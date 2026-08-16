import { NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

const defaults = { completed: false, dismissed: false, auto_launch: true };

async function context() {
  const user = await getAuthenticatedOwner();
  const db = await createSupabaseServerClient();
  return { user, db };
}

export async function GET() {
  const { user, db } = await context();
  if (!user || !db)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await db
    .from("owner_tutorial_preferences")
    .select("completed,dismissed,auto_launch")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error)
    return NextResponse.json(
      { error: "TUTORIAL_PREFERENCES_UNAVAILABLE" },
      { status: 503 },
    );
  return NextResponse.json({ preferences: { ...defaults, ...(data ?? {}) } });
}

export async function PUT(request: Request) {
  const { user, db } = await context();
  if (!user || !db)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as Partial<typeof defaults> & {
    action?: "COMPLETE" | "DISMISS" | "RESET" | "REPLAY";
  };
  const values =
    body.action === "COMPLETE"
      ? { completed: true, dismissed: false }
      : body.action === "DISMISS"
        ? { completed: false, dismissed: true }
        : body.action === "RESET"
          ? { completed: false, dismissed: false, auto_launch: true }
          : body.action === "REPLAY"
            ? { completed: false, dismissed: false }
            : {
                ...(typeof body.auto_launch === "boolean"
                  ? { auto_launch: body.auto_launch }
                  : {}),
              };
  const { data, error } = await db
    .from("owner_tutorial_preferences")
    .upsert(
      { user_id: user.id, ...values, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    )
    .select("completed,dismissed,auto_launch")
    .single();
  if (error)
    return NextResponse.json(
      { error: "TUTORIAL_PREFERENCES_NOT_SAVED" },
      { status: 503 },
    );
  return NextResponse.json({ preferences: data });
}
