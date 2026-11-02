# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get(
    "oai-authenticated-user-full-name",
  );
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)


---

# Small Trading Platform (separate development branch)

The new Small Trading foundation is being built on the `rebuild/small-trading-foundation` branch. It is separate from the legacy dashboard and does not change the repository's main branch.

## First run: local demo mode

The quickest way to see the agent workflow is to run the local synthetic-data demo. It does not require an Alpaca account and does not submit broker orders.

### Requirements

- macOS with Docker Desktop installed and running
- Git
- Node.js 22.13 or newer
- Internet connection for dependency installation

### Start

Clone this branch:

```bash
git clone --branch rebuild/small-trading-foundation https://github.com/jaredlangley01-star/ai-trading-command-center.git
cd ai-trading-command-center
```

Run the guided setup:

```bash
bash scripts/start-small-trading-mac.sh
```

The example environment defaults to `SMALL_TRADING_DATA_MODE=demo`. The script creates a private local dashboard token, starts the worker and read-only API in Docker, installs JavaScript dependencies if needed, and launches the dashboard.

Open [http://localhost:3000/small-trading](http://localhost:3000/small-trading).

Demo prices are generated test data, not market prices. The dashboard labels them accordingly. Demo mode exists to demonstrate the software workflow and must not be used to evaluate a strategy or make trading decisions.

### Stop

Use a second Terminal window:

```bash
cd ai-trading-command-center
bash scripts/stop-small-trading-mac.sh
```

This stops the worker and API while retaining the local SQLite event database. Pressing Control+C in the dashboard terminal stops only the dashboard development server.

### Switch to Alpaca IEX observations later

Create an Alpaca Paper account and obtain its API key and secret from Alpaca's own dashboard. Never paste credentials into ChatGPT or commit them to Git.

In the private `.env.small-trading` file, set:

```dotenv
SMALL_TRADING_DATA_MODE=alpaca_iex
```

The guided startup script then asks for missing Alpaca credentials through hidden terminal input. The worker reads IEX market data only. This project remains observation-only: no order submission, amendment, cancellation or live trading is enabled.

## Safety and status

- The new development branch is not the legacy production dashboard.
- The Python agent roles are deterministic software components, not independent LLM agents.
- Demo prices are synthetic.
- Risk previews remain blocked until portfolio context is verified.
- Position monitoring updates only the local simulated position ledger.
- The broker account reader is read-only.
- No live or paper broker orders are submitted by this observation-only workflow.
- Automated CI checks validate tests, TypeScript, container build and deployment configuration. They do not prove profitability or broker connectivity.
- No paid hosting service is provisioned by this branch.

For detailed setup and operational notes, see `docs/architecture/WORKER_OPERATIONS.md` and `docs/architecture/BUILD_STATUS.md`.
