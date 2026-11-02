"""Read-only Alpaca Paper Trading account adapter.

This module is intentionally limited to GET requests against the Paper API.
It cannot submit, amend, cancel, or close orders or positions.
"""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class AlpacaPaperAccountError(RuntimeError):
    pass


class AlpacaPaperAccountReader:
    BASE_URL = "https://paper-api.alpaca.markets"

    def __init__(self, api_key=None, secret_key=None, timeout=10):
        self.api_key = api_key or os.getenv("APCA_API_KEY_ID")
        self.secret_key = secret_key or os.getenv("APCA_API_SECRET_KEY")
        self.timeout = timeout
        if not self.api_key or not self.secret_key:
            raise AlpacaPaperAccountError("ALPACA_CREDENTIALS_NOT_CONFIGURED")

    def _get_json(self, path, params=None):
        query = f"?{urlencode(params)}" if params else ""
        request = Request(
            f"{self.BASE_URL}{path}{query}",
            headers={
                "APCA-API-KEY-ID": self.api_key,
                "APCA-API-SECRET-KEY": self.secret_key,
                "Accept": "application/json",
            },
            method="GET",
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            if exc.code in (401, 403):
                raise AlpacaPaperAccountError("ALPACA_PAPER_AUTHENTICATION_FAILED") from exc
            if exc.code == 429:
                raise AlpacaPaperAccountError("ALPACA_RATE_LIMITED") from exc
            raise AlpacaPaperAccountError(f"ALPACA_HTTP_ERROR_{exc.code}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise AlpacaPaperAccountError("ALPACA_NETWORK_ERROR") from exc
        except (ValueError, UnicodeDecodeError) as exc:
            raise AlpacaPaperAccountError("ALPACA_INVALID_JSON_RESPONSE") from exc

    def market_clock(self):
        """Read the broker's authoritative US equity market clock."""
        raw = self._get_json("/v2/clock")
        fields = ("timestamp", "is_open", "next_open", "next_close")
        return {"mode": "ALPACA_PAPER", **{key: raw.get(key) for key in fields}, "read_only": True}

    def account(self):
        raw = self._get_json("/v2/account")
        fields = (
            "status", "currency", "cash", "buying_power", "equity", "last_equity",
            "portfolio_value", "long_market_value", "short_market_value",
            "trading_blocked", "account_blocked", "trade_suspended_by_user",
        )
        return {"mode": "ALPACA_PAPER", **{key: raw.get(key) for key in fields}}

    def positions(self):
        raw = self._get_json("/v2/positions")
        fields = (
            "asset_id", "symbol", "exchange", "asset_class", "side", "qty",
            "avg_entry_price", "current_price", "market_value", "cost_basis",
            "unrealized_pl", "unrealized_plpc", "change_today",
        )
        return [{key: item.get(key) for key in fields} for item in raw]

    def recent_orders(self, limit=20):
        if not 1 <= limit <= 100:
            raise ValueError("LIMIT_MUST_BE_BETWEEN_1_AND_100")
        raw = self._get_json("/v2/orders", {
            "status": "all", "limit": limit, "direction": "desc",
            "nested": "false",
        })
        fields = (
            "id", "client_order_id", "symbol", "side", "type", "qty",
            "filled_qty", "filled_avg_price", "status", "submitted_at",
            "filled_at", "canceled_at",
        )
        return [{key: item.get(key) for key in fields} for item in raw]

    def open_orders(self, limit=100):
        """Read all currently open orders (up to Alpaca API maximum)."""
        if not 1 <= limit <= 100:
            raise ValueError("LIMIT_MUST_BE_BETWEEN_1_AND_100")
        raw = self._get_json("/v2/orders", {
            "status": "open", "limit": limit, "direction": "desc", "nested": "false",
        })
        fields = ("id", "client_order_id", "symbol", "side", "qty", "filled_qty", "status", "submitted_at")
        return [{key: item.get(key) for key in fields} for item in raw]

    def snapshot(self, order_limit=20):
        return {
            "mode": "ALPACA_PAPER",
            "account": self.account(),
            "positions": self.positions(),
            "recent_orders": self.recent_orders(order_limit),
            "open_orders": self.open_orders(),
            "read_only": True,
        }
