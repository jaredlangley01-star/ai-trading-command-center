import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./server";

export async function getAuthenticatedOwner() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

export async function requireAuthenticatedOwner() {
  const user = await getAuthenticatedOwner();
  if (!user) redirect("/login");
  return user;
}
