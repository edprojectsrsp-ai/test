# Report Studio — In-Frontend Reports (all 5 families, in-format, inline-edit)

## What this adds
The report is now rendered IN THE FRONTEND as the actual document, in each
family's exact format & register, with figures auto-filled from the database and
descriptive parts composed from ingestion — every figure cell and every
narrative bullet editable inline, and Export produces a docx identical to what's
on screen (screen == file).

## New backend
- formats.py    declarative specs for DO / PMC / Board-Agenda / CAPEX-MoS / WPR
                (sections, tables, register) matching the shared samples
- assemble.py   resolve_document(): walks a spec, fills figure tables + composed
                narrative -> one editable block list
- render_doc.py universal renderer: walks the SAME resolved blocks -> docx
- api.py        POST /report-brain/document      (live editable document)
                POST /report-brain/document/export (WYSIWYG docx)

## New frontend
- components/report/ReportDocument.jsx  the "paper": family tabs, in-format
  tables with click-to-edit cells, discipline-grouped narrative with click-to-
  edit bullets (grounding dots ● grounded / ▲ unverified / amber auto-draft),
  Export .docx button
- app/report-studio/page.tsx  tabs: "Ingest & Compose" | "Report Document"

## Verified (via TestClient, real inputs)
All 5 families resolve + export 200 OK, ~40-44 KB docx each, screen == file:
  DO (2 tables, 3 narrative) · PMC (3,3) · Agenda (2,9) · CAPEX (1,3) · WPR (1,1)
Figures come from figures_ctx (DB upstream) · narrative from ingested atoms ·
per-project families (DO/Agenda/CAPEX) carry ALL projects, each in its own
section preserving that project's language.

## Language/structure preservation
Each family's spec encodes its own headings, table columns and register; the
composer already emits discipline-ordered, house-voice bullets per project. So
a DO letter reads like the DO draft, a PMC report like the PMC sample, the Board
agenda like the agenda note — all from one Fact Store.

## Production wiring
- figures_ctx is populated by figures.py (capex_figures / pmc_discipline_pct /
  portfolio_counts) against the live DB — replace the demo ctx in page.tsx with
  a fetch to your figures endpoint.
- llm_polish (composer) wires to the orchestrator for exact voice-matching.
