# REAL CHANGE REVIEW — TRADE-015.1

## Outcome

The full native Node ESM import graphs rooted at `hosted-worker/index.mjs` and `hosted-worker/notification-worker.mjs` were audited. The trading graph reached four extensionless relative imports in `src/services/market-data/factory.ts`; each now uses an explicit `.ts` extension. The notification graph was already explicit.

## Runtime verification

Both Railway commands were launched with the same Node TypeScript stripping mode used in production. With safe placeholder hosted configuration, each process passed module resolution and reached normal runtime initialization; neither produced `ERR_MODULE_NOT_FOUND`. A recursive regression test now walks both transitive graphs and fails if any reachable relative import lacks an explicit supported extension.

No trading, risk, broker, notification, or safety behavior changed. PAPER remains the only broker environment, LIVE remains locked, and no local runtime dependency was added.

No deployment or LIVE enablement was performed.
