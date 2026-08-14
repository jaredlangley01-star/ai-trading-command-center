import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { isSupabaseConfigured } from "@/src/lib/supabase/config";
import { SetupRequired } from "@/components/setup-required";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!isSupabaseConfigured()) return <SetupRequired />;
  if (await getAuthenticatedOwner()) redirect("/");
  return <LoginForm />;
}
