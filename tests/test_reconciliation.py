from trading_engine.reconciliation import build_broker_reconciliation


def valid_snapshot():
    return {
        "mode": "ALPACA_PAPER",
        "account": {
            "status": "ACTIVE", "currency": "USD", "cash": "100000",
            "equity": "100000", "buying_power": "400000",
            "portfolio_value": "100000", "trading_blocked": False,
            "account_blocked": False,
        },
        "positions": [
            {"symbol": "AAPL", "qty": "2", "market_value": "400"},
        ],
        "open_orders": [],
        "read_only": True,
    }


def test_valid_paper_snapshot_is_verified_but_never_authorizes_trading():
    result = build_broker_reconciliation(valid_snapshot())
    assert result["status"] == "BROKER_DATA_VERIFIED"
    assert result["position_count"] == 1
    assert result["gross_position_market_value"] == 400
    assert result["open_order_count"] == 0
    assert result["risk_approval_enabled"] is False
    assert result["execution_enabled"] is False


def test_inactive_or_blocked_account_fails_validation():
    snapshot = valid_snapshot()
    snapshot["account"]["trading_blocked"] = True
    result = build_broker_reconciliation(snapshot)
    assert result["status"] == "BLOCKED"
    assert result["checks"]["account_unblocked"] is False
    assert result["risk_approval_enabled"] is False


def test_missing_open_orders_does_not_claim_complete_reconciliation():
    snapshot = valid_snapshot()
    snapshot.pop("open_orders")
    result = build_broker_reconciliation(snapshot)
    assert result["status"] == "BLOCKED"
    assert result["reason"] == "BROKER_SNAPSHOT_INCOMPLETE"


def test_invalid_or_duplicate_position_rows_block_validation():
    snapshot = valid_snapshot()
    snapshot["positions"].append({"symbol": "AAPL", "qty": "1", "market_value": "200"})
    result = build_broker_reconciliation(snapshot)
    assert result["status"] == "BLOCKED"
    assert result["checks"]["positions_complete"] is False


def test_non_paper_snapshot_is_rejected():
    result = build_broker_reconciliation({"mode": "LIVE"})
    assert result["status"] == "BLOCKED"
    assert result["reason"] == "BROKER_SNAPSHOT_UNAVAILABLE"
