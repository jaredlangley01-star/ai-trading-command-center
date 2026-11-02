from datetime import datetime, timezone
from trading_engine.models import DecisionStatus, Side, TradeProposal
from trading_engine.risk import RiskContext, RiskLimits, RiskManager

def proposal(**changes):
    values=dict(symbol="AAPL",side=Side.BUY,entry=100.0,stop_loss=99.0,take_profit=102.0,quantity=5,strategy="TREND",created_at=datetime.now(timezone.utc))
    values.update(changes)
    return TradeProposal(**values)

def verified_context(**changes):
    values=dict(portfolio_context_verified=True, risk_limits_authorized=True)
    values.update(changes)
    return RiskContext(**values)

def test_approves_valid_paper_proposal_only_with_verified_context_and_authorized_limits():
    result=RiskManager().evaluate(proposal(),verified_context())
    assert result.status==DecisionStatus.APPROVED and result.approved_quantity==5 and result.estimated_loss==5

def test_rejects_non_paper_mode():
    assert RiskManager().evaluate(proposal(mode="LIVE"),verified_context(paper_mode=False)).reason=="PAPER_MODE_REQUIRED"

def test_emergency_stop_blocks_trade():
    assert RiskManager().evaluate(proposal(),verified_context(emergency_stop=True)).reason=="EMERGENCY_STOP_ACTIVE"

def test_daily_loss_limit_blocks_trade():
    assert RiskManager().evaluate(proposal(),verified_context(daily_realized_pnl=-25)).reason=="DAILY_LOSS_LIMIT_REACHED"

def test_rejects_proposed_size_above_risk_limit():
    result=RiskManager(RiskLimits(max_loss_per_trade=2)).evaluate(proposal(),verified_context())
    assert result.status==DecisionStatus.REJECTED and result.reason=="PROPOSED_SIZE_EXCEEDS_LIMITS"

def test_blocks_without_verified_portfolio_context():
    result=RiskManager().evaluate(proposal(),RiskContext(risk_limits_authorized=True))
    assert result.status==DecisionStatus.REJECTED and result.reason=="PORTFOLIO_CONTEXT_UNVERIFIED"

def test_blocks_until_risk_limits_are_authorized():
    result=RiskManager().evaluate(proposal(),RiskContext(portfolio_context_verified=True))
    assert result.status==DecisionStatus.REJECTED and result.reason=="RISK_LIMITS_NOT_AUTHORIZED"
