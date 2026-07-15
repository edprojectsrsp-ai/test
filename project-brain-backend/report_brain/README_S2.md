# Monthly Report Brain — S2: Fact Store + Composer (GOLD PAIR PASSED)

## factstore.py — the single source, five renderers read from it
Idempotent Postgres DDL (rb_atoms/rb_facts/rb_narratives/rb_masters/
rb_commitments/rb_edits) + a MemStore for offline dev & the gold-pair test.
- rb_facts   : figures per project/month/metric — SQL-derived, never AI
- rb_narratives: composed sections, each bullet carrying source atom_ids
- rb_commitments: tracked record-note commitments (open/met/missed)
- rb_edits   : human corrections -> feed the taught-facts loop
Ingestion is idempotent by content_hash (re-upload = no dupes).

## composer.py — atoms -> signable Present Status
Rule mirrors RSP house structure: discipline order (D&E->Civil->Structural->
Mechanical->Electrical->Piping->Refractory->...), completed items before
under-progress within each discipline. GROUNDING ENFORCED: no number appears
unless it exists in a cited atom (_is_grounded regex-verifies post-compose).
- compose_present_status(): deterministic, offline, no LLM — used by gold test
- llm_polish(): optional voice-match against last month's exemplars; REJECTS
  its own output if it introduced any ungrounded number (falls back to
  deterministic bullets). Safe by construction.

## whatsapp.py fix (found by the gold test)
Some reporters (e.g. Bhabani Dash / Oxygen Plant) post the whole update as ONE
unbroken block with inline '1) 2) 3)' enumeration. Splitter now handles inline
enumeration AND newline bullets. Result: Oxygen June went from 1 mega-atom ->
233 clean atoms -> 23 grouped bullets.

## GOLD PAIR RESULT (Oxygen Plant, June'26)
- 233 June WhatsApp atoms -> 23 discipline-grouped bullets, 23/23 GROUNDED
- vs the real May DO-draft Oxygen prose (human-written): **13/13 entity
  coverage** — Horton Sphere, LOX, LIN, Cold Box, HT/LT Transformer, Panel,
  Cable, Piping, hydrotest, Vaporiser, HVAC, Earthing all present
- PLUS June-specific detail the human report couldn't have (RT joint counts,
  pneumatic-test loop counts, inch-meter erection progress)
Conclusion: the pipeline reproduces the site reality an officer signs, in the
right house structure, fully grounded.

## Next (S3)
Issues/Actions composer + commitment lifecycle (met/missed vs WPR-DPR) ·
figure fillers (CAPEX/S-curve SQL) · the five renderers (docx/xlsx) ·
WPR reconciliation diff
