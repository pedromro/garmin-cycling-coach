from __future__ import annotations

import os
from .models import DailyMetrics, Recommendation
from .recommender import power_zones


def write_report(report_dir: str, ftp: int, days: list[DailyMetrics], rec: Recommendation, llm_note: str | None = None) -> str:
    os.makedirs(report_dir, exist_ok=True)
    path = os.path.join(report_dir, f"training_recommendation_{rec.day}.md")
    z = power_zones(ftp)
    today = days[-1]

    lines = [
        f"# Training recommendation - {rec.day}",
        "",
        f"**Readiness:** {rec.readiness_label} ({rec.readiness_score}/100)",
        f"**Workout:** {rec.workout}",
        f"**Duration:** {rec.duration}",
        f"**Power target:** {rec.power_target}",
        "",
        "## Reasons",
    ]
    lines.extend([f"- {r}" for r in rec.reasons])
    lines += [
        "",
        "## Today data snapshot",
        f"- Sleep hours: {today.sleep_hours}",
        f"- Sleep score: {today.sleep_score}",
        f"- HRV status: {today.hrv_status}",
        f"- HRV value: {today.hrv_value}",
        f"- Resting HR: {today.resting_hr}",
        f"- Stress avg: {today.stress_avg}",
        f"- Body Battery max: {today.body_battery_max}",
        f"- Cycling minutes today: {today.cycling_minutes:.0f}",
        "",
        "## FTP power zones",
    ]
    lines.extend([f"- {name}: {rng}" for name, rng in z.items()])
    lines += ["", "## Tomorrow", rec.tomorrow, ""]
    if llm_note:
        lines += ["## Coach note", llm_note, ""]

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return path
