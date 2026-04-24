from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

@dataclass
class DailyMetrics:
    day: str
    sleep_hours: float | None = None
    sleep_score: float | None = None
    resting_hr: float | None = None
    hrv_status: str | None = None
    hrv_value: float | None = None
    stress_avg: float | None = None
    body_battery_min: float | None = None
    body_battery_max: float | None = None
    active_kcal: float | None = None
    cycling_minutes: float = 0
    cycling_distance_km: float = 0
    cycling_avg_hr: float | None = None
    cycling_avg_power: float | None = None
    cycling_np: float | None = None
    cycling_training_effect: float | None = None
    raw: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

@dataclass
class Recommendation:
    day: str
    readiness_score: int
    readiness_label: str
    workout: str
    duration: str
    power_target: str
    reasons: list[str]
    tomorrow: str
