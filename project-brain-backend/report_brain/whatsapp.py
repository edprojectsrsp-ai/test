"""
report_brain.whatsapp — parse a WhatsApp 'Export Chat (without media)' .txt into
status atoms, one per progress bullet, attributed to a project via
(project header in the message) -> (sender default) -> (area/alias match).

Handles: DD/MM/YY or DD/MM/YYYY, 12/24h, AM/PM, multi-line messages, *bold*
project headers, numbered/lettered bullets, huge runs of trailing spaces
(WhatsApp formatting artifact), <edited> / <Media omitted> lines, system lines.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime

from report_brain.atoms import (
    Atom, AliasRegistry, discipline_of, quantities_of, verb_state_of,
)

_HEADER = re.compile(
    r"^(?P<d>\d{1,2}/\d{1,2}/\d{2,4}),\s*(?P<t>\d{1,2}:\d{2}(?::\d{2})?)\s*(?P<ap>[AaPp][Mm])?\s*-\s*(?P<rest>.*)$"
)
_SENDER = re.compile(r"^(?P<name>[^:]{1,40}?):\s(?P<body>.*)$", re.S)
_SYSTEM = re.compile(
    r"(Messages and calls are end-to-end|created group|added you|"
    r"\badded\b|\bremoved\b|\bleft\b|changed the subject|changed this group|"
    r"changed their phone number|Media omitted|This message was deleted|"
    r"pinned a message|security code)", re.I)
_BULLET = re.compile(r"^\s*(?:\d+[\.\)]|[a-z][\.\)]|[-•*])\s+", re.I)


def _parse_date(d: str) -> str:
    for fmt in ("%d/%m/%y", "%d/%m/%Y"):
        try:
            return datetime.strptime(d, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def _clean(text: str) -> str:
    # collapse WhatsApp's massive space runs + strip bold markers
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = text.replace("*", "").replace("<This message was edited>", "")
    return text.strip(" \t\r\n-")


def iter_messages(txt: str):
    """Yield (date_iso, sender, body) reconstructing multi-line messages."""
    cur = None
    for raw in txt.splitlines():
        m = _HEADER.match(raw)
        if m:
            if cur:
                yield cur
            rest = m.group("rest")
            if _SYSTEM.search(rest):
                cur = None
                continue
            sm = _SENDER.match(rest)
            if not sm:
                cur = None
                continue
            cur = [_parse_date(m.group("d")), sm.group("name").strip(), sm.group("body")]
        elif cur is not None:
            cur[2] += "\n" + raw
    if cur:
        yield cur


def _split_bullets(body: str) -> tuple[str, list[str]]:
    """Return (header_line, [bullet lines]). Header = first non-bullet line if it
    looks like a project title; bullets = numbered/dashed items. Handles BOTH
    newline-separated bullets AND inline enumeration '1) .. 2) .. 3) ..' that
    some reporters post as one unbroken block."""
    lines = [ln for ln in body.split("\n") if ln.strip()]
    header = ""
    if lines and not _BULLET.match(lines[0]) and len(lines[0]) < 90:
        header = _clean(lines[0])
        rest = lines[1:]
    else:
        rest = lines

    # If the body is mostly one blob, try inline splitting on '\d+)' / '\d+.'
    joined = " ".join(rest)
    inline = re.split(r"(?:(?<=\s)|^)(?=\d{1,2}[\)\.]\s)", joined)
    inline = [_clean(re.sub(r"^\d{1,2}[\)\.]\s*", "", x)) for x in inline if x.strip()]
    if len(inline) >= 3:                       # confident inline enumeration
        # drop a leading fragment that is really the header/date line
        if inline and (re.search(r"date\s*[-:]", inline[0], re.I) or len(inline[0]) < 40) and len(inline) > 3:
            if not header:
                header = inline[0]
            inline = inline[1:]
        return header, [b for b in inline if len(b) > 3]

    # else newline-based bullets
    bullets: list[str] = []
    buf = ""
    for ln in rest:
        if _BULLET.match(ln):
            if buf:
                bullets.append(_clean(buf))
            buf = _BULLET.sub("", ln)
        else:
            buf += " " + ln
    if buf:
        bullets.append(_clean(buf))
    if not bullets and rest:
        bullets = [_clean(" ".join(rest))]
    return header, bullets


def parse_whatsapp(txt: str, reg: AliasRegistry, month: str | None = None,
                   learn_senders: bool = True) -> list[Atom]:
    """month = 'YYYY-MM' filter (report window). Returns status atoms.

    Sender defaults are learned from the FULL history first (so a sender whose
    month-window messages only mention area names still attributes correctly),
    then atoms are emitted for the requested window."""
    # ---- pass 1: learn sender->project from ALL history -------------------
    if learn_senders:
        hist: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for d_iso, sender, body in iter_messages(txt):
            header, _ = _split_bullets(body)
            p = (reg.project_of(header) if header else None) or reg.project_of(body)
            if p:
                hist[sender][p] += 1
        reg.learn_sender_stats({s: dict(c) for s, c in hist.items()})

    atoms: list[Atom] = []
    for date_iso, sender, body in iter_messages(txt):
        if not date_iso:
            continue
        if month and not date_iso.startswith(month):
            continue
        header, bullets = _split_bullets(body)
        # attribution: header alias > full-body alias > sender default
        msg_proj = (reg.project_of(header) if header else None) or reg.project_of(body) \
            or reg.sender_default(sender)

        for b in bullets:
            if len(b) < 4:
                continue
            area_proj = reg.project_of(b) or msg_proj or "?"
            atoms.append(Atom(
                kind="status", date=date_iso, project=area_proj,
                section_affinity="status",
                discipline=discipline_of(b),
                text=b,
                quantities=quantities_of(b),
                verb_state=verb_state_of(b),
                source_type="whatsapp",
                source_ref=f"whatsapp:{date_iso}:{sender}",
                author=sender,
                extra={"header": header} if header else {},
            ))
    return atoms
