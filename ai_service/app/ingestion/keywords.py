"""
keywords.py — deterministic document labeling for Project Brain ingestion.

Every ingested document gets a keywords text[] (column already exists in the
live schema) built from four signals — no LLM required, so labeling works
offline and is reproducible:

  1. CODE TOKENS      — scheme/package-shaped codes in the text (COB-7, CDCP-2)
  2. ACRONYMS         — ALL-CAPS domain acronyms (LD, PMC, DPR, BOQ, LOA, NIT…)
  3. SALIENT TERMS    — frequency-scored content words, title-boosted
  4. RESOLVED ENTITIES— canonical codes from the fuzzy entity resolver

Manual keywords from the uploader are merged in front (highest trust).
"""
from __future__ import annotations

import re
from collections import Counter

_STOP = set("""a an the and or of to in on for with by at from as is are was were be been
this that these those it its into upon shall will may not no any all such other than
which who whom whose where when what how if then also under over between during per
document page part section subject ref dated regarding above below hereby herein thereof
please kindly said same new via due within without further vide""".split())

_CODE = re.compile(r"\b[A-Za-z]{2,8}[\s\-_#]?\d{1,3}\b")
_ACRO = re.compile(r"\b[A-Z]{2,6}\b")
_WORD = re.compile(r"[A-Za-z][A-Za-z\-]{2,}")

# Domain acronyms worth labeling even at 1 occurrence
_DOMAIN_ACROS = {"LD", "PMC", "DPR", "BOQ", "LOA", "NIT", "PO", "FR", "TS", "MOS",
                 "CAPEX", "AMR", "RSP", "SAIL", "MECON", "VC", "EOT", "RA", "GST",
                 "CPM", "PERT", "WBS", "COB", "CDCP", "BF", "SMS", "TMT"}


def _norm_code(tok: str) -> str:
    return re.sub(r"[\s_#]+", "-", tok.strip()).upper()


def extract_keywords(text: str, title: str = "", max_terms: int = 8) -> list[str]:
    """Deterministic keyword set for one document. Ordered: codes, acronyms,
    salient terms. Capped so labels stay scannable, not a word cloud."""
    text = text or ""
    codes = []
    seen = set()
    for m in _CODE.finditer(f"{title}\n{text}"):
        c = _norm_code(m.group(0))
        # reject pure junk like "PAGE-1", "ITEM 2" via stopword prefix
        if c.split("-")[0].lower() in _STOP:
            continue
        if c not in seen:
            seen.add(c); codes.append(c)
    codes = codes[:6]

    acros = []
    acro_counts = Counter(m.group(0) for m in _ACRO.finditer(text))
    for a, n in acro_counts.most_common():
        if a in _DOMAIN_ACROS or n >= 3:
            if a not in seen and not any(a in c for c in codes):
                seen.add(a); acros.append(a)
    acros = acros[:5]

    words = Counter()
    for w in _WORD.findall(text.lower()):
        if w in _STOP or len(w) < 4:
            continue
        words[w] += 1
    title_words = {w.lower() for w in _WORD.findall(title)}
    salient = sorted(words.items(),
                     key=lambda kv: -(kv[1] + (5 if kv[0] in title_words else 0)))
    terms = []
    for w, n in salient:
        if n < 2 and w not in title_words:
            continue
        if w.upper() in seen or w in seen:
            continue
        seen.add(w); terms.append(w)
        if len(terms) >= max_terms:
            break

    return codes + acros + terms


def merge_keywords(auto: list[str], manual: list[str] | None,
                   entity_codes: list[str] | None = None, cap: int = 16) -> list[str]:
    """Manual first (uploader intent), then entity canonical codes, then auto."""
    out: list[str] = []
    seen: set[str] = set()
    for src in (manual or []), (entity_codes or []), auto:
        for k in src:
            k = (k or "").strip()
            if not k:
                continue
            key = k.lower()
            if key in seen:
                continue
            seen.add(key); out.append(k)
            if len(out) >= cap:
                return out
    return out
