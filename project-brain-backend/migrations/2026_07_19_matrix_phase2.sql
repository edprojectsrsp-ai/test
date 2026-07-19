-- =========================================================================
-- Matrix Engine phase 2 — full metadata configurability (no hardcoded logic).
--   rs_datasets   admin-defined dataset: base SQL + fields + derived formulas
--   rs_measures   user-defined measure library (agg / weighted / formula)
-- Seeds convert the previously built-in scheme dataset and standard MoS
-- measures into plain configuration rows — the engine has no privileged path.
-- Idempotent.
-- =========================================================================

CREATE TABLE IF NOT EXISTS rs_datasets (
    dataset_key TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    base_sql    TEXT NOT NULL,             -- SELECT with :fy/:prev_fy/:report_date params
    id_field    TEXT NOT NULL DEFAULT 'scheme_id',
    name_field  TEXT NOT NULL DEFAULT 'scheme_name',
    fields      JSONB NOT NULL,            -- [{key,label,type}]
    derived     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{key,label,type,expr}]
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by  VARCHAR(100),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rs_measures (
    measure_key  TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    kind         TEXT NOT NULL DEFAULT 'agg' CHECK (kind IN ('agg','formula')),
    field        TEXT,                     -- agg source field
    agg          TEXT,                     -- sum|count|count_distinct|avg|min|max|median|weighted_avg
    weight_field TEXT,                     -- for weighted_avg
    expr         TEXT,                     -- formula over other column keys / measures
    unit         TEXT,
    decimals     INTEGER DEFAULT 2,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- seed:
-- The scheme dataset, exactly as previously hardcoded — now editable config.
INSERT INTO rs_datasets (dataset_key, name, base_sql, id_field, name_field, fields, derived)
SELECT 'schemes', 'RSP Schemes (CAPEX-linked)',
$SQL$
WITH be AS (
  SELECT r.scheme_id, SUM(cmv.be_amount) AS be_fy
  FROM capex_month_values cmv
  JOIN capex_plan_rows r ON r.id = cmv.plan_row_id
  JOIN capex_plan_header h ON h.id = r.plan_id
  WHERE h.fy_year = :fy AND h.plan_type = 'BE'
    AND (h.is_effective = 1 OR NOT EXISTS
         (SELECT 1 FROM capex_plan_header h2
          WHERE h2.fy_year = :fy AND h2.plan_type = 'BE' AND h2.is_effective = 1))
  GROUP BY r.scheme_id),
re AS (
  SELECT r.scheme_id, SUM(cmv.re_amount) AS re_fy
  FROM capex_month_values cmv
  JOIN capex_plan_rows r ON r.id = cmv.plan_row_id
  JOIN capex_plan_header h ON h.id = r.plan_id
  WHERE h.fy_year = :fy AND h.plan_type = 'RE'
  GROUP BY r.scheme_id),
prev_exp AS (
  SELECT r.scheme_id, SUM(v.cumulative_exp_till_last_fy) AS exp_prev_fy
  FROM capex_plan_rows r
  JOIN capex_plan_header h ON h.id = r.plan_id
  LEFT JOIN capex_plan_values v ON v.plan_row_id = r.id
  WHERE h.fy_year = :fy
  GROUP BY r.scheme_id),
fy_exp AS (
  SELECT r.scheme_id, SUM(a.amount) AS exp_fy
  FROM capex_actuals a
  JOIN capex_plan_rows r ON r.id = a.plan_row_id
  WHERE a.fy_year = :fy
  GROUP BY r.scheme_id)
SELECT s.scheme_id, s.scheme_name, s.scheme_code, s.scheme_type,
       s.current_status,
       s.estimated_cost_cr  AS estimated_cost,
       s.sanctioned_cost_cr AS sanctioned_cost,
       s.anticipated_cost_cr AS anticipated_cost,
       s.planned_start_date AS planned_start,
       s.actual_start_date  AS actual_start,
       s.planned_completion_date AS planned_completion,
       NULLIF(s.extra_fields->>'revised_completion_date','')::date AS revised_completion,
       s.actual_completion_date AS actual_completion,
       COALESCE(p.exp_prev_fy, 0) AS exp_prev_fy,
       COALESCE(b.be_fy, 0)       AS be_fy,
       COALESCE(re.re_fy, 0)      AS re_fy,
       COALESCE(f.exp_fy, 0)      AS exp_fy
FROM scheme_master s
LEFT JOIN be b ON b.scheme_id = s.scheme_id
LEFT JOIN re ON re.scheme_id = s.scheme_id
LEFT JOIN prev_exp p ON p.scheme_id = s.scheme_id
LEFT JOIN fy_exp f ON f.scheme_id = s.scheme_id
WHERE NOT COALESCE(s.is_deleted, FALSE)
ORDER BY s.scheme_id
$SQL$,
'scheme_id', 'scheme_name',
'[
 {"key":"scheme_id","label":"Scheme ID","type":"number"},
 {"key":"scheme_name","label":"Scheme Name","type":"text"},
 {"key":"scheme_code","label":"Scheme Code","type":"text"},
 {"key":"scheme_type","label":"Scheme Category","type":"text"},
 {"key":"current_status","label":"Lifecycle Status","type":"text"},
 {"key":"estimated_cost","label":"Estimated Cost (Cr)","type":"number"},
 {"key":"sanctioned_cost","label":"Sanctioned Cost (Cr)","type":"number"},
 {"key":"anticipated_cost","label":"Anticipated Cost (Cr)","type":"number"},
 {"key":"planned_start","label":"Planned Start","type":"date"},
 {"key":"actual_start","label":"Actual Start","type":"date"},
 {"key":"planned_completion","label":"Original Completion Date","type":"date"},
 {"key":"revised_completion","label":"Approved Revised Completion","type":"date"},
 {"key":"actual_completion","label":"Actual Completion","type":"date"},
 {"key":"exp_prev_fy","label":"Expenditure up to Previous FY (Cr)","type":"number"},
 {"key":"be_fy","label":"BE for Selected FY (Cr)","type":"number"},
 {"key":"re_fy","label":"RE for Selected FY (Cr)","type":"number"},
 {"key":"exp_fy","label":"Expenditure in Selected FY (Cr)","type":"number"}
]'::jsonb,
'[
 {"key":"total_exp","label":"Total Expenditure (Cr)","type":"number",
  "expr":"coalesce(exp_prev_fy,0) + coalesce(exp_fy,0)"},
 {"key":"applicable_completion","label":"Applicable Completion (revised else original)","type":"date",
  "expr":"coalesce(revised_completion, planned_completion)"},
 {"key":"applicable_cost","label":"Applicable Cost (sanctioned else estimated)","type":"number",
  "expr":"if(sanctioned_cost != null and sanctioned_cost != 0, sanctioned_cost, estimated_cost)"},
 {"key":"effective_start","label":"Effective Start (actual else planned)","type":"date",
  "expr":"coalesce(actual_start, planned_start)"},
 {"key":"delay_days","label":"Delay Days at Reporting Date","type":"number",
  "expr":"if(applicable_completion != null and report_date > applicable_completion and actual_completion = null, days_between(applicable_completion, report_date), 0)"}
]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM rs_datasets WHERE dataset_key = 'schemes');

