"""Local simulator only. This is NOT a real broker connection or market fill."""
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import RLock
from .models import Side, TradeProposal

@dataclass(frozen=True)
class SimulatedFill:
    order_id: str
    client_order_id: str
    symbol: str
    side: str
    quantity: int
    fill_price: float
    status: str
    simulated: bool = True

class SimulatedPaperBroker:
    def __init__(self, starting_cash: float = 10_000.0):
        if starting_cash <= 0: raise ValueError("starting_cash must be positive")
        self._cash=starting_cash
        self._fills={}
        self._lock=RLock()

    @property
    def cash(self):
        with self._lock: return self._cash

    def submit(self, proposal: TradeProposal, client_order_id: str) -> SimulatedFill:
        if proposal.mode != "PAPER": raise PermissionError("PAPER_ONLY")
        if not client_order_id.strip(): raise ValueError("client_order_id required")
        with self._lock:
            if client_order_id in self._fills: return self._fills[client_order_id]
            gross=proposal.entry*proposal.quantity
            if proposal.side == Side.BUY and gross > self._cash:
                raise ValueError("INSUFFICIENT_SIMULATED_CASH")
            if proposal.side == Side.BUY: self._cash-=gross
            else: self._cash+=gross
            fill=SimulatedFill(
                order_id=f"SIM-{len(self._fills)+1:06d}",
                client_order_id=client_order_id,
                symbol=proposal.symbol.upper(), side=proposal.side.value,
                quantity=proposal.quantity, fill_price=proposal.entry,
                status="SIMULATED_FILLED")
            self._fills[client_order_id]=fill
            return fill

    def list_fills(self):
        with self._lock: return list(self._fills.values())
