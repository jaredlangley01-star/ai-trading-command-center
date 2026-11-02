"""Conservative validation of a read-only Alpaca Paper account snapshot.

This verifies broker data completeness and internal arithmetic only. It does not
reconcile the broker account against the simulator ledger or approve trading.
"""
import math


def _number(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def build_broker_reconciliation(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get("mode") != "ALPACA_PAPER":
        return {"status": "BLOCKED", "reason": "BROKER_SNAPSHOT_UNAVAILABLE", "read_only": True}
    account = snapshot.get("account")
    positions = snapshot.get("positions")
    orders = snapshot.get("open_orders")
    if not isinstance(account, dict) or not isinstance(positions, list) or not isinstance(orders, list):
        return {"status": "BLOCKED", "reason": "BROKER_SNAPSHOT_INCOMPLETE", "read_only": True}
    cash = _number(account.get("cash"))
    equity = _number(account.get("equity"))
    buying_power = _number(account.get("buying_power"))
    portfolio_value = _number(account.get("portfolio_value"))
    flags_clear = account.get("trading_blocked") is False and account.get("account_blocked") is False
    account_valid = (
        account.get("status") == "ACTIVE"
        and account.get("currency") == "USD"
        and cash is not None and equity is not None and buying_power is not None
        and portfolio_value is not None and flags_clear
        and min(cash, equity, buying_power, portfolio_value) >= 0
    )
    symbols = []
    position_values = []
    positions_valid = True
    for position in positions:
        symbol = position.get("symbol") if isinstance(position, dict) else None
        market_value = _number(position.get("market_value")) if isinstance(position, dict) else None
        quantity = _number(position.get("qty")) if isinstance(position, dict) else None
        if not isinstance(symbol, str) or not symbol or symbol in symbols or market_value is None or quantity is None:
            positions_valid = False
            continue
        symbols.append(symbol)
        position_values.append(abs(market_value))
    open_orders_valid = all(
        isinstance(order, dict) and isinstance(order.get("id"), str) and bool(order.get("id"))
        for order in orders
    )
    checks = {
        "paper_account": True,
        "account_fields_valid": account_valid,
        "positions_complete": positions_valid,
        "open_orders_complete": open_orders_valid,
        "account_unblocked": flags_clear,
    }
    verified = all(checks.values())
    return {
        "status": "BROKER_DATA_VERIFIED" if verified else "BLOCKED",
        "reason": "READ_ONLY_BROKER_SNAPSHOT_VALIDATED" if verified else "BROKER_DATA_VALIDATION_FAILED",
        "mode": "ALPACA_PAPER",
        "currency": account.get("currency"),
        "account_status": account.get("status"),
        "cash": cash,
        "equity": equity,
        "buying_power": buying_power,
        "portfolio_value": portfolio_value,
        "position_count": len(positions),
        "gross_position_market_value": round(sum(position_values), 2) if positions_valid else None,
        "open_order_count": len(orders),
        "checks": checks,
        "risk_approval_enabled": False,
        "execution_enabled": False,
        "read_only": True,
        "note": "Broker data validation only. This is not simulator-ledger reconciliation, a risk approval, or a trading instruction.",
    }
