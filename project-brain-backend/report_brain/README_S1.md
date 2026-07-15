# Monthly Report Brain — S1: Ingestion Extractors (verified on real inputs)

Four modules, all tested against the actual RSP corpus (June/July 2026).

## atoms.py — shared foundation
- `Atom` unified schema (kind/date/project/discipline/area/text/quantities/
  verb_state/source_ref/author) every extractor emits
- `AliasRegistry` — project attribution + area normalization + activity mapping,
  with a **teach API** (teach_project_alias / teach_sender / teach_activity) that
  persists to JSON and applies to every future parse
- helpers: discipline_of, quantities_of ("12 of 30 loops"), verb_state_of
  (completed/in_progress/started/planned)

## whatsapp.py — WhatsApp export -> status atoms
- Reconstructs multi-line messages, strips *bold*/system lines/space-runs
- Splits each message into per-bullet atoms
- **Attribution (verified on 63k-line real export):** learns sender->project
  from FULL history first, then header-alias > body-alias > sender-default.
  June result: 1171 atoms, **0 unattributed**, K K Patra->COB7-PKG2 correctly
  (works even when his window messages only name areas like "Battery-7A").
  Note: sparse COB-7 traffic is because that reporter paused posting; the
  moment he resumes, sender-learning attributes him automatically — no change.

## recordnotes.py — ED review note -> action/issue/commitment atoms
- Discipline-sectioned advisory bullets -> action atoms (issue if gap/delay/
  pending language)
- **Commitment tables -> commitment atoms with committed dates** (tracked;
  met/missed decided next month vs WPR/DPR). Real note: 9 actions, 2 issues,
  9 commitments incl. "7B Deck Slab civil — 31.07.2026"

## dpr.py — DPR xlsx -> progress(staged) + area-status + manpower
- **Format fingerprinting** (sheet+header signature): 3 distinct real formats
  produced 3 distinct fingerprints, each parsed
- Simpler DPRs (172 RSP->NPTL, by-product) parse cleanly with proper activity
  names, disciplines, scope/cum
- **Complex L&T COB-7 DPR** (301x236, merged headers): parses in 0.3s
  (row-streamed, no O(n^2)); activity names come as codes -> resolved via the
  **teach/staging loop**, not brittle heuristics — every progress row is a
  `StagingRow{raw_activity, proposed_plan_activity, confidence}` that must be
  confirmed before writing to the S-curve. Correction -> reg.teach_activity ->
  automatic next time.

## Design guarantees held
- Nothing writes to the S-curve unconfirmed (staging rows)
- Every atom carries source_ref for citation
- ~70-80% auto-match is the bar; the teach loop closes the rest and compounds

## Next (S2)
Fact Store schema · figure fillers (CAPEX/S-curve SQL) · PPT extractor ·
WPR renderer + reconciliation diff · Present-Status composer + June gold-pair test
