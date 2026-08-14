# REAL CHANGE REVIEW — TRADE-013

## Outcome

TRADE-013 adds a hosted, multi-source market-intelligence pipeline. Railway incrementally researches a configurable universe using Alpaca price/news/corporate-actions data, official SEC company facts and filings, production technical signals, TRADE-012 historical evidence, portfolio risk context, and optional AI synthesis. Supabase preserves normalized facts, provenance, scores, freshness, AI reports, and ranked snapshots; Vercel reads those results in Big Money.

## Architecture

Deterministic services normalize sources, calculate Fundamental, Catalyst, Technical, Market Context, Historical Evidence, and Risk scores, then apply explicit weights of 25/20/20/10/10/15. Confidence measures component completeness and freshness. AI receives the verified fact bundle and deterministic analysis only after scoring; it cannot change scores, risk, position size, approval, automation, or trading mode.

Railway queues one universe symbol per refresh bucket, claims jobs conditionally, and requeues jobs left RUNNING for ten minutes after a restart. News, filings, corporate actions, jobs, and snapshots have provider/job uniqueness constraints for retry-safe incremental processing.

## Sources and integrity

- Alpaca news retains article ID, headline, unmodified provider summary, source, author, symbols, URL, publication time, and retrieval time.
- SEC access uses `data.sec.gov` companyfacts/submissions plus the official ticker/CIK mapping and a declared owner-configured User-Agent. Reported metrics remain `REPORTED`; ratios and growth calculations are `DERIVED`.
- Corporate actions retain provider payloads and explicitly warn that provider availability may be delayed.
- Market context uses SPY, QQQ, DIA, and IWM historical price/volatility only; unavailable macro data is not invented.
- Source facts and AI interpretation are stored and displayed separately, with original links retained.

## Deterministic analysis

News sentiment/category/significance rules run before AI. Catalyst scoring includes recency, sentiment, significance, conflicts, filings, and corporate actions. Missing fundamentals reduce confidence to zero rather than becoming neutral. Historical evidence is taken only from completed TRADE-012 runs; missing evidence is labelled `NO HISTORICAL EVIDENCE AVAILABLE`. AI failure displays `AI ANALYSIS UNAVAILABLE` without blocking research.

## Safety

The intelligence modules contain no broker, order, permission, position mutation, Auto Trader, approval, or risk-setting interface. Existing Big Money approval still flows through Risk Manager, TradePermissionService, and the guarded Alpaca PAPER broker. LIVE and local infrastructure remain unavailable.

## Environment

New Railway variables are `RESEARCH_UNIVERSE`, `RESEARCH_REFRESH_INTERVAL_MS`, `SEC_USER_AGENT`, six optional `RESEARCH_WEIGHT_*` variables, optional `AI_API_URL`, optional `AI_MODEL`, and existing optional `AI_API_KEY`. No credential is persisted or exposed client-side.

## Verification

Tests cover news normalization/deduplication, SEC facts and filings, corporate actions, derived fundamentals, missing inputs, catalyst conflicts, composite scoring, confidence, freshness, AI fallback/isolation, provenance, owner RLS, Railway scheduling/restart safety, and absence of local/broker dependencies.

No deployment, broker order, or LIVE enablement was performed.
