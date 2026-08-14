import { NextResponse } from "next/server";
import { defaultRiskSettings } from "@/src/config/trading";
import type { RiskSettings } from "@/src/domain/models";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { validateRiskSettings } from "@/src/services/risk-manager";

export async function GET() {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json(defaultRiskSettings);
  const { data } = await supabase
    .from("risk_settings")
    .select("settings")
    .eq("user_id", user.id)
    .maybeSingle();
  return NextResponse.json({ ...defaultRiskSettings, ...data?.settings });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = (await request.json()) as RiskSettings;
  if (!validateRiskSettings(settings))
    return NextResponse.json(
      { error: "Invalid risk settings." },
      { status: 400 },
    );
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  const { error } = await supabase
    .from("risk_settings")
    .upsert(
      { user_id: user.id, settings, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  await supabase.from("audit_events").insert({
    user_id: user.id,
    action: "RISK_SETTING_CHANGED",
    metadata: { mode: "PAPER", settings },
  });
  return NextResponse.json({ settings, mode: "PAPER" });
}
