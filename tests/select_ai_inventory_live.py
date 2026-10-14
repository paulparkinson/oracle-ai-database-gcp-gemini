"""Opt-in live Gemini inventory regression; no profile or inventory writes.

Run from the SQLcl/GCP VM with Python oracledb and python-dotenv installed:
  python tests/select_ai_inventory_live.py --profile PROFILE --repeats 2
Generated SQL is restricted to this small test's tables/functions and run in a
read-only transaction. This test guard is not an arbitrary-SQL security gateway.
"""
import argparse
import json
import re
import time
from pathlib import Path

FIELDS = ('PRODUCT_ID', 'PRODUCT_NAME', 'QUARTER_LABEL',
          'STOCKOUT_PROBABILITY', 'PRIMARY_REGION')
BASE = """SELECT r.PRODUCT_ID, p.PRODUCT_NAME, r.QUARTER_LABEL,
 r.STOCKOUT_PROBABILITY, r.PRIMARY_REGION
 FROM FINANCIAL.SC_INVENTORY_RISK_SUMMARY r
 JOIN FINANCIAL.SC_PRODUCTS p ON p.PRODUCT_ID=r.PRODUCT_ID
 WHERE r.ACTIVE_FLAG='Y' AND r.STOCKOUT_PROBABILITY>0 AND """
LATEST = "r.QUARTER_LABEL=(SELECT MAX(QUARTER_LABEL) FROM FINANCIAL.SC_INVENTORY_RISK_SUMMARY)"
NEXT = "r.QUARTER_LABEL=TO_CHAR(ADD_MONTHS(SYSDATE,3),'YYYY')||'-Q'||TO_CHAR(ADD_MONTHS(SYSDATE,3),'Q')"
ORDER = ' ORDER BY r.STOCKOUT_PROBABILITY DESC, r.PRODUCT_ID'
CASES = [
    ('latest', 'List SKUs with risk of stock outages, highest risk first.', LATEST),
    ('next', 'Which products are at risk of stockouts next quarter, and which regions are driving that risk?', NEXT),
    ('next-reworded', 'Identify the products at risk of stockouts next quarter and which regions are driving that risk.', NEXT),
    ('sku', 'Show the stockout risk for SKU-700 in the latest stored quarter.', LATEST + " AND r.PRODUCT_ID='SKU-700'"),
]


def checked_sql(sql):
    sql = sql.strip()
    if not re.match(r'^SELECT\s', sql, re.I) or any(s in sql for s in (';', '--', '/*', '@', '`')):
        raise ValueError('Expected one plain SELECT, without comments or a database link')
    masked = re.sub(r"'(?:''|[^'])*'", "''", sql).replace('"', '').upper()
    if re.search(r'\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|EXECUTE|CALL|BEGIN|COMMIT|ROLLBACK|FOR|CONNECT|MODEL|UNION|INTERSECT|MINUS)\b', masked):
        raise ValueError('Unexpected SQL construct')
    functions = set(re.findall(r'\b([A-Z_][A-Z0-9_$#.]*)\s*\(', masked))
    if functions - {'TO_CHAR', 'ADD_MONTHS', 'MAX', 'UPPER', 'TRUNC', 'IN', 'EXISTS'}:
        raise ValueError('Unexpected SQL function: ' + str(functions))
    tables = re.findall(r'\b(?:FROM|JOIN)\s+([A-Z_][A-Z0-9_$.#]*)', masked)
    if not tables or any(t not in {'FINANCIAL.SC_INVENTORY_RISK_SUMMARY', 'FINANCIAL.SC_PRODUCTS',
                                  'SC_INVENTORY_RISK_SUMMARY', 'SC_PRODUCTS'} for t in tables):
        raise ValueError('Query is outside the inventory regression scope')
    return sql


def read_rows(c, sql):
    c.rollback()
    with c.cursor() as q:
        q.execute('SET TRANSACTION READ ONLY')
        try:
            q.execute(sql)
            names = [d[0].upper() for d in q.description]
            if any(names.count(f) != 1 for f in FIELDS):
                raise AssertionError('Missing or duplicate output columns: ' + str(names))
            rows = q.fetchmany(1001)
            if len(rows) >= 1001:
                raise AssertionError('Unexpected result size')
            return [tuple(row[names.index(f)] for f in FIELDS) for row in rows]
        finally:
            c.rollback()


def run(c, profile, repeats=2):
    with c.cursor() as q:
        q.execute("select attribute_value from user_cloud_ai_profile_attributes where profile_name=:p and attribute_name='model'", p=profile)
        model = q.fetchone()
        if not model or str(model[0]) != 'gemini-3.7-flash':
            raise AssertionError('Select an existing gemini-3.7-flash profile')
    results = []
    for repeat in range(repeats):
        for name, prompt, predicate in CASES:
            start = time.monotonic()
            with c.cursor() as q:
                q.execute("select dbms_cloud_ai.generate(prompt=>:p,profile_name=>:n,action=>'showsql') from dual", p=prompt, n=profile)
                sql = q.fetchone()[0]
                sql = sql.read() if hasattr(sql, 'read') else sql
            print(json.dumps({'case': name, 'repeat': repeat + 1, 'generatedSql': sql}), flush=True)
            actual = read_rows(c, checked_sql(sql))
            expected = read_rows(c, BASE + predicate + ORDER)
            if actual != expected:
                raise AssertionError(f'{name}: generated query rows/order differ from direct SQL: {actual!r} != {expected!r}')
            result = {'case': name, 'repeat': repeat + 1, 'rows': len(actual),
                      'seconds': round(time.monotonic() - start, 1), 'passed': True}
            results.append(result)
            print(json.dumps(result), flush=True)
    return results


if __name__ == '__main__':
    import oracledb
    from dotenv import dotenv_values
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', required=True)
    parser.add_argument('--repeats', type=int, choices=range(1, 6), default=2)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    env = dotenv_values(root / '.env')
    wallet = env.get('DB_WALLET_DIR') or env.get('TNS_ADMIN')
    with oracledb.connect(user=env['DB_USERNAME'], password=env['DB_PASSWORD'], dsn=env['DB_DSN'],
                          config_dir=wallet, wallet_location=wallet, wallet_password=env.get('DB_WALLET_PASSWORD')) as conn:
        conn.call_timeout = 180000
        results = run(conn, args.profile.upper(), args.repeats)
        print(json.dumps({'passed': len(results), 'model': 'gemini-3.7-flash'}))
