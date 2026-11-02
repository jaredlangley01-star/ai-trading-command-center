# Dashboard to worker connection

The Small Trading page now polls a same-origin Next.js route at /api/small-trading/status every 15 seconds. The browser never receives the backend bearer token.

Configure these variables only in the Next.js server/hosting environment:

- SMALL_TRADING_BACKEND_URL: origin of the private worker API, for example https://your-private-api.example
- SMALL_TRADING_API_TOKEN: same secret value configured as SMALL_TRADING_API_TOKEN on the Python API process

The proxy allows only status, health, portfolio and broker resources, uses GET only, disables caching, enforces HTTPS for non-local backend URLs, and applies an 8-second upstream timeout. It returns NOT_CONNECTED when either setting is missing. Do not prefix these variables with NEXT_PUBLIC_ and do not put them in browser code.

The Python API must still be configured with the matching token and should remain behind HTTPS and an authenticated reverse proxy when hosted. This proxy does not provision hosting, create DNS, or deploy the Python worker. The dashboard remains disconnected until a private backend URL and matching secrets are configured on both services.
