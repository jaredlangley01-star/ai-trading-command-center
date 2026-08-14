"use client";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/src/lib/supabase/client";

export function LogoutButton() {
  const [loading, setLoading] = useState(false);
  return (
    <button
      className="logout-button"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        await createSupabaseBrowserClient().auth.signOut();
        window.location.assign("/login");
      }}
    >
      {loading ? "…" : "LOG OUT"}
    </button>
  );
}
