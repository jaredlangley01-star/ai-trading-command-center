# OWNER SETUP — TRADE-003

1. In Supabase, open **SQL Editor** and run these files in order:
   - `supabase/migrations/202608130001_trade_001_foundation.sql`
   - `supabase/migrations/202608130002_trade_003_auth_rls.sql`
2. Open **Authentication → Providers → Email**. Enable Email/Password and disable public sign-ups after creating the owner account.
3. Open **Authentication → Users → Add user**. Create the single owner user with a strong password and mark the email confirmed.
4. Copy `.env.example` to `.env.local`.
5. In **Project Settings → API**, copy the Project URL into `NEXT_PUBLIC_SUPABASE_URL` and the publishable/anon key into `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
6. Copy the service-role key into `SUPABASE_SERVICE_ROLE_KEY` only if a future server-only administration task requires it. TRADE-003 does not read it in browser or application code.
7. Restart the local development server and sign in at `/login` using the owner account.
8. Confirm the dashboard shows **SUPABASE DATA** after records exist, **PAPER MODE**, and **LIVE LOCKED**.
