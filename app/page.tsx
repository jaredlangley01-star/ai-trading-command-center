import { redirect } from "next/navigation";
import { TradingCommandCenter } from "@/components/trading-command-center";
import { isSupabaseConfigured } from "@/src/lib/supabase/config";
import { getAuthenticatedOwner } from "@/src/lib/supabase/auth";
import { loadDashboardPersistence } from "@/src/lib/supabase/repository";
import { SetupRequired } from "@/components/setup-required";
import { loadBrokerDashboard } from "@/src/services/broker/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!isSupabaseConfigured()) return <SetupRequired />;
  const user = await getAuthenticatedOwner();
  if (!user) redirect("/login");
  const [persistence, broker] = await Promise.all([
    loadDashboardPersistence(user),
    loadBrokerDashboard(),
  ]);
  return (
    <TradingCommandCenter
      ownerEmail={user.email ?? "Owner"}
      persistence={persistence}
      broker={broker}
    />
  );
}
