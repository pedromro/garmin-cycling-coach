from __future__ import annotations

import argparse
import sys
from rich.console import Console
from rich.table import Table

from .config import Settings
from .db import CoachDB
from .recommender import recommend, power_zones
from .report import write_report
from .llm import explain_with_llm

console = Console()


def _garmin_sync(settings: Settings):
    try:
        from .garmin_client import GarminSync
    except ModuleNotFoundError as exc:
        if exc.name == "garminconnect":
            raise RuntimeError(
                "Garmin sync requires the 'garminconnect' package. "
                "Install project dependencies with 'python -m pip install -e .' "
                "or 'python -m pip install -r requirements.txt'."
            ) from exc
        raise

    return GarminSync(settings)


def cmd_sync(args) -> None:
    settings = Settings.from_env()
    db = CoachDB(settings.db_path)
    sync = _garmin_sync(settings)
    sync.login()
    metrics = sync.fetch_range(args.days)
    for m in metrics:
        db.upsert_daily(m)
    console.print(f"[green]Synced {len(metrics)} days to {settings.db_path}[/green]")


def cmd_recommend(args) -> None:
    settings = Settings.from_env()
    db = CoachDB(settings.db_path)

    if args.no_sync:
        days = db.last_days(args.days)
    else:
        sync = _garmin_sync(settings)
        sync.login()
        days = sync.fetch_range(args.days)
        for m in days:
            db.upsert_daily(m)

    if not days:
        raise RuntimeError("No data available. Run sync first or check Garmin login.")

    rec = recommend(days, settings.ftp_watts)
    llm_note = explain_with_llm(settings, days, rec) if args.llm else None
    report_path = write_report(settings.report_dir, settings.ftp_watts, days, rec, llm_note)

    table = Table(title=f"Garmin Cycling Coach - {rec.day}")
    table.add_column("Field")
    table.add_column("Value")
    table.add_row("Readiness", f"{rec.readiness_label} ({rec.readiness_score}/100)")
    table.add_row("Workout", rec.workout)
    table.add_row("Duration", rec.duration)
    table.add_row("Power", rec.power_target)
    table.add_row("Tomorrow", rec.tomorrow)
    table.add_row("Report", report_path)
    console.print(table)

    console.print("\n[bold]Reasons[/bold]")
    for r in rec.reasons:
        console.print(f"- {r}")

    console.print("\n[bold]Power zones[/bold]")
    for name, rng in power_zones(settings.ftp_watts).items():
        console.print(f"- {name}: {rng}")

    if llm_note:
        console.print("\n[bold]Coach note[/bold]")
        console.print(llm_note)


def main() -> None:
    parser = argparse.ArgumentParser(description="Personal Garmin cycling coach")
    sub = parser.add_subparsers(required=True)

    p_sync = sub.add_parser("sync", help="Sync Garmin data to local SQLite")
    p_sync.add_argument("--days", type=int, default=14)
    p_sync.set_defaults(func=cmd_sync)

    p_rec = sub.add_parser("recommend", help="Sync and generate recommendation")
    p_rec.add_argument("--days", type=int, default=14)
    p_rec.add_argument("--no-sync", action="store_true", help="Use already-synced DB data")
    p_rec.add_argument("--llm", action="store_true", help="Add OpenAI coach explanation")
    p_rec.set_defaults(func=cmd_recommend)

    args = parser.parse_args()
    try:
        args.func(args)
    except RuntimeError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
