"""
report_brain.atoms — the unified atom schema every extractor emits, plus the
alias registry (project/area names + sender attribution) with a TEACH API:
corrections persist to JSON and apply to every future parse.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field, asdict
from typing import Optional

# ----------------------------------------------------------------- atoms
@dataclass
class Atom:
    kind: str                      # status | progress | manpower | issue | action | commitment | note
    date: str                      # ISO yyyy-mm-dd (report date)
    project: str                   # canonical project code (or "?" if unattributed)
    package: str = ""
    section_affinity: str = ""     # status | issue | action | manpower | figures
    discipline: str = ""           # Civil / Structural / Mechanical / Electrical / Refractory / Safety / D&E ...
    area: str = ""                 # Battery 7A, Horton Sphere (A), Coal Tower ...
    text: str = ""                 # the human sentence / bullet
    quantities: list = field(default_factory=list)   # [{"value":12,"of":30,"unit":"loops"}...]
    verb_state: str = ""           # completed | in_progress | started | planned
    source_type: str = ""          # whatsapp | dpr | recordnotes | ppt | manual
    source_ref: str = ""           # file/message pointer for citation
    author: str = ""
    extra: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        return asdict(self)


def dump_atoms(atoms: list[Atom], path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump([a.to_json() for a in atoms], f, ensure_ascii=False, indent=1)


# ------------------------------------------------------- alias registry
_DEFAULT_PROJECTS = {
    # canonical: [aliases, lowercase substrings]
    "COB7-PKG2": ["battery-7a", "battery 7a", "battery 7b", "cob7 ramp", "silo:", "end bench", "eb-7", "piling work", "cob#7 p2", "cob 7 p2", "cob#7 pkg-2", "battery proper", "stamp charge", "cob#7-battery",
                   "oven machine", "cob#7 main"],
    "COB7-PKG4": ["by product", "by-product", "bpp", "cob#7 pkg-4", "cob#7 -- by product"],
    "OXY-1000": ["1000 tpd oxygen", "oxygen plant", "1000tpd oxygen", "oxygen  plant"],
    "BF5-STOVE4": ["4th stove", "bf#5", "bf 5", "bf-5", "stove shell"],
    "PELLET-2MTPA": ["2.0mtpa pellet", "pellet plant project", "2.0 mtpa pellet"],
    "MICROPELLET": ["micro pellet", "micro-pellet"],
    "TS2": ["ts 2", "ts-2", "treatment system 2", "treatment system-2"],
    "NPTL": ["nptl", "new product testing", "product testing laboratory"],
    "STP30": ["30 mld stp", "stp"],
    "BWALL": ["boundary wall"],
}

_DISCIPLINES = ["Safety", "Design & Engineering", "Civil", "Structural", "Mechanical",
                "Electrical", "Piping", "Refractory", "Instrumentation", "Commissioning"]
_DISC_PAT = {
    "Safety": r"\bsafety\b", "Design & Engineering": r"design\s*&?\s*eng|drawing",
    "Civil": r"\bcivil\b|excavat|concret|pcc|rcc|casting|foundation|pil(e|ing)|slab",
    "Structural": r"structur|fabricat|erection of .*steel|steel erection|shell",
    "Mechanical": r"mechanic|equipment erection|compressor|pump house|conveyor",
    "Electrical": r"electric|cable|transformer|panel|ecr\b|lt |ht ",
    "Piping": r"\bpip(e|ing)\b|hydrotest|pneumatic test",
    "Refractory": r"refractor",
    "Instrumentation": r"instrument",
    "Commissioning": r"commission|trial|pg test",
}


class AliasRegistry:
    """Project attribution + area normalization, teachable & persistent."""

    def __init__(self, path: str = "report_brain_aliases.json"):
        self.path = path
        self.projects: dict[str, list[str]] = {k: list(v) for k, v in _DEFAULT_PROJECTS.items()}
        self.senders: dict[str, str] = {}          # sender -> default project (learned)
        self.activity_map: dict[str, str] = {}     # contractor activity name -> plan activity (taught)
        if os.path.exists(path):
            try:
                data = json.load(open(path, encoding="utf-8"))
                for k, v in data.get("projects", {}).items():
                    self.projects.setdefault(k, [])
                    self.projects[k] = sorted(set(self.projects[k] + v))
                self.senders.update(data.get("senders", {}))
                self.activity_map.update(data.get("activity_map", {}))
            except Exception:
                pass

    # ---- teach API (called from staging screens / corrections) -------------
    def teach_project_alias(self, project: str, alias: str) -> None:
        self.projects.setdefault(project, []).append(alias.lower().strip())
        self.save()

    def teach_sender(self, sender: str, project: str) -> None:
        self.senders[sender.strip()] = project
        self.save()

    def teach_activity(self, raw_name: str, plan_activity: str) -> None:
        self.activity_map[raw_name.strip().lower()] = plan_activity
        self.save()

    def save(self) -> None:
        json.dump({"projects": self.projects, "senders": self.senders,
                   "activity_map": self.activity_map},
                  open(self.path, "w", encoding="utf-8"), indent=1)

    # ---- resolution ---------------------------------------------------------
    def project_of(self, text: str) -> Optional[str]:
        low = " ".join(text.lower().split())
        best, best_len = None, 0
        for proj, aliases in self.projects.items():
            for a in aliases:
                if a in low and len(a) > best_len:
                    best, best_len = proj, len(a)
        return best

    def sender_default(self, sender: str) -> Optional[str]:
        return self.senders.get(sender.strip())

    def learn_sender_stats(self, stats: dict[str, dict[str, int]], min_share: float = 0.6) -> None:
        """From {sender: {project: count}} adopt majority defaults."""
        for sender, counts in stats.items():
            total = sum(counts.values())
            if not total:
                continue
            proj, n = max(counts.items(), key=lambda kv: kv[1])
            if n / total >= min_share and total >= 3:
                self.senders.setdefault(sender, proj)
        self.save()


def discipline_of(text: str) -> str:
    low = text.lower()
    for disc in _DISCIPLINES:
        if re.search(_DISC_PAT[disc], low):
            return disc
    return ""


_QTY = re.compile(r"(?P<a>\d+(?:\.\d+)?)\s*(?:no\.?s?\.?|nos\.?)?\s*(?:out\s+of|of|/)\s*(?P<b>\d+(?:\.\d+)?)"
                  r"|(?P<v>\d+(?:\.\d+)?)\s*(?P<u>nos?\.?|mt|cum|rmt|mtr|m|km|%|plates?|loops?|joints?|floors?)\b",
                  re.I)


def quantities_of(text: str) -> list[dict]:
    out = []
    for m in _QTY.finditer(text):
        if m.group("a"):
            out.append({"value": float(m.group("a")), "of": float(m.group("b")), "unit": ""})
        else:
            out.append({"value": float(m.group("v")), "unit": m.group("u").lower()})
    return out[:6]


def verb_state_of(text: str) -> str:
    low = text.lower()
    if re.search(r"\bcompleted\b|\bdone\b|\bachiev", low):
        return "completed"
    if re.search(r"under progress|in progress|continuing|progressing|carried out|being ", low):
        return "in_progress"
    if re.search(r"\bstarted\b|commenced|to start|shall commence|mobilis", low):
        return "started"
    if re.search(r"planned|expected|scheduled|will be|to be ", low):
        return "planned"
    return ""
