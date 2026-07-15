# Friend Project Data Port

## Source surveyed

- Extracted application: `Friend project/Project Brain`
- PostgreSQL export: `Friend project/Project Brain/project_brain_export.sql`
- Source application: FastAPI/Python backend with a Vite/React frontend and legacy desktop modules.
- Source database: 82 projects, including 62 plant-level AMR projects and COB-7 package records.

## Imported scope

| Source | Destination | Imported |
| --- | --- | ---: |
| `projects` | `scheme_master`, `packages` | 82 source projects represented as 79 schemes / 81 packages |
| `plans` | `progress_plans` | 12 |
| `activities` | `plan_activities` | 94 |
| `monthly_plans` | `monthly_plan_entries` | 2,538 |
| `daily_actuals` | `daily_actuals` | 205 |
| `appendix2` | `appendix2_revisions`, `appendix2_items` | 5 revisions / 64 leaf items / 25 categories |
| `billing_schedule` | `billing_schedules` | 72 milestones, 54 linked to Appendix-2 items |
| `plant_level_amr_details` | `plant_progress_monthly`, CAPEX values | 59 physical snapshots / 62 CAPEX rows |
| `plant_level_amr_monthly` | `capex_month_values`, `capex_actuals` | 744 valid monthly rows |

The 82 source projects become 79 schemes because four friend project rows are the three packages plus umbrella entry for the single COB-7 scheme. Five projects not present in the base database are created; the remaining 77 use explicit project-id mappings to curated schemes/packages.

## Excluded scope

- CPM and schedule import tables
- AI/RAG, embeddings, users, permissions, and assistant history
- PPE/camera/detection data and code

These exclusions apply only to the normalized operational import. On
2026-07-13, every non-security table in the friend export was also copied
byte-for-byte at the SQL-value level into the destination database's
`friend_archive` schema. This preserves 9,431 source rows across 23 tables,
including 4,481 schedule activities, approval field/history data, corporate
AMR master data, tender openings, plant EDC/IDC, and legacy DPR records.

The archive intentionally excludes password hashes, password-reset OTPs,
friend users, user preferences, and user/role permission tables. Its
`friend_archive.import_manifest` row records the source dump SHA-256, table
counts, exclusions, and import timestamp.

The 93 `daily_progress_manpower` source rows were additionally mapped into
the normalized `public.daily_progress_manpower` table using the audited
friend-project-to-scheme mapping. Existing destination rows were preserved.

## Import behavior

Run `tools/import_friend_data.py` after restoring the friend dump to a staging database. Configure connections with `FRIEND_DB_URL` and `PROJECT_BRAIN_DB_URL`.

The importer is repeatable. Imported child rows are tagged with `extra_fields.src = friend_import`, Appendix-2 billing links are preserved, and known synthetic COB-7/demo records are deactivated or removed before authoritative friend data is loaded.

## Verification completed

- Database foreign-key checks: no orphan plan months, actuals, or billing rows.
- Normalized operational layer: 79 schemes / 81 packages, with real physical/financial rows.
- Source-compatible portfolio layer: 81 leaf projects and Rs 12,301.99 Cr total cost.
- Dashboard parity: Rs 2,150.01 Cr BE, Rs 264.51 Cr actual, 45 on-time,
  1 delayed under one year, 0 delayed over one year, and 3 completed this FY.
- Dashboard classifications: approval stages 1/20/23/37 and FY-start groups
  12 current FY / 29 prior FY / 31 without implementation start.
- Upcoming parity: Corporate 3 / Rs 490.42 Cr; Plant 23 / Rs 157.96 Cr.
- MoS CAPEX parity: all 14 source rows match, including the Rs 7,216.24 Cr
  grand total and Rs 2,157.29 Cr current-FY CAPEX total.
- Physical/financial drill-down parity: 52 source project rows, with 10 shown
  individually at Rs 50 Cr or above and 42 rolled into the below-Rs-50-Cr row.
- PMC parity: all 19 corporate package blocks; COB-7 leaf package costs and
  cumulative expenditure are kept separate instead of repeating umbrella totals.
- Run `.venv/Scripts/python tools/verify_friend_parity.py` after any formula,
  import, or schema change to detect dashboard/report drift.
- Scheme 70 (`4th Stove BF#5`): April 2026 physical/financial summary, DPR actuals, and 12-point S-curve returned successfully.
- Appendix-2 scheme 70: imported revision and 13 source leaf items rendered.
- Billing package 70: 13 source milestones rendered.
- Plant package 1: imported May 2026 physical snapshot rendered.
- Browser console: no errors on dashboard, reports hub, S-curve, DPR, Appendix-2, billing, or package S-curve pages.
