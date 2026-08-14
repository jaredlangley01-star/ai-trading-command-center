"""Hard PAPER-only configuration guards shared by HTTP and IBKR layers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

HTTP_HOST = "127.0.0.1"
HTTP_PORT = 8765
IBKR_HOST = "127.0.0.1"
IBKR_PORT = 4002
IBKR_CLIENT_ID = 41
PAPER_PORTS = frozenset({4002})
LIVE_PORTS = frozenset({4001, 7496})


class BridgeError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass(frozen=True)
class PaperContext:
    environment: str
    host: str
    port: int
    client_id: int


def validate_context(payload: dict[str, Any]) -> PaperContext:
    environment = str(payload.get("environment", "")).upper()
    host = str(payload.get("host", ""))
    try:
        port = int(payload.get("port", 0))
        client_id = int(payload.get("clientId", -1))
    except (TypeError, ValueError) as error:
        raise BridgeError(400, "INVALID_CONTEXT", "Invalid IBKR connection context.") from error

    if environment != "PAPER":
        raise BridgeError(423, "LIVE_TRADING_LOCKED", "Only the PAPER environment is permitted.")
    if port in LIVE_PORTS or port not in PAPER_PORTS:
        raise BridgeError(423, "LIVE_TRADING_LOCKED", "This bridge permits only IB Gateway PAPER port 4002.")
    if host != IBKR_HOST:
        raise BridgeError(400, "INVALID_HOST", "IBKR host must be 127.0.0.1.")
    if client_id != IBKR_CLIENT_ID:
        raise BridgeError(400, "INVALID_CLIENT_ID", "IBKR client ID must be 41.")
    return PaperContext(environment, host, port, client_id)


def validate_order(payload: dict[str, Any]) -> None:
    if str(payload.get("mode", "")).upper() != "PAPER":
        raise BridgeError(423, "LIVE_TRADING_LOCKED", "Only PAPER orders are permitted.")
    if payload.get("confirmed") is not True:
        raise BridgeError(400, "PAPER_CONFIRMATION_REQUIRED", "Paper confirmation is required.")
    if str(payload.get("direction", "")).upper() not in {"BUY", "SELL"}:
        raise BridgeError(400, "INVALID_ORDER", "Direction must be BUY or SELL.")
    order_type = str(payload.get("type", "")).upper()
    if order_type not in {"MARKET", "LIMIT"}:
        raise BridgeError(400, "INVALID_ORDER", "Only MARKET and LIMIT orders are supported.")
    try:
        quantity = float(payload.get("quantity", 0))
        limit_price = float(payload.get("limitPrice", 0) or 0)
    except (TypeError, ValueError) as error:
        raise BridgeError(400, "INVALID_ORDER", "Order quantity or price is invalid.") from error
    if quantity <= 0:
        raise BridgeError(400, "INVALID_ORDER", "Quantity must be positive.")
    if order_type == "LIMIT" and limit_price <= 0:
        raise BridgeError(400, "INVALID_ORDER", "A positive limit price is required.")
