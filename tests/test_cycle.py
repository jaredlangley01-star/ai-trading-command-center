from trading_engine.market_data import InMemoryMarketDataProvider
from trading_engine.cycle import ObservationCycle

def test_observation_cycle_returns_four_strategy_signals():
    prices=[100+i*0.2 for i in range(25)]
    report=ObservationCycle(InMemoryMarketDataProvider({"AAPL":prices})).run_symbol("AAPL")
    assert report.status=="READY"
    assert len(report.signals)==4

def test_observation_cycle_blocks_missing_symbol():
    report=ObservationCycle(InMemoryMarketDataProvider({})).run_symbol("MSFT")
    assert report.status=="BLOCKED"
    assert report.message.startswith("DATA_UNAVAILABLE")
