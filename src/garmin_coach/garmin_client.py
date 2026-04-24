from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from garminconnect import Garmin

from .config import Settings
from .models import DailyMetrics


def _dig(obj: Any, *keys: str) -> Any:
    cur = obj
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def _first_number(*values: Any) -> float | None:
    for v in values:
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            try:
                return float(v)
            except ValueError:
                pass
    return None


class GarminSync:
    def __init__(self, settings: Settings):
        settings.validate_garmin()
        self.client = Garmin(settings.garmin_email, settings.garmin_password)

    def login(self) -> None:
        self.client.login()

    def fetch_day(self, day: date) -> DailyMetrics:
        ds = day.isoformat()
        raw: dict[str, Any] = {}

        def safe(name: str, fn):
            try:
                value = fn()
                raw[name] = value
                return value
            except Exception as exc:  # Garmin endpoints vary by account/device
                raw[name + "_error"] = str(exc)
                return None

        sleep = safe("sleep", lambda: self.client.get_sleep_data(ds))
        stats = safe("stats", lambda: self.client.get_stats(ds))
        hrv = safe("hrv", lambda: getattr(self.client, "get_hrv_data")(ds)) if hasattr(self.client, "get_hrv_data") else None
        stress = safe("stress", lambda: self.client.get_stress_data(ds)) if hasattr(self.client, "get_stress_data") else None
        activities = safe("activities", lambda: self.client.get_activities_by_date(ds, ds, "cycling")) or []

        metric = DailyMetrics(day=ds, raw=raw)

        daily_sleep = _dig(sleep, "dailySleepDTO") or {}
        metric.sleep_hours = _first_number(
            daily_sleep.get("sleepTimeSeconds", None) / 3600 if isinstance(daily_sleep.get("sleepTimeSeconds"), (int, float)) else None,
            daily_sleep.get("sleepTimeMinutes", None) / 60 if isinstance(daily_sleep.get("sleepTimeMinutes"), (int, float)) else None,
        )
        metric.sleep_score = _first_number(
            _dig(sleep, "sleepScores", "overall", "value"),
            daily_sleep.get("sleepScore"),
            daily_sleep.get("overallSleepScore"),
        )
        metric.resting_hr = _first_number(
            daily_sleep.get("restingHeartRate"),
            _dig(stats, "restingHeartRate"),
            _dig(stats, "wellnessEpochRespirationDataDTOList", "restingHeartRate"),
        )
        metric.hrv_status = _dig(hrv, "hrvSummary", "status") or _dig(hrv, "hrvStatus")
        metric.hrv_value = _first_number(
            _dig(hrv, "hrvSummary", "lastNightAvg"),
            _dig(hrv, "hrvSummary", "weeklyAvg"),
            _dig(hrv, "lastNightAvg"),
        )
        metric.stress_avg = _first_number(
            _dig(stress, "avgStressLevel"),
            _dig(stats, "averageStressLevel"),
        )
        metric.body_battery_min = _first_number(_dig(stats, "bodyBatteryLowestValue"), _dig(stats, "bodyBatteryMin"))
        metric.body_battery_max = _first_number(_dig(stats, "bodyBatteryHighestValue"), _dig(stats, "bodyBatteryMax"))
        metric.active_kcal = _first_number(_dig(stats, "activeKilocalories"), _dig(stats, "activeCalories"))

        total_minutes = 0.0
        total_km = 0.0
        hrs = []
        powers = []
        nps = []
        effects = []
        for a in activities if isinstance(activities, list) else []:
            total_minutes += _first_number(a.get("duration"), a.get("elapsedDuration"), 0) or 0
            total_km += (_first_number(a.get("distance"), 0) or 0) / 1000.0
            hr = _first_number(a.get("averageHR"), a.get("averageHr"), a.get("averageHeartRate"))
            p = _first_number(a.get("avgPower"), a.get("averagePower"))
            np = _first_number(a.get("normPower"), a.get("normalizedPower"))
            te = _first_number(a.get("aerobicTrainingEffect"), a.get("trainingEffect"))
            if hr: hrs.append(hr)
            if p: powers.append(p)
            if np: nps.append(np)
            if te: effects.append(te)

        # Garmin durations are usually seconds.
        metric.cycling_minutes = total_minutes / 60 if total_minutes > 500 else total_minutes
        metric.cycling_distance_km = total_km
        metric.cycling_avg_hr = sum(hrs) / len(hrs) if hrs else None
        metric.cycling_avg_power = sum(powers) / len(powers) if powers else None
        metric.cycling_np = sum(nps) / len(nps) if nps else None
        metric.cycling_training_effect = max(effects) if effects else None
        return metric

    def fetch_range(self, days: int) -> list[DailyMetrics]:
        today = date.today()
        start = today - timedelta(days=days - 1)
        return [self.fetch_day(start + timedelta(days=i)) for i in range(days)]
