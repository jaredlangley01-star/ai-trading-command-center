import { NextResponse } from "next/server";

export const revalidate = 3600;

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("base") ?? "USD";
  const base = requested.toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) {
    return NextResponse.json({ error: "INVALID_CURRENCY" }, { status: 400 });
  }
  if (base === "ZAR") {
    return NextResponse.json({ base, target: "ZAR", rate: 1, source: "IDENTITY", updatedAt: new Date().toISOString() });
  }
  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
      next: { revalidate: 3600 },
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("FX_PROVIDER_UNAVAILABLE");
    const data = await response.json() as { result?: string; base_code?: string; time_last_update_utc?: string; rates?: Record<string, number> };
    const rate = data.rates?.ZAR;
    if (data.result !== "success" || !Number.isFinite(rate) || !rate) throw new Error("ZAR_RATE_UNAVAILABLE");
    return NextResponse.json({
      base,
      target: "ZAR",
      rate,
      source: "ExchangeRate-API",
      updatedAt: data.time_last_update_utc ?? new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: "FX_RATE_UNAVAILABLE", base, target: "ZAR" }, { status: 503 });
  }
}
