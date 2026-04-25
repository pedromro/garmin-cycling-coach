from __future__ import annotations

import json
import os
import sqlite3
from typing import Any
from .models import DailyMetrics

SCHEMA = """
CREATE TABLE IF NOT EXISTS daily_metrics (
    day TEXT PRIMARY KEY,
    sleep_hours REAL,
    sleep_score REAL,
    resting_hr REAL,
    hrv_status TEXT,
    hrv_value REAL,
    stress_avg REAL,
    body_battery_min REAL,
    body_battery_max REAL,
    active_kcal REAL,
    cycling_minutes REAL,
    cycling_distance_km REAL,
    cycling_avg_hr REAL,
    cycling_avg_power REAL,
    cycling_np REAL,
    cycling_training_effect REAL,
    raw_json TEXT
);
"""

class CoachDB:
    def __init__(self, path: str):
        self.path = path
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute(SCHEMA)
        self.conn.commit()

    def upsert_daily(self, m: DailyMetrics) -> None:
        self.conn.execute(
            """
            INSERT INTO daily_metrics VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(day) DO UPDATE SET
                sleep_hours=excluded.sleep_hours,
                sleep_score=excluded.sleep_score,
                resting_hr=excluded.resting_hr,
                hrv_status=excluded.hrv_status,
                hrv_value=excluded.hrv_value,
                stress_avg=excluded.stress_avg,
                body_battery_min=excluded.body_battery_min,
                body_battery_max=excluded.body_battery_max,
                active_kcal=excluded.active_kcal,
                cycling_minutes=excluded.cycling_minutes,
                cycling_distance_km=excluded.cycling_distance_km,
                cycling_avg_hr=excluded.cycling_avg_hr,
                cycling_avg_power=excluded.cycling_avg_power,
                cycling_np=excluded.cycling_np,
                cycling_training_effect=excluded.cycling_training_effect,
                raw_json=excluded.raw_json
            """,
            (
                m.day, m.sleep_hours, m.sleep_score, m.resting_hr, m.hrv_status, m.hrv_value,
                m.stress_avg, m.body_battery_min, m.body_battery_max, m.active_kcal,
                m.cycling_minutes, m.cycling_distance_km, m.cycling_avg_hr,
                m.cycling_avg_power, m.cycling_np, m.cycling_training_effect,
                json.dumps(m.raw or {}, ensure_ascii=False),
            ),
        )
        self.conn.commit()

    def last_days(self, limit: int, include_raw: bool = False) -> list[DailyMetrics]:
        rows = self.conn.execute(
            "SELECT * FROM daily_metrics ORDER BY day DESC LIMIT ?", (limit,)
        ).fetchall()
        out: list[DailyMetrics] = []
        for r in reversed(rows):
            out.append(DailyMetrics(
                day=r["day"], sleep_hours=r["sleep_hours"], sleep_score=r["sleep_score"],
                resting_hr=r["resting_hr"], hrv_status=r["hrv_status"], hrv_value=r["hrv_value"],
                stress_avg=r["stress_avg"], body_battery_min=r["body_battery_min"],
                body_battery_max=r["body_battery_max"], active_kcal=r["active_kcal"],
                cycling_minutes=r["cycling_minutes"] or 0, cycling_distance_km=r["cycling_distance_km"] or 0,
                cycling_avg_hr=r["cycling_avg_hr"], cycling_avg_power=r["cycling_avg_power"],
                cycling_np=r["cycling_np"], cycling_training_effect=r["cycling_training_effect"],
                raw=json.loads(r["raw_json"] or "{}") if include_raw else None,
            ))
        return out

    def activity_power_records(self, limit: int) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT day, raw_json FROM daily_metrics ORDER BY day DESC LIMIT ?", (limit,)
        ).fetchall()
        records: list[dict[str, Any]] = []
        for row in reversed(rows):
            raw = json.loads(row["raw_json"] or "{}")
            activities = raw.get("activities")
            if not isinstance(activities, list):
                continue
            for activity in activities:
                if not isinstance(activity, dict):
                    continue
                if activity.get("excludeFromPowerCurveReports"):
                    continue
                powers: dict[int, float] = {}
                for seconds in (1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 18000):
                    value = activity.get(f"maxAvgPower_{seconds}")
                    if isinstance(value, (int, float)):
                        powers[seconds] = float(value)
                if not powers:
                    continue
                records.append(
                    {
                        "day": row["day"],
                        "activity_id": activity.get("activityId"),
                        "activity_name": activity.get("activityName"),
                        "duration": activity.get("duration"),
                        "powers": powers,
                    }
                )
        return records

    def activity_vo2max_records(self, limit: int) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT day, raw_json FROM daily_metrics ORDER BY day DESC LIMIT ?", (limit,)
        ).fetchall()
        records: list[dict[str, Any]] = []
        for row in reversed(rows):
            raw = json.loads(row["raw_json"] or "{}")
            activities = raw.get("activities")
            if not isinstance(activities, list):
                continue
            values = []
            names = []
            for activity in activities:
                if not isinstance(activity, dict):
                    continue
                value = activity.get("vO2MaxValue")
                if isinstance(value, (int, float)):
                    values.append(float(value))
                    if activity.get("activityName"):
                        names.append(str(activity.get("activityName")))
            if values:
                records.append(
                    {
                        "day": row["day"],
                        "vo2max": round(sum(values) / len(values), 1),
                        "activity_count": len(values),
                        "activity_name": names[0] if names else None,
                    }
                )
        return records

    def activity_training_load_records(self, limit: int) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT day, raw_json FROM daily_metrics ORDER BY day DESC LIMIT ?", (limit,)
        ).fetchall()
        records: list[dict[str, Any]] = []
        for row in reversed(rows):
            raw = json.loads(row["raw_json"] or "{}")
            activities = raw.get("activities")
            if not isinstance(activities, list):
                continue
            tss_total = 0.0
            if_weighted_sum = 0.0
            if_weight = 0.0
            activity_count = 0
            for activity in activities:
                if not isinstance(activity, dict):
                    continue
                tss = activity.get("trainingStressScore")
                intensity_factor = activity.get("intensityFactor")
                duration = activity.get("duration")
                weight = float(duration) if isinstance(duration, (int, float)) and duration > 0 else 1.0
                if isinstance(tss, (int, float)):
                    tss_total += float(tss)
                    activity_count += 1
                if isinstance(intensity_factor, (int, float)):
                    if_weighted_sum += float(intensity_factor) * weight
                    if_weight += weight
                    activity_count += 1 if not isinstance(tss, (int, float)) else 0
            if tss_total > 0 or if_weight > 0:
                records.append(
                    {
                        "day": row["day"],
                        "tss": round(tss_total, 1) if tss_total > 0 else None,
                        "intensity_factor": round(if_weighted_sum / if_weight, 3) if if_weight else None,
                        "activity_count": activity_count,
                    }
                )
        return records
