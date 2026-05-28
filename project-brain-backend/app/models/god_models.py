"""
god_models.py — QUARANTINED (Sprint 0).

This module is t3-era dead code. It is NOT imported by main.py (the god_api
router is not wired in). It previously caused two latent failures:

  1. It imported names that do not exist in app/models/scheme.py
     (SchemeMaster ok, but Stage1Details / TenderDetails / Stage2Details /
     OrderDetails / ClosureDetails were never defined) -> ImportError if loaded.
  2. It ran `Base.metadata.create_all(bind=engine)` AT IMPORT TIME, which would
     attempt to CREATE every mapped table (including drifted/orphan ones) in the
     live DB the instant anything imported it.

Both are now removed. The seed routine is preserved as a no-op stub so that any
lingering import succeeds without side effects. If you want to re-enable RSP
seeding, rewrite it against the current models (Scheme, Stage1Approval,
TenderCycle, Stage2Approval) and a real schema migration — do NOT use
create_all against a production database.

Original seeding logic intentionally not executed.
"""

# NOTE: deliberately NO `Base.metadata.create_all(...)` here.
# NOTE: deliberately NO imports of non-existent classes.


def seed_complete_rsp_data(*args, **kwargs):
    """Disabled. See module docstring. Returns without touching the database."""
    raise RuntimeError(
        "god_models.seed_complete_rsp_data is quarantined (Sprint 0). "
        "Re-implement against current models + a migration before use."
    )
