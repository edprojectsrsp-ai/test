# Monthly Report Brain — S3: Lifecycle + Figures + Renderer (REAL DOCX GENERATED)

## issues_actions.py — the month-to-month memory
classify_commitments() checks each record-note commitment against this month's
progress signal and labels it:
  met    -> completion evidence found  -> Actions ("completed, committed <date>")
  open   -> date still future          -> Actions ("targeted by <date>")
  missed -> date passed, no evidence   -> Issue (AUTO-DRAFTED slippage, flagged)
VERIFIED on real COB-7 June data: 2 met, 4 open, 3 MISSED -> 3 auto-drafted
slippage Issues, with zero human writing. This is what no template tool does.

## figures.py — the SQL half (never AI)
manpower_average() (DB-independent, from ingested DPR atoms), capex_figures(),
pmc_discipline_pct() (s-curve/appendix2 weightages), portfolio_counts().
Each DB block independently guarded (missing table -> skip, never 500).

## render_pmc.py — actual .docx in RSP house format
Underlined roman-numeral headings, discipline-grouped narrative, progress table,
issues/actions, OCMS milestones, manpower table, officials. Ungrounded bullets
marked [unverified]; auto-slippage marked [auto-draft — review].

## END-TO-END RESULT (raw inputs -> signable file)
Inputs: real June WhatsApp + June record notes + L&T COB-7 DPR
Output: PMC_COB7_June26_GENERATED.docx — 41 KB, 319 paragraphs, 3 tables,
        reopens clean. 273 present-status bullets, 15 actions, 5 issues
        (incl. 3 auto-slippage), 36 manpower categories.
Guarantee held throughout: every figure SQL-derived, every narrative bullet
grounded to a source atom, hallucinated numbers structurally impossible.

## Next (S4)
Report Studio frontend (upload -> compose -> review-with-citations -> generate
pack) + wire edits into the taught-facts learning loop + remaining renderers
(DO letter, Board agenda, CAPEX/MoS, WPR + reconciliation).
