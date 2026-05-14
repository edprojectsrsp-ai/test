from sqlalchemy import Column, Date, Float, ForeignKey, Integer, String

from app.core.database import Base


class TaskEntry(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    scheme_id = Column(Integer, ForeignKey("schemes.id"), nullable=False)
    task_name = Column(String, nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    progress_pct = Column(Float, default=0.0)
    depends_on = Column(Integer, ForeignKey("tasks.id"), nullable=True)

