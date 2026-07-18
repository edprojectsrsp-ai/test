# Dynamic Reporting Studio

This module defines the foundation for a database-connected, self-service reporting system for both single-project and portfolio-level reporting.

## Product modes

1. **Data Explorer** — drag/select fields, type-aware filters, multi-column sorting, grouping, aggregation, totals, conditional formatting, saved views, and export.
2. **Pivot Builder** — rows, columns, measures, filters, subtotals, grand totals, and drill-through.
3. **Formatted Report Designer** — spreadsheet-style layout with merged headers, cell bindings, filtered measures, formulas, repeating detail bands, parameters, and printable templates.

## Recommended implementation

- **Data Explorer:** TanStack Table with shadcn/ui; tablecn may be used only as a UI reference/base.
- **Formatted designer:** Univer spreadsheet canvas.
- **Backend:** FastAPI report compiler and execution engine.
- **Database:** PostgreSQL reporting datasets/views, metric catalogue, report definitions, snapshots, and permissions.
- **Charts:** Recharts where required.

The design deliberately avoids depending on one external repository for the complete product. Table libraries solve data exploration; spreadsheet libraries solve free-form cell layout; neither provides the governed semantic/reporting engine required for consistent KPIs.

## Core rule

Users never receive unrestricted SQL access. The UI produces a validated `ReportDefinition`. The backend resolves business fields and metrics from an allow-listed catalogue, compiles parameterised queries, batches equivalent cell queries, and returns a result model.

## Report flow

```text
Reporting datasets / views
        ↓
Field and KPI catalogue
        ↓
Validated report definition
        ↓
FastAPI query compiler
        ↓
Batched parameterised SQL
        ↓
Grid / pivot / spreadsheet result
        ↓
Saved template, snapshot, Excel/PDF export
```

## Supported field types

- text
- integer
- decimal
- currency
- percentage
- date
- datetime
- boolean
- enum
- duration
- project reference
- user/agency/department reference

Each field type controls valid filters, editor, formatter, sorter, aggregation options, and formula compatibility.

## Supported filter operators

- equals / not equals
- contains / does not contain
- starts with / ends with
- greater than / greater than or equal
- less than / less than or equal
- between
- in / not in
- is empty / is not empty
- before / after / relative date

Filter groups support nested `AND` and `OR` logic.

## Supported formulas

Initial allow-list:

- `SUM`, `COUNT`, `DISTINCTCOUNT`, `AVERAGE`, `MIN`, `MAX`
- `IF`, `AND`, `OR`, `NOT`
- `ROUND`, `ABS`, `COALESCE`, `SAFE_DIVIDE`
- `DATEDIFF`, `DATEADD`
- cell references such as `=E6+G6`

Arbitrary JavaScript, Python, and raw SQL are prohibited.

## Scope model

Every report accepts a scope:

- one project
- selected projects
- department
- agency
- scheme/category
- entire portfolio

A report may also declare runtime parameters such as `as_on_date`, `financial_year`, `report_month`, `project_id`, and `department_id`.

## Performance rule

Do not execute one SQL query per spreadsheet cell. The report compiler groups cells by dataset, dimensions, filters, and aggregation requirements, executes a small number of grouped queries, maps results to cells, and then evaluates local cell formulas.

## Files

- `report-definition.schema.json` — canonical contract shared by frontend and backend.
- `schema.sql` — initial PostgreSQL metadata and persistence tables.

## Next implementation slices

1. FastAPI Pydantic models and validation for the report definition.
2. Field catalogue and reporting dataset API.
3. Safe filter/sort/query compiler.
4. Data Explorer using TanStack Table/shadcn.
5. Saved views and exports.
6. Pivot query compiler and pivot UI.
7. Univer-based formatted report designer with cell binding.
8. Template versioning, permissions, snapshots, and scheduled exports.
