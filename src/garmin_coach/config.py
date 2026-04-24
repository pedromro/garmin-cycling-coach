from __future__ import annotations

import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name, str(default)).strip()
    try:
        return int(value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer, got {value!r}") from exc


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name, str(default)).strip()
    try:
        return float(value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a number, got {value!r}") from exc


@dataclass(frozen=True)
class Settings:
    garmin_email: str
    garmin_password: str
    openai_api_key: str | None
    openai_model: str
    ftp_watts: int
    body_weight_kg: float
    target_event: str
    db_path: str
    report_dir: str

    @staticmethod
    def from_env() -> "Settings":
        email = os.getenv("GARMIN_EMAIL", "").strip()
        password = os.getenv("GARMIN_PASSWORD", "").strip()
        return Settings(
            garmin_email=email,
            garmin_password=password,
            openai_api_key=os.getenv("OPENAI_API_KEY") or None,
            openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            ftp_watts=_env_int("FTP_WATTS", 293),
            body_weight_kg=_env_float("BODY_WEIGHT_KG", 80),
            target_event=os.getenv("TARGET_EVENT", "Endurance / ultra cycling"),
            db_path=os.getenv("DB_PATH", "data/garmin_coach.sqlite3"),
            report_dir=os.getenv("REPORT_DIR", "reports"),
        )

    def validate_garmin(self) -> None:
        if not self.garmin_email or not self.garmin_password:
            raise RuntimeError("Set GARMIN_EMAIL and GARMIN_PASSWORD in .env")
