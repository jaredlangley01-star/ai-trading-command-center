import json
from threading import Thread
from urllib.request import urlopen, Request
from urllib.error import HTTPError
from unittest.mock import patch

import pytest

from trading_engine.dashboard_api import create_dashboard_server


class Portfolio:
    def build(self):
        return {
            "open_position_count": 0,
            "realized_pnl_from_ledger": 0.0,
            "unrealized_pnl": 0.0,
            "reconciliation_status": "NOT_RECONCILED",
        }


class Health:
    def build(self):
        return {"status": "UNKNOWN", "heartbeat_at": None}


def _serve(server):
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return thread


def test_dashboard_api_is_read_only_and_reports_simulator_mode():
    server = create_dashboard_server(Portfolio(), Health(), port=0)
    thread = _serve(server)
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with urlopen(base + "/api/status") as response:
            status = json.loads(response.read())
            assert response.headers["Cache-Control"] == "no-store"
        assert status["mode"] == "PAPER_SIMULATOR"
        assert status["trading_enabled"] is False
        assert status["execution_api"] is False
        try:
            urlopen(base + "/api/broker")
            assert False, "unconfigured broker must not appear connected"
        except HTTPError as error:
            assert error.code == 503
            assert json.loads(error.read())["mode"] == "NOT_CONNECTED"
        with urlopen(base + "/api/health") as response:
            assert json.loads(response.read())["status"] == "UNKNOWN"
        try:
            urlopen(base + "/api/orders")
            assert False, "orders route must not exist"
        except HTTPError as error:
            assert error.code == 404
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_non_local_bind_is_refused_without_token():
    with patch.dict("os.environ", {}, clear=True):
        with pytest.raises(ValueError, match="NON_LOCAL_BIND_REQUIRES"):
            create_dashboard_server(Portfolio(), Health(), host="0.0.0.0", port=0)


def test_remote_bind_requires_correct_bearer_token():
    server = create_dashboard_server(Portfolio(), Health(), host="127.0.0.1", port=0, access_token="test-secret")
    thread = _serve(server)
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        try:
            urlopen(base + "/api/status")
            assert False, "request without token must be rejected"
        except HTTPError as error:
            assert error.code == 401
        wrong = Request(base + "/api/status", headers={"Authorization": "Bearer wrong"})
        try:
            urlopen(wrong)
            assert False, "wrong token must be rejected"
        except HTTPError as error:
            assert error.code == 401
        correct = Request(base + "/api/status", headers={"Authorization": "Bearer test-secret"})
        with urlopen(correct) as response:
            assert json.loads(response.read())["mode"] == "PAPER_SIMULATOR"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


class EventStore:
    def list_events(self, limit):
        return [{"id": 7, "event_type": "OBSERVATION_CYCLE", "created_at": "2026-11-02T10:00:00+00:00", "payload": {"symbol": "AAPL", "status": "READY"}}]


