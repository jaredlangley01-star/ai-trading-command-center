import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { deepLink } from "@/src/services/notifications/policy";

async function context() {
  const db = await createSupabaseServerClient();
  const { data } = db ? await db.auth.getUser() : { data: { user: null } };
  return { db, user: data.user };
}
export async function GET(request: Request) {
  const { db, user } = await context();
  if (!db || !user)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const url = new URL(request.url),
    category = url.searchParams.get("category"),
    severity = url.searchParams.get("severity");
  let query = db
    .from("notification_events")
    .select(
      "id,event_type,category,severity,title,body,deep_link,status,created_at,notification_read_state(read_at)",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (category) query = query.eq("category", category);
  if (severity) query = query.eq("severity", severity);
  const { data } = await query;
  const notifications = (data ?? []).map((item) => ({
    ...item,
    read:
      Array.isArray(item.notification_read_state) &&
      item.notification_read_state.length > 0,
  }));
  return NextResponse.json({
    notifications,
    unreadCount: notifications.filter((item) => !item.read).length,
  });
}
export async function POST(request: Request) {
  const { db, user } = await context();
  if (!db || !user)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await request.json();
  if (body.action === "test") {
    const id = crypto.randomUUID();
    const { error } = await db.from("notification_events").insert({
      user_id: user.id,
      event_type: "TEST",
      category: "SYSTEM",
      severity: "INFO",
      title: "Trading Command Center",
      body: "Safe test notification. PAPER remains locked; no broker action occurred.",
      payload: { test: true },
      deep_link: deepLink("TEST"),
      dedupe_key: `test:${id}`,
    });
    return error
      ? NextResponse.json({ error: "QUEUE_FAILED" }, { status: 500 })
      : NextResponse.json({ queued: true });
  }
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (body.action === "read_all") {
    const { data } = await db
      .from("notification_events")
      .select("id")
      .eq("user_id", user.id);
    await db.from("notification_read_state").upsert(
      (data ?? []).map((item) => ({ user_id: user.id, event_id: item.id })),
      { onConflict: "user_id,event_id" },
    );
  } else if (body.action === "read" && ids.length)
    await db.from("notification_read_state").upsert(
      ids.map((id: string) => ({ user_id: user.id, event_id: id })),
      { onConflict: "user_id,event_id" },
    );
  return NextResponse.json({ updated: true });
}
