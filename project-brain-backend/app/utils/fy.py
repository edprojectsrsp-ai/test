"""
PROJECT BRAIN — Financial year helpers, variance engine, S-curve builder.
"""

from datetime import date
from typing import List, Tuple


def current_fy(today: date | None = None) -> Tuple[int, int]:
    today = today or date.today()
    return (today.year, today.year + 1) if today.month >= 4 else (today.year - 1, today.year)


def fy_label(today: date | None = None) -> str:
    s, e = current_fy(today)
    return f"FY {s}-{str(e)[-2:]}"


def fy_months(today: date | None = None) -> List[str]:
    s, e = current_fy(today)
    return [date(s, m, 1).strftime("%b-%y") for m in range(4, 13)] + \
           [date(e, m, 1).strftime("%b-%y") for m in range(1, 4)]


def fy_month_dates(today: date | None = None) -> List[date]:
    s, e = current_fy(today)
    return [date(s, m, 1) for m in range(4, 13)] + \
           [date(e, m, 1) for m in range(1, 4)]


def fy_range(today: date | None = None) -> Tuple[date, date]:
    s, e = current_fy(today)
    return date(s, 4, 1), date(e, 3, 31)


def fy_options(count: int = 4, today: date | None = None) -> List[str]:
    s, _ = current_fy(today)
    return [f"FY {y}-{str(y + 1)[-2:]}" for y in range(s, s + count)]


def variance(planned: float, actual: float, scope: float) -> Tuple[float, str]:
    if scope <= 0:
        return (0.0, "No Scope")
    p = (planned / scope) * 100
    a = (actual / scope) * 100
    v = round(a - p, 2)
    if v > 5:
        label = "Ahead"
    elif v < -5:
        label = "Behind"
    else:
        label = "On Track"
    return (v, label)


def overall_progress(activities: list) -> dict:
    total_weight = sum(a.get("weightage", 0) for a in activities)
    if total_weight == 0:
        return {"planned_pct": 0, "actual_pct": 0, "variance_pct": 0, "status": "No Data"}

    w_planned = 0.0
    w_actual = 0.0
    for a in activities:
        scope = a.get("scope_qty", 0)
        weight = a.get("weightage", 0)
        planned = a.get("planned_qty", 0)
        actual = (a.get("actuals_till_last_fy", 0) or 0) + (a.get("current_fy_actual", 0) or 0)
        if scope > 0:
            w_planned += (planned / scope) * weight
            w_actual += (actual / scope) * weight

    pp = round(w_planned, 2)
    ap = round(w_actual, 2)
    vp = round(ap - pp, 2)
    status = "Ahead" if vp > 5 else ("Behind" if vp < -5 else "On Track")
    return {"planned_pct": pp, "actual_pct": ap, "variance_pct": vp, "status": status}


def build_s_curve(monthly_planned: dict, monthly_actual: dict, total_scope: float) -> list:
    if total_scope <= 0:
        return []
    all_months = sorted(set(list(monthly_planned.keys()) + list(monthly_actual.keys())))
    cum_p = 0.0
    cum_a = 0.0
    points = []
    for m in all_months:
        cum_p += monthly_planned.get(m, 0)
        cum_a += monthly_actual.get(m, 0)
        points.append({
            "month": m,
            "planned_cum_pct": round(cum_p / total_scope * 100, 2),
            "actual_cum_pct": round(cum_a / total_scope * 100, 2),
        })
    return points


def classify_delay(scheduled_completion: date | None, expected_completion: date | None, today: date | None = None) -> dict:
    today = today or date.today()
    if not scheduled_completion:
        return {"delay_months": 0, "delay_category": "No Schedule", "color": "gray"}

    target = expected_completion or scheduled_completion
    delta = (target - scheduled_completion).days
    delay_months = max(0, delta // 30)

    if delay_months == 0:
        return {"delay_months": 0, "delay_category": "On Time", "color": "green"}
    elif delay_months <= 6:
        return {"delay_months": delay_months, "delay_category": "Minor Delay", "color": "yellow"}
    elif delay_months <= 12:
        return {"delay_months": delay_months, "delay_category": "Moderate Delay", "color": "orange"}
    else:
        return {"delay_months": delay_months, "delay_category": "Critical Delay", "color": "red"}
