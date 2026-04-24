from __future__ import annotations

from .models import DailyMetrics, Recommendation


def power_zones(ftp: int) -> dict[str, str]:
    return {
        "Z1 Recovery": f"< {int(0.55 * ftp)} W",
        "Z2 Endurance": f"{int(0.56 * ftp)}-{int(0.75 * ftp)} W",
        "Z3 Tempo": f"{int(0.76 * ftp)}-{int(0.90 * ftp)} W",
        "Z4 Threshold": f"{int(0.91 * ftp)}-{int(1.05 * ftp)} W",
        "Z5 VO2": f"{int(1.06 * ftp)}-{int(1.20 * ftp)} W",
    }


def weekly_minutes(days: list[DailyMetrics]) -> float:
    return sum(d.cycling_minutes for d in days[-7:])


def hard_days_recent(days: list[DailyMetrics]) -> int:
    recent = days[-3:]
    count = 0
    for d in recent:
        if (d.cycling_training_effect or 0) >= 3.5:
            count += 1
        elif (d.cycling_np or d.cycling_avg_power or 0) > 0 and d.cycling_minutes >= 45:
            # simple fallback when Training Effect is unavailable
            count += 1 if d.cycling_minutes >= 120 else 0
    return count


def recommend(days: list[DailyMetrics], ftp: int) -> Recommendation:
    if not days:
        raise ValueError("No metrics available")
    today = days[-1]
    score = 75
    reasons: list[str] = []

    if today.sleep_hours is not None:
        if today.sleep_hours < 6:
            score -= 25
            reasons.append(f"Sleep was short: {today.sleep_hours:.1f} h")
        elif today.sleep_hours < 7:
            score -= 10
            reasons.append(f"Sleep was moderate: {today.sleep_hours:.1f} h")
        else:
            score += 5
            reasons.append(f"Sleep duration is acceptable: {today.sleep_hours:.1f} h")

    if today.sleep_score is not None:
        if today.sleep_score < 60:
            score -= 20
            reasons.append(f"Sleep score is low: {today.sleep_score:.0f}")
        elif today.sleep_score >= 80:
            score += 10
            reasons.append(f"Sleep score is strong: {today.sleep_score:.0f}")

    if today.hrv_status:
        status = today.hrv_status.lower()
        if "low" in status or "unbalanced" in status or "poor" in status:
            score -= 20
            reasons.append(f"HRV status is not ideal: {today.hrv_status}")
        elif "balanced" in status or "optimal" in status:
            score += 10
            reasons.append(f"HRV status is good: {today.hrv_status}")

    if today.body_battery_max is not None:
        if today.body_battery_max < 50:
            score -= 15
            reasons.append(f"Body Battery peak is low: {today.body_battery_max:.0f}")
        elif today.body_battery_max >= 75:
            score += 5
            reasons.append(f"Body Battery peak is good: {today.body_battery_max:.0f}")

    if today.stress_avg is not None and today.stress_avg > 45:
        score -= 10
        reasons.append(f"Average stress is elevated: {today.stress_avg:.0f}")

    hard_recent = hard_days_recent(days)
    if hard_recent >= 2:
        score -= 15
        reasons.append("Two or more hard/relevant training days in the last 3 days")

    wmin = weekly_minutes(days)
    if wmin > 600:
        score -= 10
        reasons.append(f"High recent cycling volume: {wmin:.0f} min in 7 days")

    score = max(0, min(100, score))
    z = power_zones(ftp)

    if score < 40:
        label = "Low"
        workout = "Rest or active recovery"
        duration = "0-45 min"
        power = z["Z1 Recovery"]
        tomorrow = "Reassess recovery. Do not schedule intensity until sleep/HRV improves."
    elif score < 60:
        label = "Moderate-low"
        workout = "Easy endurance ride"
        duration = "45-75 min"
        power = z["Z1 Recovery"] + " to low " + z["Z2 Endurance"]
        tomorrow = "If sleep improves, progress to normal Z2 endurance."
    elif score < 80:
        label = "Good"
        workout = "Endurance / aerobic base"
        duration = "75-120 min"
        power = z["Z2 Endurance"]
        tomorrow = "You may add tempo or sweet spot if recovery remains good."
    else:
        label = "High"
        workout = "Quality session: threshold or VO2 depending on training block"
        duration = "60-90 min"
        power = f"Main intervals in {z['Z4 Threshold']} or {z['Z5 VO2']}; recover in {z['Z1 Recovery']}"
        tomorrow = "Plan easy Z1/Z2 recovery after intensity."

    if not reasons:
        reasons.append("Limited recovery data available; recommendation is conservative.")

    return Recommendation(
        day=today.day,
        readiness_score=score,
        readiness_label=label,
        workout=workout,
        duration=duration,
        power_target=power,
        reasons=reasons,
        tomorrow=tomorrow,
    )
