"""Event-backed position ledger and deterministic exit checks for simulated fills."""
from dataclasses import dataclass
from datetime import datetime, timezone
from .models import Side
from .storage import SQLiteStore

@dataclass(frozen=True)
class Position:
    position_id: str
    symbol: str
    side: str
    quantity: int
    entry_price: float
    stop_loss: float
    take_profit: float
    strategy: str
    opened_at: str
    status: str = "OPEN"
    last_price: float | None = None
    realized_pnl: float = 0.0
    exit_reason: str | None = None
    exit_price: float | None = None
    closed_at: str | None = None

class PositionLedger:
    def __init__(self, store: SQLiteStore):
        self.store=store

    def _events(self):
        return list(reversed(self.store.list_events(100000)))

    def get(self, position_id: str):
        current=None
        for event in self._events():
            payload=event["payload"]
            if payload.get("position_id") != position_id: continue
            if event["event_type"]=="POSITION_OPENED": current=payload
            elif event["event_type"]=="POSITION_MARKED" and current and current["status"]=="OPEN":
                current={**current,"last_price":payload["price"]}
            elif event["event_type"]=="POSITION_CLOSED" and current:
                current={**current,"status":"CLOSED","realized_pnl":payload["realized_pnl"],"closed_at":payload["closed_at"],"exit_price":payload["exit_price"],"exit_reason":payload["reason"]}
        return Position(**{k:v for k,v in current.items() if k in Position.__dataclass_fields__}) if current else None

    def list_open(self):
        opened={}
        for event in self._events():
            p=event["payload"]; pid=p.get("position_id")
            if not pid: continue
            if event["event_type"]=="POSITION_OPENED": opened[pid]=p
            elif event["event_type"]=="POSITION_CLOSED": opened.pop(pid,None)
            elif event["event_type"]=="POSITION_MARKED" and pid in opened: opened[pid]={**opened[pid],"last_price":p["price"]}
        return [Position(**{k:v for k,v in p.items() if k in Position.__dataclass_fields__}) for p in opened.values()]

    def open_from_fill(self, fill: dict, stop_loss: float, take_profit: float, strategy: str):
        if not fill.get("simulated") or fill.get("status")!="SIMULATED_FILLED":
            raise PermissionError("SIMULATED_FILL_REQUIRED")
        pid=fill["order_id"]
        existing=self.get(pid)
        if existing: return existing
        entry=float(fill["fill_price"]); qty=int(fill["quantity"]); side=fill["side"]
        if qty<1 or entry<=0 or stop_loss<=0 or take_profit<=0: raise ValueError("INVALID_POSITION_PARAMETERS")
        if side=="BUY" and not stop_loss<entry<take_profit: raise ValueError("INVALID_LONG_STOPS")
        if side=="SELL" and not take_profit<entry<stop_loss: raise ValueError("INVALID_SHORT_STOPS")
        payload={"position_id":pid,"symbol":fill["symbol"],"side":side,"quantity":qty,"entry_price":entry,
                 "stop_loss":float(stop_loss),"take_profit":float(take_profit),"strategy":strategy,
                 "opened_at":datetime.now(timezone.utc).isoformat(),"status":"OPEN","last_price":entry,"realized_pnl":0.0}
        if not self.store.append_event("POSITION_OPENED",payload,event_key=f"position-open:{pid}"):
            existing=self.get(pid)
            if existing: return existing
            raise RuntimeError("POSITION_OPEN_EVENT_CONFLICT")
        return Position(**payload)

    def mark(self, position_id: str, price: float):
        if price<=0: raise ValueError("INVALID_MARK_PRICE")
        position=self.get(position_id)
        if not position or position.status!="OPEN": raise ValueError("POSITION_NOT_OPEN")
        self.store.append_event("POSITION_MARKED",{"position_id":position_id,"price":float(price),"marked_at":datetime.now(timezone.utc).isoformat()})
        return self.get(position_id)

    def close(self, position_id: str, price: float, reason: str):
        if price<=0: raise ValueError("INVALID_EXIT_PRICE")
        position=self.get(position_id)
        if not position: raise KeyError("POSITION_NOT_FOUND")
        if position.status=="CLOSED": return position
        direction=1 if position.side=="BUY" else -1
        pnl=(price-position.entry_price)*position.quantity*direction
        payload={"position_id":position_id,"exit_price":float(price),"realized_pnl":round(pnl,8),
                 "reason":reason,"closed_at":datetime.now(timezone.utc).isoformat()}
        if not self.store.append_event("POSITION_CLOSED",payload,event_key=f"position-close:{position_id}"):
            return self.get(position_id)
        return self.get(position_id)

class PositionMonitoringAgent:
    def __init__(self, ledger: PositionLedger): self.ledger=ledger
    def evaluate(self, position: Position, price: float, end_of_day: bool=False):
        if position.status!="OPEN": return None
        if end_of_day: return "END_OF_DAY"
        if position.side=="BUY":
            if price<=position.stop_loss: return "STOP_LOSS"
            if price>=position.take_profit: return "TAKE_PROFIT"
        else:
            if price>=position.stop_loss: return "STOP_LOSS"
            if price<=position.take_profit: return "TAKE_PROFIT"
        return None
    def process_mark(self, position_id: str, price: float, end_of_day: bool=False):
        position=self.ledger.get(position_id)
        if not position or position.status!="OPEN": return position
        reason=self.evaluate(position,price,end_of_day)
        if reason: return self.ledger.close(position_id,price,reason)
        return self.ledger.mark(position_id,price)
