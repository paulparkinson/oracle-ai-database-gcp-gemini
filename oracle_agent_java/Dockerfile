FROM maven:3.9.11-eclipse-temurin-21 AS build

WORKDIR /workspace
COPY oracle_agent_java/pom.xml oracle_agent_java/pom.xml
COPY oracle_agent_java/src oracle_agent_java/src
RUN mvn -q -f oracle_agent_java/pom.xml -DskipTests package

FROM eclipse-temurin:21-jre-jammy
WORKDIR /opt/app
COPY --from=build /workspace/oracle_agent_java/target/oracle-graph-agent-0.0.1-SNAPSHOT.jar app.jar
ENV SERVER_ADDRESS=0.0.0.0
ENTRYPOINT ["java", "-Djava.awt.headless=true", "-jar", "/opt/app/app.jar", "--server.address=0.0.0.0"]