-- Standard MoS/PMC measure library (spec §4.2 examples as config)
INSERT INTO rs_measures (measure_key, name, kind, field, agg, expr, unit, decimals) VALUES
('scheme_count',   'Number of Schemes', 'agg', 'scheme_id', 'count_distinct', NULL, 'nos', 0),
('project_cost',   'Total Project Cost', 'agg', 'applicable_cost', 'sum', NULL, '₹ Cr', 2),
('prev_fy_exp',    'Expenditure up to Previous FY', 'agg', 'exp_prev_fy', 'sum', NULL, '₹ Cr', 2),
('be',             'Budget Estimate (BE)', 'agg', 'be_fy', 'sum', NULL, '₹ Cr', 2),
('re',             'Revised Estimate (RE)', 'agg', 're_fy', 'sum', NULL, '₹ Cr', 2),
('fy_exp',         'Expenditure in Selected FY', 'agg', 'exp_fy', 'sum', NULL, '₹ Cr', 2),
('total_exp',      'Total Expenditure', 'agg', 'total_exp', 'sum', NULL, '₹ Cr', 2),
('avg_delay',      'Average Delay (days)', 'agg', 'delay_days', 'avg', NULL, 'days', 0),
('cost_wtd_delay', 'Cost-weighted Delay (days)', 'agg', 'delay_days', 'weighted_avg', NULL, 'days', 0),
('budget_util',    'Budget Utilisation %', 'formula', NULL, NULL, 'if(be > 0, fy_exp / be * 100, null)', '%', 1),
('fin_progress',   'Financial Progress %', 'formula', NULL, NULL, 'if(cost > 0, total / cost * 100, null)', '%', 1)
ON CONFLICT (measure_key) DO NOTHING;
UPDATE rs_measures SET weight_field = 'applicable_cost' WHERE measure_key = 'cost_wtd_delay';
