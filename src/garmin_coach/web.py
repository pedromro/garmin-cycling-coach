from __future__ import annotations

import argparse
import json
import mimetypes
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .config import Settings
from .dashboard import dashboard_payload
from .db import CoachDB


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = PROJECT_ROOT / "frontend"


def _json_response(handler: SimpleHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _days_from_query(path: str, default: int = 14) -> int:
    query = parse_qs(urlparse(path).query)
    try:
        return max(1, min(730, int(query.get("days", [default])[0])))
    except ValueError:
        return default


def _load_dashboard(days: int) -> dict:
    settings = Settings.from_env()
    db = CoachDB(settings.db_path)
    return dashboard_payload(db.last_days(days), settings.ftp_watts)


def _refresh_dashboard(days: int) -> dict:
    try:
        from .garmin_client import GarminSync
    except ModuleNotFoundError as exc:
        if exc.name == "garminconnect":
            raise RuntimeError(
                "Garmin refresh requires the 'garminconnect' package. "
                "Install project dependencies with 'python -m pip install -r requirements.txt'."
            ) from exc
        raise

    settings = Settings.from_env()
    db = CoachDB(settings.db_path)
    sync = GarminSync(settings)
    sync.login()
    metrics = sync.fetch_range(days)
    for metric in metrics:
        db.upsert_daily(metric)
    payload = dashboard_payload(db.last_days(days), settings.ftp_watts)
    payload["sync"] = {"days": days, "synced": len(metrics)}
    return payload


class CoachRequestHandler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path.startswith("/api/dashboard"):
            try:
                _json_response(self, 200, _load_dashboard(_days_from_query(self.path)))
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        self._serve_frontend()

    def do_POST(self) -> None:
        if self.path.startswith("/api/refresh"):
            try:
                _json_response(self, 200, _refresh_dashboard(_days_from_query(self.path)))
            except Exception as exc:
                _json_response(self, 500, {"error": str(exc)})
            return

        _json_response(self, 404, {"error": "Not found"})

    def _serve_frontend(self) -> None:
        parsed = urlparse(self.path)
        relative = parsed.path.lstrip("/") or "index.html"
        target = (FRONTEND_DIR / relative).resolve()

        try:
            target.relative_to(FRONTEND_DIR.resolve())
        except ValueError:
            self.send_error(403)
            return
        if target.is_dir():
            target = target / "index.html"
        if not target.exists():
            target = FRONTEND_DIR / "index.html"

        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Garmin Cycling Coach dashboard")
    parser.add_argument("--host", default=os.getenv("COACH_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("COACH_PORT", "5173")))
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), CoachRequestHandler)
    print(f"Garmin Cycling Coach dashboard: http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
