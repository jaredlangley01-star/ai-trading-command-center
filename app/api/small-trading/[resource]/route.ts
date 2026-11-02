import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_RESOURCES = new Set(["status", "health", "portfolio", "broker", "events", "market", "market-clock", "decisions", "performance"]);

function backendUrl(resource: string) {
  const configured = process.env.SMALL_TRADING_BACKEND_URL;
  const token = process.env.SMALL_TRADING_API_TOKEN;
  if (!configured || !token) return null;

  let base: URL;
  try {
    base = new URL(configured);
  } catch {
    return null;
  }

  const localHost = ["localhost", "127.0.0.1", "::1"].includes(base.hostname);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && localHost)) return null;
  return { url: new URL(`/api/${resource}`, base), token };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  const { resource } = await context.params;
  if (!ALLOWED_RESOURCES.has(resource)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const backend = backendUrl(resource);
  if (!backend) {
    return NextResponse.json(
      { connected: false, error: "BACKEND_NOT_CONFIGURED" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const upstream = await fetch(backend.url, {
      method: "GET",
      headers: { Authorization: `Bearer ${backend.token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const payload = await upstream.json().catch(() => ({ error: "INVALID_BACKEND_RESPONSE" }));
    return NextResponse.json(payload, {
      status: upstream.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { connected: false, error: "BACKEND_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
