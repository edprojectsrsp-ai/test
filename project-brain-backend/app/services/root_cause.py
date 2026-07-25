"""
Root-cause taxonomy for progress deviations.

When a DPR reports less work than planned, the Ministry's first question is
why. Today the repo has no answer: there is no root-cause field anywhere, so
the reason lives in free-text `issues` if it is recorded at all, and cannot be
aggregated. "We lost 47 days to design holds this quarter" is not a report
anyone can currently produce.

Free text will not fix that. Three engineers write "rain", "heavy rains" and
"weather" for the same cause, and no amount of grouping recovers the number. So
the taxonomy is a closed list, with a free-text note beside it rather than
instead of it.

The categories are chosen to answer the question that actually follows "why":
whose problem is it. Attribution drives extension-of-time claims, so each cause
carries a default responsibility, and each is marked for whether it typically
supports an EOT claim. Those defaults are a starting point for a planner, never
an automatic contractual determination — the code says so and the UI must too.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

# Who is answerable. Deliberately coarse: finer attribution is a contractual
# argument, not a dropdown.
OWNER = "owner"                 # the client / RSP
CONTRACTOR = "contractor"
EXTERNAL = "external"           # neither party controls it
SHARED = "shared"


@dataclass(frozen=True)
class RootCause:
    code: str
    label: str
    group: str
    default_responsibility: str
    typically_excusable: bool     # does this usually support an EOT claim
    hint: str


# Order within a group is roughly by how often it is the real answer on an
# Indian steel-plant project.
ROOT_CAUSES: tuple[RootCause, ...] = (
    # ---- design and engineering -------------------------------------------
    RootCause("DRG_PENDING", "Drawing not released", "Design", OWNER, True,
              "Work front is ready but the drawing is not IFC."),
    RootCause("DRG_REVISION", "Drawing revised / rework", "Design", OWNER, True,
              "Issued drawing changed after work started."),
    RootCause("DESIGN_QUERY", "Design query unresolved", "Design", OWNER, True,
              "Site query raised, awaiting engineering reply."),
    RootCause("SCOPE_CHANGE", "Scope change / variation", "Design", OWNER, True,
              "Additional or altered scope instructed."),

    # ---- materials and supply ---------------------------------------------
    RootCause("MAT_NOT_DELIVERED", "Material not delivered", "Supply", CONTRACTOR, False,
              "Ordered material has not reached site."),
    RootCause("MAT_FREE_ISSUE", "Free-issue material not supplied", "Supply", OWNER, True,
              "Owner-supplied material awaited."),
    RootCause("MAT_REJECTED", "Material rejected at inspection", "Supply", CONTRACTOR, False,
              "Delivered material failed inspection."),
    RootCause("MAT_SHORTAGE", "Market shortage", "Supply", EXTERNAL, True,
              "Item unavailable in the market, not a procurement failure."),

    # ---- labour and plant --------------------------------------------------
    RootCause("LABOUR_SHORTAGE", "Labour shortage", "Resources", CONTRACTOR, False,
              "Insufficient manpower deployed."),
    RootCause("LABOUR_STRIKE", "Strike / industrial action", "Resources", EXTERNAL, True,
              "Work stopped by industrial action."),
    RootCause("EQUIP_BREAKDOWN", "Equipment breakdown", "Resources", CONTRACTOR, False,
              "Plant or machinery unavailable."),
    RootCause("EQUIP_AWAITED", "Equipment not mobilised", "Resources", CONTRACTOR, False,
              "Required plant not yet brought to site."),

    # ---- site access and enabling ------------------------------------------
    RootCause("FRONT_NOT_AVAILABLE", "Work front not available", "Access", OWNER, True,
              "Predecessor work or another agency is occupying the front."),
    RootCause("SHUTDOWN_AWAITED", "Shutdown / outage awaited", "Access", OWNER, True,
              "Work needs a plant outage that has not been granted."),
    RootCause("PERMIT_PENDING", "Permit / clearance pending", "Access", OWNER, True,
              "Work permit, hot-work or statutory clearance not issued."),
    RootCause("UTILITY_SHIFT", "Utility shifting pending", "Access", OWNER, True,
              "Existing services must be diverted first."),

    # ---- external ----------------------------------------------------------
    RootCause("WEATHER_RAIN", "Rain", "External", EXTERNAL, True,
              "Rain stopped or slowed work."),
    RootCause("WEATHER_OTHER", "Other adverse weather", "External", EXTERNAL, True,
              "Heat, wind or storm beyond working limits."),
    RootCause("STATUTORY", "Statutory / regulatory hold", "External", EXTERNAL, True,
              "Order from an authority stopped work."),
    RootCause("LAW_ORDER", "Law and order / bandh", "External", EXTERNAL, True,
              "Access or work prevented by public disturbance."),

    # ---- quality and safety -------------------------------------------------
    RootCause("QUALITY_REWORK", "Rework after quality failure", "Quality", CONTRACTOR, False,
              "Executed work rejected and being redone."),
    RootCause("SAFETY_STOP", "Safety stoppage", "Quality", SHARED, False,
              "Work stopped on safety grounds."),
    RootCause("ACCIDENT", "Accident / incident", "Quality", SHARED, True,
              "Work suspended following an incident."),

    # ---- commercial ---------------------------------------------------------
    RootCause("PAYMENT_DELAY", "Payment delay", "Commercial", OWNER, True,
              "Contractor unable to proceed pending payment."),
    RootCause("SUBCONTRACTOR", "Sub-contractor default", "Commercial", CONTRACTOR, False,
              "Appointed sub-agency failed to perform."),

    # ---- catch-all ----------------------------------------------------------
    RootCause("PLANNED_NIL", "No work planned", "Other", SHARED, False,
              "Nil progress is expected — holiday, or activity not yet due."),
    RootCause("OTHER", "Other (explain in note)", "Other", SHARED, False,
              "Use only when nothing above fits; the note becomes mandatory."),
)

BY_CODE: dict[str, RootCause] = {c.code: c for c in ROOT_CAUSES}
GROUPS: tuple[str, ...] = tuple(dict.fromkeys(c.group for c in ROOT_CAUSES))

# Causes that mean "nothing went wrong", so a deviation carrying one should not
# be counted as lost time in a delay analysis.
BENIGN_CODES = frozenset({"PLANNED_NIL"})

# Free text is required for these, because the code alone says nothing useful.
NOTE_REQUIRED_CODES = frozenset({"OTHER"})


def is_valid(code: str | None) -> bool:
    return bool(code) and code in BY_CODE


def validate(code: str | None, note: str | None = None) -> list[str]:
    """Return a list of problems; empty means acceptable."""
    problems: list[str] = []
    if not code:
        problems.append("A root cause is required for a deviation.")
        return problems
    if code not in BY_CODE:
        problems.append(f"Unknown root cause '{code}'.")
        return problems
    if code in NOTE_REQUIRED_CODES and not (note or "").strip():
        problems.append(f"'{BY_CODE[code].label}' requires an explanatory note.")
    return problems


def catalogue() -> list[dict]:
    """Grouped list for a dropdown, in display order."""
    return [{
        "group": g,
        "causes": [{
            "code": c.code, "label": c.label,
            "responsibility": c.default_responsibility,
            "excusable": c.typically_excusable,
            "hint": c.hint,
            "note_required": c.code in NOTE_REQUIRED_CODES,
        } for c in ROOT_CAUSES if c.group == g],
    } for g in GROUPS]


@dataclass
class CauseTally:
    code: str
    label: str
    group: str
    responsibility: str
    excusable: bool
    occurrences: int
    days_lost: float

    def as_dict(self) -> dict:
        return {
            "code": self.code, "label": self.label, "group": self.group,
            "responsibility": self.responsibility, "excusable": self.excusable,
            "occurrences": self.occurrences, "days_lost": round(self.days_lost, 1),
        }


def summarise(
    deviations: Iterable[tuple[str | None, float]],
    include_benign: bool = False,
) -> dict:
    """Aggregate (root_cause_code, days_lost) pairs into a report.

    This is the whole reason the field is a closed list: it produces
    "47 days lost to design holds, of which 41 are owner-attributable and
    excusable" from data an engineer entered with one tap.
    """
    tallies: dict[str, CauseTally] = {}
    unclassified_count = 0
    unclassified_days = 0.0

    for code, days in deviations:
        d = float(days or 0.0)
        if not is_valid(code):
            unclassified_count += 1
            unclassified_days += d
            continue
        if code in BENIGN_CODES and not include_benign:
            continue
        c = BY_CODE[code]
        t = tallies.get(code)
        if t is None:
            tallies[code] = CauseTally(c.code, c.label, c.group,
                                       c.default_responsibility,
                                       c.typically_excusable, 1, d)
        else:
            t.occurrences += 1
            t.days_lost += d

    ordered = sorted(tallies.values(), key=lambda t: (-t.days_lost, t.code))
    by_group: dict[str, float] = {}
    by_responsibility: dict[str, float] = {}
    excusable_days = 0.0
    for t in ordered:
        by_group[t.group] = by_group.get(t.group, 0.0) + t.days_lost
        by_responsibility[t.responsibility] = (
            by_responsibility.get(t.responsibility, 0.0) + t.days_lost)
        if t.excusable:
            excusable_days += t.days_lost

    total = sum(t.days_lost for t in ordered)
    return {
        "causes": [t.as_dict() for t in ordered],
        "by_group": {k: round(v, 1) for k, v in
                     sorted(by_group.items(), key=lambda kv: -kv[1])},
        "by_responsibility": {k: round(v, 1) for k, v in
                              sorted(by_responsibility.items(), key=lambda kv: -kv[1])},
        "total_days_lost": round(total, 1),
        "excusable_days": round(excusable_days, 1),
        "non_excusable_days": round(total - excusable_days, 1),
        "unclassified_count": unclassified_count,
        "unclassified_days": round(unclassified_days, 1),
        # Stated explicitly so a report never reads as a contractual finding.
        "disclaimer": ("Responsibility and excusability are defaults from the "
                       "cause taxonomy, offered to speed up analysis. They are "
                       "not a contractual determination and every EOT claim "
                       "still needs its own assessment."),
    }
