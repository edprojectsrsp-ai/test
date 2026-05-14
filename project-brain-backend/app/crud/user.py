from app.core.security import get_password_hash
from app.schemas.user import UserCreate


def build_user_record(user: UserCreate) -> dict[str, object]:
    return {
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "hashed_password": get_password_hash(user.password),
    }
