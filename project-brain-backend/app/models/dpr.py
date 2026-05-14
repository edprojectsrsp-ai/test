from sqlalchemy import Column, Date, ForeignKey, Integer, String, Text

from app.core.database import Base


class DPREntry(Base):
    __tablename__ = "dpr_entries"

    id = Column(Integer, primary_key=True, index=True)
    scheme_id = Column(Integer, ForeignKey("schemes.id"), nullable=False)
    report_date = Column(Date, nullable=False)
    weather = Column(String, default="Clear")
    manpower = Column(Integer, default=0)
    work_done = Column(Text, nullable=True)
    issues = Column(Text, nullable=True)


class CorporateManpowerDaily(Base):
    __tablename__ = "corporate_manpower_daily"

    id = Column(Integer, primary_key=True, index=True)
    scheme_id = Column(Integer, ForeignKey("schemes.id"))
    record_date = Column(Date)
    rsp_executives = Column(Integer, default=0)
    rsp_non_executives = Column(Integer, default=0)
    agency_executives = Column(Integer, default=0)
    agency_non_executives = Column(Integer, default=0)
    subcontractor_supervisors = Column(Integer, default=0)
    subcontractor_labour = Column(Integer, default=0)
