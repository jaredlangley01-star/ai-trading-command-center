# OWNER SETUP — TRADE-018

1. Apply `supabase/migrations/202608200002_trade_018_paper_automation_stress.sql` to the production Supabase project.
2. Deploy the updated Vercel application and all three Railway services using the existing TRADE-017 variables and commands:
   - Trading worker: `npm run worker:start`
   - Notification worker: `npm run worker:notifications`
   - Trader worker: `npm run worker:trader`
3. Confirm Railway remains configured with `HOSTED_PRODUCTION`, `BROKER_ADAPTER=ALPACA_PAPER`, the Alpaca PAPER base URL, Alpaca PAPER credentials, Supabase URL, and Supabase service-role key.
4. Confirm `LIVE_TRADING_ENABLED=false`. Do not configure an Alpaca LIVE endpoint for stress mode.
5. In Auto Trader settings, set the normal maximum concurrent positions and risk limits. Stress mode will never exceed those normal limits even if its target is higher.
6. Review the TEST MODE ONLY thresholds and configurable symbol universe. Save the configuration.
7. Explicitly enable **PAPER AUTOMATION TEST MODE** and confirm the warning. Auto Trader must also be ACTIVE and the market must be within the configured entry session.
8. Optionally enable Big Money PAPER test mode. Leave test auto-approval OFF unless PAPER-only automatic approval is intentionally being tested.
9. Verify Dashboard counts use confirmed Alpaca PAPER positions and that every expected protected position shows `PROTECTED`.

No new secret is required by TRADE-018.
