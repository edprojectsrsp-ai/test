# Project Brain — Roadmap & Competitive Position

*Updated 19 Jul 2026. Benchmark set: Bentley SYNCHRO (4D/Cost/Perform/Control),
Oracle Primavera P6 + Unifier + Aconex, Hexagon EcoSys, InEight, Wrench
SmartProject. Positioning: the owner-side PSU monitoring + ministry-reporting +
forensic-delay + AI stack that none of them ship.*

## Shipped (verified against live Postgres + hand calculations)

| Capability | Module | Benchmark equivalent |
|---|---|---|
| CPM engine (FS/SS/FF/SF, constraints, float) | CPM Studio | P6 core |
| Forensic delay analysis — 5 SCL/AACE methods | Delay Studio | **Nobody ships this** |
| Earned Value: PV/EV/AC, SPI/CPI, 3× EAC, TCPI, portfolio health board | EVM Studio | EcoSys / SYNCHRO Cost |
| Monte Carlo QSRA: P10-P90, criticality index, tornado drivers | `/qsra` API | Primavera Risk / Safran |
| XER (P6) + MPP import | cpm_importers | Interop table stakes |
| Semantic self-serve BI: Matrix Builder + Dashboard Canvas (cross-filter, slicers) | Report Studio | Power BI embedded |
| **Metadata report platform**: versioned rules, inherited hierarchies, period-sensitive classification, cell drill-down, reconciliation, frozen snapshots | Matrix Engine | **Nobody ships this either** |
| Hybrid RAG + knowledge graph + chat with charts + ~20 DB tools | AI service | SYNCHRO still sells "dashboards" |
| Telegram assistant + scheduled daily/weekly digests (`/digest`) | report_push | — |
| MoS CAPEX / PMC / Board formats, Indian FY, notesheets | Reports Hub | — |

## Next: Matrix Engine phase 2 (spec §5.6–§5.10, §10–§14)
- **Excel export in exact MoS layout** (merged cells, indentation, borders) — openpyxl composer fed by the run grid; the uploaded PMC workbook is the golden reference.
- Calculated/variance/percentage rows; formula cells referencing other cells.
- Manual adjustments with reason + approval + calculated-vs-final display (§10).
- Data-quality rules (§11): missing dates, exp > cost, progress > 100 — drillable pre-flight panel before freeze.
- Snapshot compare: live vs approved vs previous month, cell-level deltas with "why it changed" (rule version diff + population diff).
- AI-assist (§18): natural language → draft rule (deterministic engine executes; user reviews, previews, versions); Excel upload → auto-mapped report skeleton.
- Row/section templates (§5.8): reusable delay-triplet blocks.
- RBAC: rule publisher / report approver / read-only roles on the existing admin_rbac layer.

## Differentiator plays
- **4D BIM ↔ CPM linkage**: bind web-ifc model elements to activities, timeline playback, paint-by-status — SYNCHRO's moat, buildable on parts already in repo.
- **Risk-adjusted board reporting**: P80 dates from QSRA flow straight into MoS formats — "committed vs P80" column no competitor prints.
- **Predictive completion**: ML on DPR velocity vs plan (data already flowing) → early-warning before SPI degrades.
- **Auto-narrative monthly report**: the report_brain composer + Matrix Engine grid + EVM + delay studio → one-click ministry pack with AI-drafted commentary, every figure drillable.
- **What-if sandbox**: clone schedule → drag durations/logic → live Δfinish, ΔP80, ΔEVM side-by-side.
- **Photo/vision progress**: PPE camera infra → progress photo classification vs DPR claims.
- **Weather/monsoon-aware scheduling**: activity calendars with monsoon windows for Odisha; QSRA distributions widened in Jun–Sep automatically.
- **Vendor/agency scorecards**: delay attribution (already computed) rolled up per executing agency across schemes.
- **SAIL multi-plant tenancy**: RSP → 5-plant portfolio; corporate roll-up dashboards; the expansion play.
- **SAP FI bridge**: auto-ingest actuals (SAIL runs SAP) — kills manual actuals entry.
- **e-Office/DAK integration**: notesheet module → official correspondence register with SLA tracking (Aconex domain).
- **Voice DPR**: site engineer speaks progress on Telegram; AI service transcribes → structured DPR draft → engineer confirms.
- **Alert rules**: "notify chair when any Corporate AMR slips to Delay>1" — Matrix Engine rules reused as alert predicates, pushed via the digest transport.

## UI modernisation track (agreed 20 Jul)
- **UI-V1 (done)**: react-querybuilder rules tab (nested groups, NOT, tokens,
  rule refs — converters unit-tested); AntV S2 custom-tree matrix grid themed
  to Furnace (classic table kept as toggle fallback); TanStack Table installed
  for secondary tables (variance, audit, drilldown) — apply in UI-V2.
- **UI-V2**: Gridstack.js canvas drag/resize; ECharts renderers for canvas +
  BrainChat; TanStack rollout to variance/audit/drilldown tables; optional
  FINOS Perspective population explorer.
- **Design references (study, don't embed)**: Superset — dataset/cache/
  permission/dashboard-metadata architecture for M5; Cube.js — pre-aggregation
  + semantic-model patterns for the M5 materialised population cache;
  TableCN/shadcn — toolbar, filter and table-state UX patterns.

## Hardening track
Audit trail on rule/report mutations · e-sign on approvals · SSO/LDAP ·
row-level security (department/plant scoping) · materialised population views
for >10k schemes · offline-tolerant mobile DPR · backup/restore runbooks.
