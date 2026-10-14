"""Offline checks for the deliberately narrow live-test SQL guard."""
import unittest
from select_ai_inventory_live import checked_sql


class QueryGuardTest(unittest.TestCase):
    def test_inventory_select(self):
        sql = 'SELECT "r"."PRODUCT_ID" FROM "FINANCIAL"."SC_INVENTORY_RISK_SUMMARY" "r"'
        self.assertEqual(checked_sql(sql), sql)

    def test_quarter_expression(self):
        checked_sql("SELECT PRODUCT_ID FROM FINANCIAL.SC_INVENTORY_RISK_SUMMARY WHERE QUARTER_LABEL=TO_CHAR(ADD_MONTHS(SYSDATE,3),'YYYY')||'-Q'||TO_CHAR(ADD_MONTHS(SYSDATE,3),'Q')")

    def test_reject_out_of_scope(self):
        for sql in [
            'DELETE FROM FINANCIAL.SC_PRODUCTS',
            'SELECT * FROM FINANCIAL.SC_PRODUCTS; DROP TABLE x',
            'SELECT * FROM FINANCIAL.SC_PRODUCTS@remote',
            'SELECT * FROM ALL_USERS',
            "SELECT UTL_HTTP.REQUEST('https://example.com') FROM FINANCIAL.SC_PRODUCTS",
            'SELECT * FROM FINANCIAL.SC_PRODUCTS FOR UPDATE',
            'SELECT /* hint */ * FROM FINANCIAL.SC_PRODUCTS',
        ]:
            with self.subTest(sql=sql), self.assertRaises(ValueError):
                checked_sql(sql)


if __name__ == '__main__':
    unittest.main()
