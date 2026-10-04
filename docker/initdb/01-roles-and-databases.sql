-- Creates the two local databases and the two non-superuser roles required by
-- Plan.md section 4.4: a migration role that owns the schema, and a restricted
-- runtime role used by the application and by integration tests.
--
-- Runs once, on first initialisation of the data volume.

\set migrator_password `echo "$PENTA_MIGRATOR_PASSWORD"`
\set app_password `echo "$PENTA_APP_PASSWORD"`

-- Schema owner. Runs migrations. Not a superuser.
CREATE ROLE penta_migrator LOGIN PASSWORD :'migrator_password';

-- Application runtime. Not a superuser, owns nothing, cannot run DDL.
-- Table-level privileges are granted by the migrations themselves.
CREATE ROLE penta_app LOGIN PASSWORD :'app_password';

CREATE DATABASE penta_crm_dev OWNER penta_migrator;
CREATE DATABASE penta_crm_test OWNER penta_migrator;

-- Lock down the public schema in both databases and make sure anything the
-- migrator creates later is reachable (but not owned) by the runtime role.
\connect penta_crm_dev
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE penta_crm_dev FROM PUBLIC;
GRANT CONNECT ON DATABASE penta_crm_dev TO penta_app, penta_migrator;
ALTER SCHEMA public OWNER TO penta_migrator;
GRANT USAGE ON SCHEMA public TO penta_app;

\connect penta_crm_test
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE penta_crm_test FROM PUBLIC;
GRANT CONNECT ON DATABASE penta_crm_test TO penta_app, penta_migrator;
ALTER SCHEMA public OWNER TO penta_migrator;
GRANT USAGE ON SCHEMA public TO penta_app;
