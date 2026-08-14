"use client";
import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/src/lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const { error: authError } =
      await createSupabaseBrowserClient().auth.signInWithPassword({
        email,
        password,
      });
    if (authError) {
      setError("Sign-in failed. Check the owner email and password.");
      setLoading(false);
      return;
    }
    window.location.assign("/");
  }
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">
          <span>T</span>
          <div>
            <b>TRADING</b>
            <small>COMMAND CENTER</small>
          </div>
        </div>
        <p className="auth-kicker">PRIVATE OWNER ACCESS</p>
        <h1>Sign in to Command Center</h1>
        <p>Authenticate with the owner account configured in Supabase.</p>
        <form onSubmit={submit}>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <button className="auth-button" disabled={loading}>
            {loading ? "AUTHENTICATING…" : "SIGN IN SECURELY"}
          </button>
        </form>
        <div className="auth-safety">
          PAPER ONLY · LIVE TRADING LOCKED · NO BROKER CONNECTED
        </div>
      </section>
    </main>
  );
}
