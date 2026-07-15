"""
report_brain.composer — turn atoms into a signable Present-Status section.

The composition rule mirrors the RSP house structure exactly:
  discipline order (Civil -> Structural -> Mechanical -> Electrical -> Piping ->
  Refractory -> ...), and within a discipline: completed areas first, then
  under-progress areas. Every emitted bullet carries the atom ids it was built
  from (grounding), and NO quantity appears that isn't in a cited atom.

Two modes:
  * compose_present_status(...)              deterministic, offline, no LLM —
    aggregates the latest state per (discipline, area) across the month and
    renders house-style prose. This is what the gold-pair test runs.
  * llm_polish(section, exemplars, ask_fn)   optional: hand the grounded facts +
    last month's report exemplars to the model to match register/voice. The
    ground-check re-verifies every number survives; ungrounded output is
    rejected. (ask_fn = your orchestrator's grounded call.)
"""
from __future__ import annotations

import re
from collections import OrderedDict, defaultdict

DISC_ORDER = ["Design & Engineering", "Civil", "Structural", "Mechanical",
              "Electrical", "Piping", "Refractory", "Instrumentation",
              "Commissioning", "Safety"]

_STATE_RANK = {"completed": 3, "in_progress": 2, "started": 1, "planned": 0, "": 0}


def _latest_per_area(atoms: list[dict]) -> "OrderedDict[tuple, dict]":
    """Keep the newest, most-advanced atom per (discipline, area/text-key)."""
    best: dict[tuple, dict] = {}
    for a in sorted(atoms, key=lambda x: x.get("date", "")):
        disc = a.get("discipline") or "General"
        # area key: explicit area, else first 6 words of the sentence
        area = a.get("area") or " ".join(re.split(r"[:\-.,]", a.get("text", ""))[0].split()[:6])
        key = (disc, area.lower().strip())
        cur = best.get(key)
        if cur is None or _STATE_RANK[a.get("verb_state", "")] >= _STATE_RANK[cur.get("verb_state", "")]:
            best[key] = a
    return OrderedDict(sorted(best.items(), key=lambda kv: (
        DISC_ORDER.index(kv[0][0]) if kv[0][0] in DISC_ORDER else 99, kv[0][1])))


def compose_present_status(atoms: list[dict]) -> list[dict]:
    """Return grouped bullets: [{discipline, text, atom_ids, grounded, state}]."""
    latest = _latest_per_area(atoms)
    by_disc: "OrderedDict[str, list[dict]]" = OrderedDict()
    for (disc, _area), atom in latest.items():
        by_disc.setdefault(disc, []).append(atom)

    out: list[dict] = []
    for disc in sorted(by_disc, key=lambda d: DISC_ORDER.index(d) if d in DISC_ORDER else 99):
        items = by_disc[disc]
        # completed first, then in-progress, then rest
        items.sort(key=lambda a: -_STATE_RANK.get(a.get("verb_state", ""), 0))
        for a in items:
            text = _house_phrase(a)
            out.append({
                "discipline": disc,
                "text": text,
                "atom_ids": [a.get("content_hash") or a.get("source_ref")],
                "grounded": _is_grounded(text, [a]),
                "state": a.get("verb_state", ""),
                "source_ref": a.get("source_ref", ""),
            })
    return out


def _house_phrase(a: dict) -> str:
    """Normalize a raw atom into report register (light touch, deterministic)."""
    t = a.get("text", "").strip().rstrip(".")
    t = re.sub(r"\s+", " ", t)
    # normalize common contractor verbs to report voice
    t = re.sub(r"\bunder progress\b", "under progress", t, flags=re.I)
    t = re.sub(r"\bcontinuing\b", "under progress", t, flags=re.I)
    t = re.sub(r"\bdone\b", "completed", t, flags=re.I)
    return t[0].upper() + t[1:] if t else t


_NUM = re.compile(r"\d+(?:\.\d+)?")


def _is_grounded(text: str, atoms: list[dict]) -> bool:
    """Every number in `text` must appear in some cited atom's text/quantities."""
    nums = set(_NUM.findall(text))
    if not nums:
        return True
    haystack = " ".join(a.get("text", "") + " " +
                        " ".join(str(q.get("value", "")) + " " + str(q.get("of", ""))
                                 for q in a.get("quantities", []))
                        for a in atoms)
    have = set(_NUM.findall(haystack))
    return nums.issubset(have)


def render_prose(bullets: list[dict]) -> str:
    """Discipline-headed prose block, DO-letter style."""
    lines: list[str] = []
    cur = None
    for b in bullets:
        if b["discipline"] != cur:
            cur = b["discipline"]
            lines.append(f"\n{cur}:")
        flag = "" if b["grounded"] else "  ⚠"
        lines.append(f"  - {b['text']}.{flag}")
    return "\n".join(lines).strip()


# ---------------------------------------------------------------- LLM polish
STYLE_PROMPT = """You are drafting the "Present Status" section of an RSP (SAIL) monthly project report.
Rewrite the GROUNDED FACTS below into the exact register of the STYLE EXEMPLARS.
Hard rules:
- Group by discipline in this order: {order}.
- Within a discipline, completed items first, then under-progress items.
- Use ONLY facts present below. NEVER introduce a number not in the facts.
- Keep the terse PSU bullet voice. No preamble, no conclusion.

STYLE EXEMPLARS (last month, same section):
{exemplars}

GROUNDED FACTS (this month):
{facts}
"""


def llm_polish(bullets: list[dict], exemplars: list[str], ask_fn) -> list[dict]:
    """Optional voice-matching pass. ask_fn(prompt)->str. Falls back to the
    deterministic bullets if the model adds ungrounded numbers."""
    facts = "\n".join(f"[{b['discipline']}] {b['text']} (state={b['state']})" for b in bullets)
    prompt = STYLE_PROMPT.format(order=", ".join(DISC_ORDER),
                                 exemplars="\n".join(exemplars[:3]) or "(none)",
                                 facts=facts)
    try:
        draft = ask_fn(prompt)
    except Exception:
        return bullets
    polished: list[dict] = []
    cur_disc = "General"
    for line in draft.splitlines():
        s = line.strip()
        if not s:
            continue
        m = re.match(r"^([A-Za-z &]+):$", s)
        if m and m.group(1).strip() in DISC_ORDER:
            cur_disc = m.group(1).strip()
            continue
        s = re.sub(r"^[-•]\s*", "", s)
        # ground-check against the union of source atoms for this discipline
        src = [b for b in bullets if b["discipline"] == cur_disc]
        polished.append({
            "discipline": cur_disc, "text": s,
            "atom_ids": [i for b in src for i in b["atom_ids"]],
            "grounded": _is_grounded(s, [{"text": b["text"]} for b in src]),
            "state": "", "source_ref": "",
        })
    # reject the polish entirely if it introduced ungrounded numbers
    if any(not p["grounded"] for p in polished):
        return bullets
    return polished or bullets
