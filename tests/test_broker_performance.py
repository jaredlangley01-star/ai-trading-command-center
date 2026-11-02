from trading_engine.broker_performance import build_broker_performance


def test_broker_performance_summarizes_fills_without_claiming_realized_pnl():
    result = build_broker_performance({
        "mode": "ALPACA_PAPER",
        "recent_orders": [
            {"symbol": "AAPL", "status": "filled", "filled_qty": "2", "filled_avg_price": "200"},
            {"symbol": "MSFT", "status": "partially_filled", "filled_qty": "1"},
            {"symbol": "NVDA", "status": "canceled", "filled_qty": "0"},
        ],
    })
    assert result["status"] == "AVAILABLE"
    assert result["orders_returned"] == 3
    assert result["filled_orders"] == 1
    assert result["partially_filled_orders"] == 1
    assert result["filled_quantity_total"] == 3
    assert result["symbols_with_fills"] == ["AAPL", "MSFT"]
    assert result["realized_pnl"] is None
    assert result["execution_enabled"] is False
    assert result["read_only"] is True


def test_broker_performance_fails_closed_for_non_paper_data():
    result = build_broker_performance({"mode": "LIVE", "recent_orders": []})
    assert result["status"] == "UNAVAILABLE"
    assert result["realized_pnl"] is None
    assert result["execution_enabled"] is False
