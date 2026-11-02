import json
from unittest.mock import patch

import pytest

from trading_engine.alpaca_paper_account import (
    AlpacaPaperAccountError,
    AlpacaPaperAccountReader,
)


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self.payload


def test_account_reads_paper_host_and_returns_safe_fields():
    payload = {
        "status": "ACTIVE", "currency": "USD", "cash": "100000",
        "buying_power": "200000", "equity": "100000",
        "portfolio_value": "100000", "secret_extra": "must-not-leak",
    }
    reader = AlpacaPaperAccountReader("paper-key", "paper-secret")
    with patch("trading_engine.alpaca_paper_account.urlopen", return_value=FakeResponse(payload)) as mocked:
        result = reader.account()
    request = mocked.call_args.args[0]
    assert request.full_url == "https://paper-api.alpaca.markets/v2/account"
    assert request.get_method() == "GET"
    assert result["mode"] == "ALPACA_PAPER"
    assert result["cash"] == "100000"
    assert "secret_extra" not in result


def test_positions_are_read_only_get_requests():
    reader = AlpacaPaperAccountReader("key", "secret")
    payload = [{"symbol": "AAPL", "qty": "2", "market_value": "400", "ignored": "x"}]
    with patch("trading_engine.alpaca_paper_account.urlopen", return_value=FakeResponse(payload)) as mocked:
        positions = reader.positions()
    request = mocked.call_args.args[0]
    assert request.get_method() == "GET"
    assert request.full_url == "https://paper-api.alpaca.markets/v2/positions"
    assert positions[0]["symbol"] == "AAPL"
    assert positions[0]["qty"] == "2"
    assert "ignored" not in positions[0]


def test_orders_are_read_only_and_limit_is_validated():
    reader = AlpacaPaperAccountReader("key", "secret")
    with pytest.raises(ValueError, match="LIMIT_MUST"):
        reader.recent_orders(101)
    with patch("trading_engine.alpaca_paper_account.urlopen", return_value=FakeResponse([])) as mocked:
        assert reader.recent_orders(5) == []
    request = mocked.call_args.args[0]
    assert request.get_method() == "GET"
    assert request.full_url.startswith("https://paper-api.alpaca.markets/v2/orders?")
    assert "limit=5" in request.full_url


def test_reader_requires_credentials():
    with patch.dict("os.environ", {}, clear=True):
        with pytest.raises(AlpacaPaperAccountError, match="CREDENTIALS_NOT_CONFIGURED"):
            AlpacaPaperAccountReader()


def test_market_clock_uses_read_only_paper_endpoint():
    reader = AlpacaPaperAccountReader("paper-key", "paper-secret")
    payload = {
        "timestamp": "2026-11-02T15:00:00Z",
        "is_open": True,
        "next_open": "2026-11-03T14:30:00Z",
        "next_close": "2026-11-02T21:00:00Z",
        "unneeded": "must-not-leak",
    }
    with patch("trading_engine.alpaca_paper_account.urlopen", return_value=FakeResponse(payload)) as mocked:
        result = reader.market_clock()
    request = mocked.call_args.args[0]
    assert request.full_url == "https://paper-api.alpaca.markets/v2/clock"
    assert request.get_method() == "GET"
    assert result["is_open"] is True
    assert result["mode"] == "ALPACA_PAPER"
    assert result["read_only"] is True
    assert "unneeded" not in result
