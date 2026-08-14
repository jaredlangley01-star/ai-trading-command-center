import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "./server";
import type { RiskSettings } from "@/src/domain/models";
import { defaultRiskSettings } from "@/src/config/trading";

export type DashboardPersistence = {
  source: "SUPABASE" | "DEMO";
  autoTraderStatus: "ACTIVE" | "PAUSED" | "LOCKED";
  emergencyStopActive: boolean;
  recommendationStatus: "PENDING" | "APPROVED" | "REJECTED";
  riskSettings: RiskSettings;
  dailyRiskStatus: "NORMAL" | "DAILY_LOCK" | "SYSTEM_LOCK";
  dailyRiskReason: string | null;
  workerStatus: "ONLINE" | "OFFLINE";
  workerLastSeen: string | null;
  databaseStatus: "CONNECTED" | "DEMO";
};

export const demoDashboardPersistence: DashboardPersistence = {
  source: "DEMO",
  autoTraderStatus: "ACTIVE",
  emergencyStopActive: false,
  recommendationStatus: "PENDING",
  riskSettings: defaultRiskSettings,
  dailyRiskStatus: "NORMAL",
  dailyRiskReason: null,
  workerStatus: "OFFLINE",
  workerLastSeen: null,
  databaseStatus: "DEMO",
};

export async function ensureOwnerProfile(user: User) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return;
  await supabase.from("profiles").upsert(
    {
      id: user.id,
      display_name:
        user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "Owner",
    },
    { onConflict: "id" },
  );
}

export async function loadDashboardPersistence(
  user: User,
): Promise<DashboardPersistence> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return demoDashboardPersistence;
  await ensureOwnerProfile(user);
  const [
    systemResult,
    recommendationResult,
    settingsResult,
    dailyResult,
    workerResult,
  ] = await Promise.all([
    supabase
      .from("system_state")
      .select("auto_trader_status, emergency_stop_active")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("recommendations")
      .select("status")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("risk_settings")
      .select("settings")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("daily_risk_state")
      .select("status,lock_reason")
      .eq("user_id", user.id)
      .eq("trading_date", new Date().toISOString().slice(0, 10))
      .maybeSingle(),
    supabase
      .from("trading_worker_heartbeats")
      .select("last_seen_at")
      .eq("user_id", user.id)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (
    systemResult.error ||
    recommendationResult.error ||
    settingsResult.error
  ) {
    return demoDashboardPersistence;
  }
  return {
    source:
      systemResult.data || recommendationResult.data ? "SUPABASE" : "DEMO",
    autoTraderStatus:
      systemResult.data?.auto_trader_status ??
      demoDashboardPersistence.autoTraderStatus,
    emergencyStopActive: systemResult.data?.emergency_stop_active ?? false,
    recommendationStatus:
      recommendationResult.data?.status ??
      demoDashboardPersistence.recommendationStatus,
    riskSettings: {
      ...defaultRiskSettings,
      ...(settingsResult.data?.settings as Partial<RiskSettings> | null),
    },
    dailyRiskStatus: dailyResult.data?.status ?? "NORMAL",
    dailyRiskReason: dailyResult.data?.lock_reason ?? null,
    workerStatus:
      workerResult.data?.last_seen_at &&
      Date.now() - new Date(workerResult.data.last_seen_at).getTime() < 90_000
        ? "ONLINE"
        : "OFFLINE",
    workerLastSeen: workerResult.data?.last_seen_at ?? null,
    databaseStatus: "CONNECTED",
  };
}
