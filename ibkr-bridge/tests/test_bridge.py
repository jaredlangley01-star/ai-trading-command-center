from __future__ import annotations

import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

BRIDGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRIDGE_ROOT))

from http_server import BridgeHTTPServer  # noqa: E402
from market_data import (  # noqa: E402
    RealtimeSubscriptionUnavailable,
    quote_with_delayed_fallback,
)
from safety import (  # noqa: E402
    BridgeError,
    HTTP_HOST,
    HTTP_PORT,
    IBKR_CLIENT_ID,
    IBKR_HOST,
    IBKR_PORT,
    validate_context,
    validate_order,
)


def context(**overrides: Any) -> dict[str, Any]:
    return {
        "environment": "PAPER",
        "host": "127.0.0.1",
        "port": 4002,
        "clientId": 41,
        **overrides,
    }


class FakeService:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.failure: BridgeError | None = None

    def _result(self, name: str, value: Any) -> Any:
        self.calls.append(name)
        if self.failure:
            raise self.failure
        return value

    def account_summary(self):
        return self._result("summary", {"status": "PAPER_CONNECTED"})

    def positions(self):
        return self._result("positions", [])

    def orders(self):
        return self._result("orders", [])

    def executions(self):
        return self._result("executions", [])

    def quote(self, payload):
        return self._result("quote", {"last": 100})

    def history(self, payload):
        return self._result("history", [])

    def place_order(self, payload):
        return self._result("place", {"status": "SUBMITTED", "mode": "PAPER"})

    def cancel_order(self, order_id):
        return self._result("cancel", {"status": "CANCELLED", "mode": "PAPER"})


class SafetyTests(unittest.TestCase):
    def test_production_constants_are_loopback_paper_only(self):
        self.assertEqual((HTTP_HOST, HTTP_PORT), ("127.0.0.1", 8765))
        self.assertEqual((IBKR_HOST, IBKR_PORT, IBKR_CLIENT_ID), ("127.0.0.1", 4002, 41))

    def test_rejects_live_and_non_paper_contexts(self):
        for invalid in [
            context(environment="LIVE"),
            context(port=4001),
            context(port=7496),
            context(port=7497),
            context(host="0.0.0.0"),
            context(clientId=42),
        ]:
            with self.assertRaises(BridgeError):
                validate_context(invalid)

    def test_orders_require_paper_confirmation_and_basic_types(self):
        valid = context(mode="PAPER", confirmed=True, direction="BUY", type="LIMIT", quantity=1, limitPrice=100)
        validate_order(valid)
        for invalid in [
            {**valid, "mode": "LIVE"},
            {**valid, "confirmed": False},
            {**valid, "type": "STOP"},
            {**valid, "quantity": 0},
            {**valid, "limitPrice": 0},
        ]:
            with self.assertRaises(BridgeError):
                validate_order(invalid)


class MarketDataFallbackTests(unittest.TestCase):
    def test_live_data_is_preferred_when_available(self):
        calls = []

        def live():
            calls.append("live")
            return {"bid": 99, "ask": 101, "last": 100, "isDelayed": False}

        result = quote_with_delayed_fallback(live, lambda: calls.append("delayed"))
        self.assertEqual(calls, ["live"])
        self.assertFalse(result["isDelayed"])

    def test_10089_subscription_failure_falls_back_to_delayed(self):
        calls = []

        def live():
            calls.append("live")
            raise RealtimeSubscriptionUnavailable()

        def delayed():
            calls.append("delayed")
            return {
                "bid": 98,
                "ask": 102,
                "last": 100,
                "asOf": "2026-08-14T00:00:00Z",
                "source": "IBKR_TWS_PAPER_DELAYED",
                "isDelayed": True,
            }

        result = quote_with_delayed_fallback(live, delayed)
        self.assertEqual(calls, ["live", "delayed"])
        self.assertTrue(result["isDelayed"])
        self.assertEqual(result["source"], "IBKR_TWS_PAPER_DELAYED")

    def test_delayed_data_unavailable_is_not_mislabeled(self):
        def live():
            raise RealtimeSubscriptionUnavailable()

        def delayed():
            raise BridgeError(
                400,
                "DELAYED_MARKET_DATA_UNAVAILABLE",
                "Delayed data unavailable.",
            )

        with self.assertRaisesRegex(BridgeError, "Delayed data unavailable"):
            quote_with_delayed_fallback(live, delayed)


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.service = FakeService()
        self.server = BridgeHTTPServer(("127.0.0.1", 0), self.service)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def post(self, path: str, payload: dict[str, Any]):
        request = urllib.request.Request(
            self.url + path,
            data=json.dumps(payload).encode(),
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_all_contract_endpoints_route_to_service(self):
        routes = [
            ("/v1/account/summary", "summary"),
            ("/v1/account/positions", "positions"),
            ("/v1/account/orders", "orders"),
            ("/v1/account/executions", "executions"),
            ("/v1/market/quote", "quote"),
            ("/v1/market/history", "history"),
        ]
        for path, call in routes:
            status, _ = self.post(path, context(symbol="AAPL"))
            self.assertEqual(status, 200)
            self.assertEqual(self.service.calls[-1], call)
        status, _ = self.post(
            "/v1/orders",
            context(mode="PAPER", confirmed=True, direction="BUY", type="MARKET", quantity=1, symbol="AAPL"),
        )
        self.assertEqual(status, 200)
        status, _ = self.post("/v1/orders/123/cancel", context())
        self.assertEqual(status, 200)
        self.assertEqual(self.service.calls[-2:], ["place", "cancel"])

    def test_guard_rejects_before_service_call(self):
        status, body = self.post("/v1/account/summary", context(environment="LIVE"))
        self.assertEqual(status, 423)
        self.assertEqual(body["code"], "LIVE_TRADING_LOCKED")
        self.assertEqual(self.service.calls, [])

    def test_connection_failures_are_normalized(self):
        self.service.failure = BridgeError(503, "DISCONNECTED_SESSION", "Gateway unavailable.")
        status, body = self.post("/v1/account/summary", context())
        self.assertEqual(status, 503)
        self.assertEqual(body["code"], "DISCONNECTED_SESSION")


class SourceContractTests(unittest.TestCase):
    def test_official_ibapi_and_required_calls_are_present(self):
        source = (BRIDGE_ROOT / "ibkr_client.py").read_text(encoding="utf-8")
        self.assertIn("from ibapi.client import EClient", source)
        for method in [
            "reqAccountSummary",
            "reqPositions",
            "reqOpenOrders",
            "reqExecutions",
            "reqMktData",
            "reqMarketDataType",
            "reqHistoricalData",
            "placeOrder",
            "cancelOrder",
        ]:
            self.assertIn(method, source)
        self.assertNotRegex(source.lower(), r"username|password|session_cookie|token=")
        self.assertIn("market_data_type=1", source)
        self.assertIn("market_data_type=3", source)


if __name__ == "__main__":
    unittest.main()
