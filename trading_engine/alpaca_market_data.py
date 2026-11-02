"""Alpaca IEX market-data adapter.

Requires APCA_API_KEY_ID and APCA_API_SECRET_KEY environment variables.
Uses the free IEX feed by default. This module reads data only and cannot
submit, amend or cancel broker orders.
"""
import json
import os
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .market_data import PriceBar
from .models import MarketSnapshot


class AlpacaMarketDataError(RuntimeError):
    pass


class AlpacaIEXMarketDataProvider:
    BASE_URL = "https://data.alpaca.markets"

    def __init__(self, api_key=None, secret_key=None, feed=None, timeout=10):
        self.api_key = api_key or os.getenv("APCA_API_KEY_ID")
        self.secret_key = secret_key or os.getenv("APCA_API_SECRET_KEY")
        self.feed = (feed or os.getenv("APCA_DATA_FEED") or "iex").lower()
        self.timeout = timeout
        if not self.api_key or not self.secret_key:
            raise AlpacaMarketDataError("ALPACA_CREDENTIALS_NOT_CONFIGURED")
        if self.feed != "iex":
            raise AlpacaMarketDataError("FREE_DATA_FEED_MUST_BE_IEX")

    def _get_json(self, path, params):
        url = f"{self.BASE_URL}{path}?{urlencode(params)}"
        request = Request(url, headers={
            "APCA-API-KEY-ID": self.api_key,
            "APCA-API-SECRET-KEY": self.secret_key,
            "Accept": "application/json",
        })
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            if exc.code in (401, 403):
                raise AlpacaMarketDataError("ALPACA_AUTHENTICATION_OR_DATA_PERMISSION_FAILED") from exc
            if exc.code == 429:
                raise AlpacaMarketDataError("ALPACA_RATE_LIMITED") from exc
            raise AlpacaMarketDataError(f"ALPACA_HTTP_ERROR_{exc.code}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise AlpacaMarketDataError("ALPACA_NETWORK_ERROR") from exc
        except (ValueError, UnicodeDecodeError) as exc:
            raise AlpacaMarketDataError("ALPACA_INVALID_JSON_RESPONSE") from exc

    def get_bars(self, symbol, limit=100, timeframe="1Min"):
        symbol = symbol.strip().upper()
        if not symbol or not symbol.replace(".", "").replace("-", "").isalnum():
            raise ValueError("INVALID_SYMBOL")
        if not 1 <= limit <= 1000:
            raise ValueError("LIMIT_MUST_BE_BETWEEN_1_AND_1000")
        payload = self._get_json(f"/v2/stocks/{symbol}/bars", {
            "timeframe": timeframe,
            "limit": limit,
            "feed": self.feed,
            "sort": "desc",
        })
        bars = []
        for item in payload.get("bars", []):
            timestamp = datetime.fromisoformat(item["t"].replace("Z", "+00:00"))
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=timezone.utc)
            bars.append(PriceBar(
                symbol=symbol,
                timestamp=timestamp.astimezone(timezone.utc),
                open=float(item["o"]),
                high=float(item["h"]),
                low=float(item["l"]),
                close=float(item["c"]),
                volume=float(item.get("v", 0)),
            ))
        if not bars:
            raise AlpacaMarketDataError(f"NO_BARS_RETURNED_FOR_{symbol}")
        # Alpaca returns newest-first; strategy windows must be chronological.
        return list(reversed(bars))

    def latest_snapshot(self, symbol):
        bar = self.get_bars(symbol, limit=1)[-1]
        return MarketSnapshot(
            symbol=bar.symbol, price=bar.close, timestamp=bar.timestamp,
            source="ALPACA_IEX", volume=bar.volume,
        )

    def recent_closes(self, symbol, limit):
        if limit < 1:
            raise ValueError("limit must be positive")
        return [bar.close for bar in self.get_bars(symbol, limit=min(limit, 1000))]
