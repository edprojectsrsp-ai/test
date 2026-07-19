-- =========================================================================
-- Matrix Engine M3 — Productivity.
--   rs_section_templates (spec §5.8): reusable row subtrees. Inserted under
--   any parent, they inherit that parent's full rule chain automatically —
--   the same Delay triplet works under Corporate, Plant, department, etc.
-- Idempotent.
-- =========================================================================

CREATE TABLE IF NOT EXISTS rs_section_templates (
    template_key TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    rows         JSONB NOT NULL,           -- row subtree WITHOUT ids (assigned on insert)
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO rs_section_templates (template_key, name, description, rows) VALUES
('delay_triplet', 'Delay classification (Ontime / <1yr / >1yr)',
 'Standard MoS timeline split — mutually exclusive and exhaustive under any parent',
 '[{"name":"Ontime","rule":"on_time"},
   {"name":"Delay<1","rule":"delay_lt1"},
   {"name":"Delay>1","rule":"delay_gt1"}]'::jsonb),
('corp_plant_split', 'Corporate / Plant(<30Cr) split with delay triplets',
 'Two-level MoS section',
 '[{"name":"Corporate AMR","rule":"corporate","recon":"exclusive_exhaustive","children":[
     {"name":"Ontime","rule":"on_time"},{"name":"Delay<1","rule":"delay_lt1"},{"name":"Delay>1","rule":"delay_gt1"}]},
   {"name":"Plant AMR(<30 Cr.)","rule":"plant_lt30","recon":"exclusive_exhaustive","children":[
     {"name":"Ontime","rule":"on_time"},{"name":"Delay<1","rule":"delay_lt1"},{"name":"Delay>1","rule":"delay_gt1"}]}]'::jsonb)
ON CONFLICT (template_key) DO NOTHING;
