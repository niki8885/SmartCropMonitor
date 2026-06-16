from fastapi import HTTPException, Depends, APIRouter
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from passlib.context import CryptContext
from app.core.security import create_access_token, get_current_user
import hashlib
import bcrypt

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

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def _verify_password(plain: str, hashed: str) -> bool:
    if not hashed.startswith("$2"):
        return hashlib.sha256(plain.encode()).hexdigest() == hashed
    return bcrypt.checkpw(plain.encode(), hashed.encode())


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
    if not db_user or not _verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid username or password")

    if not (db_user.hashed_password.startswith("$2b$") or db_user.hashed_password.startswith("$2a$")):
        db_user.hashed_password = _hash_password(user.password)
        db.commit()

    token = create_access_token({"sub": str(db_user.id)})
    return {"access_token": token, "token_type": "bearer", **_user_profile(db_user)}


@router.get("/me", summary="Получить профиль")
async def get_me(current_user: UserDB = Depends(get_current_user)):
    return _user_profile(current_user)


@router.patch("/me", summary="Обновить профиль")
async def update_profile(
    body: UserUpdateProfile,
    current_user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = current_user

    if body.email and body.email != user.email:
        existing = db.query(UserDB).filter(UserDB.email == body.email).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return {"status": "updated", **_user_profile(user)}
