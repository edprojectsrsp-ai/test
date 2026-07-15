"""
report_brain.recordnotes — parse an ED(Projects) Monthly Review Meeting record
note (docx -> plain text) into ACTION atoms, ISSUE atoms and COMMITMENT atoms.

Structure observed:
  - Header (ref no, date, project, participants table)
  - "Following actionable points emerged during discussion:"
  - Discipline sections: Safety / Design & Engineering / Civil Work /
    Structural fabrication / ...
  - Under each: advisory bullets ("ED(P) advised M/s L&T to ...") -> action atoms
  - Committed-completion tables (Sl | Activity | Committed Completion Date)
    -> commitment atoms (tracked; met/missed decided later against WPR/DPR)
"""
from __future__ import annotations

import re
from datetime import datetime

from report_brain.atoms import Atom, discipline_of

_DISC_HEADS = [
    "Safety", "Design & Engineering", "Design and Engineering", "Civil Work",
    "Civil", "Structural fabrication", "Structural", "Mechanical", "Electrical",
    "Piping", "Refractory", "Instrumentation", "Commissioning", "General",
]
_ADVISE = re.compile(r"\b(advised|apprised|emphasi|instructed|directed|requested|"
                     r"committed|informed|shall|to be completed|agreed)\b", re.I)
_DATE = re.compile(r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})")


def _iso(s: str) -> str:
    m = _DATE.search(s)
    if not m:
        return ""
    d, mo, y = m.groups()
    y = ("20" + y) if len(y) == 2 else y
    try:
        return datetime(int(y), int(mo), int(d)).date().isoformat()
    except ValueError:
        return ""


def _meeting_meta(text: str) -> tuple[str, str]:
    date = ""
    m = re.search(r"held on\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})", text, re.I)
    if m:
        date = _iso(m.group(1))
    proj = ""
    pm = re.search(r"for\s+(Installation of[^\n]+?COB\s*#?\s*7|[A-Z][^\n]{6,60})", text)
    if pm:
        proj = pm.group(1).strip()
    return date, proj


def parse_record_notes(text: str, project: str = "COB7-PKG2") -> list[Atom]:
    date, proj_name = _meeting_meta(text)
    lines = text.split("\n")
    atoms: list[Atom] = []
    cur_disc = "General"

    # 1) discipline-sectioned advisory bullets
    i = 0
    while i < len(lines):
        ln = lines[i].strip()
        bare = ln.rstrip(": ").strip()
        matched = next((d for d in _DISC_HEADS if bare.lower() == d.lower()), None)
        if matched:
            cur_disc = ("Design & Engineering" if "Design" in matched
                        else "Civil" if matched.startswith("Civil")
                        else "Structural" if "Structural" in matched else matched)
            i += 1
            continue
        if re.match(r"^[-•]\s+|^\s*[-•]", ln) and len(ln) > 8:
            body = re.sub(r"^[-•]\s*", "", ln)
            j = i + 1
            while j < len(lines) and lines[j].strip() and not re.match(r"^[-•]", lines[j].strip()) \
                    and not any(lines[j].strip().rstrip(": ").lower() == d.lower() for d in _DISC_HEADS):
                body += " " + lines[j].strip()
                j += 1
            if _ADVISE.search(body):
                is_issue = re.search(r"\bgap\b|delay|pending|shortfall|inadequate|slippage|concern|bridge", body, re.I)
                atoms.append(Atom(
                    kind="issue" if is_issue else "action",
                    date=date, project=project,
                    section_affinity="issue" if is_issue else "action",
                    discipline=cur_disc or discipline_of(body),
                    text=body.strip(),
                    verb_state="",
                    source_type="recordnotes",
                    source_ref=f"recordnotes:{date}",
                    extra={"meeting": proj_name},
                ))
            i = j
            continue
        i += 1

    # 2) commitment tables: rows "Activity ... <date>"
    for m in re.finditer(r"([A-Z][A-Za-z0-9 ,/&#\-\(\)\.]{8,90}?)\s+(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})", text):
        activity, dstr = m.group(1).strip(), m.group(2)
        ciso = _iso(dstr)
        if not ciso:
            continue
        # skip participant / header noise
        if re.search(r"advised|apprised|emphasi|Members|Record Notes|Ref", activity, re.I):
            continue
        atoms.append(Atom(
            kind="commitment", date=date, project=project,
            section_affinity="action",
            discipline=discipline_of(activity),
            text=f"{activity} — committed completion {ciso}",
            verb_state="planned",
            source_type="recordnotes",
            source_ref=f"recordnotes:{date}",
            extra={"activity": activity, "committed_date": ciso, "status": "open"},
        ))
    return atoms
