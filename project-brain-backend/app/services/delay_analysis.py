"""Forensic delay-analysis engine (Python twin of engine/delayAnalysis.ts).

Authoritative server-side implementation of the five SCL/AACE methods, each a
distinct process flow:

  1. As-Planned vs As-Built (APAB)  — retrospective observation: baseline CPM vs
     as-built dates, the as-built driving chain, per-activity variance ledger.
  2. Impacted As-Planned (IAP)      — additive: insert delay events into the
     pristine baseline one at a time; each event's completion delta is its impact.
  3. Collapsed As-Built             — subtractive but-for: remove a party's events
     from the as-built and collapse; the improvement is that party's responsibility.
  4. Window Analysis                — contemporaneous: cut the project into periods;
     the forecast-completion drift inside each window is attributed to that window's
     critical events.
  5. Time Impact Analysis (TIA)     — prospective: status the schedule at a data
     date, insert the fragnet, measure the forecast shift (the EOT instrument).

The network model (activities + precedence + baseline/as-built day-indices) is
derived from the live plan_activities baseline vs expected-finish dates by
build_schedule_model(); delay events come from the delay_events register.
"""

from __future__ import annotations

from collections import deque
from datetime import date, datetime
from typing import Optional

from sqlalchemy import text


# ─────────────────── Schedule model from real plan data ─────────────────────

# Stage rank drives the derived precedence spine (Design → Civil/Supply →
# Erection → Commissioning) since plan_activities carry no explicit logic.
_STAGE_RULES = [
    (("design", "eng"), 0),
    (("civil",), 1),
    (("supply", "deliver", "procure", "manufactur", "indigen", "import", "fabricat"), 2),
    (("erection", "install", "construct"), 3),
    (("commission", "testing", "trial", "startup", "start-up", "handover"), 4),
]


def _stage_rank(category: str, name: str) -> int:
    t = f"{category or ''} {name or ''}".lower()
    for keywords, rank in _STAGE_RULES:
        if any(k in t for k in keywords):
            return rank
    return 2  # default: mid-stage execution


def _discipline(name: str) -> str:
    t = (name or "").lower()
    if "steel" in t or "structur" in t:
        return "structural"
    if "mechanical" in t or "equipment" in t or "equip" in t:
        return "mechanical"
    if "electric" in t:
        return "electrical"
    if "refractor" in t:
        return "refractory"
    if "civil" in t:
        return "civil"
    if "design" in t or "eng" in t:
        return "design"
    return "general"


