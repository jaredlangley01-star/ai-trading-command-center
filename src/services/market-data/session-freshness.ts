export type EquityMarketSession =
  | "REGULAR"
  | "PRE_MARKET"
  | "AFTER_HOURS"
  | "CLOSED";

export type QuoteFreshnessState = "CURRENT" | "STALE_DATA" | "MARKET_CLOSED";

export type AlpacaClock = {
  isOpen: boolean;
  nextOpen: string | null;
  nextClose: string | null;
  observedAt: string;
  isTradingDay?: boolean;
};

const parts = (date: Date) => {
  const entries = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(entries.map((entry) => [entry.type, entry.value]));
};

export function classifyEquityMarketSession(
  clock: AlpacaClock,
  now = new Date(),
): EquityMarketSession {
  if (clock.isOpen) return "REGULAR";
  const local = parts(now);
  if (["Sat", "Sun"].includes(local.weekday)) return "CLOSED";
  if (clock.isTradingDay === false) return "CLOSED";
  const minutes = Number(local.hour) * 60 + Number(local.minute);
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "PRE_MARKET";
  if (clock.isTradingDay && minutes >= 16 * 60 && minutes < 20 * 60)
    return "AFTER_HOURS";
  return "CLOSED";
}

export function evaluateSessionQuoteFreshness(input: {
  quoteTimestamp: string;
  clock: AlpacaClock;
  now?: Date;
  regularMaxAgeMs?: number;
  extendedMaxAgeMs?: number;
}) {
  const now = input.now ?? new Date();
  const session = classifyEquityMarketSession(input.clock, now);
  const parsed = Date.parse(input.quoteTimestamp);
  const ageMs = Number.isFinite(parsed)
    ? Math.max(0, now.getTime() - parsed)
    : Number.POSITIVE_INFINITY;
  const permittedAgeMs =
    session === "REGULAR"
      ? (input.regularMaxAgeMs ?? 120_000)
      : session === "PRE_MARKET" || session === "AFTER_HOURS"
        ? (input.extendedMaxAgeMs ?? 300_000)
        : null;
  const state: QuoteFreshnessState =
    session === "CLOSED"
      ? "MARKET_CLOSED"
      : ageMs <= Number(permittedAgeMs)
        ? "CURRENT"
        : "STALE_DATA";
  return {
    state,
    session,
    ageMs,
    permittedAgeMs,
    quoteTimestamp: input.quoteTimestamp,
    nextOpen: input.clock.nextOpen,
    nextClose: input.clock.nextClose,
  };
}

export function marketOrderAvailability(
  session: EquityMarketSession,
  freshness: QuoteFreshnessState,
) {
  if (session === "CLOSED")
    return { allowed: false, code: "MARKET_CLOSED" as const };
  if (session !== "REGULAR")
    return {
      allowed: false,
      code: "ORDER_NOT_AVAILABLE_IN_CURRENT_SESSION" as const,
    };
  if (freshness !== "CURRENT")
    return { allowed: false, code: "STALE_DATA" as const };
  return { allowed: true, code: null };
}
