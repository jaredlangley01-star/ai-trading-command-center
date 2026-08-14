# OWNER SETUP — TRADE-013

1. Apply `supabase/migrations/202608140007_trade_013_intelligence.sql` in Supabase.
2. In Railway, retain the existing server-side Alpaca variables and add:
   - `RESEARCH_UNIVERSE=AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,AMD,NFLX,SPY,QQQ`
   - `RESEARCH_REFRESH_INTERVAL_MS=3600000`
   - `SEC_USER_AGENT=TradingCommandCenter your-real-contact-email@example.com`
   - Optional score weights: `RESEARCH_WEIGHT_TECHNICAL`, `RESEARCH_WEIGHT_FUNDAMENTAL`, `RESEARCH_WEIGHT_CATALYST`, `RESEARCH_WEIGHT_MARKET_CONTEXT`, `RESEARCH_WEIGHT_HISTORICAL`, and `RESEARCH_WEIGHT_RISK` (defaults: `25,20,20,10,10,15`).
3. Optional AI synthesis only: add `AI_API_KEY`, `AI_API_URL=https://api.openai.com/v1`, and an owner-selected `AI_MODEL` to Railway. Do not add these to Vercel or prefix them with `NEXT_PUBLIC_`.
4. Redeploy Railway and Vercel. Confirm Railway completes an intelligence research job and the Big Money page shows a persisted opportunity feed.
5. Confirm source links open the original provider pages, AI-unavailable mode still shows deterministic scores, approvals remain PAPER-only, and LIVE remains locked.