def test_events_endpoint_is_read_only_and_limits_results():
    server = create_dashboard_server(Portfolio(), Health(), port=0, event_store=EventStore())
    thread = _serve(server)
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with urlopen(base + "/api/events?limit=10") as response:
            payload = json.loads(response.read())
        assert payload["events"][0]["event_type"] == "OBSERVATION_CYCLE"
        for limit in ("101", "0", "invalid"):
            try:
                urlopen(base + "/api/events?limit=" + limit)
                assert False, "invalid event limit must be rejected"
            except HTTPError as error:
                assert error.code == 400
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_market_endpoint_reports_latest_observation_and_freshness():
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    class MarketEventStore:
        def list_events(self, limit):
            return [
                {"id": 9, "event_type": "OBSERVATION_CYCLE", "created_at": now,
                 "payload": {"symbol": "AAPL", "market": {"price": 205.5, "source": "ALPACA_IEX", "timestamp": now, "volume": 500}}},
                {"id": 8, "event_type": "OBSERVATION_CYCLE", "created_at": now,
                 "payload": {"symbol": "AAPL", "market": {"price": 204.5, "source": "ALPACA_IEX", "timestamp": now, "volume": 450}}},
            ]
    server = create_dashboard_server(Portfolio(), Health(), port=0, event_store=MarketEventStore())
    thread = _serve(server)
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with urlopen(base + "/api/market") as response:
            payload = json.loads(response.read())
        assert payload["status"] == "FRESH"
        assert len(payload["observations"]) == 1
        assert payload["observations"][0]["price"] == 205.5
        assert payload["observations"][0]["source"] == "ALPACA_IEX"
        assert payload["observations"][0]["freshness"] == "FRESH"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_market_clock_endpoint_returns_read_only_broker_clock():
    class Clock:
        def market_clock(self):
            return {
                "mode": "ALPACA_PAPER",
                "timestamp": "2026-11-02T15:00:00Z",
                "is_open": False,
                "next_open": "2026-11-03T14:30:00Z",
                "next_close": "2026-11-03T21:00:00Z",
                "read_only": True,
            }
    server = create_dashboard_server(Portfolio(), Health(), port=0, market_clock_snapshot=Clock())
    thread = _serve(server)
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with urlopen(base + "/api/market-clock") as response:
            payload = json.loads(response.read())
        assert payload["mode"] == "ALPACA_PAPER"
        assert payload["is_open"] is False
        assert payload["next_open"] == "2026-11-03T14:30:00Z"
        assert payload["read_only"] is True
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_healthz_is_minimal_and_available_without_bearer_token():
    server = create_dashboard_server(Portfolio(), Health(), port=0, access_token="test-secret")
    thread = _serve(server)
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with urlopen(base + "/healthz") as response:
            payload = json.loads(response.read())
        assert payload == {"status": "ALIVE", "read_only": True}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_decisions_endpoint_exposes_strategy_signal_history_without_risk_or_execution_claims():
    class DecisionEventStore:
        def list_events(self, limit):
            return [{
                "id": 12, "event_type": "OBSERVATION_CYCLE", "created_at": "2026-11-02T10:00:00+00:00",
                "payload": {"symbol": "AAPL", "market": {"timestamp": "2026-11-02T10:00:00+00:00", "price": 200, "source": "ALPACA_IEX"},
                            "signals": [{"strategy": "TREND", "status": "BUY", "score": 1.2, "reason": "FAST_SLOW_AVERAGE_ALIGNMENT", "risk": {"status": "REJECTED", "reason": "PORTFOLIO_CONTEXT_UNVERIFIED", "proposed_quantity": 1, "estimated_loss": 2.0}}],
                            "execution_enabled": False}
            }]
    server = create_dashboard_server(Portfolio(), Health(), port=0, event_store=DecisionEventStore())
    thread = _serve(server)
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with urlopen(base + "/api/decisions") as response:
            payload = json.loads(response.read())
        assert payload["status"] == "OBSERVATION_ONLY"
        decision = payload["decisions"][0]
        assert decision["symbol"] == "AAPL"
        assert decision["strategy"] == "TREND"
        assert decision["signal"] == "BUY"
        assert decision["risk_status"] == "REJECTED"
        assert decision["risk_reason"] == "PORTFOLIO_CONTEXT_UNVERIFIED"
        assert decision["proposed_quantity"] == 1
        assert decision["execution_enabled"] is False
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_performance_endpoint_reports_simulator_ledger_only():
    from trading_engine.storage import SQLiteStore
    store = SQLiteStore(":memory:")
    server = create_dashboard_server(Portfolio(), Health(), port=0, event_store=store)
    thread = _serve(server)
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with urlopen(base + "/api/performance") as response:
            payload = json.loads(response.read())
        assert payload["mode"] == "PAPER_SIMULATOR_LEDGER"
        assert payload["source"] == "SIMULATED_POSITION_EVENTS_ONLY"
        assert payload["execution_enabled"] is False
        assert payload["reconciliation_status"] == "NOT_RECONCILED"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        store.close()
