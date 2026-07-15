"""
Alerts & dashboard engine. Turns CPM / delay / register state into a list of
actionable alerts plus summary cards for the dashboard.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

from .cpm import CPMActivity, CPMResult, CPMRelationship


@dataclass
class Alert:
    category: str
    severity: str          # info / warning / critical
    message: str
    activity_id: Optional[str] = None


@dataclass
class DashboardCards:
    critical_activities: int = 0
    delayed_activities: int = 0
    negative_float_activities: int = 0
    milestones_upcoming: int = 0
    activities_needing_update: int = 0
    open_hindrances: int = 0
    high_risks: int = 0
    schedule_health: str = "unknown"   # good / watch / poor
    dcma_score: Optional[float] = None


def generate_alerts(
    cpm: CPMResult,
    relationships: list[CPMRelationship],
    data_date: Optional[date] = None,
    lookahead_days: int = 14,
    open_hindrances: Optional[list[dict]] = None,
    high_risks: Optional[list[dict]] = None,
) -> tuple[list[Alert], DashboardCards]:
    alerts: list[Alert] = []
    acts = cpm.activities
    preds = {r.successor_id for r in relationships}
    succs = {r.predecessor_id for r in relationships}

    cards = DashboardCards()
    horizon = (data_date or cpm.project_start) + timedelta(days=lookahead_days)

    for aid, a in acts.items():
        if a.is_critical:
            cards.critical_activities += 1
        if a.total_float is not None and a.total_float < 0:
            cards.negative_float_activities += 1
            alerts.append(Alert("negative_float", "critical",
                                f"{a.name}: negative float "
                                f"({a.total_float} wd) — schedule at risk.", aid))
        # missing logic
        if not a.is_complete and (aid not in preds or aid not in succs):
            alerts.append(Alert("missing_logic", "warning",
                                f"{a.name}: missing "
                                f"{'predecessor' if aid not in preds else 'successor'} "
                                "logic.", aid))
        # upcoming milestones
        if a.is_milestone and a.ef and (data_date or cpm.project_start) <= a.ef <= horizon:
            cards.milestones_upcoming += 1
            alerts.append(Alert("upcoming_milestone", "info",
                                f"Milestone {a.name} due {a.ef:%d-%b-%Y}.", aid))
        # overdue updates: in-progress with no actual start past data date
        if data_date and a.is_started and not a.actual_start:
            cards.activities_needing_update += 1
            alerts.append(Alert("overdue_update", "warning",
                                f"{a.name}: progress recorded but no actual "
                                "start entered.", aid))
        # critical activity starting in the lookahead window
        if a.is_critical and a.es and (data_date or cpm.project_start) <= a.es <= horizon:
            alerts.append(Alert("critical_lookahead", "warning",
                                f"Critical activity {a.name} starts "
                                f"{a.es:%d-%b-%Y}.", aid))

    for h in (open_hindrances or []):
        cards.open_hindrances += 1
        alerts.append(Alert("unresolved_hindrance", "warning",
                            f"Open hindrance: {h.get('hindrance_type','?')} on "
                            f"{h.get('activity_name','activity')}.",
                            h.get("activity_id")))

    for r in (high_risks or []):
        cards.high_risks += 1
        alerts.append(Alert("high_risk", "critical",
                            f"High risk: {r.get('title','risk')} "
                            f"(score {r.get('severity_score','?')}).",
                            r.get("activity_id")))

    # schedule health heuristic
    if cards.negative_float_activities > 0:
        cards.schedule_health = "poor"
    elif cards.critical_activities > 0.4 * max(len(acts), 1):
        cards.schedule_health = "watch"
    else:
        cards.schedule_health = "good"

    return alerts, cards
