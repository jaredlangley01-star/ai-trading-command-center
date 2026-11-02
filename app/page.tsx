import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/src/lib/supabase/config";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { SetupRequired } from "@/components/setup-required";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!isSupabaseConfigured()) return <SetupRequired />;
  const user = await getAuthenticatedOwner();
  if (!user) redirect("/login");
  redirect("/small-trading");
}
