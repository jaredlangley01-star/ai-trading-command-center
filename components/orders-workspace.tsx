"use client";
import { useCallback, useEffect, useState } from "react";

type OrderRow = {
  id: string;
  executionRequestId: string | null;
  symbol: string;
  side: string;
  quantity: number;
  orderType: string;
  limitPrice: number | null;
  source: string;
  classification: string;
  state: string;
  explanation: string;
  createdAt: string;
  updatedAt: string;
  brokerOrderId: string | null;
  filledQuantity: number;
  averageFillPrice: number | null;
  errorReason: string | null;
  workerDelayed: boolean;
  positionId: string | null;
  completedTradeId: string | null;
  journalEntryId: string | null;
  timeline: Array<{
    key: string;
    label: string;
    at: string | null;
    complete: boolean;
  }>;
};
type Summary = {
  pending: number;
  accepted: number;
  partiallyFilled: number;
  filledToday: number;
  rejectedToday: number;
};
const tabs = [
  "ALL",
  "PENDING",
  "OPEN",
  "FILLED",
  "CANCELED",
  "REJECTED",
  "FAILED",
];

export function OrdersWorkspace({
  initialFilter = "ALL",
  initialId,
  navigate,
}: {
  initialFilter?: string;
  initialId?: string | null;
  navigate: (section: string) => void;
}) {
  const [filter, setFilter] = useState(initialFilter),
    [orders, setOrders] = useState<OrderRow[]>([]),
    [summary, setSummary] = useState<Summary>({
      pending: 0,
      accepted: 0,
      partiallyFilled: 0,
      filledToday: 0,
      rejectedToday: 0,
    }),
    [selected, setSelected] = useState<string | null>(initialId ?? null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const query = selected
        ? `id=${encodeURIComponent(selected)}`
        : `filter=${encodeURIComponent(filter)}`;
      const response = await fetch(`/api/orders?${query}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const payload = await response.json();
      setOrders(payload.orders);
      setSummary(payload.summary);
    } catch {
      setError("Order lifecycle synchronization is temporarily unavailable.");
    }
  }, [filter, selected]);
  useEffect(() => {
    const initial = window.setTimeout(load, 0),
      timer = window.setInterval(load, 10_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);
  const detail = selected ? orders[0] : null;
  return (
    <div className="orders-workspace">
      <section className="order-summary-grid">
        {[
          ["PENDING", summary.pending],
          ["ACCEPTED", summary.accepted],
          ["PARTIAL", summary.partiallyFilled],
          ["FILLED TODAY", summary.filledToday],
          ["REJECTED TODAY", summary.rejectedToday],
        ].map(([label, value]) => (
          <article className="module" key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </article>
        ))}
      </section>
      <section className="module orders-panel">
        <header className="module-head">
          <div>
            <span className="section-label">
              AUTHORITATIVE PAPER EXECUTION MONITOR
            </span>
            <h2>{detail ? `${detail.symbol} order detail` : "Orders"}</h2>
          </div>
          {detail && (
            <button className="button" onClick={() => setSelected(null)}>
              BACK TO ORDERS
            </button>
          )}
          {!detail && (
            <button
              className="button"
              onClick={() => window.location.assign("/api/exports/orders")}
            >
              EXPORT ORDERS CSV
            </button>
          )}
        </header>
        {error && <div className="broker-error">{error}</div>}
        {!detail && (
          <>
            <div className="orders-tabs">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  className={filter === tab ? "active" : ""}
                  onClick={() => {
                    setFilter(tab);
                    setSelected(null);
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="orders-table-wrap">
              <table className="orders-table">
                <thead>
                  <tr>
                    <th>SYMBOL</th>
                    <th>SIDE</th>
                    <th>QTY</th>
                    <th>TYPE</th>
                    <th>SOURCE / CLASS</th>
                    <th>STATE</th>
                    <th>CREATED / UPDATED</th>
                    <th>FILL</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <b>{order.symbol}</b>
                      </td>
                      <td>{order.side}</td>
                      <td>{order.quantity}</td>
                      <td>
                        {order.orderType}
                        {order.limitPrice != null && (
                          <small> @ ${order.limitPrice.toFixed(2)}</small>
                        )}
                      </td>
                      <td>
                        {order.source}
                        <small>{order.classification}</small>
                      </td>
                      <td>
                        <span
                          className={`status-badge ${order.state.toLowerCase()}`}
                        >
                          {order.state.replaceAll("_", " ")}
                        </span>
                        {order.workerDelayed && (
                          <small className="negative">WORKER DELAYED</small>
                        )}
                      </td>
                      <td>
                        {new Date(order.createdAt).toLocaleString()}
                        <small>
                          {new Date(order.updatedAt).toLocaleString()}
                        </small>
                      </td>
                      <td>
                        {order.filledQuantity}/{order.quantity}
                        <small>
                          {order.averageFillPrice
                            ? `AVG $${order.averageFillPrice.toFixed(2)}`
                            : "NOT FILLED"}
                        </small>
                      </td>
                      <td>
                        <button onClick={() => setSelected(order.id)}>
                          VIEW
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {orders.length === 0 && (
                <div className="strategy-empty">
                  No persisted PAPER orders match this filter.
                </div>
              )}
            </div>
          </>
        )}
        {detail && <OrderDetail order={detail} navigate={navigate} />}
      </section>
    </div>
  );
}

function OrderDetail({
  order,
  navigate,
}: {
  order: OrderRow;
  navigate: (section: string) => void;
}) {
  return (
    <div className="order-detail">
      <div className="order-detail-head">
        <div>
          <span>STATE</span>
          <b>{order.state.replaceAll("_", " ")}</b>
          <p>{order.explanation}</p>
        </div>
        <div>
          <span>EXECUTION REQUEST</span>
          <b>{order.executionRequestId ?? "NOT QUEUED"}</b>
          <small>
            BROKER ORDER · {order.brokerOrderId ?? "NOT ACKNOWLEDGED"}
          </small>
        </div>
      </div>
      <div className="order-timeline">
        {order.timeline.map((step) => (
          <div
            className={step.complete ? "complete" : "pending"}
            key={step.key}
          >
            <i>{step.complete ? "✓" : "○"}</i>
            <b>{step.label}</b>
            <small>
              {step.at ? new Date(step.at).toLocaleString() : "Not reached"}
            </small>
          </div>
        ))}
      </div>
      {order.errorReason && (
        <div className="broker-error">{order.errorReason}</div>
      )}
      <div className="order-links">
        {order.positionId && (
          <button
            className="button primary"
            onClick={() => navigate("Portfolio")}
          >
            VIEW POSITION
          </button>
        )}
        {(order.journalEntryId || order.completedTradeId) && (
          <button className="button" onClick={() => navigate("Trade Journal")}>
            VIEW JOURNAL ENTRY
          </button>
        )}
      </div>
    </div>
  );
}

export function PendingOrdersHeader({ navigate }: { navigate: () => void }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () =>
      fetch("/api/orders?filter=PENDING", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => {
          if (active && p) setCount(p.summary.pending);
        })
        .catch(() => undefined);
    const initial = window.setTimeout(load, 0),
      timer = window.setInterval(load, 15_000);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);
  return (
    <button className="pending-orders-header" onClick={navigate}>
      PENDING ORDERS: {count}
    </button>
  );
}

export function OrderActivityCard({ navigate }: { navigate: () => void }) {
  const [summary, setSummary] = useState<Summary>({
    pending: 0,
    accepted: 0,
    partiallyFilled: 0,
    filledToday: 0,
    rejectedToday: 0,
  });
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void fetch("/api/orders?filter=ALL", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((p) => p && setSummary(p.summary)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <section className="module order-activity-card">
      <header className="module-head">
        <div>
          <span className="section-label">ORDER ACTIVITY</span>
          <p>Persisted Alpaca PAPER lifecycle</p>
        </div>
        <button className="button" onClick={navigate}>
          VIEW ORDERS
        </button>
      </header>
      <div>
        {Object.entries(summary).map(([key, value]) => (
          <span key={key}>
            {key.replace(/([A-Z])/g, " $1").toUpperCase()} <b>{value}</b>
          </span>
        ))}
      </div>
    </section>
  );
}
