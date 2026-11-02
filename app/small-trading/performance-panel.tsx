"use client";
import { useEffect, useState } from "react";
type BrokerPerformance = { status?:string; mode?:string; source?:string; orders_returned?:number; filled_orders?:number; partially_filled_orders?:number; filled_quantity_total?:number; symbols_with_fills?:string[]; realized_pnl?:number|null; realized_pnl_status?:string; note?:string; reason?:string; };\ntype Performance = {
  mode?:string; source?:string; closed_positions?:number; open_positions?:number;
  winning_positions?:number; losing_positions?:number; win_rate_percent?:number|null;
  realized_pnl?:number; gross_profit?:number; gross_loss?:number;
  execution_enabled?:boolean; reconciliation_status?:string;
};
export default function PerformancePanel(){
  const [data,setData]=useState<Performance|null>(null);\n  const [broker,setBroker]=useState<BrokerPerformance|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [checked,setChecked]=useState<string|null>(null);
  useEffect(()=>{
    let active=true;
    async function refresh(){
      try{
        const response=await fetch("/api/small-trading/performance",{cache:"no-store"});
        const payload=await response.json() as Performance;\n        const brokerResponse=await fetch("/api/small-trading/broker-performance",{cache:"no-store"});\n        const brokerPayload=await brokerResponse.json() as BrokerPerformance;
        if(!response.ok)throw new Error("PERFORMANCE_SUMMARY_UNAVAILABLE");
        if(active){setData(payload);setBroker(brokerPayload);setError(null);setChecked(new Date().toISOString());}
      }catch(e){if(active)setError(e instanceof Error?e.message:"PERFORMANCE_SUMMARY_UNAVAILABLE");}
    }
    void refresh();const timer=window.setInterval(()=>void refresh(),15000);
    return()=>{active=false;window.clearInterval(timer);};
  },[]);
  return <section className="st-card st-panel" id="performance">
    <div className="st-panel-head"><div><h2>Performance & Reporting</h2><p>Results calculated from the simulated position ledger only</p></div><span className="st-tag">SIMULATOR DATA</span></div>
    {error||!data?<div className="st-empty"><b>Performance data not connected</b><p>{error??"Waiting for the worker to record a performance snapshot."}</p></div>:
      <>
        <div className="st-decision-summary">
          <div><small>Closed positions</small><b>{data.closed_positions??0}</b></div>
          <div><small>Open positions</small><b>{data.open_positions??0}</b></div>
          <div><small>Win rate</small><b>{data.win_rate_percent===null||data.win_rate_percent===undefined?"—":data.win_rate_percent+"%"}</b></div>
        </div>
        <div className="st-decision-meta">
          <span>Realized P&amp;L: $ {Number(data.realized_pnl??0).toFixed(2)}</span>
          <span>Winners: {data.winning_positions??0}</span>
          <span>Losers: {data.losing_positions??0}</span>
          <span>Gross profit: $ {Number(data.gross_profit??0).toFixed(2)}</span>
          <span>Gross loss: $ {Number(data.gross_loss??0).toFixed(2)}</span>
        </div>
        <p className="st-live-footnote">Source: {data.source}. Reconciliation: {data.reconciliation_status}. This is not your Alpaca account P&amp;L and does not demonstrate profitability.</p>
      </>}
    <div className="st-divider" />\n    <div className="st-panel-head"><div><h2>Alpaca Paper performance activity</h2><p>Broker order history · separate from simulated ledger</p></div><span className="st-tag">{broker?.status??"CHECKING"}</span></div>\n    {broker?.status==="AVAILABLE" ? <><div className="st-decision-summary"><div><small>Orders returned</small><b>{broker.orders_returned??"—"}</b></div><div><small>Filled orders</small><b>{broker.filled_orders??"—"}</b></div><div><small>Partial fills</small><b>{broker.partially_filled_orders??"—"}</b></div></div><div className="st-decision-meta"><span>Filled quantity: {broker.filled_quantity_total??0}</span><span>Symbols: {broker.symbols_with_fills?.join(", ")||"None"}</span><span>Realized P&amp;L: Not calculated</span></div><p className="st-live-footnote">{broker.note} Realized P&amp;L remains unavailable until fill-level lot matching is implemented.</p></> : <p className="st-muted">Broker activity unavailable: {broker?.reason??"Waiting for broker data"}.</p>}\n    <p className="st-live-footnote">Last checked: {checked?new Date(checked).toLocaleTimeString():"—"}.</p>
  </section>;
}
