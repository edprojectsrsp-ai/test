"""
Normalized intermediate representation produced by every importer, so the
loader that writes into PostgreSQL only has to understand one shape regardless
of whether the source was XER, XML or MPP.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional


@dataclass
class ImpCalendar:
    src_id: str
    name: str
    working_weekdays: list[int] = field(default_factory=lambda: [1, 2, 3, 4, 5])
    holidays: list[date] = field(default_factory=list)


@dataclass
class ImpWBS:
    src_id: str
    parent_src_id: Optional[str]
    code: str
    name: str


@dataclass
class ImpActivity:
    src_id: str
    code: str
    name: str
    duration: int = 0                 # working days
    is_milestone: bool = False
    wbs_src_id: Optional[str] = None
    calendar_src_id: Optional[str] = None
    percent_complete: float = 0.0
    actual_start: Optional[date] = None
    actual_finish: Optional[date] = None
    constraint_type: str = "NONE"
    constraint_date: Optional[date] = None


@dataclass
class ImpRelationship:
    pred_src_id: str
    succ_src_id: str
    rel_type: str = "FS"
    lag: int = 0


@dataclass
class ImportedSchedule:
    project_name: str = "Imported Project"
    project_start: Optional[date] = None
    data_date: Optional[date] = None
    source_format: str = ""
    calendars: list[ImpCalendar] = field(default_factory=list)
    wbs: list[ImpWBS] = field(default_factory=list)
    activities: list[ImpActivity] = field(default_factory=list)
    relationships: list[ImpRelationship] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def summary(self) -> dict:
        return {
            "project_name": self.project_name,
            "source_format": self.source_format,
            "activities": len(self.activities),
            "relationships": len(self.relationships),
            "wbs": len(self.wbs),
            "calendars": len(self.calendars),
            "warnings": self.warnings,
        }
