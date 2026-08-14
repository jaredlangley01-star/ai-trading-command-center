import { createClient } from "@supabase/supabase-js";

const PAPER_URL = "https://paper-api.alpaca.markets";
const DATA_URL = "https://data.alpaca.markets";
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ALPACA_BROKER_API_KEY",
  "ALPACA_BROKER_API_SECRET",
  "ALPACA_API_KEY",
  "ALPACA_API_SECRET",
];
for (const name of required)
  if (!process.env[name]) throw new Error(`MISSING_ENV:${name}`);
if (process.env.TRADING_RUNTIME_MODE !== "HOSTED_PRODUCTION")
  throw new Error("HOSTED_PRODUCTION_REQUIRED");
if (process.env.BROKER_ADAPTER !== "ALPACA_PAPER")
  throw new Error("LIVE_TRADING_LOCKED");
if ((process.env.ALPACA_BROKER_ENVIRONMENT ?? "PAPER") !== "PAPER")
  throw new Error("LIVE_TRADING_LOCKED");
if ((process.env.ALPACA_BROKER_BASE_URL ?? PAPER_URL) !== PAPER_URL)
  throw new Error("LIVE_TRADING_LOCKED");
if ((process.env.ALPACA_DATA_FEED ?? "iex").toLowerCase() !== "iex")
  throw new Error("IEX_FEED_REQUIRED");

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const workerId = process.env.WORKER_ID ?? "railway-trading-engine";
const intervalMs = Math.max(
  10_000,
  Number(process.env.WORKER_INTERVAL_MS ?? 30_000),
);
const symbols = (process.env.WORKER_SCAN_SYMBOLS ?? "AAPL,MSFT,NVDA,SPY")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const headers = (key, secret) => ({
  "APCA-API-KEY-ID": key,
  "APCA-API-SECRET-KEY": secret,
});
let stopping = false;

async function json(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`UPSTREAM_${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function cycle() {
  const startedAt = new Date().toISOString();
  const { data: owners, error } = await db.from("profiles").select("id");
  if (error) throw error;
  const [account, positions, orders, snapshots] = await Promise.all([
    json(`${PAPER_URL}/v2/account`, {
      headers: headers(
        process.env.ALPACA_BROKER_API_KEY,
        process.env.ALPACA_BROKER_API_SECRET,
      ),
    }),
    json(`${PAPER_URL}/v2/positions`, {
      headers: headers(
        process.env.ALPACA_BROKER_API_KEY,
        process.env.ALPACA_BROKER_API_SECRET,
      ),
    }),
    json(`${PAPER_URL}/v2/orders?status=open`, {
      headers: headers(
        process.env.ALPACA_BROKER_API_KEY,
        process.env.ALPACA_BROKER_API_SECRET,
      ),
    }),
    json(
      `${DATA_URL}/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(","))}&feed=iex`,
      {
        headers: headers(
          process.env.ALPACA_API_KEY,
          process.env.ALPACA_API_SECRET,
        ),
      },
    ),
  ]);
  for (const owner of owners ?? []) {
    const { data: state } = await db
      .from("system_state")
      .select("auto_trader_status,emergency_stop_active")
      .eq("user_id", owner.id)
      .maybeSingle();
    const autoTraderPermitted =
      state?.auto_trader_status === "ACTIVE" &&
      state?.emergency_stop_active === false;
    const metadata = {
      accountStatus: account?.status ?? "UNKNOWN",
      positionCount: positions?.length ?? 0,
      openOrderCount: orders?.length ?? 0,
      scannedSymbols: Object.keys(snapshots ?? {}),
      marketData: "ALPACA_IEX",
      broker: "ALPACA_PAPER",
      autoTrader: autoTraderPermitted ? "SCHEDULED" : "PAUSED",
      safety: "LIVE_LOCKED",
    };
    await db.from("trading_worker_heartbeats").upsert(
      {
        user_id: owner.id,
        worker_id: workerId,
        status: "ONLINE",
        runtime: "HOSTED_PRODUCTION",
        last_seen_at: new Date().toISOString(),
        version: process.env.WORKER_VERSION ?? "TRADE-010",
        metadata,
      },
      { onConflict: "user_id,worker_id" },
    );
    await db
      .from("trading_worker_runs")
      .insert({
        user_id: owner.id,
        worker_id: workerId,
        task_type: "HOSTED_CYCLE",
        idempotency_key: `${workerId}:${owner.id}:${startedAt.slice(0, 16)}`,
        status: "COMPLETED",
        details: metadata,
      })
      .then(() => undefined);
  }
}

async function loop() {
  try {
    await cycle();
    console.log(
      JSON.stringify({
        level: "info",
        event: "worker_cycle_complete",
        at: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "worker_cycle_failed",
        message: error instanceof Error ? error.message : "UNKNOWN",
        at: new Date().toISOString(),
      }),
    );
  }
  if (!stopping) setTimeout(loop, intervalMs);
}
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
await loop();
