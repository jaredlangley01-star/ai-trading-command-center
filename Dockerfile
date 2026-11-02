FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SMALL_TRADING_DATABASE_PATH=/data/trading.db

WORKDIR /app

COPY pyproject.toml README.md ./
COPY trading_engine ./trading_engine
RUN python -m pip install --no-cache-dir .

RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data \
    && chown -R appuser:appuser /app /data

USER appuser
VOLUME ["/data"]

CMD ["small-trading-worker"]
