"""Paper-only market data fallback policy, kept separate from order handling."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from safety import BridgeError


# IBKR documents 10089/10091 as API subscription errors. Older API/TWS
# combinations can report the equivalent condition as 354 or 10167.
REALTIME_SUBSCRIPTION_ERROR_CODES = frozenset({354, 10089, 10091, 10167})
DELAYED_UNAVAILABLE_ERROR_CODES = frozenset({10168, 10186})


class RealtimeSubscriptionUnavailable(BridgeError):
    """Signals that a quote may be retried with TWS delayed data type 3."""

    def __init__(self) -> None:
        super().__init__(
            400,
            "REALTIME_MARKET_DATA_UNAVAILABLE",
            "Real-time IBKR market data is unavailable; delayed data will be requested.",
        )


def quote_with_delayed_fallback(
    request_realtime: Callable[[], dict[str, Any]],
    request_delayed: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    """Prefer real-time and retry only subscription failures as delayed."""

    try:
        return request_realtime()
    except RealtimeSubscriptionUnavailable:
        return request_delayed()