def _to_date(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def build_schedule_model(db, scheme_id: int, package_id: Optional[int] = None):
    """Derive the forensic network from live plan_activities: baseline durations
    (planned_start→planned_finish), a forecast/as-built layer (planned_start→
    expected_finish, capturing the real slip) and a category-staged precedence
    spine. Dates are converted to integer project-days (day 0 = earliest
    baseline start)."""
    pkg_sql = "AND pkg.package_id = :pkg" if package_id else ""
    rows = db.execute(text(f"""
        SELECT pa.activity_id, pa.activity_name, pa.activity_category,
               pa.planned_start_date, pa.planned_finish_date,
               pa.actual_start_date, pa.actual_finish_date,
               pa.expected_finish_date, pa.sort_order,
               COALESCE(um.uom_code, '') AS uom, pkg.package_id, pkg.package_name
        FROM plan_activities pa
        JOIN progress_plans pp ON pp.plan_id = pa.plan_id
        JOIN packages pkg      ON pkg.package_id = pp.package_id
        LEFT JOIN uom_master um ON um.uom_id = pa.uom_id
        WHERE pkg.scheme_id = :sid
          AND pp.is_locked = TRUE AND pp.is_current = TRUE
          AND NOT pp.is_deleted AND NOT pa.is_deleted AND NOT pkg.is_deleted
          AND pa.planned_start_date IS NOT NULL AND pa.planned_finish_date IS NOT NULL
          {pkg_sql}
        ORDER BY pkg.package_id, pa.sort_order, pa.activity_id
    """), {"sid": scheme_id, "pkg": package_id}).mappings().all()
    rows = [dict(r) for r in rows]
    if not rows:
        return {"activities": [], "asBuilt": {}, "meta": {"origin": None}, "rows": []}

    # project day 0 = earliest baseline start
    all_starts = [_to_date(r["planned_start_date"]) for r in rows if _to_date(r["planned_start_date"])]
    origin = min(all_starts)

    def day(d):
        d = _to_date(d)
        return (d - origin).days if d else None

    model_rows = []
    for r in rows:
        ps, pf = _to_date(r["planned_start_date"]), _to_date(r["planned_finish_date"])
        ef = _to_date(r["expected_finish_date"]) or pf
        as_ = _to_date(r["actual_start_date"])
        af = _to_date(r["actual_finish_date"])
        base_dur = max(1, (pf - ps).days)
        # as-built / forecast layer: prefer real actuals, else forecast finish
        ab_start = day(as_ if as_ else ps)
        ab_finish = day(af if af else ef)
        model_rows.append({
            "aid": str(r["activity_id"]),
            "name": r["activity_name"],
            "category": r["activity_category"] or "",
            "discipline": _discipline(r["activity_name"]),
            "stage": _stage_rank(r["activity_category"], r["activity_name"]),
            "uom": r["uom"], "package": r["package_name"],
            "plannedStartDay": day(ps), "plannedFinishDay": day(pf),
            "baselineDur": base_dur,
            "abStartDay": ab_start, "abFinishDay": max(ab_start, ab_finish),
            "slipDays": max(0, (ef - pf).days),
            "hasActual": bool(af),
            "plannedStartDate": ps.isoformat(), "plannedFinishDate": pf.isoformat(),
            "expectedFinishDate": ef.isoformat(),
        })

    # Derived precedence CONSISTENT with the recorded baseline dates: each
    # activity is FS-linked to its stage feeder (the discipline chain Design ->
    # Supply -> Erection -> Commissioning) with the lag read straight off the
    # baseline (lag = successor.start - feeder.finish; negative where work is
    # fast-tracked/overlapped). This reproduces the real baseline under CPM
    # (honest slips) while keeping every finish = start + duration, so a feeder
    # slip or a duration extension propagates through the chain instead of being
    # silently absorbed (as an FF-pinned link would do).
    activities = []
    for m in model_rows:
        preds = []
        if m["stage"] > 0 and m["plannedStartDay"] is not None:
            lower = [x for x in model_rows
                     if x["aid"] != m["aid"] and x["package"] == m["package"]
                     and x["stage"] < m["stage"] and x["plannedFinishDay"] is not None]
            same = [x for x in lower if x["discipline"] == m["discipline"]]
            pool = same or lower
            if pool:
                top = max(x["stage"] for x in pool)          # nearest lower stage
                pool = [x for x in pool if x["stage"] == top]
                feeder = max(pool, key=lambda x: x["plannedFinishDay"])   # binding feeder
                lag = m["plannedStartDay"] - feeder["plannedFinishDay"]   # real overlap/gap
                preds.append({"id": feeder["aid"], "type": "FS", "lag": lag})
        activities.append({"id": m["aid"], "name": m["name"], "dur": m["baselineDur"], "preds": preds})

    as_built = {m["aid"]: {"start": m["abStartDay"], "finish": m["abFinishDay"]} for m in model_rows}
    # baseline "start no earlier than" floors keep the CPM anchored to the real
    # recorded baseline dates while still propagating delays through the logic.
    start_floor = {m["aid"]: m["plannedStartDay"] for m in model_rows}
    return {
        "activities": activities,
        "asBuilt": as_built,
        "startFloor": start_floor,
        "rows": model_rows,
        "meta": {"origin": origin.isoformat(), "unit": "days",
                 "activityCount": len(model_rows),
                 "packages": sorted({m["package"] for m in model_rows})},
    }


# ─────────────────────────── CPM core ───────────────────────────────────────

def _topo(acts):
    indeg = {a["id"]: 0 for a in acts}
    succ = {a["id"]: [] for a in acts}
    for a in acts:
        for p in a.get("preds") or []:
            if p["id"] not in indeg:
                raise ValueError(f'unknown predecessor "{p["id"]}" of "{a["id"]}"')
            indeg[a["id"]] += 1
            succ[p["id"]].append(a["id"])
    q = deque([k for k, v in indeg.items() if v == 0])
    order = []
    while q:
        u = q.popleft()
        order.append(u)
        for s in succ[u]:
            indeg[s] -= 1
            if indeg[s] == 0:
                q.append(s)
    if len(order) != len(acts):
        raise ValueError("cycle in activity network")
    return order


def cpm(acts, dur_override: Optional[dict] = None, start_floor: Optional[dict] = None):
    """Forward/backward CPM. start_floor[id] pins an activity's earliest start
    to its real baseline position ("start no earlier than"), so a network whose
    activities carry recorded dates reproduces those dates while still letting
    delays propagate through the logic to successors."""
    by_id = {a["id"]: a for a in acts}
    start_floor = start_floor or {}

    def dur(aid):
        d = (dur_override or {}).get(aid)
        if d is None:
            d = by_id[aid]["dur"]
        return max(0.0, float(d))

    order = _topo(acts)
    es, ef = {}, {}
    for aid in order:
        a = by_id[aid]
        start = float(start_floor.get(aid, 0.0))
        d = dur(aid)
        for l in a.get("preds") or []:
            t, lag = l.get("type", "FS"), l.get("lag", 0)
            pes, pef = es[l["id"]], ef[l["id"]]
            if t == "FS":
                cand = pef + lag
            elif t == "SS":
                cand = pes + lag
            elif t == "FF":
                cand = pef + lag - d
            else:  # SF
                cand = pes + lag - d
            start = max(start, cand)
        es[aid] = start
        ef[aid] = start + d
    finish = max((ef[a] for a in order), default=0.0)

    succ_links = {aid: [] for aid in order}
    for a in acts:
        for l in a.get("preds") or []:
            succ_links[l["id"]].append({"id": a["id"], "type": l.get("type", "FS"), "lag": l.get("lag", 0)})
    ls, lf = {}, {}
    for aid in reversed(order):
        d = dur(aid)
        late = finish
        for s in succ_links[aid]:
            sls, slf = ls[s["id"]], lf[s["id"]]
            if s["type"] == "FS":
                cand = sls - s["lag"]
            elif s["type"] == "SS":
                cand = sls - s["lag"] + d
            elif s["type"] == "FF":
                cand = slf - s["lag"]
            else:  # SF
                cand = slf - s["lag"] + d
            late = min(late, cand)
        lf[aid] = late
        ls[aid] = late - d

    dates, critical_path = {}, []
    for aid in order:
        tf = ls[aid] - es[aid]
        critical = abs(tf) < 1e-9
        dates[aid] = {"es": es[aid], "ef": ef[aid], "ls": ls[aid], "lf": lf[aid],
                      "tf": tf, "critical": critical}
        if critical:
            critical_path.append(aid)
    return {"dates": dates, "finish": finish, "criticalPath": critical_path}


def statused_forecast(acts, as_built, t, start_floor: Optional[dict] = None):
    """Schedule statused at data date t (shared by windows & TIA)."""
    by_id = {a["id"]: a for a in acts}
    start_floor = start_floor or {}
    dur_at_t, fixed_start = {}, {}
    for a in acts:
        ab = as_built.get(a["id"])
        if ab and ab["finish"] <= t:
            dur_at_t[a["id"]] = ab["finish"] - ab["start"]
            fixed_start[a["id"]] = ab["start"]
        elif ab and ab["start"] <= t:
            elapsed = t - ab["start"]
            remaining = max(0.0, a["dur"] - elapsed)
            dur_at_t[a["id"]] = elapsed + remaining
            fixed_start[a["id"]] = ab["start"]
        else:
            dur_at_t[a["id"]] = a["dur"]

    order = _topo(acts)
    es, ef = {}, {}
    for aid in order:
        a = by_id[aid]
        if aid in fixed_start:
            start = fixed_start[aid]
        else:
            start = float(start_floor.get(aid, 0.0))
            d = dur_at_t[aid]
            for l in a.get("preds") or []:
                tp, lag = l.get("type", "FS"), l.get("lag", 0)
                pes, pef = es[l["id"]], ef[l["id"]]
                if tp == "FS":
                    cand = pef + lag
                elif tp == "SS":
                    cand = pes + lag
                elif tp == "FF":
                    cand = pef + lag - d
                else:
                    cand = pes + lag - d
                start = max(start, cand)
            start = max(start, 0.0)
            if start < t:               # unstarted work cannot begin in the past
                start = t
        es[aid] = start
        ef[aid] = start + dur_at_t[aid]
    finish = max((ef[a] for a in order), default=0.0)
    return {"finish": finish, "cpmResult": cpm(acts, dur_at_t, start_floor),
            "durAtT": dur_at_t, "fixedStart": fixed_start}


# ─────────────────────── Method 1 — APAB ─────────────────────────────────────

def as_planned_vs_as_built(acts, as_built, start_floor=None):
    base = cpm(acts, None, start_floor)
    by_id = {a["id"]: a for a in acts}
    ab_finish = max((as_built[a["id"]]["finish"] for a in acts if a["id"] in as_built), default=0.0)

    TOL = 0.51
    started = [a for a in acts if a["id"] in as_built]
    cursor = None
    if started:
        cursor = sorted(started, key=lambda a: as_built[a["id"]]["finish"], reverse=True)[0]["id"]
    chain, in_chain = [], set()
    while cursor is not None and cursor not in in_chain:
        chain.append(cursor)
        in_chain.add(cursor)
        a = by_id[cursor]
        ab_s = as_built[cursor]
        driver, best = None, float("-inf")
        for l in a.get("preds") or []:
            pab = as_built.get(l["id"])
            if not pab:
                continue
            if abs(pab["finish"] - ab_s["start"]) <= TOL or pab["finish"] >= ab_s["start"] - TOL:
                if pab["finish"] > best:
                    best, driver = pab["finish"], l["id"]
        cursor = driver
    chain.reverse()

    rows = []
    for a in acts:
        d = base["dates"][a["id"]]
        ab = as_built.get(a["id"])
        rows.append({
            "id": a["id"], "name": a.get("name", a["id"]),
            "plannedStart": d["es"], "plannedFinish": d["ef"],
            "actualStart": ab["start"] if ab else None,
            "actualFinish": ab["finish"] if ab else None,
            "startVar": (ab["start"] - d["es"]) if ab else None,
            "finishVar": (ab["finish"] - d["ef"]) if ab else None,
            "ownSlip": ((ab["finish"] - ab["start"]) - a["dur"]) if ab else None,
            "plannedCritical": d["critical"],
            "asBuiltCritical": a["id"] in in_chain,
        })
    slip = ab_finish - base["finish"]
    drivers = sorted([r for r in rows if r["asBuiltCritical"] and (r["ownSlip"] or 0) > 0],
                     key=lambda r: r["ownSlip"] or 0, reverse=True)
    narrative = [
        f'Planned completion day {base["finish"]:g}; as-built completion day {ab_finish:g} — project slip {slip:g} day(s).',
        f'As-built critical chain: {" → ".join(by_id[c].get("name", c) for c in chain)}.',
    ] + [
        f'{r["name"]} consumed {r["ownSlip"]:g} extra day(s) on the driving chain '
        f'(planned {by_id[r["id"]]["dur"]:g}d, actual {(r["actualFinish"] - r["actualStart"]):g}d).'
        for r in drivers[:3]
    ]
    return {"method": "as_planned_vs_as_built", "rows": rows,
            "plannedFinish": base["finish"], "asBuiltFinish": ab_finish,
            "projectSlip": slip, "drivingChain": chain, "narrative": narrative}


# ─────────────────────── Method 2 — IAP ──────────────────────────────────────

def impacted_as_planned(acts, events, start_floor=None):
    base = cpm(acts, None, start_floor)
    dur_ov = {a["id"]: a["dur"] for a in acts}
    prev_finish = base["finish"]
    steps = []
    by_party = {"employer": 0.0, "contractor": 0.0, "neutral": 0.0}
    for ev in sorted(events, key=lambda e: e.get("atDay", 0)):
        if ev["activityId"] not in dur_ov:
            continue
        dur_ov[ev["activityId"]] += ev["days"]
        r = cpm(acts, dur_ov, start_floor)
        impact = r["finish"] - prev_finish
        steps.append({"event": ev, "finishBefore": prev_finish, "finishAfter": r["finish"], "impact": impact})
        by_party[ev["party"]] = by_party.get(ev["party"], 0.0) + impact
        prev_finish = r["finish"]
    narrative = [
        f'Baseline completion day {base["finish"]:g}; impacted completion day {prev_finish:g} (+{prev_finish - base["finish"]:g}).',
    ] + [
        f'{s["event"]["name"]} ({s["event"]["party"]}, {s["event"]["days"]:g}d on {s["event"]["activityId"]}) '
        f'→ +{s["impact"]:g} day(s) to completion'
        + (" (partially absorbed by float)" if s["impact"] < s["event"]["days"] else "") + "."
        for s in steps
    ] + [
        f'Attribution — Employer {by_party["employer"]:g}d · Contractor {by_party["contractor"]:g}d · Neutral {by_party["neutral"]:g}d.'
    ]
    return {"method": "impacted_as_planned", "baselineFinish": base["finish"],
            "impactedFinish": prev_finish, "totalImpact": prev_finish - base["finish"],
            "steps": steps, "byParty": by_party, "narrative": narrative}


# ─────────────────────── Method 3 — Collapsed As-Built ──────────────────────

def collapsed_as_built(acts, as_built, events, start_floor=None):
    ab_dur = {}
    for a in acts:
        ab = as_built.get(a["id"])
        ab_dur[a["id"]] = (ab["finish"] - ab["start"]) if ab else a["dur"]
    ab_finish = cpm(acts, ab_dur, start_floor)["finish"]

    def collapse(remove):
        d = dict(ab_dur)
        for ev in events:
            if remove(ev):
                d[ev["activityId"]] = max(0.0, d[ev["activityId"]] - ev["days"])
        return cpm(acts, d, start_floor)["finish"]

    parties = ["employer", "contractor", "neutral"]
    scenarios, by_party = [], {"employer": 0.0, "contractor": 0.0, "neutral": 0.0}
    for p in parties:
        f = collapse(lambda e, p=p: e["party"] == p)
        scenarios.append({"removedParty": p, "collapsedFinish": f, "saved": ab_finish - f})
        by_party[p] = ab_finish - f
    all_f = collapse(lambda e: True)
    scenarios.append({"removedParty": "all", "collapsedFinish": all_f, "saved": ab_finish - all_f})
    base_finish = cpm(acts, None, start_floor)["finish"]
    narrative = [
        f"As-built completion day {ab_finish:g}.",
    ] + [
        f'But-for {p} delay events, the project collapses to day '
        f'{next(s for s in scenarios if s["removedParty"] == p)["collapsedFinish"]:g} — '
        f'{by_party[p]:g} day(s) attributable to {p}.'
        for p in parties
    ] + [
        f'Removing ALL events collapses to day {all_f:g}'
        + (" (matches the baseline — event set fully explains the slip)"
           if abs(all_f - base_finish) < 1e-9 else "") + "."
    ]
    return {"method": "collapsed_as_built", "asBuiltFinish": ab_finish,
            "scenarios": scenarios, "byParty": by_party, "narrative": narrative}


# ─────────────────────── Method 4 — Windows ─────────────────────────────────

def window_analysis(acts, as_built, events, boundaries, start_floor=None):
    bs = sorted(boundaries)
    windows = []
    total_by_party = {"employer": 0.0, "contractor": 0.0, "neutral": 0.0}
    unexplained_total = 0.0
    for i in range(len(bs) - 1):
        t0, t1 = bs[i], bs[i + 1]
        f0 = statused_forecast(acts, as_built, t0, start_floor)
        f1 = statused_forecast(acts, as_built, t1, start_floor)
        slip = f1["finish"] - f0["finish"]
        critical = set(f1["cpmResult"]["criticalPath"])
        in_win = [e for e in events
                  if t0 <= e.get("atDay", 0) < t1 and e["activityId"] in critical]
        ev_days = sum(e["days"] for e in in_win)
        scale = min(1.0, max(0.0, slip) / ev_days) if ev_days > 0 else 0.0
        attributed = [{"event": e, "days": round(e["days"] * scale, 2)} for e in in_win]
        by_party = {"employer": 0.0, "contractor": 0.0, "neutral": 0.0}
        for a in attributed:
            by_party[a["event"]["party"]] += a["days"]
        unexplained = round(max(0.0, slip) - sum(a["days"] for a in attributed), 2)
        for p in by_party:
            total_by_party[p] += by_party[p]
        unexplained_total += unexplained
        windows.append({
            "from": t0, "to": t1, "forecastAtStart": f0["finish"], "forecastAtEnd": f1["finish"],
            "slip": slip, "attributed": attributed, "byParty": by_party,
            "unexplained": unexplained, "criticalAtEnd": f1["cpmResult"]["criticalPath"],
        })
    total_slip = sum(w["slip"] for w in windows)
    narrative = [
        f'{len(windows)} window(s); cumulative slip {total_slip:g} day(s) '
        f'(forecast day {windows[0]["forecastAtStart"]:g} → {windows[-1]["forecastAtEnd"]:g}).'
        if windows else "No windows.",
    ] + [
        f'Window {w["from"]:g}–{w["to"]:g}: slip {w["slip"]:g}d '
        f'({", ".join(f"{a["event"]["name"]} {a["days"]:g}d" for a in w["attributed"]) or "no critical events"}'
        + (f', unexplained {w["unexplained"]:g}d' if w["unexplained"] > 0 else "") + ")."
        for w in windows
    ] + [
        f'Attribution — Employer {total_by_party["employer"]:.1f}d · Contractor {total_by_party["contractor"]:.1f}d '
        f'· Neutral {total_by_party["neutral"]:.1f}d · Unexplained {unexplained_total:.1f}d.'
    ]
    return {"method": "window_analysis", "windows": windows, "totalSlip": total_slip,
            "byParty": total_by_party, "unexplained": unexplained_total, "narrative": narrative}


# ─────────────────────── Method 5 — TIA ──────────────────────────────────────

def time_impact_analysis(acts, as_built, fragnet, data_date, start_floor=None):
    before = statused_forecast(acts, as_built, data_date, start_floor)
    dur = dict(before["durAtT"])
    if fragnet["activityId"] not in dur:
        raise ValueError(f'fragnet targets unknown activity {fragnet["activityId"]}')
    dur[fragnet["activityId"]] += fragnet["days"]
    after = cpm(acts, dur, start_floor)
    with_finish = max(after["finish"], before["finish"])
    impact = with_finish - before["finish"]
    narrative = [
        f'Data date day {data_date:g}: forecast completion day {before["finish"]:g}.',
        f'Inserting fragnet "{fragnet["name"]}" ({fragnet["party"]}, {fragnet["days"]:g}d on {fragnet["activityId"]}) '
        f'moves forecast to day {with_finish:g}.',
        f'Time impact: {impact:g} day(s)'
        + (" (partially absorbed by float)" if impact < fragnet["days"] else "")
        + " — prima facie EOT entitlement if the event is excusable.",
    ]
    return {"method": "time_impact_analysis", "dataDate": data_date,
            "forecastWithout": before["finish"], "forecastWith": with_finish,
            "impact": impact, "fragnet": fragnet,
            "criticalAfter": after["criticalPath"], "narrative": narrative}
