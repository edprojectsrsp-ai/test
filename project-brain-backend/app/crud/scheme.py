from sqlalchemy.orm import Session
from app.models.scheme import SchemeMaster
from app.schemas.schemes import SchemeStep1Create
import difflib


def create_scheme(db: Session, scheme: dict):
    db_scheme = SchemeMaster(**scheme)
    db.add(db_scheme)
    db.commit()
    db.refresh(db_scheme)
    return db_scheme


def get_all_schemes(db: Session):
    """Fetch all schemes, ordered by newest first."""
    return db.query(SchemeMaster).order_by(SchemeMaster.id.desc()).all()


def get_scheme_by_name(db: Session, name: str):
    return db.query(SchemeMaster).filter(SchemeMaster.scheme_name == name).first()


def get_similar_schemes(db: Session, name: str):
    return (
        db.query(SchemeMaster)
        .filter(SchemeMaster.scheme_name.ilike(f"%{name}%"))
        .limit(10)
        .all()
    )


def get_fuzzy_scheme_matches(db: Session, target_name: str, threshold: float = 0.6):
    """Find exact and fuzzy scheme-name matches for duplicate prevention."""
    all_schemes = db.query(SchemeMaster.id, SchemeMaster.scheme_name).all()
    target_lower = target_name.strip().lower()
    similar = []

    for scheme_id, scheme_name in all_schemes:
        scheme_lower = scheme_name.lower()
        if scheme_lower == target_lower:
            return [{"id": scheme_id, "name": scheme_name, "exact": True}]

        ratio = difflib.SequenceMatcher(None, target_lower, scheme_lower).ratio()
        if ratio >= threshold:
            similar.append(
                {
                    "id": scheme_id,
                    "name": scheme_name,
                    "exact": False,
                    "confidence": round(ratio * 100),
                }
            )

    return sorted(similar, key=lambda item: item.get("confidence", 100), reverse=True)


def create_basic_scheme(db: Session, scheme_in: SchemeStep1Create):
    """Step 1: Save core registration details."""
    db_scheme = SchemeMaster(
        scheme_name=scheme_in.scheme_name.strip(),
        scheme_type=scheme_in.scheme_type.value,
        current_status=scheme_in.current_status.value,
        multi_package_type="none",
        total_cost=0.0,
    )
    db.add(db_scheme)
    db.commit()
    db.refresh(db_scheme)
    return db_scheme


def update_scheme_dates(db: Session, scheme_id: int, date_data: dict):
    """Step 2: Update timeline dates and remarks."""
    db_scheme = db.query(SchemeMaster).filter(SchemeMaster.id == scheme_id).first()
    if not db_scheme:
        return None

    for key, value in date_data.items():
        setattr(db_scheme, key, value)

    db.commit()
    db.refresh(db_scheme)
    return db_scheme


def update_scheme_parent(db: Session, scheme_id: int, parent_id: int):
    """Step 3: Link a scheme to a parent/master scheme."""
    db_scheme = db.query(SchemeMaster).filter(SchemeMaster.id == scheme_id).first()
    if not db_scheme:
        return None

    db_scheme.parent_scheme_id = parent_id
    db_scheme.multi_package_type = "sub"
    db.commit()
    db.refresh(db_scheme)
    return db_scheme


def get_all_potential_parents(db: Session, current_scheme_id: int):
    """Get schemes that can act as parents, excluding the current scheme."""
    return db.query(SchemeMaster).filter(SchemeMaster.id != current_scheme_id).all()
