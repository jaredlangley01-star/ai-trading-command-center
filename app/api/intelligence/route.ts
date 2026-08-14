import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

export async function GET() {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ opportunities: [] });
  const { data, error } = await supabase
    .from("intelligence_snapshots")
    .select("*")
    .eq("user_id", user.id)
    .order("opportunity_score", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(50);
  if (error)
    return NextResponse.json(
      { error: "INTELLIGENCE_UNAVAILABLE" },
      { status: 503 },
    );
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of data ?? [])
    if (!latest.has(row.symbol)) latest.set(row.symbol, row);
  return NextResponse.json({ opportunities: [...latest.values()] });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedOwner();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { symbol } = (await request.json()) as { symbol?: string };
  const normalized = symbol?.trim().toUpperCase();
  if (!normalized || !/^[A-Z.]{1,10}$/.test(normalized))
    return NextResponse.json({ error: "INVALID_SYMBOL" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return NextResponse.json({ error: "SUPABASE_REQUIRED" }, { status: 503 });
  const { data, error } = await supabase
    .from("intelligence_research_jobs")
    .insert({
      user_id: user.id,
      symbol: normalized,
      job_key: crypto.randomUUID(),
      status: "QUEUED",
    })
    .select("id,status")
    .single();
  return error
    ? NextResponse.json({ error: "RESEARCH_QUEUE_FAILED" }, { status: 409 })
    : NextResponse.json(data, { status: 202 });
}
