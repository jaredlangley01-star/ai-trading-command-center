from datetime import datetime, timezone
import pytest
from trading_engine.broker import SimulatedPaperBroker
from trading_engine.execution import PaperExecutionGateway
from trading_engine.models import Side, TradeProposal
from trading_engine.risk import RiskContext, RiskManager
from trading_engine.storage import SQLiteStore

def make_proposal(**changes):
    values=dict(symbol="AAPL",side=Side.BUY,entry=100.0,stop_loss=99.0,take_profit=102.0,quantity=2,strategy="TREND",created_at=datetime.now(timezone.utc))
    values.update(changes)
    return TradeProposal(**values)

def gateway():
    store=SQLiteStore(":memory:")
    broker=SimulatedPaperBroker(1000)
    return PaperExecutionGateway(broker,RiskManager(),store),broker,store

def test_paper_gateway_records_simulated_fill_and_prevents_duplicate():
    gate,broker,store=gateway()
    first=gate.submit(make_proposal(),RiskContext(),"test-order-1")
    second=gate.submit(make_proposal(),RiskContext(),"test-order-1")
    assert first==second
    assert len(broker.list_fills())==1
    assert len([e for e in store.list_events() if e["event_type"]=="ORDER_FILLED"])==1

def test_risk_rejection_never_reaches_broker():
    gate,broker,_=gateway()
    with pytest.raises(PermissionError,match="RISK_REJECTED"):
        gate.submit(make_proposal(mode="LIVE"),RiskContext(),"bad-mode")
    assert broker.list_fills()==[]

def test_live_context_is_blocked_before_broker():
    gate,broker,_=gateway()
    with pytest.raises(PermissionError,match="PAPER_ONLY_GATE"):
        gate.submit(make_proposal(),RiskContext(paper_mode=False),"live-context")
    assert broker.list_fills()==[]
