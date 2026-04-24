from __future__ import annotations

from .models import DailyMetrics, Recommendation
from .config import Settings


def explain_with_llm(settings: Settings, days: list[DailyMetrics], rec: Recommendation) -> str:
    if not settings.openai_api_key:
        return "LLM explanation skipped: OPENAI_API_KEY is not set."

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    data = [d.to_dict() for d in days[-14:]]
    prompt = f"""
You are a conservative endurance cycling coach.
The deterministic engine already selected this recommendation. Do not override it unless there is a clear safety issue.

Athlete:
- FTP: {settings.ftp_watts} W
- Weight: {settings.body_weight_kg} kg
- Goal: {settings.target_event}

Recent Garmin-derived data:
{data}

Recommendation:
{rec}

Write a concise coaching note with:
1. Today readiness
2. Workout
3. Why
4. What to change if legs feel bad
5. Tomorrow guidance
"""
    response = client.chat.completions.create(
        model=settings.openai_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )
    return response.choices[0].message.content or ""
