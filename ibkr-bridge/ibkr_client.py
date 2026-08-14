"""Official IBKR TWS API client normalized to the bridge contract."""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from ibapi.client import EClient
from ibapi.contract import Contract
from ibapi.execution import ExecutionFilter
from ibapi.order import Order
from ibapi.wrapper import EWrapper

from safety import BridgeError, IBKR_CLIENT_ID, IBKR_HOST, IBKR_PORT
from market_data import (
    DELAYED_UNAVAILABLE_ERROR_CODES,
    REALTIME_SUBSCRIPTION_ERROR_CODES,
    RealtimeSubscriptionUnavailable,
    quote_with_delayed_fallback,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def number(value: Any) -> float:
    try:
        result = float(value)
        return result if math.isfinite(result) else 0.0
    except (TypeError, ValueError):
        return 0.0


def mask_account(account: str) -> str:
    if len(account) <= 4:
        return "****"
    return f"****{account[-4:]}"


def stock_contract(payload: dict[str, Any]) -> Contract:
    symbol = str(payload.get("symbol", "")).strip().upper()
    if not symbol or not symbol.replace(".", "").replace("-", "").isalnum():
        raise BridgeError(400, "INVALID_SYMBOL", "A valid stock symbol is required.")
    contract = Contract()
    contract.symbol = symbol
    contract.secType = "STK"
    contract.exchange = "SMART"
    contract.currency = str(payload.get("currency", "USD")).strip().upper() or "USD"
    return contract


@dataclass
class Pending:
    event: threading.Event = field(default_factory=threading.Event)
    items: list[Any] = field(default_factory=list)
    values: dict[str, Any] = field(default_factory=dict)
    error: BridgeError | None = None
    market_data_type: int | None = None


class IBKRClient(EWrapper, EClient):
    def __init__(self) -> None:
        EWrapper.__init__(self)
        EClient.__init__(self, self)
        self.ready = threading.Event()
        self._connect_lock = threading.Lock()
        self._operation_lock = threading.Lock()
        self._market_data_lock = threading.Lock()
        self._pending_lock = threading.Lock()
        self._id_lock = threading.Lock()
        self._pending: dict[str, Pending] = {}
        self._request_id = 1000
        self._next_order_id: int | None = None
        self._thread: threading.Thread | None = None
        self._account = ""
        self._last_error = ""
        self._last_sync: str | None = None

    def start(self, timeout: float = 6.0) -> None:
        with self._connect_lock:
            if self.isConnected() and self.ready.is_set():
                return
            self.ready.clear()
            try:
                self.connect(IBKR_HOST, IBKR_PORT, clientId=IBKR_CLIENT_ID)
            except Exception as error:
                raise BridgeError(503, "GATEWAY_UNAVAILABLE", "IB Gateway PAPER is unavailable.") from error
            self._thread = threading.Thread(target=self.run, name="ibkr-api-reader", daemon=True)
            self._thread.start()
        if not self.ready.wait(timeout):
            self.disconnect()
            raise BridgeError(503, "DISCONNECTED_SESSION", "IB Gateway PAPER handshake timed out.")

    def stop(self) -> None:
        if self.isConnected():
            self.disconnect()
        self.ready.clear()

    def _connected(self) -> None:
        if not self.isConnected() or not self.ready.is_set():
            self.start()

    def _new_id(self) -> int:
        with self._id_lock:
            self._request_id += 1
            return self._request_id

    def _new_order_id(self) -> int:
        with self._id_lock:
            if self._next_order_id is None:
                raise BridgeError(503, "DISCONNECTED_SESSION", "IBKR order ID is unavailable.")
            value = self._next_order_id
            self._next_order_id += 1
            return value

    def _create(self, key: str, market_data_type: int | None = None) -> Pending:
        pending = Pending(market_data_type=market_data_type)
        with self._pending_lock:
            self._pending[key] = pending
        return pending

    def _get(self, key: str) -> Pending | None:
        with self._pending_lock:
            return self._pending.get(key)

    def _finish(self, key: str) -> None:
        pending = self._get(key)
        if pending:
            pending.event.set()

    def _wait(self, key: str, pending: Pending, timeout: float = 12.0) -> Pending:
        if not pending.event.wait(timeout):
            with self._pending_lock:
                self._pending.pop(key, None)
            raise BridgeError(504, "TIMEOUT", "IBKR PAPER request timed out.")
        with self._pending_lock:
            self._pending.pop(key, None)
        if pending.error:
            raise pending.error
        self._last_sync = utc_now()
        return pending

    # Connection callbacks
    def nextValidId(self, orderId: int) -> None:  # noqa: N802 - official callback name
        self._next_order_id = orderId
        self.ready.set()

    def managedAccounts(self, accountsList: str) -> None:  # noqa: N802
        self._account = accountsList.split(",")[0] if accountsList else ""

    def connectionClosed(self) -> None:  # noqa: N802
        self.ready.clear()
        self._fail_all(BridgeError(503, "DISCONNECTED_SESSION", "IBKR PAPER session disconnected."))

    def error(self, reqId: int, *args: Any) -> None:  # noqa: N802
        # API 10.33 added errorTime after reqId. Accept both official forms:
        # (reqId, code, message, advancedReject) and
        # (reqId, errorTime, code, message, advancedReject).
        if len(args) >= 3 and isinstance(args[0], (int, float)) and args[0] > 100_000_000:
            errorCode = int(args[1])
            errorString = str(args[2])
        elif len(args) >= 2:
            errorCode = int(args[0])
            errorString = str(args[1])
        else:
            errorCode = -1
            errorString = "Unknown IBKR error."
        # Informational farm/connectivity notifications are not request failures.
        if errorCode in {2104, 2106, 2107, 2108, 2158}:
            return
        self._last_error = f"{errorCode}: {errorString}"
        message = errorString.lower()
        request_pending = self._get(f"request:{reqId}")
        if errorCode in REALTIME_SUBSCRIPTION_ERROR_CODES:
            # Some Gateway versions repeat 10089 while a type-3 snapshot is
            # transitioning to delayed ticks. It is terminal for the original
            # live request, but the fresh delayed request must remain open for
            # tick IDs 66-76 and tickSnapshotEnd.
            if request_pending and request_pending.market_data_type == 3:
                request_pending.values["subscriptionWarning"] = errorCode
                return
            error = RealtimeSubscriptionUnavailable()
        elif errorCode in DELAYED_UNAVAILABLE_ERROR_CODES:
            error = BridgeError(
                400,
                "DELAYED_MARKET_DATA_UNAVAILABLE",
                "IBKR delayed market data is unavailable for this instrument.",
            )
        elif errorCode in {100, 101, 420}:
            error = BridgeError(429, "RATE_LIMIT", "IBKR API pacing limit reached.")
        elif errorCode == 201:
            error = BridgeError(400, "ORDER_REJECTED", errorString)
        elif "auth" in message or "login" in message:
            error = BridgeError(401, "AUTHENTICATION_REQUIRED", "IB Gateway PAPER authentication is required.")
        elif errorCode in {502, 504, 1100, 1300}:
            error = BridgeError(503, "GATEWAY_UNAVAILABLE", "IB Gateway PAPER is unavailable.")
        else:
            error = BridgeError(400, "IBKR_ERROR", f"IBKR rejected the request ({errorCode}).")
        keys = [f"request:{reqId}", f"order:{reqId}", f"cancel:{reqId}"]
        delivered = False
        for key in keys:
            pending = self._get(key)
            if pending:
                pending.error = error
                pending.event.set()
                delivered = True
        if not delivered and error.status >= 500:
            self._fail_all(error)

    def _fail_all(self, error: BridgeError) -> None:
        with self._pending_lock:
            pending_items = list(self._pending.values())
        for pending in pending_items:
            pending.error = error
            pending.event.set()

    # Account summary
    def account_summary(self) -> dict[str, Any]:
        self._connected()
        with self._operation_lock:
            request_id = self._new_id()
            key = f"request:{request_id}"
            pending = self._create(key)
            self.reqAccountSummary(request_id, "All", "NetLiquidation,TotalCashValue,AvailableFunds,BuyingPower")
            result = self._wait(key, pending)
            self.cancelAccountSummary(request_id)
        values = result.values
        return {
            "accountIdMasked": mask_account(str(values.get("account", self._account))),
            "balance": values.get("TotalCashValue"),
            "netLiquidation": values.get("NetLiquidation"),
            "availableCash": values.get("AvailableFunds"),
            "buyingPower": values.get("BuyingPower"),
            "currency": values.get("currency", "USD"),
            "status": "PAPER_CONNECTED",
            "lastSuccessfulSync": self._last_sync or utc_now(),
            "lastError": self._last_error or None,
        }

    def accountSummary(self, reqId: int, account: str, tag: str, value: str, currency: str) -> None:  # noqa: N802
        pending = self._get(f"request:{reqId}")
        if pending:
            pending.values[tag] = number(value)
            pending.values["currency"] = currency or pending.values.get("currency", "USD")
            pending.values["account"] = account

    def accountSummaryEnd(self, reqId: int) -> None:  # noqa: N802
        self._finish(f"request:{reqId}")

    # Positions
    def positions(self) -> list[dict[str, Any]]:
        self._connected()
        with self._operation_lock:
            if self._account:
                pending = self._create("portfolio")
                self.reqAccountUpdates(True, self._account)
                result = self._wait("portfolio", pending)
                self.reqAccountUpdates(False, self._account)
                return result.items
            pending = self._create("positions")
            self.reqPositions()
            result = self._wait("positions", pending)
            self.cancelPositions()
        return result.items

    def updatePortfolio(self, contract: Contract, position: Decimal, marketPrice: float, marketValue: float, averageCost: float, unrealizedPNL: float, realizedPNL: float, accountName: str) -> None:  # noqa: N802
        pending = self._get("portfolio")
        quantity = number(position)
        if pending and quantity:
            pending.items.append({
                "id": f"ibkr-position:{contract.conId}",
                "symbol": contract.symbol,
                "direction": "BUY" if quantity > 0 else "SELL",
                "entryPrice": number(averageCost),
                "currentPrice": number(marketPrice),
                "investment": abs(number(marketValue)),
                "profitLoss": number(unrealizedPNL),
                "stopLoss": 0,
                "takeProfit": 0,
                "mode": "PAPER",
            })

    def accountDownloadEnd(self, accountName: str) -> None:  # noqa: N802
        if accountName == self._account:
            self._finish("portfolio")

    def position(self, account: str, contract: Contract, position: Decimal, avgCost: float) -> None:
        pending = self._get("positions")
        quantity = number(position)
        if pending and quantity:
            pending.items.append({
                "id": f"ibkr-position:{contract.conId}",
                "symbol": contract.symbol,
                "direction": "BUY" if quantity > 0 else "SELL",
                "entryPrice": number(avgCost),
                "currentPrice": number(avgCost),
                "investment": abs(quantity * number(avgCost)),
                "profitLoss": 0,
                "stopLoss": 0,
                "takeProfit": 0,
                "mode": "PAPER",
            })

    def positionEnd(self) -> None:  # noqa: N802
        self._finish("positions")

    # Orders
    def orders(self) -> list[dict[str, Any]]:
        self._connected()
        with self._operation_lock:
            pending = self._create("open_orders")
            self.reqOpenOrders()
            result = self._wait("open_orders", pending)
        return list(result.values.values())

    def openOrder(self, orderId: int, contract: Contract, order: Order, orderState: Any) -> None:  # noqa: N802
        item = {
            "id": str(orderId),
            "symbol": contract.symbol,
            "direction": str(order.action).upper(),
            "quantity": number(order.totalQuantity),
            "type": "LIMIT" if order.orderType == "LMT" else "MARKET",
            "status": self._order_status(getattr(orderState, "status", "SUBMITTED")),
            "submittedAt": utc_now(),
        }
        open_pending = self._get("open_orders")
        if open_pending:
            open_pending.values[str(orderId)] = item
        order_pending = self._get(f"order:{orderId}")
        if order_pending:
            order_pending.values.update(item)

    def openOrderEnd(self) -> None:  # noqa: N802
        self._finish("open_orders")

    def orderStatus(self, orderId: int, status: str, filled: Decimal, remaining: Decimal, avgFillPrice: float, permId: int, parentId: int, lastFillPrice: float, clientId: int, whyHeld: str, mktCapPrice: float) -> None:  # noqa: N802
        normalized = self._order_status(status)
        open_pending = self._get("open_orders")
        if open_pending and str(orderId) in open_pending.values:
            open_pending.values[str(orderId)]["status"] = normalized
        for prefix in ("order", "cancel"):
            pending = self._get(f"{prefix}:{orderId}")
            if pending:
                pending.values.update({"brokerOrderId": str(orderId), "status": normalized})
                if normalized in {"SUBMITTED", "ACCEPTED", "FILLED", "CANCELLED", "REJECTED"}:
                    pending.event.set()

    @staticmethod
    def _order_status(status: str) -> str:
        return {
            "PreSubmitted": "ACCEPTED",
            "Submitted": "SUBMITTED",
            "Filled": "FILLED",
            "Cancelled": "CANCELLED",
            "ApiCancelled": "CANCELLED",
            "Inactive": "REJECTED",
            "PendingSubmit": "SUBMITTED",
        }.get(status, "SUBMITTED")

    def place_order(self, payload: dict[str, Any]) -> dict[str, Any]:
        self._connected()
        order_id = self._new_order_id()
        contract = stock_contract(payload)
        order = Order()
        order.action = str(payload["direction"]).upper()
        order.totalQuantity = Decimal(str(payload["quantity"]))
        order.orderType = "LMT" if str(payload["type"]).upper() == "LIMIT" else "MKT"
        if order.orderType == "LMT":
            order.lmtPrice = number(payload.get("limitPrice"))
        order.transmit = True
        order.outsideRth = False
        order.orderRef = str(payload.get("clientOrderId", ""))[:90]
        key = f"order:{order_id}"
        pending = self._create(key)
        self.placeOrder(order_id, contract, order)
        result = self._wait(key, pending, timeout=20)
        status = result.values.get("status", "SUBMITTED")
        return {
            "brokerOrderId": str(order_id),
            "status": status,
            "message": f"IBKR PAPER order {status.lower()}.",
            "mode": "PAPER",
        }

    def cancel_order(self, order_id: str) -> dict[str, Any]:
        self._connected()
        try:
            numeric_id = int(order_id)
        except ValueError as error:
            raise BridgeError(400, "INVALID_ORDER_ID", "Order ID must be numeric.") from error
        key = f"cancel:{numeric_id}"
        pending = self._create(key)
        try:
            from ibapi.order_cancel import OrderCancel

            self.cancelOrder(numeric_id, OrderCancel())
        except (ImportError, TypeError):
            self.cancelOrder(numeric_id, "")
        result = self._wait(key, pending, timeout=15)
        return {
            "brokerOrderId": str(numeric_id),
            "status": result.values.get("status", "CANCELLED"),
            "message": "IBKR PAPER cancellation acknowledged.",
            "mode": "PAPER",
        }

    # Executions
    def executions(self) -> list[dict[str, Any]]:
        self._connected()
        request_id = self._new_id()
        key = f"request:{request_id}"
        pending = self._create(key)
        self.reqExecutions(request_id, ExecutionFilter())
        return self._wait(key, pending).items

    def execDetails(self, reqId: int, contract: Contract, execution: Any) -> None:  # noqa: N802
        pending = self._get(f"request:{reqId}")
        if pending:
            pending.items.append({
                "id": execution.execId,
                "orderId": str(execution.orderId),
                "symbol": contract.symbol,
                "quantity": number(execution.shares),
                "price": number(execution.price),
                "executedAt": execution.time or utc_now(),
            })

    def execDetailsEnd(self, reqId: int) -> None:  # noqa: N802
        self._finish(f"request:{reqId}")

    # Market data
    def quote(self, payload: dict[str, Any]) -> dict[str, Any]:
        self._connected()
        with self._market_data_lock:
            try:
                return quote_with_delayed_fallback(
                    lambda: self._request_quote(payload, market_data_type=1),
                    lambda: self._request_quote(payload, market_data_type=3),
                )
            finally:
                # reqMarketDataType is session-wide. Every subsequent quote must
                # again prefer live data, even after a delayed request fails.
                self.reqMarketDataType(1)

    def _request_quote(
        self, payload: dict[str, Any], market_data_type: int
    ) -> dict[str, Any]:
        request_id = self._new_id()
        key = f"request:{request_id}"
        pending = self._create(key, market_data_type=market_data_type)
        self.reqMarketDataType(market_data_type)
        try:
            self.reqMktData(request_id, stock_contract(payload), "", True, False, [])
            try:
                result = self._wait(key, pending, timeout=14)
            except BridgeError as error:
                if market_data_type == 3 and error.code == "TIMEOUT":
                    raise BridgeError(
                        504,
                        "DELAYED_MARKET_DATA_UNAVAILABLE",
                        "IBKR delayed market data did not return a quote.",
                    ) from error
                raise
        finally:
            self.cancelMktData(request_id)
        bid = result.values.get("bid", 0)
        ask = result.values.get("ask", 0)
        last = result.values.get("last") or result.values.get("close") or 0
        if last <= 0:
            raise BridgeError(400, "MARKET_DATA_UNAVAILABLE", "No valid IBKR quote was returned.")
        return {
            "assetId": str(payload.get("symbol", "")).lower(),
            "bid": bid,
            "ask": ask,
            "last": last,
            "asOf": utc_now(),
            "source": (
                "IBKR_TWS_PAPER_DELAYED"
                if market_data_type == 3
                else "IBKR_TWS_PAPER_REALTIME"
            ),
            "isDemo": False,
            "isDelayed": market_data_type == 3,
        }

    def tickPrice(self, reqId: int, tickType: int, price: float, attrib: Any) -> None:  # noqa: N802
        pending = self._get(f"request:{reqId}")
        if not pending or price <= 0:
            return
        field = {1: "bid", 2: "ask", 4: "last", 9: "close", 66: "bid", 67: "ask", 68: "last", 75: "close"}.get(tickType)
        if field:
            pending.values[field] = number(price)

    def tickSnapshotEnd(self, reqId: int) -> None:  # noqa: N802
        self._finish(f"request:{reqId}")

    def history(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        self._connected()
        request_id = self._new_id()
        key = f"request:{request_id}"
        pending = self._create(key)
        self.reqHistoricalData(
            request_id,
            stock_contract(payload),
            "",
            str(payload.get("duration", "2 M")),
            str(payload.get("barSize", "1 day")),
            "TRADES",
            1,
            2,
            False,
            [],
        )
        result = self._wait(key, pending, timeout=20)
        self.cancelHistoricalData(request_id)
        return result.items

    def historicalData(self, reqId: int, bar: Any) -> None:  # noqa: N802
        pending = self._get(f"request:{reqId}")
        if pending:
            pending.items.append({
                "time": str(bar.date),
                "open": number(bar.open),
                "high": number(bar.high),
                "low": number(bar.low),
                "close": number(bar.close),
                "volume": number(bar.volume),
            })

    def historicalDataEnd(self, reqId: int, start: str, end: str) -> None:  # noqa: N802
        self._finish(f"request:{reqId}")
