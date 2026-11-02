"""Read-only summary of broker-reported Paper order activity.

This deliberately does not estimate realized P&L from order averages. Correct
realized P&L requires fill-level lot matching and corporate-action handling.
"""
def build_broker_performance(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get("mode") != "ALPACA_PAPER":
        return {"status": "UNAVAILABLE", "source": "ALPACA_PAPER_ORDER_HISTORY", "realized_pnl": None, "execution_enabled": False, "read_only": True}
    orders = snapshot.get("recent_orders")
    if not isinstance(orders, list):
        return {"status": "UNAVAILABLE", "reason": "ORDER_HISTORY_UNAVAILABLE", "source": "ALPACA_PAPER_ORDER_HISTORY", "realized_pnl": None, "execution_enabled": False, "read_only": True}
    filled = [o for o in orders if isinstance(o, dict) and o.get("status") == "filled"]
    partial = [o for o in orders if isinstance(o, dict) and o.get("status") == "partially_filled"]
    symbols = sorted({str(o.get("symbol")).upper() for o in filled + partial if o.get("symbol")})
    filled_qty = 0.0
    for order in filled + partial:
        try:
            filled_qty += max(0.0, float(order.get("filled_qty") or 0))
        except (TypeError, ValueError):
            continue
    return {
        "status": "AVAILABLE",
        "mode": "ALPACA_PAPER",
        "source": "ALPACA_PAPER_ORDER_HISTORY",
        "orders_returned": len(orders),
        "filled_orders": len(filled),
        "partially_filled_orders": len(partial),
        "filled_quantity_total": round(filled_qty, 8),
        "symbols_with_fills": symbols,
        "realized_pnl": None,
        "realized_pnl_status": "NOT_CALCULATED_FILL_LEVEL_LOT_MATCHING_REQUIRED",
        "note": "Order history is limited to the broker response window. Realized P&L is intentionally not inferred from average order fills.",
        "execution_enabled": False,
        "read_only": True,
    }
