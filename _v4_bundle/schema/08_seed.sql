-- ============================================================================
-- 08 SEED DATA — admin user, roles, default templates, default permissions
--    (The real 74 schemes get loaded by the preseeder Python script)
-- ============================================================================
BEGIN;

INSERT INTO users (username, email, full_name, designation, role, password_hash, is_active) VALUES
    ('admin', 'admin@rsp.sail.local', 'System Administrator', 'Admin', 'admin',
     crypt('admin123', gen_salt('bf', 10)), TRUE),
    ('system', 'system@rsp.sail.local', 'System', 'System', 'admin', NULL, TRUE);

INSERT INTO role_permissions (role, module_key, can_view, can_edit, can_approve, can_delete) VALUES
    ('admin','schemes',TRUE,TRUE,TRUE,TRUE), ('admin','packages',TRUE,TRUE,TRUE,TRUE),
    ('admin','appendix2',TRUE,TRUE,TRUE,TRUE), ('admin','plans',TRUE,TRUE,TRUE,TRUE),
    ('admin','capex',TRUE,TRUE,TRUE,TRUE), ('admin','billing',TRUE,TRUE,TRUE,TRUE),
    ('admin','users',TRUE,TRUE,TRUE,TRUE), ('admin','ai',TRUE,TRUE,FALSE,FALSE),
    ('admin','documents',TRUE,TRUE,TRUE,TRUE),
    ('manager','schemes',TRUE,TRUE,TRUE,FALSE), ('manager','packages',TRUE,TRUE,TRUE,FALSE),
    ('manager','appendix2',TRUE,TRUE,TRUE,FALSE), ('manager','plans',TRUE,TRUE,TRUE,FALSE),
    ('manager','capex',TRUE,TRUE,TRUE,FALSE), ('manager','billing',TRUE,TRUE,TRUE,FALSE),
    ('manager','ai',TRUE,TRUE,FALSE,FALSE), ('manager','documents',TRUE,TRUE,TRUE,FALSE),
    ('engineer','schemes',TRUE,FALSE,FALSE,FALSE), ('engineer','packages',TRUE,TRUE,FALSE,FALSE),
    ('engineer','appendix2',TRUE,TRUE,FALSE,FALSE), ('engineer','plans',TRUE,TRUE,FALSE,FALSE),
    ('engineer','capex',TRUE,FALSE,FALSE,FALSE), ('engineer','billing',TRUE,FALSE,FALSE,FALSE),
    ('engineer','ai',TRUE,TRUE,FALSE,FALSE), ('engineer','documents',TRUE,TRUE,FALSE,FALSE),
    ('site_engineer','schemes',TRUE,FALSE,FALSE,FALSE),
    ('site_engineer','packages',TRUE,FALSE,FALSE,FALSE),
    ('site_engineer','daily_progress',TRUE,TRUE,FALSE,FALSE),
    ('site_engineer','observations',TRUE,TRUE,FALSE,FALSE),
    ('site_engineer','ai',TRUE,TRUE,FALSE,FALSE),
    ('viewer','schemes',TRUE,FALSE,FALSE,FALSE), ('viewer','packages',TRUE,FALSE,FALSE,FALSE),
    ('viewer','appendix2',TRUE,FALSE,FALSE,FALSE), ('viewer','ai',TRUE,FALSE,FALSE,FALSE),
    ('viewer','documents',TRUE,FALSE,FALSE,FALSE);

INSERT INTO uom_master (uom_code, uom_name, uom_category) VALUES
    ('MT','Metric Tonne','weight'), ('KG','Kilogram','weight'),
    ('M3','Cubic Metre','volume'), ('M2','Square Metre','area'),
    ('RM','Running Metre','length'), ('NOS','Numbers','count'),
    ('LS','Lump Sum','lump_sum'), ('SET','Set','count');

INSERT INTO appendix2_templates (template_name, description, scope_keywords, target_scheme_type, is_global) VALUES
    ('Standard Civil + Mechanical','Default for plant projects',
     ARRAY['civil','mechanical','foundation','rcc','erection'], NULL, TRUE),
    ('Heavy Mechanical (Coke Oven / Caster)','Optimized for COB and caster',
     ARRAY['coke','oven','caster','blast','furnace','heavy-mech'], 'corporate', TRUE),
    ('Electrical & Instrumentation','For E&I-dominated scope',
     ARRAY['electrical','instrumentation','substation','cable','control-room'], NULL, TRUE),
    ('Modernisation / Revamp','For brownfield modernisation',
     ARRAY['modernisation','revamp','retrofit','upgrade','phased'], NULL, TRUE);

INSERT INTO custom_field_definitions (entity_type, field_key, field_label, field_type, sort_order, description) VALUES
    ('scheme','priority','Priority','select',10,'Strategic priority level'),
    ('scheme','env_clearance_no','Env. Clearance No.','text',20,'Environmental clearance reference'),
    ('scheme','risk_category','Risk Category','select',30,'Strategic risk classification'),
    ('package','shutdown_window','Shutdown Window','text',10,'Required shutdown period'),
    ('package','safety_score','Safety Score','percent',20,'Current safety performance');

UPDATE custom_field_definitions SET options='["P0-Critical","P1-High","P2-Normal","P3-Low"]'::jsonb
WHERE entity_type='scheme' AND field_key='priority';
UPDATE custom_field_definitions
SET options='["Financial","Schedule","Technical","Regulatory","Strategic"]'::jsonb
WHERE entity_type='scheme' AND field_key='risk_category';

INSERT INTO monitoring_log(event_type,severity,source,message,payload)
VALUES('schema_migration','info','schema_v4_master.sql','Schema v4 deployed',
    jsonb_build_object(
        'tables', (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'),
        'views', (SELECT COUNT(*) FROM information_schema.views WHERE table_schema='public'),
        'enums', (SELECT COUNT(*) FROM pg_type WHERE typtype='e')));

COMMIT;

\echo '============================================================'
\echo '  Schema v4 deployed:'
SELECT 'tables: '||COUNT(*)::text FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
UNION ALL SELECT 'views: '||COUNT(*)::text FROM information_schema.views WHERE table_schema='public'
UNION ALL SELECT 'enums: '||COUNT(*)::text FROM pg_type WHERE typtype='e'
UNION ALL SELECT 'triggers: '||COUNT(*)::text FROM information_schema.triggers WHERE trigger_schema='public';
\echo '============================================================'
