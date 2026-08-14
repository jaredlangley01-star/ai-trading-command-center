import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import {
  defaultNotificationPreferences,
  requiresCriticalConfirmation,
  type NotificationPreferences,
} from "@/src/services/notifications/policy";

async function context() {
  const db = await createSupabaseServerClient();
  const { data } = db ? await db.auth.getUser() : { data: { user: null } };
  return { db, user: data.user };
}
export async function GET() {
  const { db, user } = await context();
  if (!db || !user)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { data } = await db
    .from("notification_preferences")
    .select("preferences")
    .eq("user_id", user.id)
    .maybeSingle();
  return NextResponse.json({
    ...defaultNotificationPreferences,
    ...(data?.preferences ?? {}),
    types: {
      ...defaultNotificationPreferences.types,
      ...(data?.preferences?.types ?? {}),
    },
  });
}
export async function PUT(request: Request) {
  const { db, user } = await context();
  if (!db || !user)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { preferences, criticalAcknowledged } = (await request.json()) as {
    preferences: NotificationPreferences;
    criticalAcknowledged?: boolean;
  };
  const currentResponse = await db
    .from("notification_preferences")
    .select("preferences")
    .eq("user_id", user.id)
    .maybeSingle();
  const current = {
    ...defaultNotificationPreferences,
    ...(currentResponse.data?.preferences ?? {}),
    types: {
      ...defaultNotificationPreferences.types,
      ...(currentResponse.data?.preferences?.types ?? {}),
    },
  };
  if (
    requiresCriticalConfirmation(current, preferences) &&
    !criticalAcknowledged
  )
    return NextResponse.json(
      { error: "CRITICAL_CONFIRMATION_REQUIRED" },
      { status: 409 },
    );
  if (
    preferences.minimumOpportunityScore < 0 ||
    preferences.minimumOpportunityScore > 100 ||
    preferences.cooldownMinutes < 0
  )
    return NextResponse.json({ error: "INVALID_PREFERENCES" }, { status: 400 });
  const { error } = await db.from("notification_preferences").upsert({
    user_id: user.id,
    preferences,
    updated_at: new Date().toISOString(),
    critical_disable_acknowledged_at: criticalAcknowledged
      ? new Date().toISOString()
      : null,
  });
  return error
    ? NextResponse.json({ error: "SAVE_FAILED" }, { status: 500 })
    : NextResponse.json(preferences);
}
