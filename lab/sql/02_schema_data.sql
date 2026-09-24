-- AI DBA Platform - LAB ONLY. Runs as the lab superuser connected to shopdb.
-- Builds a deterministic, reproducible "stale statistics after nightly load" scenario.
\set ON_ERROR_STOP on
SELECT setseed(0.42);

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

SET ROLE app_owner;

CREATE TABLE public.customers (
  id         integer PRIMARY KEY,
  name       text        NOT NULL,
  region     text        NOT NULL,
  created_at timestamptz NOT NULL
);

-- Misconfiguration under test: autovacuum disabled on the table (common after a bulk-load runbook
-- that was never reverted).
CREATE TABLE public.orders (
  id          bigint PRIMARY KEY,
  customer_id integer       NOT NULL REFERENCES public.customers(id),
  status      text          NOT NULL,
  created_at  timestamptz   NOT NULL,
  total       numeric(12,2) NOT NULL
) WITH (autovacuum_enabled = false);

CREATE TABLE public.order_items (
  order_id   bigint        NOT NULL,
  line_no    smallint      NOT NULL,
  product_id integer       NOT NULL,
  qty        integer       NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  PRIMARY KEY (order_id, line_no)
);

INSERT INTO public.customers
SELECT g, 'customer_' || g,
       (ARRAY['north','south','east','west','central','andina','caribe','pacifico'])[1 + (g % 8)],
       now() - (g % 1000) * interval '1 day'
FROM generate_series(1, 50000) g;

-- Historical orders: all delivered.
INSERT INTO public.orders
SELECT g, 1 + ((g::bigint * 7919) % 50000)::int, 'delivered',
       now() - interval '400 days' + (g % 390) * interval '1 day',
       round((10 + (g % 500))::numeric, 2)
FROM generate_series(1, 400000) g;

INSERT INTO public.order_items
SELECT o, l, 1 + ((o::bigint * 31 + l) % 5000)::int, 1 + ((o + l) % 5), round((5 + ((o::bigint * l) % 200))::numeric, 2)
FROM generate_series(1, 400000) o, generate_series(1, 3) l;

CREATE INDEX orders_status_idx      ON public.orders (status);
CREATE INDEX orders_customer_id_idx ON public.orders (customer_id);

-- Statistics gathered when every order was 'delivered'.
ANALYZE public.customers;
ANALYZE public.orders;
ANALYZE public.order_items;

-- Nightly load: 150k new pending orders. autovacuum is disabled on orders, so nobody re-analyzes it.
INSERT INTO public.orders
SELECT g, 1 + ((g::bigint * 7919) % 50000)::int, 'pending',
       now() - (g % 3) * interval '1 hour',
       round((10 + (g % 500))::numeric, 2)
FROM generate_series(400001, 550000) g;

INSERT INTO public.order_items
SELECT o, l, 1 + ((o::bigint * 31 + l) % 5000)::int, 1 + ((o + l) % 5), round((5 + ((o::bigint * l) % 200))::numeric, 2)
FROM generate_series(400001, 550000) o, generate_series(1, 3) l;

-- order_items keeps autovacuum on; gather its stats now so only orders is stale (deterministic).
ANALYZE public.order_items;

RESET ROLE;

-- Least privilege grants.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_user, dba_agent_ro, dba_agent_exec;
GRANT SELECT, INSERT, UPDATE ON public.customers, public.orders, public.order_items TO app_user;
-- Read-only agent needs SELECT for EXPLAIN of registered probes.
GRANT SELECT ON public.customers, public.orders, public.order_items TO dba_agent_ro;
-- Exec agent: MAINTAIN only (PostgreSQL 17+): ANALYZE/VACUUM/REINDEX, no DML, no ALTER.
GRANT MAINTAIN ON public.customers, public.orders, public.order_items TO dba_agent_exec;

SELECT pg_stat_statements_reset();
