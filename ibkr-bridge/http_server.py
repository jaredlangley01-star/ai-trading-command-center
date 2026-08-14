"""Loopback HTTP contract for the Trading Command Center."""

from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Protocol

from safety import BridgeError, validate_context, validate_order


class BridgeService(Protocol):
    def account_summary(self) -> dict[str, Any]: ...
    def positions(self) -> list[dict[str, Any]]: ...
    def orders(self) -> list[dict[str, Any]]: ...
    def executions(self) -> list[dict[str, Any]]: ...
    def quote(self, payload: dict[str, Any]) -> dict[str, Any]: ...
    def history(self, payload: dict[str, Any]) -> list[dict[str, Any]]: ...
    def place_order(self, payload: dict[str, Any]) -> dict[str, Any]: ...
    def cancel_order(self, order_id: str) -> dict[str, Any]: ...


class BridgeHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], service: BridgeService):
        self.service = service
        super().__init__(address, BridgeRequestHandler)


class BridgeRequestHandler(BaseHTTPRequestHandler):
    server: BridgeHTTPServer
    protocol_version = "HTTP/1.1"

    def log_message(self, message: str, *args: object) -> None:
        print(f"[bridge-http] {self.address_string()} {message % args}")

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(200, {"status": "ok", "environment": "PAPER"})
        else:
            self._send(404, {"code": "NOT_FOUND", "message": "Route not found."})

    def do_POST(self) -> None:
        try:
            payload = self._read_json()
            validate_context(payload)
            service = self.server.service
            route = self.path.rstrip("/")
            if route == "/v1/account/summary":
                result = service.account_summary()
            elif route == "/v1/account/positions":
                result = service.positions()
            elif route == "/v1/account/orders":
                result = service.orders()
            elif route == "/v1/account/executions":
                result = service.executions()
            elif route == "/v1/market/quote":
                result = service.quote(payload)
            elif route == "/v1/market/history":
                result = service.history(payload)
            elif route == "/v1/orders":
                validate_order(payload)
                result = service.place_order(payload)
            elif match := re.fullmatch(r"/v1/orders/([^/]+)/cancel", route):
                result = service.cancel_order(match.group(1))
            else:
                raise BridgeError(404, "NOT_FOUND", "Route not found.")
            self._send(200, result)
        except BridgeError as error:
            self._send(error.status, {"code": error.code, "message": error.message})
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send(400, {"code": "MALFORMED_REQUEST", "message": "A valid JSON body is required."})
        except Exception as error:  # Fail closed without leaking internals.
            print(f"[bridge-http] unexpected error: {error}")
            self._send(500, {"code": "BRIDGE_ERROR", "message": "The paper bridge request failed safely."})

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError as error:
            raise BridgeError(400, "MALFORMED_REQUEST", "Invalid content length.") from error
        if length <= 0 or length > 1_000_000:
            raise BridgeError(400, "MALFORMED_REQUEST", "A bounded JSON body is required.")
        value = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(value, dict):
            raise BridgeError(400, "MALFORMED_REQUEST", "JSON body must be an object.")
        return value

    def _send(self, status: int, value: Any) -> None:
        body = json.dumps(value, separators=(",", ":"), default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.end_headers()
        self.wfile.write(body)
