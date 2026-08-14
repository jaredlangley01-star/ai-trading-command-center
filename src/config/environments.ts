import { BrokerError } from "../services/broker/errors.ts";

export type TradingEnvironment = "PAPER" | "LIVE";

export const ALPACA_PAPER_URL = "https://paper-api.alpaca.markets" as const;
export const ALPACA_LIVE_URL = "https://api.alpaca.markets" as const;
export const LIVE_CONFIRMATION_PHRASE = "ENABLE LIVE TRADING" as const;

export type EnvironmentReadiness = {
  environment: TradingEnvironment;
  credentialsConfigured: boolean;
  endpointValid: boolean;
  executionEnabled: boolean;
  label:
    | "PAPER READY"
    | "LIVE READY — LOCKED"
    | "LIVE READY"
    | "NOT CONFIGURED";
};

const credentials = (environment: TradingEnvironment) =>
  environment === "PAPER"
    ? {
        key: process.env.ALPACA_PAPER_API_KEY,
        secret: process.env.ALPACA_PAPER_API_SECRET,
        url: process.env.ALPACA_PAPER_BASE_URL ?? ALPACA_PAPER_URL,
      }
    : {
        key: process.env.ALPACA_LIVE_API_KEY,
        secret: process.env.ALPACA_LIVE_API_SECRET,
        url: process.env.ALPACA_LIVE_BASE_URL ?? ALPACA_LIVE_URL,
      };

export function getEnvironmentReadiness(
  environment: TradingEnvironment,
): EnvironmentReadiness {
  const config = credentials(environment);
  const configured = Boolean(config.key && config.secret);
  const endpointValid =
    config.url ===
    (environment === "PAPER" ? ALPACA_PAPER_URL : ALPACA_LIVE_URL);
  if (environment === "PAPER")
    return {
      environment,
      credentialsConfigured: configured,
      endpointValid,
      executionEnabled: configured && endpointValid,
      label: configured && endpointValid ? "PAPER READY" : "NOT CONFIGURED",
    };
  const enabled = process.env.LIVE_TRADING_ENABLED === "true";
  return {
    environment,
    credentialsConfigured: configured,
    endpointValid,
    executionEnabled: configured && endpointValid && enabled,
    label:
      configured && endpointValid && enabled
        ? "LIVE READY"
        : configured && endpointValid
          ? "LIVE READY — LOCKED"
          : "NOT CONFIGURED",
  };
}

export function assertEnvironmentCredentials(environment: TradingEnvironment) {
  const state = getEnvironmentReadiness(environment);
  if (!state.credentialsConfigured || !state.endpointValid)
    throw new BrokerError(
      "LIVE_TRADING_LOCKED",
      `${environment} broker credentials or endpoint are not configured safely.`,
    );
  if (environment === "LIVE" && !state.executionEnabled)
    throw new BrokerError(
      "LIVE_TRADING_LOCKED",
      "LIVE exists architecturally but server-side execution remains locked.",
    );
  return credentials(environment);
}

export function validateEnvironmentSwitch(input: {
  requested: TradingEnvironment;
  confirmation?: string;
  criticalDiagnostics: number;
  hasUnsafeOrderTransition: boolean;
  servicesHealthy: boolean;
}) {
  if (input.requested === "PAPER") return { allowed: true, reason: null };
  const readiness = getEnvironmentReadiness("LIVE");
  if (!readiness.executionEnabled)
    return { allowed: false, reason: "LIVE_TRADING_LOCKED" };
  if (input.confirmation !== LIVE_CONFIRMATION_PHRASE)
    return { allowed: false, reason: "LIVE_CONFIRMATION_REQUIRED" };
  if (input.hasUnsafeOrderTransition)
    return { allowed: false, reason: "UNSAFE_ORDER_TRANSITION" };
  if (input.criticalDiagnostics > 0 || !input.servicesHealthy)
    return { allowed: false, reason: "SYSTEM_NOT_READY" };
  return { allowed: true, reason: null };
}

export function redactDiagnosticValue(value: string) {
  return /key|secret|token|password|authorization|cookie/i.test(value)
    ? "[REDACTED]"
    : value.replace(
        /(APCA-API-KEY-ID|APCA-API-SECRET-KEY)\s*[:=]\s*\S+/gi,
        "$1=[REDACTED]",
      );
}
