# Dashboard API security

The dashboard API binds to loopback (127.0.0.1) by default. Binding to a non-loopback interface is refused unless SMALL_TRADING_API_TOKEN is configured (or an explicit access_token is provided by the application). When a token is configured, every GET endpoint requires Authorization: Bearer <token>.

Responses use Cache-Control: no-store and X-Content-Type-Options: nosniff. There are no order placement, replacement, cancellation, or position-closing routes.

For deployment, set SMALL_TRADING_API_TOKEN in the hosting provider's secret/environment settings. Never commit it, paste it into chat, or expose it in browser-side JavaScript. A public deployment should additionally sit behind HTTPS and a trusted authenticated frontend/proxy; the bearer-token check here is a minimum API guard, not a complete identity-management system.

The API remains read-only. Broker account credentials are separate and should be configured only in the server environment.
