import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

async function owner() {
  const db = await createSupabaseServerClient();
  const { data } = db ? await db.auth.getUser() : { data: { user: null } };
  return { db, user: data.user };
}
export async function GET() {
  const { db, user } = await owner();
  if (!db || !user)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { data } = await db
    .from("push_subscriptions")
    .select("id,device_name,user_agent,active,last_seen_at")
    .eq("user_id", user.id)
    .eq("active", true);
  return NextResponse.json({
    subscriptions: data ?? [],
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
  });
}
export async function POST(request: Request) {
  const { db, user } = await owner();
  if (!db || !user)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await request.json();
  const endpoint = String(body.endpoint ?? ""),
    p256dh = String(body.keys?.p256dh ?? ""),
    auth = String(body.keys?.auth ?? "");
  if (!endpoint.startsWith("https://") || !p256dh || !auth)
    return NextResponse.json(
      { error: "INVALID_SUBSCRIPTION" },
      { status: 400 },
    );
  const { error } = await db.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      active: true,
      device_name: String(body.deviceName ?? "Owner device").slice(0, 100),
      user_agent: request.headers.get("user-agent")?.slice(0, 500),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "user_id,endpoint" },
  );
  return error
    ? NextResponse.json({ error: "SUBSCRIPTION_FAILED" }, { status: 500 })
    : NextResponse.json({ subscribed: true });
}
export async function DELETE(request: Request) {
  const { db, user } = await owner();
  if (!db || !user)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const endpoint = String((await request.json()).endpoint ?? "");
  await db
    .from("push_subscriptions")
    .update({ active: false })
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);
  return NextResponse.json({ subscribed: false });
}
