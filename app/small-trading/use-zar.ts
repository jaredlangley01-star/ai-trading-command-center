"use client";
import { useEffect, useState } from "react";

type FxState = { rate: number | null; updatedAt: string | null; error: string | null };
export function useZarRate(base = "USD") {
  const [state, setState] = useState<FxState>({ rate: base === "ZAR" ? 1 : null, updatedAt: null, error: null });
  useEffect(() => {
    if (base === "ZAR") { setState({ rate: 1, updatedAt: new Date().toISOString(), error: null }); return; }
    let active = true;
    async function refresh() {
      try {
        const response = await fetch(`/api/small-trading/fx?base=${encodeURIComponent(base)}`, { cache: "no-store" });
        const data = await response.json() as { rate?: number; updatedAt?: string; error?: string };
        if (!response.ok || !Number.isFinite(data.rate)) throw new Error(data.error ?? "FX_RATE_UNAVAILABLE");
        if (active) setState({ rate: data.rate!, updatedAt: data.updatedAt ?? null, error: null });
      } catch (error) {
        if (active) setState(current => ({ ...current, error: error instanceof Error ? error.message : "FX_RATE_UNAVAILABLE" }));
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3600000);
    return () => { active = false; window.clearInterval(timer); };
  }, [base]);
  const format = (value: number | string | null | undefined, fractionDigits = 2) => {
    const amount = Number(value);
    if (value === null || value === undefined || value === "" || !Number.isFinite(amount) || state.rate === null) return "—";
    return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(amount * state.rate);
  };
  return { ...state, format };
}
