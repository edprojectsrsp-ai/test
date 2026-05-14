from sqlalchemy.orm import Session
from app.core.database import SessionLocal, engine
from app.models.scheme import (
    Base, SchemeMaster, Stage1Details, TenderDetails, 
    Stage2Details, OrderDetails, ClosureDetails
)

Base.metadata.create_all(bind=engine)

def seed_complete_rsp_data():
    db: Session = SessionLocal()
    projects_data = [
        {"sn": 1, "type": "plant", "name": "Upgradation and Modification of Otis Make Lifts", "cost": 7.12, "agency": "M/s OTIS ELEVATOR", "contract": "23049072", "effective": "23-Mar-23", "schedule": "22-Oct-24", "status": "ongoing"},
        # ... [Add remaining 75 rows here] ...
    ]

    try:
        db.query(SchemeMaster).delete()
        db.commit()

        for p in projects_data:
            master = SchemeMaster(
                scheme_name=p["name"],
                scheme_type=p["type"].lower(),
                current_status=p["status"].lower(),
                estimated_cost_cr=p["cost"] or 0.0,
                is_active=True,
                pending_details=True,
                multi_package_type="none"
            )
            db.add(master)
            db.flush()

            db.add(Stage1Details(scheme_id=master.scheme_id))
            db.add(TenderDetails(scheme_id=master.scheme_id))
            db.add(Stage2Details(scheme_id=master.scheme_id))
            db.add(OrderDetails(
                scheme_id=master.scheme_id,
                party_name=p["agency"],
                po_number=p["contract"],
                effective_date=p["effective"],
                schedule_completion_date=p["schedule"]
            ))
            db.add(ClosureDetails(scheme_id=master.scheme_id))

        db.commit()
        print(f"✅ SUCCESS: {len(projects_data)} projects seeded.")
    except Exception as e:
        db.rollback()
        print(f"❌ ERROR: {str(e)}")
    finally:
        db.close()

if __name__ == "__main__":
    seed_complete_rsp_data()