"use client";
import { useEffect, useMemo, useState } from "react";
import { useZarRate } from "./use-zar";
type Decision = { event_id:number; symbol:string; observed_at:string; market_price:number|null; market_source:string|null; strategy:string; signal:string; score:number; reason:string; execution_enabled:boolean; risk_status:string; risk_reason:string; proposed_quantity:number; estimated_loss:number; stop_loss:number|null; take_profit:number|null };
type Response = { status?:string; decisions?:Decision[]; error?:string };
const strategies=["ALL","TREND","MOMENTUM","BREAKOUT","MEAN_REVERSION"];
export default function DecisionHistory() {
  const fx=useZarRate("USD");
  const [decisions,setDecisions]=useState<Decision[]>([]);
  const [filter,setFilter]=useState("ALL");
  const [error,setError]=useState<string|null>(null);
  const [checked,setChecked]=useState<string|null>(null);
  useEffect(()=>{
    let active=true;
    async function refresh(){
      try{
        const response=await fetch("/api/small-trading/decisions",{cache:"no-store"});
        const data=await response.json() as Response;
        if(!response.ok) throw new Error(data.error??"DECISION_HISTORY_UNAVAILABLE");
        if(active){setDecisions(data.decisions??[]);setError(null);setChecked(new Date().toISOString());}
      }catch(e){if(active)setError(e instanceof Error?e.message:"DECISION_HISTORY_UNAVAILABLE");}
    }
    void refresh(); const timer=window.setInterval(()=>void refresh(),10000);
    return ()=>{active=false;window.clearInterval(timer);};
  },[]);
  const filtered=useMemo(()=>filter==="ALL"?decisions:decisions.filter(d=>d.strategy===filter),[decisions,filter]);
  const counts=useMemo(()=>({
    total:decisions.length,
    signals:decisions.filter(d=>d.signal==="BUY"||d.signal==="SELL").length,
    noSignal:decisions.filter(d=>d.signal==="NO_SIGNAL").length,
  }),[decisions]);
  return <section className="st-card st-panel" id="decisions">
    <div className="st-panel-head"><div><h2>Strategy decision journal</h2><p>Every recorded strategy result, with its reason and market context</p></div><span className="st-tag">OBSERVATION ONLY</span></div>
    <div className="st-decision-summary">
      <div><small>Evaluations logged</small><b>{counts.total}</b></div>
      <div><small>Directional signals</small><b>{counts.signals}</b></div>
      <div><small>No signal</small><b>{counts.noSignal}</b></div>
    </div>
    <div className="st-decision-toolbar"><span>Filter strategy</span><select aria-label="Filter strategy decisions" value={filter} onChange={e=>setFilter(e.target.value)}>{strategies.map(s=><option key={s} value={s}>{s==="ALL"?"All strategies":s.replaceAll("_"," ")}</option>)}</select></div>
    {error?<div className="st-empty"><b>Decision journal not connected</b><p>{error}</p></div>:filtered.length===0?<div className="st-empty"><b>No strategy decisions recorded yet</b><p>Results will appear here after the worker completes market scans.</p></div>:
      <div className="st-decision-list">{filtered.slice(0,80).map((d,i)=><article className="st-decision-row" key={d.event_id+"-"+d.strategy+"-"+i}>
        <div className="st-decision-main"><div className="st-decision-title"><b>{d.symbol}</b><span>{d.strategy.replaceAll("_"," ")}</span><strong className={d.signal==="BUY"?"is-buy":d.signal==="SELL"?"is-sell":""}>{d.signal.replaceAll("_"," ")}</strong></div>
          <p>{d.reason.replaceAll("_"," ")}</p>{d.risk_status!=="NOT_APPLICABLE" && <p>Illustrative levels: stop $ {(d.stop_loss==null?"—":fx.format(d.stop_loss))} · target $ {(d.take_profit==null?"—":fx.format(d.take_profit))}</p>}<small>{d.observed_at?new Date(d.observed_at).toLocaleString():"Time unavailable"} · {d.market_source??"Unknown data source"}{typeof d.market_price==="number"?" · "+fx.format(d.market_price):""}</small>
          <div className="st-decision-meta"><span>Score {Number(d.score??0).toFixed(1)}</span><span>Risk: {d.risk_status.replaceAll("_"," ")}</span><span>{d.risk_reason.replaceAll("_"," ")}</span><span>Proposed qty: {d.proposed_quantity}</span><span>Est. risk: {fx.format(d.estimated_loss)}</span><span>No order submitted</span></div>
        </div>
      </article>)}</div>}
    <p className="st-live-footnote">Last checked: {checked?new Date(checked).toLocaleTimeString():"—"}. All USD amounts are converted to ZAR using the latest available rate. {fx.error ? "FX conversion unavailable." : ""} A BUY/SELL here is a strategy signal, not an approved trade recommendation. Preliminary risk reviews run, but candidates remain blocked until portfolio context is verified. No order execution is connected.</p>
  </section>;
}
