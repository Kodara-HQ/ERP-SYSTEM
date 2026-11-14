-- BAJOGO ERP — database and role on a shared PostgreSQL server.
-- Run once as the postgres superuser:
--   sudo -u postgres psql -f deploy/postgres-setup.sql
-- Replace the password first. Each application on the server should have its
-- own role and database like this, so one app cannot read another's data.

CREATE ROLE bajogo_app LOGIN PASSWORD 'replace-with-a-strong-password';
CREATE DATABASE bajogo_erp OWNER bajogo_app ENCODING 'UTF8';
REVOKE ALL ON DATABASE bajogo_erp FROM PUBLIC;
GRANT ALL ON DATABASE bajogo_erp TO bajogo_app;
