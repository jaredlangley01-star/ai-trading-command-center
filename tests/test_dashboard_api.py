import json
from threading import Thread
from urllib.request import urlopen
from urllib.error import HTTPError

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


def test_dashboard_api_is_read_only_and_reports_simulator_mode():
    server = create_dashboard_server(Portfolio(), Health(), port=0)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with urlopen(base + "/api/status") as response:
            status = json.loads(response.read())
        assert status["mode"] == "PAPER_SIMULATOR"
        assert status["trading_enabled"] is False
        assert status["execution_api"] is False
        with urlopen(base + "/api/broker") as response:
            assert json.loads(response.read())["mode"] == "NOT_CONNECTED"
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
