-- AI DBA Platform - LAB ONLY. Runs as the lab superuser against the isolated lab cluster.
-- Passwords come from environment variables via \getenv; they never appear in this file.
\set ON_ERROR_STOP on
\getenv ro_pw   DBA_AGENT_RO_PASSWORD
\getenv exec_pw DBA_AGENT_EXEC_PASSWORD
\getenv app_pw  LAB_APP_PASSWORD

DROP DATABASE IF EXISTS shopdb WITH (FORCE);
DROP ROLE IF EXISTS dba_agent_ro;
DROP ROLE IF EXISTS dba_agent_exec;
DROP ROLE IF EXISTS app_user;
DROP ROLE IF EXISTS app_owner;

-- Owner of business objects. Cannot log in.
CREATE ROLE app_owner NOLOGIN;
-- Application workload identity.
CREATE ROLE app_user LOGIN PASSWORD :'app_pw' CONNECTION LIMIT 10;

-- AI DBA read-only identity: assessment, monitoring, diagnostics, evidence.
CREATE ROLE dba_agent_ro LOGIN PASSWORD :'ro_pw' CONNECTION LIMIT 3
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT pg_monitor TO dba_agent_ro;
ALTER ROLE dba_agent_ro SET default_transaction_read_only = on;
ALTER ROLE dba_agent_ro SET statement_timeout = '5s';
ALTER ROLE dba_agent_ro SET lock_timeout = '1s';
ALTER ROLE dba_agent_ro SET idle_in_transaction_session_timeout = '10s';

-- AI DBA execution identity: only explicitly authorized maintenance actions.
CREATE ROLE dba_agent_exec LOGIN PASSWORD :'exec_pw' CONNECTION LIMIT 2
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE dba_agent_exec SET statement_timeout = '60s';
ALTER ROLE dba_agent_exec SET lock_timeout = '3s';

CREATE DATABASE shopdb OWNER app_owner;
REVOKE ALL ON DATABASE shopdb FROM PUBLIC;
GRANT CONNECT ON DATABASE shopdb TO app_user, dba_agent_ro, dba_agent_exec;
