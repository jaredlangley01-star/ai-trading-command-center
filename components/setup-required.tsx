export function SetupRequired() {
  return (
    <main className="auth-shell">
      <section className="auth-card setup-card">
        <div className="auth-brand">
          <div>
            <b>TRADING</b>
            <small>COMMAND CENTER</small>
          </div>
        </div>
        <p className="auth-kicker">OWNER CONNECTION REQUIRED</p>
        <h1>Supabase setup is incomplete</h1>
        <p>
          Add the three required environment variables and apply the supplied
          migrations. No credentials have been invented or stored in the
          application.
        </p>
        <div className="auth-button secondary">
          FOLLOW OWNER_SETUP_TRADE-003.md
        </div>
        <div className="auth-safety">PAPER ONLY · LIVE TRADING LOCKED</div>
      </section>
    </main>
  );
}
