"""Regression coverage for the real TWS callback sequence around error 10089."""

from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path

BRIDGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BRIDGE_ROOT))


def install_ibapi_test_double() -> None:
    """Provide only the official class surface when the owner API is absent."""

    try:
        __import__("ibapi.client")
        return
    except ModuleNotFoundError:
        pass

    package = types.ModuleType("ibapi")

    class EWrapper:
        def __init__(self):
            pass

    class EClient:
        def __init__(self, wrapper):
            self.wrapper = wrapper

        def isConnected(self):  # noqa: N802
            return True

    class Contract:
        pass

    class ExecutionFilter:
        pass

    class Order:
        pass

    modules = {
        "ibapi": package,
        "ibapi.client": types.ModuleType("ibapi.client"),
        "ibapi.contract": types.ModuleType("ibapi.contract"),
        "ibapi.execution": types.ModuleType("ibapi.execution"),
        "ibapi.order": types.ModuleType("ibapi.order"),
        "ibapi.wrapper": types.ModuleType("ibapi.wrapper"),
    }
    modules["ibapi.client"].EClient = EClient
    modules["ibapi.contract"].Contract = Contract
    modules["ibapi.execution"].ExecutionFilter = ExecutionFilter
    modules["ibapi.order"].Order = Order
    modules["ibapi.wrapper"].EWrapper = EWrapper
    sys.modules.update(modules)


install_ibapi_test_double()

from ibkr_client import IBKRClient  # noqa: E402


class CallbackDrivenClient(IBKRClient):
    def __init__(self):
        super().__init__()
        self.market_data_types: list[int] = []
        self.market_requests: list[tuple[int, int]] = []
        self.cancelled_requests: list[int] = []
        self.current_market_data_type = 1

    def _connected(self):
        return

    def reqMarketDataType(self, market_data_type):  # noqa: N802
        self.current_market_data_type = market_data_type
        self.market_data_types.append(market_data_type)

    def reqMktData(self, request_id, contract, generic_ticks, snapshot, regulatory_snapshot, options):  # noqa: N802
        self.market_requests.append((request_id, self.current_market_data_type))
        if self.current_market_data_type == 1:
            self.error(
                request_id,
                10089,
                "Requested market data requires additional subscription for API. Delayed market data is available.",
            )
            return

        # Reproduce Gateways that repeat 10089 during the delayed transition,
        # followed by official delayed bid/ask/last tick IDs.
        self.error(
            request_id,
            10089,
            "Requested market data requires additional subscription for API. Delayed market data is available.",
        )
        self.tickPrice(request_id, 66, 99.0, None)
        self.tickPrice(request_id, 67, 101.0, None)
        self.tickPrice(request_id, 68, 100.0, None)
        self.tickSnapshotEnd(request_id)

    def cancelMktData(self, request_id):  # noqa: N802
        self.cancelled_requests.append(request_id)


class ExactDelayedRetryRegressionTests(unittest.TestCase):
    def test_10089_cancels_live_and_retries_fresh_id_for_delayed_ticks(self):
        client = CallbackDrivenClient()

        result = client.quote({"symbol": "AAPL", "currency": "USD"})

        self.assertEqual(client.market_requests, [(1001, 1), (1002, 3)])
        self.assertEqual(client.cancelled_requests, [1001, 1002])
        self.assertEqual(client.market_data_types, [1, 3, 1])
        self.assertEqual((result["bid"], result["ask"], result["last"]), (99.0, 101.0, 100.0))
        self.assertTrue(result["isDelayed"])
        self.assertEqual(result["source"], "IBKR_TWS_PAPER_DELAYED")


if __name__ == "__main__":
    unittest.main()
