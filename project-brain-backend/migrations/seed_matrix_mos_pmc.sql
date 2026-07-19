-- =========================================================================
-- Matrix Engine seed — standard PSU classification rules + the MoS PMC
-- "Overview of RSP CAPEX projects" report, ready to run for any month.
-- Idempotent: safe to re-run.
-- =========================================================================

INSERT INTO rs_rules (rule_key, rule_name, description, condition) VALUES
('ongoing', 'Ongoing Schemes', 'Lifecycle status = ongoing',
 '{"op":"AND","conditions":[{"field":"current_status","op":"=","value":"ongoing"}]}'),
('completed', 'Completed Schemes', NULL,
 '{"op":"AND","conditions":[{"field":"current_status","op":"=","value":"completed"}]}'),
('corporate', 'Corporate Schemes', 'Approval level: corporate',
 '{"op":"AND","conditions":[{"field":"scheme_type","op":"=","value":"corporate"}]}'),
('plant_lt30', 'Plant AMR (< 30 Cr)', 'Plant-level below cost threshold',
 '{"op":"AND","conditions":[{"field":"scheme_type","op":"=","value":"plant"},{"field":"applicable_cost","op":"<","value":30}]}'),
('impl_prev_fy', 'Implemented from previous FY', 'Effective start before selected FY',
 '{"op":"AND","conditions":[{"field":"effective_start","op":"<","value":{"token":"fy_start"}}]}'),
('impl_this_fy', 'Started during selected FY', NULL,
 '{"op":"AND","conditions":[{"field":"effective_start","op":">=","value":{"token":"fy_start"}},{"field":"effective_start","op":"<=","value":{"token":"fy_end"}}]}'),
('on_time', 'On Time', 'No delay at reporting date (uses applicable completion date)',
 '{"op":"AND","conditions":[{"field":"delay_days","op":"=","value":0}]}'),
('delay_lt1', 'Delayed < 1 year', NULL,
 '{"op":"AND","conditions":[{"field":"delay_days","op":">","value":0},{"field":"delay_days","op":"<","value":365}]}'),
('delay_gt1', 'Delayed > 1 year', NULL,
 '{"op":"AND","conditions":[{"field":"delay_days","op":">=","value":365}]}')
ON CONFLICT (rule_key) DO NOTHING;

INSERT INTO rs_matrix_reports (name, description, definition)
SELECT 'MoS CAPEX Overview (PMC)',
       'Overview of RSP CAPEX projects — spec-format hierarchical report, period-sensitive',
       '{
  "columns": [
    {"key":"n","name":"Total no. of Projects","measure":{"field":"scheme_id","agg":"count_distinct"}},
    {"key":"cost","name":"Total cost of Projects","measure":{"field":"applicable_cost","agg":"sum"}},
    {"key":"prev","name":"Expenditure up to prev FY","measure":{"field":"exp_prev_fy","agg":"sum"}},
    {"key":"be","name":"CAPEX (BE)","measure":{"field":"be_fy","agg":"sum"}},
    {"key":"exp","name":"Expenditure in FY","measure":{"field":"exp_fy","agg":"sum"}},
    {"key":"tot","name":"Total Expenditure","measure":{"field":"total_exp","agg":"sum"}}
  ],
  "rows": [
    {"id":"ongoing","name":"Total Ongoing projects","rule":"ongoing","recon":"exclusive_exhaustive","children":[
      {"id":"prevfy","name":"Being implemented from last FY","rule":"impl_prev_fy","recon":"exclusive_exhaustive","children":[
        {"id":"pf_corp","name":"Corporate AMR","rule":"corporate","recon":"exclusive_exhaustive","children":[
          {"id":"pfc_ot","name":"Ontime","rule":"on_time"},
          {"id":"pfc_d1","name":"Delay<1","rule":"delay_lt1"},
          {"id":"pfc_dg","name":"Delay>1","rule":"delay_gt1"}]},
        {"id":"pf_plant","name":"Plant AMR(<30 Cr.)","rule":"plant_lt30","recon":"exclusive_exhaustive","children":[
          {"id":"pfp_ot","name":"Ontime","rule":"on_time"},
          {"id":"pfp_d1","name":"Delay<1","rule":"delay_lt1"},
          {"id":"pfp_dg","name":"Delay>1","rule":"delay_gt1"}]}
      ]},
      {"id":"thisfy","name":"Implementation started during FY","rule":"impl_this_fy","recon":"exclusive_exhaustive","children":[
        {"id":"tf_corp","name":"Corporate AMR","rule":"corporate","children":[
          {"id":"tfc_ot","name":"Ontime","rule":"on_time"},
          {"id":"tfc_d1","name":"Delay<1","rule":"delay_lt1"},
          {"id":"tfc_dg","name":"Delay>1","rule":"delay_gt1"}]},
        {"id":"tf_plant","name":"Plant AMR(<30 Cr.)","rule":"plant_lt30","children":[
          {"id":"tfp_ot","name":"Ontime","rule":"on_time"},
          {"id":"tfp_d1","name":"Delay<1","rule":"delay_lt1"},
          {"id":"tfp_dg","name":"Delay>1","rule":"delay_gt1"}]}
      ]}
    ]}
  ]
}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM rs_matrix_reports WHERE name = 'MoS CAPEX Overview (PMC)');
