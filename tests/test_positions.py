import pytest
from trading_engine.storage import SQLiteStore
from trading_engine.positions import PositionLedger, PositionMonitoringAgent

def fill(**changes):
    data={"order_id":"SIM-000001","symbol":"AAPL","side":"BUY","quantity":2,"fill_price":100.0,"status":"SIMULATED_FILLED","simulated":True}
    data.update(changes); return data

def setup():
    store=SQLiteStore(":memory:")
    ledger=PositionLedger(store)
    return store,ledger,PositionMonitoringAgent(ledger)

def test_open_mark_and_close_position_records_realized_pnl():
    store,ledger,monitor=setup()
    p=ledger.open_from_fill(fill(),95,110,"TREND")
    assert p.status=="OPEN"
    monitor.process_mark(p.position_id,105)
    closed=monitor.process_mark(p.position_id,111)
    assert closed.status=="CLOSED"
    assert closed.realized_pnl==22
    assert closed.exit_reason=="TAKE_PROFIT"
    assert ledger.list_open()==[]

def test_stop_loss_closes_position():
    _,ledger,monitor=setup()
    p=ledger.open_from_fill(fill(),95,110,"TREND")
    closed=monitor.process_mark(p.position_id,94)
    assert closed.status=="CLOSED"
    assert closed.realized_pnl==-12
    assert closed.exit_reason=="STOP_LOSS"

def test_end_of_day_closes_at_supplied_mark():
    _,ledger,monitor=setup()
    p=ledger.open_from_fill(fill(),95,110,"TREND")
    closed=monitor.process_mark(p.position_id,101,end_of_day=True)
    assert closed.exit_reason=="END_OF_DAY"
    assert closed.realized_pnl==2

def test_duplicate_close_does_not_realize_twice():
    _,ledger,_=setup()
    p=ledger.open_from_fill(fill(),95,110,"TREND")
    first=ledger.close(p.position_id,105,"MANUAL")
    second=ledger.close(p.position_id,90,"MANUAL")
    assert first.realized_pnl==second.realized_pnl==10

def test_rejects_non_simulated_fill():
    _,ledger,_=setup()
    with pytest.raises(PermissionError):
        ledger.open_from_fill(fill(simulated=False),95,110,"TREND")
