FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY pyproject.toml .
COPY src ./src
RUN pip install -e .
COPY . .
CMD ["python", "-m", "garmin_coach.cli", "recommend", "--days", "14"]
