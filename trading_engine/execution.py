"""Only this gateway may call the simulated broker in this foundation."""
from dataclasses import asdict
from .broker import SimulatedPaperBroker
from .models import DecisionStatus, TradeProposal
from .risk import RiskContext, RiskManager
from .storage import SQLiteStore

class PaperExecutionGateway:
    def __init__(self, broker: SimulatedPaperBroker, risk: RiskManager, store: SQLiteStore):
        self.broker,self.risk,self.store=broker,risk,store

    def submit(self, proposal: TradeProposal, context: RiskContext, client_order_id: str):
        if proposal.mode != "PAPER" or not context.paper_mode:
            raise PermissionError("PAPER_ONLY_GATE")
        if not client_order_id or not client_order_id.strip():
            raise ValueError("CLIENT_ORDER_ID_REQUIRED")
        existing=[e for e in self.store.list_events(10000) if e["event_type"]=="ORDER_FILLED" and e["event_key"]==client_order_id]
        if existing: return existing[0]["payload"]
        decision=self.risk.evaluate(proposal,context)
        self.store.append_event("RISK_DECISION",{
            "symbol":proposal.symbol,"strategy":proposal.strategy,
            "status":decision.status.value,"reason":decision.reason,
            "requested_quantity":proposal.quantity,
            "approved_quantity":decision.approved_quantity,
            "estimated_loss":decision.estimated_loss,
        })
        if decision.status != DecisionStatus.APPROVED:
            raise PermissionError(f"RISK_REJECTED:{decision.reason}")
        fill=self.broker.submit(proposal,client_order_id)
        payload=asdict(fill)
        if not self.store.append_event("ORDER_FILLED",payload,event_key=client_order_id):
            raise RuntimeError("DUPLICATE_ORDER_EVENT")
        return payload
