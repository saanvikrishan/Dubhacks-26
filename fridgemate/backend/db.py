"""Tiger Data / PostgreSQL persistence for pantry and saved meals."""

from __future__ import annotations

import os
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import (
    Date,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    select,
    delete,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

DATABASE_URL = (
    os.getenv("DATABASE_URL") or os.getenv("TIGER_DATABASE_URL") or ""
).strip()

engine = None
SessionLocal = None


class Base(DeclarativeBase):
    pass


class PantryItem(Base):
    __tablename__ = "pantry_items"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_pantry_user_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(80), default="demo", index=True)
    name: Mapped[str] = mapped_column(String(120))
    grams: Mapped[float] = mapped_column(Float, default=0)
    expires_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


class SavedMeal(Base):
    __tablename__ = "saved_meals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(80), default="demo", index=True)
    meal_id: Mapped[str] = mapped_column(String(160), index=True)
    name: Mapped[str] = mapped_column(String(200))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )


def database_configured() -> bool:
    return bool(DATABASE_URL)


def init_db() -> bool:
    """Create engine + tables when DATABASE_URL is set. Returns True if ready."""
    global engine, SessionLocal, DATABASE_URL
    DATABASE_URL = (
        os.getenv("DATABASE_URL") or os.getenv("TIGER_DATABASE_URL") or ""
    ).strip()
    if not DATABASE_URL:
        engine = None
        SessionLocal = None
        return False
    url = DATABASE_URL
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://") and "+psycopg" not in url:
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    # Tiger Data / managed Postgres usually needs SSL
    connect_args = {}
    if "sslmode=" not in url:
        connect_args["sslmode"] = "require"
    try:
        engine = create_engine(
            url,
            pool_pre_ping=True,
            connect_args=connect_args,
        )
        SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        Base.metadata.create_all(bind=engine)
        return True
    except Exception:
        engine = None
        SessionLocal = None
        raise


def get_session():
    if SessionLocal is None:
        return None
    return SessionLocal()


def list_pantry(user_id: str = "demo") -> list[dict]:
    session = get_session()
    if session is None:
        return []
    try:
        rows = session.scalars(
            select(PantryItem).where(PantryItem.user_id == user_id).order_by(PantryItem.name)
        ).all()
        return [
            {
                "id": r.id,
                "name": r.name,
                "grams": r.grams,
                "expires_on": r.expires_on.isoformat() if r.expires_on else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ]
    finally:
        session.close()


def replace_pantry(items: list[dict], user_id: str = "demo") -> list[dict]:
    session = get_session()
    if session is None:
        raise RuntimeError("Database is not configured")
    try:
        session.execute(delete(PantryItem).where(PantryItem.user_id == user_id))
        now = datetime.now(timezone.utc)
        for raw in items:
            name = str(raw.get("name") or "").strip()[:120]
            if not name:
                continue
            grams = float(raw.get("grams") or 0)
            expires = raw.get("expires_on")
            expires_on = None
            if expires:
                expires_on = date.fromisoformat(str(expires)[:10])
            session.add(
                PantryItem(
                    user_id=user_id,
                    name=name,
                    grams=max(0, grams),
                    expires_on=expires_on,
                    updated_at=now,
                )
            )
        session.commit()
        return list_pantry(user_id)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def list_saved_meals(user_id: str = "demo") -> list[dict]:
    session = get_session()
    if session is None:
        return []
    try:
        rows = session.scalars(
            select(SavedMeal)
            .where(SavedMeal.user_id == user_id)
            .order_by(SavedMeal.created_at.desc())
        ).all()
        return [
            {
                "id": r.id,
                "meal_id": r.meal_id,
                "name": r.name,
                "payload": r.payload,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    finally:
        session.close()


def save_meal(meal: dict, user_id: str = "demo") -> dict:
    session = get_session()
    if session is None:
        raise RuntimeError("Database is not configured")
    try:
        meal_id = str(meal.get("id") or meal.get("meal_id") or "")[:160]
        name = str(meal.get("name") or "Saved meal")[:200]
        if not meal_id:
            raise ValueError("meal id is required")
        row = SavedMeal(
            user_id=user_id,
            meal_id=meal_id,
            name=name,
            payload=meal,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return {
            "id": row.id,
            "meal_id": row.meal_id,
            "name": row.name,
            "payload": row.payload,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def delete_saved_meal(row_id: int, user_id: str = "demo") -> bool:
    session = get_session()
    if session is None:
        raise RuntimeError("Database is not configured")
    try:
        row = session.get(SavedMeal, row_id)
        if not row or row.user_id != user_id:
            return False
        session.delete(row)
        session.commit()
        return True
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
