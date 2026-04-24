# Garmin Cycling Coach Agent

Personal Garmin-based cycling coach for local use.

It pulls Garmin Connect data, stores it in SQLite, evaluates sleep/recovery/training load, and produces a daily cycling recommendation.

## Features

- Garmin Connect sync using the unofficial `garminconnect` Python library
- SQLite local database
- FTP-based cycling zones
- Sleep/recovery/training-load rules
- Markdown daily report
- Optional OpenAI coach explanation
- Docker and non-Docker execution

## Setup on Windows with WSL

```bash
cd garmin-cycling-coach
cp .env.example .env
nano .env
```

Fill in:

```env
GARMIN_EMAIL=...
GARMIN_PASSWORD=...
FTP_WATTS=293
BODY_WEIGHT_KG=80
```

Install locally:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
```

Run:

```bash
python -m garmin_coach.cli recommend --days 14
```

## Docker

```bash
docker compose build
docker compose run --rm garmin-coach
```

## Commands

Sync only:

```bash
python -m garmin_coach.cli sync --days 14
```

Generate recommendation:

```bash
python -m garmin_coach.cli recommend --days 14
```

Use LLM explanation:

```bash
python -m garmin_coach.cli recommend --days 14 --llm
```

## Notes

Garmin may ask for MFA. The `garminconnect` package supports token storage in many cases, but login flows can change because this is not an official Garmin API.

## Training logic

The first version intentionally uses deterministic rules before asking an LLM to explain the result. This avoids hallucinated training decisions.

Main outputs:

- readiness score
- suggested workout type
- recommended duration
- power zones based on FTP
- reason codes
- tomorrow guidance
