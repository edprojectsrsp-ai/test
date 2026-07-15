"""
report_brain.issues_actions — compose the Issues and Actions-Taken sections,
and run the COMMITMENT LIFECYCLE that gives the report month-to-month memory.

Inputs: record-note atoms (actions/issues/commitments) + this month's progress
signal (WPR/DPR cumulatives or status atoms) to decide whether each committed
activity was met or missed.

Lifecycle per commitment:
  open   -> committed date is in the future            -> Actions ("committed by <date>")
  met    -> progress shows completion on/before date    -> Actions ("completed on <date>")
  missed -> date passed, no completion evidence          -> Issue  (auto-drafted slippage)

This is what no template tool does: last month's commitment becomes this month's
Action or Issue automatically, in the report's own register.
"""
from __future__ import annotations

import re
from datetime import date

from report_brain.composer import _is_grounded, DISC_ORDER


def _parse_iso(s: str):
    try:
        return date.fromisoformat(s)
    except Exception:
        return None


def _completed_signal(activity: str, status_atoms: list[dict]) -> dict | None:
    """Find a status atom that indicates this activity is completed."""
    words = [w for w in re.split(r"[^a-z0-9]+", activity.lower()) if len(w) > 3][:4]
    for a in status_atoms:
        if a.get("verb_state") != "completed":
            continue
        t = a.get("text", "").lower()
        if sum(1 for w in words if w in t) >= max(1, len(words) // 2):
            return a
    return None


def classify_commitments(commitments: list[dict], status_atoms: list[dict],
                         as_of: str) -> list[dict]:
    """Return commitments annotated with lifecycle status + evidence."""
    today = _parse_iso(as_of) or date.today()
    out = []
    for c in commitments:
        cdate = _parse_iso(c.get("extra", {}).get("committed_date", "") if "extra" in c else c.get("committed_date", ""))
        activity = c.get("extra", {}).get("activity") if "extra" in c else c.get("activity", "")
        activity = activity or c.get("text", "")
        evidence = _completed_signal(activity, status_atoms)
        if evidence:
            status = "met"
        elif cdate and cdate < today:
            status = "missed"
        else:
            status = "open"
        out.append({**c, "lifecycle": status, "committed_date": cdate.isoformat() if cdate else "",
                    "activity": activity, "evidence_ref": evidence.get("source_ref") if evidence else ""})
    return out


def compose_actions(action_atoms: list[dict], classified_commitments: list[dict]) -> list[dict]:
    """Actions-Taken bullets: advisories from record notes + met/open commitments."""
    bullets: list[dict] = []
    # 1) advisory actions verbatim (already in register)
    for a in sorted(action_atoms, key=lambda x: DISC_ORDER.index(x.get("discipline", "")) if x.get("discipline") in DISC_ORDER else 99):
        bullets.append({"discipline": a.get("discipline") or "General",
                        "text": a.get("text", "").strip().rstrip("."),
                        "atom_ids": [a.get("source_ref")], "grounded": True, "kind": "advisory"})
    # 2) commitments that were met, or are still open (tracked)
    for c in classified_commitments:
        if c["lifecycle"] == "met":
            bullets.append({"discipline": c.get("discipline") or "General",
                            "text": f"{c['activity']} — completed (committed {c['committed_date']})",
                            "atom_ids": [c.get("source_ref"), c.get("evidence_ref")],
                            "grounded": True, "kind": "commitment_met"})
        elif c["lifecycle"] == "open":
            bullets.append({"discipline": c.get("discipline") or "General",
                            "text": f"{c['activity']} — targeted for completion by {c['committed_date']}",
                            "atom_ids": [c.get("source_ref")], "grounded": True, "kind": "commitment_open"})
    return bullets


def compose_issues(issue_atoms: list[dict], classified_commitments: list[dict]) -> list[dict]:
    """Issues bullets: record-note issues + auto-drafted slippages from missed commitments."""
    bullets: list[dict] = []
    for a in issue_atoms:
        bullets.append({"discipline": a.get("discipline") or "General",
                        "text": a.get("text", "").strip().rstrip("."),
                        "atom_ids": [a.get("source_ref")], "grounded": True, "kind": "reported"})
    for c in classified_commitments:
        if c["lifecycle"] == "missed":
            bullets.append({"discipline": c.get("discipline") or "General",
                            "text": (f"{c['activity']} — committed for {c['committed_date']} "
                                     f"but not completed as per latest progress; recovery to be reviewed"),
                            "atom_ids": [c.get("source_ref")], "grounded": True,
                            "kind": "auto_slippage", "draft": True})
    return bullets


def render_issue_action_prose(bullets: list[dict], heading: str) -> str:
    lines = [heading]
    cur = None
    for b in bullets:
        if b["discipline"] != cur:
            cur = b["discipline"]
            lines.append(f"\n{cur}:")
        mark = "  [auto-draft]" if b.get("draft") else ""
        lines.append(f"  - {b['text']}.{mark}")
    return "\n".join(lines).strip()
