import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { loadBrokerDashboard } from "@/src/services/broker/dashboard";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
export async function GET() {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = await loadBrokerDashboard();
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    await supabase.from("broker_accounts").upsert(
      {
        user_id: user.id,
        provider:
          data.source === "ALPACA_PAPER"
            ? "ALPACA_PAPER"
            : "INTERACTIVE_BROKERS_LOCAL_ONLY",
        mode: "PAPER",
        status: data.status,
        last_sync_at: data.summary?.lastSuccessfulSync,
        last_error: data.lastError,
      },
      { onConflict: "user_id,provider" },
    );
    await supabase.from("market_data_sync_state").upsert(
      {
        user_id: user.id,
        provider: "ALPACA_IEX",
        status: data.marketDataStatus,
        last_quote_at:
          data.marketDataStatus === "MARKET_DATA_ACTIVE"
            ? new Date().toISOString()
            : null,
        last_error:
          data.marketDataStatus === "ERROR" ||
          data.marketDataStatus === "AUTH_REQUIRED"
            ? data.lastError
            : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );
    await supabase.from("audit_events").insert({
      user_id: user.id,
      action:
        data.status === "PAPER_CONNECTED"
          ? "BROKER_CONNECTED"
          : data.status === "ERROR"
            ? "BROKER_CONNECTION_FAILED"
            : "BROKER_CONNECTION_ATTEMPTED",
      metadata: {
        provider: data.brokerProvider,
        mode: "PAPER",
        status: data.status,
        runtime: data.runtime,
        local_only: Boolean(data.localOnlyWarning),
      },
    });
  }
  return NextResponse.json(data);
}
