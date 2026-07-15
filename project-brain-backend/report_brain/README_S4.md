# Monthly Report Brain — S4: API + Report Studio (FULL PIPELINE LIVE)

## report_brain/api.py — FastAPI surface (tested end-to-end via TestClient)
  POST /report-brain/ingest       upload WhatsApp .txt / DPR .xlsx / notes .docx -> atoms
  POST /report-brain/quick-note   type a status/issue/action directly -> atom
  GET  /report-brain/projects     projects + atom counts for a month
  POST /report-brain/compose      compose all sections (grounded) + commitment lifecycle
  POST /report-brain/edit         correction -> store + taught-facts learning loop
  GET  /report-brain/commitments  lifecycle board
  POST /report-brain/generate     render family -> docx
  GET  /report-brain/download/{f} download the generated report

Wire-up (2 lines in your FastAPI main.py):
    from report_brain.api import router as report_brain_router
    app.include_router(report_brain_router, prefix="/api/v1")

VERIFIED end-to-end on real files:
  ingest WhatsApp -> 1329 atoms · ingest DPR -> 276 status + 36 manpower + 276
  staging rows · quick-note ok · projects listed (OXY 233, COB7 282, TS2 769…)
  · compose OXY -> 23/23 grounded · edit -> learned · generate -> 37KB docx
  downloaded over HTTP (200).

## frontend/components/report/ReportStudio.jsx + app/report-studio/page.tsx
Drag-drop sources (or Browse) · Quick Note box · project cards with live atom
counts · Compose · per-bullet review with grounding tick (✓ green / ⚠ red),
auto-draft amber tag, source citation shown inline · click any bullet to edit
(saves + feeds learning) · Generate PMC/DO/Agenda/CAPEX -> opens the docx ·
manpower chips · commitment banner (met/open/missed).

## THE COMPLETE SYSTEM (S1–S4)
atoms · whatsapp · recordnotes · dpr · factstore · composer · issues_actions
· figures · render_pmc · api  (10 backend modules + 1 frontend module)

Guarantees held throughout:
  * every figure SQL-derived, never AI
  * every narrative bullet grounded to a cited source atom (hallucinated
    numbers structurally impossible; llm_polish self-rejects on violation)
  * nothing writes to the S-curve unconfirmed (DPR staging rows)
  * every human edit is captured and fed to the taught-facts loop
  * commitments create month-to-month memory (met->Actions, missed->auto-Issue)

## Remaining polish (not architecture)
  * DO / Board-agenda / CAPEX-MoS / WPR renderers (share the same store; PMC is
    the reference implementation — each is a format skin)
  * llm_polish wired to the live orchestrator for voice-matching
  * DPR staging-confirm screen for S-curve writes (backend staging rows ready)
