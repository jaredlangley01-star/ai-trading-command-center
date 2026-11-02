import json
from io import BytesIO
from unittest.mock import patch

import pytest

from trading_engine.alpaca_market_data import (
    AlpacaIEXMarketDataProvider,
    AlpacaMarketDataError,
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


def test_provider_requires_credentials():
    with patch.dict("os.environ", {}, clear=True):
        with pytest.raises(AlpacaMarketDataError, match="CREDENTIALS_NOT_CONFIGURED"):
            AlpacaIEXMarketDataProvider()


def test_provider_rejects_paid_or_non_iex_feed():
    with pytest.raises(AlpacaMarketDataError, match="MUST_BE_IEX"):
        AlpacaIEXMarketDataProvider("key", "secret", feed="sip")


def test_reads_iex_bars_and_builds_snapshot():
    payload = {"bars": [{
        "t": "2026-11-02T10:15:00Z", "o": 100, "h": 102,
        "l": 99, "c": 101.5, "v": 1234
    }]}
    provider = AlpacaIEXMarketDataProvider("test-key", "test-secret")
    with patch("trading_engine.alpaca_market_data.urlopen", return_value=FakeResponse(payload)) as mocked:
        snapshot = provider.latest_snapshot("aapl")
    request = mocked.call_args.args[0]
    assert request.get_header("Apca-data-feed") is None
    assert request.get_header("Apca-api-key-id") == "test-key"
    assert "feed=iex" in request.full_url
    assert snapshot.symbol == "AAPL"
    assert snapshot.price == 101.5
    assert snapshot.volume == 1234
    assert snapshot.source == "ALPACA_IEX"


def test_empty_bar_response_is_not_treated_as_zero_price():
    provider = AlpacaIEXMarketDataProvider("test-key", "test-secret")
    with patch("trading_engine.alpaca_market_data.urlopen", return_value=FakeResponse({"bars": []})):
        with pytest.raises(AlpacaMarketDataError, match="NO_BARS_RETURNED"):
            provider.latest_snapshot("AAPL")


def test_fetch_observation_uses_one_request_for_price_and_history():
    # Alpaca sort=desc returns newest bars first; the adapter normalizes them.
    payload = {"bars": [
        {"t": "2026-11-02T10:15:00Z", "o": 100, "h": 102, "l": 99, "c": 101.5, "v": 1234},
        {"t": "2026-11-02T10:14:00Z", "o": 99, "h": 100, "l": 98, "c": 99.5, "v": 800},
    ]}
    provider = AlpacaIEXMarketDataProvider("test-key", "test-secret")
    with patch("trading_engine.alpaca_market_data.urlopen", return_value=FakeResponse(payload)) as mocked:
        snapshot, closes = provider.fetch_observation("aapl", 100)
    assert mocked.call_count == 1
    assert snapshot.price == 101.5
    assert snapshot.timestamp.isoformat() == "2026-11-02T10:15:00+00:00"
    assert closes == [99.5, 101.5]
