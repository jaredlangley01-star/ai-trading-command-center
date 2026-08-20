import { createClient } from "@supabase/supabase-js";
import { livePaperStrategyPerformance } from "../src/services/strategy-analytics.ts";

if (process.env.TRADING_RUNTIME_MODE !== "HOSTED_PRODUCTION")
  throw new Error("HOSTED_PRODUCTION_REQUIRED");
for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])
  if (!process.env[key]) throw new Error(`MISSING_ENV:${key}`);

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const workerId = process.env.TRADER_WORKER_ID ?? "railway-trader-worker";
const intervalMs = Math.max(
  60_000,
  Number(process.env.TRADER_WORKER_INTERVAL_MS ?? 300_000),
);
const cooldownMs = Math.max(
  300_000,
  Number(process.env.TRADER_PROACTIVE_COOLDOWN_MS ?? 3_600_000),
);
let stopping = false;

async function insertMessage(userId, content, actions, dedupeKey, context) {
  await db.from("trader_messages").upsert(
    {
      user_id: userId,
      role: "TRADER",
      content,
      actions,
      proactive: true,
      dedupe_key: dedupeKey,
      context_snapshot: context,
    },
    { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
  );
}

async function processOwner(userId) {
  const [positions, risk, recommendations, trades, config, prior] =
    await Promise.all([
      db
        .from("paper_positions")
        .select(
          "symbol,trade_origin,market_value,unrealized_pl,status,protection_status",
        )
        .eq("user_id", userId)
        .in("status", ["OPEN", "EXIT_PENDING"]),
      db
        .from("system_state")
        .select("risk_state,emergency_stop_active,auto_trader_status")
        .eq("user_id", userId)
        .maybeSingle(),
      db
        .from("recommendations")
        .select("id,symbol,score,status")
        .eq("user_id", userId)
        .eq("status", "PENDING")
        .order("score", { ascending: false })
        .limit(1),
      db
        .from("completed_paper_trades")
        .select("*")
        .eq("user_id", userId)
        .eq("trade_origin", "AUTO_TRADER")
        .eq("environment", "PAPER")
        .order("exit_timestamp", { ascending: false })
        .limit(500),
      db
        .from("auto_trader_config")
        .select("strategy_health_minimum_sample")
        .eq("user_id", userId)
        .maybeSingle(),
      db
        .from("trader_messages")
        .select("created_at")
        .eq("user_id", userId)
        .eq("proactive", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  if (prior.data && Date.now() - Date.parse(prior.data.created_at) < cooldownMs)
    return;
  const open = positions.data ?? [];
  const unprotected = open.filter(
    (position) => position.protection_status === "UNPROTECTED",
  );
  const bucket = Math.floor(Date.now() / cooldownMs);
  if (unprotected.length) {
    await insertMessage(
      userId,
      `${unprotected.length} open PAPER position${unprotected.length === 1 ? " is" : "s are"} marked UNPROTECTED. Open Portfolio and review the critical protection warning.`,
      [{ label: "OPEN PORTFOLIO", href: "/?section=Portfolio" }],
      `proactive:unprotected:${bucket}`,
      { unprotected: unprotected.map((item) => item.symbol), liveLocked: true },
    );
    return;
  }
  if (risk.data?.emergency_stop_active || risk.data?.risk_state === "LOCKED") {
    await insertMessage(
      userId,
      `Risk Manager is ${risk.data?.risk_state ?? "UNKNOWN"}; Emergency Stop is ${risk.data?.emergency_stop_active ? "ACTIVE" : "not active"}. No Trader action can bypass this state.`,
      [{ label: "OPEN RISK MANAGER", href: "/?section=Risk%20Manager" }],
      `proactive:risk:${bucket}`,
      { risk: risk.data, liveLocked: true },
    );
    return;
  }
  if (recommendations.data?.length) {
    const recommendation = recommendations.data[0];
    await insertMessage(
      userId,
      `${recommendation.symbol} has a persisted Big Money recommendation with signal score ${recommendation.score}. Owner approval is still required.`,
      [
        {
          label: "REVIEW BIG MONEY OPPORTUNITY",
          href: "/?section=Big%20Money",
        },
      ],
      `proactive:recommendation:${recommendation.id}`,
      { recommendation, liveLocked: true },
    );
    return;
  }
  const performance = livePaperStrategyPerformance(
    trades.data ?? [],
    Number(config.data?.strategy_health_minimum_sample ?? 20),
  );
  const unhealthy = Object.entries(performance).find(([, metrics]) =>
    ["UNDERPERFORMING", "PAUSE RECOMMENDED"].includes(metrics.health),
  );
  if (unhealthy)
    await insertMessage(
      userId,
      `${unhealthy[0]} is classified ${unhealthy[1].health} across ${unhealthy[1].completed} completed Auto Trader PAPER trades. This is an explanation, not an automatic strategy change.`,
      [{ label: "VIEW STRATEGY", href: "/?section=Strategies" }],
      `proactive:strategy:${unhealthy[0]}:${bucket}`,
      { strategy: unhealthy[0], metrics: unhealthy[1], liveLocked: true },
    );
}

async function cycle() {
  const { data: owners } = await db.from("profiles").select("id");
  for (const owner of owners ?? []) {
    try {
      await processOwner(owner.id);
      await db.from("trader_worker_heartbeats").upsert(
        {
          user_id: owner.id,
          worker_id: workerId,
          status: "ONLINE",
          last_seen_at: new Date().toISOString(),
          metadata: { readOnly: true, liveLocked: true },
        },
        { onConflict: "user_id" },
      );
    } catch (error) {
      await db.from("trader_worker_heartbeats").upsert(
        {
          user_id: owner.id,
          worker_id: workerId,
          status: "ERROR",
          last_seen_at: new Date().toISOString(),
          metadata: {
            error:
              error instanceof Error ? error.message : "TRADER_CYCLE_FAILED",
            readOnly: true,
          },
        },
        { onConflict: "user_id" },
      );
    }
  }
}

process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
while (!stopping) {
  await cycle();
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
