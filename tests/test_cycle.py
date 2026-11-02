from trading_engine.market_data import InMemoryMarketDataProvider
from trading_engine.cycle import ObservationCycle

def test_observation_cycle_returns_four_strategy_signals():
    prices=[100+i*0.2 for i in range(25)]
    report=ObservationCycle(InMemoryMarketDataProvider({"AAPL":prices})).run_symbol("AAPL")
    assert report.status=="READY"
    assert len(report.signals)==4
    assert report.observed_price == prices[-1]
    assert report.market_source == "IN_MEMORY_FIXTURE"
    assert report.market_timestamp is not None

def test_observation_cycle_blocks_missing_symbol():
    report=ObservationCycle(InMemoryMarketDataProvider({})).run_symbol("MSFT")
    assert report.status=="BLOCKED"
    assert report.message.startswith("DATA_UNAVAILABLE")


def test_cycle_uses_one_consistent_observation_fetch():
    class SingleFetchProvider:
        def __init__(self):
            self.calls = 0
        def fetch_observation(self, symbol, limit):
            from datetime import datetime, timezone
            from trading_engine.models import MarketSnapshot
            self.calls += 1
            assert symbol == "AAPL"
            assert limit == 100
            return MarketSnapshot("AAPL", 106, datetime.now(timezone.utc), "TEST"), [100 + i * 0.2 for i in range(25)]
        def latest_snapshot(self, symbol):
            raise AssertionError("cycle should use atomic observation")
        def recent_closes(self, symbol, limit):
            raise AssertionError("cycle should use atomic observation")

    provider = SingleFetchProvider()
    report = ObservationCycle(provider).run_symbol("AAPL")
    assert provider.calls == 1
    assert report.status == "READY"
    assert report.observed_price == 106


def test_cycle_blocks_stale_market_data():
    from datetime import datetime, timedelta, timezone
    from trading_engine.models import MarketSnapshot

    class StaleProvider:
        def fetch_observation(self, symbol, limit):
            snapshot = MarketSnapshot(
                "AAPL", 100, datetime.now(timezone.utc) - timedelta(minutes=10), "TEST"
            )
            return snapshot, [100] * 25

    report = ObservationCycle(StaleProvider()).run_symbol("AAPL")
    assert report.status == "BLOCKED"
    assert report.message == "STALE_OR_INVALID_MARKET_DATA"
    assert report.signals == ()

def test_cycle_accepts_recent_alpaca_minute_bar_within_three_scan_intervals():
    from datetime import datetime, timedelta, timezone
    from trading_engine.models import MarketSnapshot

    class SlightlyDelayedProvider:
        def fetch_observation(self, symbol, limit):
            snapshot = MarketSnapshot(
                "AAPL", 100, datetime.now(timezone.utc) - timedelta(seconds=150), "ALPACA_IEX"
            )
            return snapshot, [100 + i * 0.1 for i in range(25)]

    report = ObservationCycle(SlightlyDelayedProvider()).run_symbol("AAPL")
    assert report.status == "READY"
    assert report.market_source == "ALPACA_IEX"
