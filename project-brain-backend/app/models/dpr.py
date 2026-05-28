"""
DPR / field-observation models — remapped to LIVE t5 tables.

Sprint 0 fix. The previous file defined dpr_entries / dpr_entries_v2 /
dpr_photos / corporate_manpower_daily — NONE of which exist in t5. The real
t5 home for geotagged field reports with photos is `field_observations`
(it already has gps lat/lng + photo_urls[] + severity + resolution tracking).
The quantity side of a daily report lives in `daily_actuals` (entered_via='dpr').

Mapping:
    DPREntryV2 (geotagged report + photos)  ->  field_observations
    DPRPhoto  (separate photo rows)         ->  folded into photo_urls[] array
    DPREntry  (legacy flat report)          ->  field_observations (observation_type='progress_update')
    CorporateManpowerDaily                  ->  daily_actuals.manpower_count
                                                (no separate table in t5)

The dpr.py ROUTER must be rewritten (Chunk 2) to use FieldObservation; the
aliases below only keep the import working until then.

Place at: project-brain-backend/app/models/dpr.py
"""

from sqlalchemy import (
    Column, Integer, String, Text, Numeric, Date, DateTime, Boolean,
    ForeignKey, ARRAY,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from app.core.database import Base


class FieldObservation(Base):
    """
    Geotagged field report. observation_type_enum values:
      'progress_update' | 'issue' | 'safety_incident' | 'quality_issue'
      | 'photo' | 'note'
    severity uses risk_level_enum: 'green' | 'amber' | 'red' | 'unknown'.
    """
    __tablename__ = "field_observations"

    observation_id = Column(Integer, primary_key=True, autoincrement=True)
    package_id = Column(Integer, ForeignKey("packages.package_id", ondelete="CASCADE"), nullable=False)
    activity_id = Column(Integer, ForeignKey("plan_activities.activity_id"))
    observation_type = Column(String(30), nullable=False, default="note")
    title = Column(String(300))
    description = Column(Text, nullable=False)
    severity = Column(String(10))  # risk_level_enum
    photo_urls = Column(ARRAY(Text))
    location_lat = Column(Numeric(10, 7))
    location_lng = Column(Numeric(10, 7))
    location_label = Column(String(200))
    weather = Column(String(100))
    observed_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())
    observed_by = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    is_resolved = Column(Boolean, nullable=False, default=False)
    resolved_at = Column(DateTime)
    resolved_by = Column(Integer, ForeignKey("users.user_id"))
    resolution_notes = Column(Text)
    extra_fields = Column(JSONB, nullable=False, default=dict)
    is_deleted = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())


# ============================================================================
# BACKWARD-COMPAT ALIASES (prevent ImportError until dpr.py router rewrite)
# DO NOT write new code against these — column names differ from t5.
# ============================================================================
DPREntry = FieldObservation
DPREntryV2 = FieldObservation
DPRPhoto = FieldObservation   # photos are now an array on the observation
