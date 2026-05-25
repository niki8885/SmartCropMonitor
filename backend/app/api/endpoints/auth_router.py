from fastapi import HTTPException, Depends, APIRouter
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import hashlib

from app.core.database import UserDB, get_db

router = APIRouter()


# =========================
# Schemas
# =========================

class UserRegister(BaseModel):
    username:     str
    password:     str
    email:        Optional[str]   = None
    first_name:   Optional[str]   = None
    last_name:    Optional[str]   = None
    phone:        Optional[str]   = None
    country:      Optional[str]   = None
    city:         Optional[str]   = None
    farm_name:    Optional[str]   = None
    farm_size_ha: Optional[float] = None


class UserLogin(BaseModel):
    username: str
    password: str


class UserUpdateProfile(BaseModel):
    email:        Optional[str]   = None
    email_enabled: Optional[bool] = None
    first_name:   Optional[str]   = None
    last_name:    Optional[str]   = None
    phone:        Optional[str]   = None
    country:      Optional[str]   = None
    city:         Optional[str]   = None
    farm_name:    Optional[str]   = None
    farm_size_ha: Optional[float] = None


# =========================
# Helpers
# =========================

def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def _user_profile(user: UserDB) -> dict:
    return {
        "user_id":     user.id,
        "username":    user.username,
        "email":       user.email,
        "email_enabled": bool(user.email_enabled),
        "first_name":  user.first_name,
        "last_name":   user.last_name,
        "phone":       user.phone,
        "country":     user.country,
        "city":        user.city,
        "farm_name":   user.farm_name,
        "farm_size_ha": float(user.farm_size_ha) if user.farm_size_ha else None,
    }


# =========================
# Endpoints
# =========================

@router.post("/register", summary="Регистрация")
async def register(user: UserRegister, db: Session = Depends(get_db)):
    if db.query(UserDB).filter(UserDB.username == user.username).first():
        raise HTTPException(status_code=400, detail="Username already registered")
    if user.email and db.query(UserDB).filter(UserDB.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    new_user = UserDB(
        username        = user.username,
        hashed_password = _hash_password(user.password),
        email           = user.email,
        first_name      = user.first_name,
        last_name       = user.last_name,
        phone           = user.phone,
        country         = user.country,
        city            = user.city,
        farm_name       = user.farm_name,
        farm_size_ha    = user.farm_size_ha,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"status": "user created", **_user_profile(new_user)}


@router.post("/login", summary="Вход")
async def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(UserDB).filter(UserDB.username == user.username).first()
    if not db_user or db_user.hashed_password != _hash_password(user.password):
        raise HTTPException(status_code=400, detail="Invalid username or password")
    return {"status": "login success", **_user_profile(db_user)}


@router.get("/user/{user_id}", summary="Получить профиль")
async def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.get(UserDB, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _user_profile(user)


@router.patch("/user/{user_id}", summary="Обновить профиль")
async def update_profile(user_id: int, body: UserUpdateProfile, db: Session = Depends(get_db)):
    user = db.get(UserDB, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.email and body.email != user.email:
        existing = db.query(UserDB).filter(UserDB.email == body.email).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return {"status": "updated", **_user_profile(user)}
