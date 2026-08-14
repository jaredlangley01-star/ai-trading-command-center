import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const actions = new Set([
  "AUTO_TRADER_PAUSED",
  "AUTO_TRADER_RESUMED",
  "RECOMMENDATION_APPROVED",
  "RECOMMENDATION_REJECTED",
  "EMERGENCY_STOP_ACTIVATED",
  "EMERGENCY_STOP_RESET",
]);
export async function POST(request: Request) {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as {
    action?: string;
    recommendationId?: string;
  };
  if (!body.action || !actions.has(body.action))
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 },
    );
  if (body.action.startsWith("RECOMMENDATION_")) {
    if (!body.recommendationId)
      return NextResponse.json(
        { error: "Recommendation required" },
        { status: 400 },
      );
    const { data: system } = await supabase
      .from("system_state")
      .select("emergency_stop_active")
      .eq("user_id", user.id)
      .maybeSingle();
    if (
      body.action === "RECOMMENDATION_APPROVED" &&
      system?.emergency_stop_active
    )
      return NextResponse.json(
        { error: "Emergency Stop is active" },
        { status: 423 },
      );
    await supabase
      .from("recommendations")
      .update({
        status: body.action.endsWith("APPROVED") ? "APPROVED" : "REJECTED",
      })
      .eq("id", body.recommendationId)
      .eq("user_id", user.id);
  } else {
    const values =
      body.action === "EMERGENCY_STOP_ACTIVATED"
        ? {
            emergency_stop_active: true,
            risk_state: "LOCKED",
            auto_trader_status: "LOCKED",
          }
        : body.action === "EMERGENCY_STOP_RESET"
          ? {
              emergency_stop_active: false,
              risk_state: "NORMAL",
              auto_trader_status: "PAUSED",
            }
          : {
              auto_trader_status:
                body.action === "AUTO_TRADER_RESUMED" ? "ACTIVE" : "PAUSED",
            };
    await supabase
      .from("system_state")
      .upsert(
        { user_id: user.id, mode: "PAPER", ...values },
        { onConflict: "user_id" },
      );
  }
  await supabase.from("audit_events").insert({
    user_id: user.id,
    action: body.action,
    metadata: { mode: "PAPER", source: "OWNER_UI" },
  });
  return NextResponse.json({ ok: true, mode: "PAPER", execution: false });
}
