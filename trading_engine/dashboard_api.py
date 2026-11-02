"""Read-only dashboard API. Local-only unless protected by a bearer token."""
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import ip_address
from urllib.parse import urlsplit, parse_qs
from datetime import datetime, timezone


def _is_loopback(host):
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return host.lower() == "localhost"


def create_dashboard_server(portfolio_snapshot, health_snapshot, broker_snapshot=None, host="127.0.0.1", port=8765, access_token=None, event_store=None, market_clock_snapshot=None):
    token = access_token or os.getenv("SMALL_TRADING_API_TOKEN")
    if not _is_loopback(host) and not token:
        raise ValueError("NON_LOCAL_BIND_REQUIRES_SMALL_TRADING_API_TOKEN")

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, payload):
            body = json.dumps(payload, default=str).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            parsed = urlsplit(self.path)
            # Minimal liveness probe for hosting-provider health checks. It
            # exposes no account, portfolio, event or worker details.
            if parsed.path == "/healthz":
                return self._send(200, {"status": "ALIVE", "read_only": True})
            if token:
                supplied = self.headers.get("Authorization", "")
                expected = f"Bearer {token}"
                if not hmac.compare_digest(supplied, expected):
                    return self._send(401, {"error": "UNAUTHORIZED"})
            if parsed.path == "/api/events":
                if event_store is None:
                    return self._send(503, {"error": "EVENT_STORE_NOT_CONFIGURED", "events": []})
                try:
                    raw_limit = parse_qs(parsed.query).get("limit", ["50"])[0]
                    limit = int(raw_limit)
                    if not 1 <= limit <= 100:
                        raise ValueError
                except (TypeError, ValueError):
                    return self._send(400, {"error": "INVALID_LIMIT", "message": "limit must be between 1 and 100"})
                return self._send(200, {"events": event_store.list_events(limit)})
            if parsed.path == "/api/decisions":
                if event_store is None:
                    return self._send(503, {"status": "UNKNOWN", "decisions": []})
                decisions = []
                for event in event_store.list_events(1000):
                    if event.get("event_type") != "OBSERVATION_CYCLE":
                        continue
                    payload = event.get("payload") or {}
                    market = payload.get("market") or {}
                    for signal in payload.get("signals") or []:
                        decisions.append({
                            "event_id": event.get("id"),
                            "symbol": payload.get("symbol"),
                            "observed_at": market.get("timestamp") or event.get("created_at"),
                            "market_price": market.get("price"),
                            "market_source": market.get("source"),
                            "strategy": signal.get("strategy"),
                            "signal": signal.get("status", "UNKNOWN"),
                            "score": signal.get("score", 0.0),
                            "reason": signal.get("reason", ""),
                            "execution_enabled": False,
                            "risk_status": (signal.get("risk") or {}).get("status", "NOT_REVIEWED"),
                            "risk_reason": (signal.get("risk") or {}).get("reason", "NOT_REVIEWED"),
                            "proposed_quantity": (signal.get("risk") or {}).get("proposed_quantity", 0),
                            "estimated_loss": (signal.get("risk") or {}).get("estimated_loss", 0.0),
                            "stop_loss": (signal.get("risk") or {}).get("stop_loss"),
                            "take_profit": (signal.get("risk") or {}).get("take_profit"),
                        })
                return self._send(200, {"status": "OBSERVATION_ONLY", "decisions": decisions[:200]})
            if parsed.path == "/api/performance":
                if event_store is None:
                    return self._send(503, {"status": "UNKNOWN", "execution_enabled": False})
                from .performance import PerformanceReportingAgent
                return self._send(200, PerformanceReportingAgent(event_store).snapshot())
            if parsed.path == "/api/market":
                if event_store is None:
                    return self._send(503, {"status": "UNKNOWN", "observations": []})
                latest = {}
                for event in event_store.list_events(100):
                    if event.get("event_type") != "OBSERVATION_CYCLE":
                        continue
                    payload = event.get("payload") or {}
                    symbol = payload.get("symbol")
                    market = payload.get("market") or {}
                    stamp = market.get("timestamp")
                    if not isinstance(symbol, str) or not isinstance(stamp, str) or symbol in latest:
                        continue
                    try:
                        observed_at = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
                        if observed_at.tzinfo is None:
                            observed_at = observed_at.replace(tzinfo=timezone.utc)
                        age = max(0.0, (datetime.now(timezone.utc) - observed_at.astimezone(timezone.utc)).total_seconds())
                    except ValueError:
                        continue
                    latest[symbol] = {
                        "symbol": symbol, "price": market.get("price"),
                        "source": market.get("source") or "UNKNOWN",
                        "observed_at": observed_at.astimezone(timezone.utc).isoformat(),
                        "age_seconds": round(age, 1),
                        "freshness": "FRESH" if age <= 120 else "STALE",
                        "volume": market.get("volume"),
                    }
                observations = list(latest.values())
                overall = "UNKNOWN" if not observations else ("STALE" if any(x["freshness"] == "STALE" for x in observations) else "FRESH")
                return self._send(200, {"status": overall, "max_age_seconds": 120, "observations": observations})
            if parsed.path == "/api/market-clock":
                if market_clock_snapshot is None:
                    return self._send(503, {"status": "UNKNOWN", "read_only": True})
                try:
                    payload = market_clock_snapshot.market_clock()
                    return self._send(200, payload)
                except Exception:
                    return self._send(503, {"status": "UNAVAILABLE", "read_only": True, "error": "MARKET_CLOCK_READ_FAILED"})
            if parsed.path == "/api/broker":
                if broker_snapshot is None:
                    return self._send(503, {"mode": "NOT_CONNECTED", "read_only": True})
                try:
                    payload = broker_snapshot() if callable(broker_snapshot) else broker_snapshot.snapshot()
                    return self._send(200, payload)
                except Exception:
                    return self._send(503, {"mode": "UNAVAILABLE", "read_only": True, "error": "BROKER_READ_FAILED"})
            if parsed.path == "/api/health":
                return self._send(200, health_snapshot.build())
            if parsed.path == "/api/portfolio":
                return self._send(200, portfolio_snapshot.build())
            if parsed.path == "/api/status":
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
