"""Local read-only JSON API for the dashboard; deliberately exposes no order routes."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def create_dashboard_server(portfolio_snapshot, health_snapshot, broker_snapshot=None, host="127.0.0.1", port=8765):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, payload):
            body = json.dumps(payload, default=str).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/api/broker":
                if broker_snapshot is None:
                    return self._send(503, {"mode": "NOT_CONNECTED", "read_only": True})
                try:
                    payload = broker_snapshot() if callable(broker_snapshot) else broker_snapshot.snapshot()
                    return self._send(200, payload)
                except Exception:
                    return self._send(503, {"mode": "UNAVAILABLE", "read_only": True, "error": "BROKER_READ_FAILED"})
            if self.path == "/api/health":
                return self._send(200, health_snapshot.build())
            if self.path == "/api/portfolio":
                return self._send(200, portfolio_snapshot.build())
            if self.path == "/api/status":
                health = health_snapshot.build()
                portfolio = portfolio_snapshot.build()
                return self._send(200, {
                    "application": "small-trading-platform",
                    "mode": "PAPER_SIMULATOR",
                    "health": health,
                    "portfolio": {
                        "open_position_count": portfolio["open_position_count"],
                        "realized_pnl_from_ledger": portfolio["realized_pnl_from_ledger"],
                        "unrealized_pnl": portfolio["unrealized_pnl"],
                        "reconciliation_status": portfolio["reconciliation_status"],
                    },
                    "trading_enabled": False,
                    "execution_api": False,
                })
            return self._send(404, {"error": "NOT_FOUND", "message": "This API is read-only."})

        def log_message(self, format, *args):
            return

    return ThreadingHTTPServer((host, port), Handler)
