-- ============================================================================
-- SCHEMA v4 MASTER FILE
--
-- Deploy:
--   pg_dump -h 127.0.0.1 -p 5433 -U postgres -F c project_brain > pre_v4.dump
--   psql "postgresql://postgres:abc123@127.0.0.1:5433/project_brain" -f schema_v4_master.sql
--
-- Requires: PostgreSQL 16+ and pgvector extension installed
--   (sudo apt-get install postgresql-16-pgvector  OR  build from source)
-- ============================================================================
\i 01_foundation.sql
\i 02_infrastructure.sql
\i 03_scheme_lifecycle.sql
\i 04_packages_tender.sql
\i 05_execution_capex.sql
\i 06_godmode_ai.sql
\i 07_views.sql
\i 08_seed.sql
