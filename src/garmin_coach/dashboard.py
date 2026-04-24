from __future__ import annotations

from dataclasses import asdict
from typing import Any

from .models import DailyMetrics
from .recommender import hard_days_recent, power_zones, recommend, weekly_minutes


FITNESS_DAYS = 42
FATIGUE_DAYS = 7


def _avg(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _classify_intensity(day: DailyMetrics, ftp: int) -> str:
    power = day.cycling_np or day.cycling_avg_power
    if not power or day.cycling_minutes <= 0:
        return "none"
    ratio = power / ftp
    if ratio < 0.76:
        return "easy"
    if ratio < 0.91:
        return "tempo"
    return "hard"


def _estimated_stress(day: DailyMetrics, ftp: int) -> float:
    power = day.cycling_np or day.cycling_avg_power
    if power and day.cycling_minutes > 0:
        intensity_factor = power / ftp
        return (day.cycling_minutes / 60) * intensity_factor * intensity_factor * 100
    if day.cycling_training_effect is not None:
        return day.cycling_minutes * max(0.3, day.cycling_training_effect / 3)
    return day.cycling_minutes * 0.55


def _impulse_response(days: list[DailyMetrics], ftp: int) -> list[dict[str, float | str]]:
    fitness = 0.0
    fatigue = 0.0
    trend = []
    for day in days:
        stress = _estimated_stress(day, ftp)
        fitness += (stress - fitness) / FITNESS_DAYS
        fatigue += (stress - fatigue) / FATIGUE_DAYS
        trend.append(
            {
                "day": day.day,
                "stress": round(stress, 1),
                "fitness": round(fitness, 1),
                "fatigue": round(fatigue, 1),
                "form": round(fitness - fatigue, 1),
            }
        )
    return trend


def _zone_minutes(days: list[DailyMetrics], ftp: int) -> dict[str, float]:
    zones = {"Z1": 0.0, "Z2": 0.0, "Z3": 0.0, "Z4": 0.0, "Z5": 0.0, "No power": 0.0}
    for day in days:
        power = day.cycling_np or day.cycling_avg_power
        if not power or day.cycling_minutes <= 0:
            if day.cycling_minutes > 0:
                zones["No power"] += day.cycling_minutes
            continue
        ratio = power / ftp
        if ratio < 0.56:
            zones["Z1"] += day.cycling_minutes
        elif ratio < 0.76:
            zones["Z2"] += day.cycling_minutes
        elif ratio < 0.91:
            zones["Z3"] += day.cycling_minutes
        elif ratio < 1.06:
            zones["Z4"] += day.cycling_minutes
        else:
            zones["Z5"] += day.cycling_minutes
    return zones


def _trend_delta(today: float | None, baseline: float | None) -> float | None:
    if today is None or baseline is None:
        return None
    return today - baseline


def _daily_payload(days: list[DailyMetrics], ftp: int) -> list[dict[str, Any]]:
    payload = []
    for day in days:
        item = day.to_dict()
        item.pop("raw", None)
        item["intensity_bucket"] = _classify_intensity(day, ftp)
        item["estimated_stress"] = round(_estimated_stress(day, ftp), 1)
        payload.append(item)
    return payload


def masters_metrics(days: list[DailyMetrics], ftp: int) -> dict[str, Any]:
    if not days:
        return {}

    last_7 = days[-7:]
    prev_7 = days[-14:-7]
    trend = _impulse_response(days, ftp)
    latest_trend = trend[-1] if trend else {}
    last_3 = days[-3:]
    today = days[-1]

    bucket_minutes = {"easy": 0.0, "tempo": 0.0, "hard": 0.0}
    for day in last_7:
        bucket = _classify_intensity(day, ftp)
        if bucket in bucket_minutes:
            bucket_minutes[bucket] += day.cycling_minutes

    total_intensity_minutes = sum(bucket_minutes.values())
    previous_volume = sum(day.cycling_minutes for day in prev_7)
    current_volume = weekly_minutes(days)

    hrv_baseline_days = [day.hrv_value for day in days[-8:-1] if day.hrv_value is not None]
    sleep_days = [day.sleep_hours for day in last_7 if day.sleep_hours is not None]
    resting_hr_baseline_days = [day.resting_hr for day in days[-8:-1] if day.resting_hr is not None]

    recovery_flags = []
    if today.sleep_hours is not None and today.sleep_hours < 6:
        recovery_flags.append("short_sleep")
    if today.hrv_status and any(token in today.hrv_status.lower() for token in ("low", "poor", "unbalanced")):
        recovery_flags.append("hrv_status")
    if today.body_battery_max is not None and today.body_battery_max < 60:
        recovery_flags.append("low_body_battery")
    if hard_days_recent(days) >= 2:
        recovery_flags.append("stacked_hard_days")
    if previous_volume and current_volume / previous_volume > 1.25:
        recovery_flags.append("load_spike")

    if len(recovery_flags) >= 3:
        recovery_risk = "High"
    elif recovery_flags:
        recovery_risk = "Moderate"
    else:
        recovery_risk = "Low"

    return {
        "weekly_minutes": current_volume,
        "weekly_distance_km": sum(day.cycling_distance_km for day in last_7),
        "previous_week_minutes": previous_volume,
        "load_spike_ratio": (current_volume / previous_volume) if previous_volume else None,
        "hard_days_3": hard_days_recent(days),
        "hard_days_7": sum(1 for day in last_7 if _classify_intensity(day, ftp) == "hard" or (day.cycling_training_effect or 0) >= 3.5),
        "intensity_minutes": bucket_minutes,
        "intensity_pct": {
            key: (value / total_intensity_minutes * 100) if total_intensity_minutes else 0
            for key, value in bucket_minutes.items()
        },
        "sleep_avg_7": _avg(sleep_days),
        "hrv_baseline_7": _avg(hrv_baseline_days),
        "hrv_delta": _trend_delta(today.hrv_value, _avg(hrv_baseline_days)),
        "resting_hr_delta": _trend_delta(today.resting_hr, _avg(resting_hr_baseline_days)),
        "recovery_risk": recovery_risk,
        "recovery_flags": recovery_flags,
        "fitness": latest_trend.get("fitness"),
        "fatigue": latest_trend.get("fatigue"),
        "form": latest_trend.get("form"),
        "stress_7": sum(_estimated_stress(day, ftp) for day in last_7),
        "stress_28": sum(_estimated_stress(day, ftp) for day in days[-28:]),
        "fitness_trend": trend,
        "zone_minutes": _zone_minutes(last_7, ftp),
        "progression": [
            {
                "day": day.day,
                "distance_km": round(sum(item.cycling_distance_km for item in days[: index + 1]), 1),
                "minutes": round(sum(item.cycling_minutes for item in days[: index + 1]), 0),
                "stress": round(sum(_estimated_stress(item, ftp) for item in days[: index + 1]), 1),
            }
            for index, day in enumerate(days)
        ],
        "strength_sessions_7": None,
        "vo2max_estimate": None,
    }


def dashboard_payload(days: list[DailyMetrics], ftp: int) -> dict[str, Any]:
    if not days:
        return {
            "ftp": ftp,
            "metrics": [],
            "recommendation": None,
            "zones": power_zones(ftp),
            "masters": {},
        }

    rec = recommend(days, ftp)
    return {
        "ftp": ftp,
        "metrics": _daily_payload(days, ftp),
        "recommendation": asdict(rec),
        "zones": power_zones(ftp),
        "masters": masters_metrics(days, ftp),
    }
