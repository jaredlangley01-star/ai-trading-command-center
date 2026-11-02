"""Transparent baseline signal evaluators; not evidence of profitability."""
from dataclasses import dataclass
from statistics import fmean
from .models import MarketSnapshot, Side

@dataclass(frozen=True)
class Signal:
    symbol: str
    strategy: str
    side: Side | None
    score: float
    reason: str

def make(snapshot, name, side, score, reason): return Signal(snapshot.symbol, name, side, max(0.0,min(100.0,score)), reason)
def trend(snapshot, closes):
    if len(closes)<20 or any(x<=0 for x in closes): return make(snapshot,"TREND",None,0,"INSUFFICIENT_VALID_HISTORY")
    fast,slow=fmean(closes[-5:]),fmean(closes[-20:]); side=Side.BUY if fast>slow else Side.SELL if fast<slow else None
    return make(snapshot,"TREND",side,abs(fast-slow)/slow*10000,"FAST_SLOW_AVERAGE_ALIGNMENT")
def momentum(snapshot, closes):
    if len(closes)<6 or closes[-6]<=0: return make(snapshot,"MOMENTUM",None,0,"INSUFFICIENT_VALID_HISTORY")
    change=(closes[-1]/closes[-6]-1)*100; side=Side.BUY if change>0 else Side.SELL if change<0 else None
    return make(snapshot,"MOMENTUM",side,abs(change)*10,"FIVE_PERIOD_PRICE_CHANGE")
def breakout(snapshot, closes):
    if len(closes)<21: return make(snapshot,"BREAKOUT",None,0,"INSUFFICIENT_VALID_HISTORY")
    prior=closes[-21:-1]; hi,lo=max(prior),min(prior); side=Side.BUY if snapshot.price>hi else Side.SELL if snapshot.price<lo else None
    return make(snapshot,"BREAKOUT",side,75 if side else 0,"BREAK_OF_PRIOR_TWENTY_PERIOD_RANGE")
def mean_reversion(snapshot, closes):
    if len(closes)<20 or any(x<=0 for x in closes[-20:]): return make(snapshot,"MEAN_REVERSION",None,0,"INSUFFICIENT_VALID_HISTORY")
    deviation=(snapshot.price/fmean(closes[-20:])-1)*100; side=Side.BUY if deviation < -1 else Side.SELL if deviation > 1 else None
    return make(snapshot,"MEAN_REVERSION",side,abs(deviation)*20,"DISTANCE_FROM_TWENTY_PERIOD_MEAN")
