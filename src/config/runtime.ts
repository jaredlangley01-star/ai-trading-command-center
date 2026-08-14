import { BrokerError } from "../services/broker/errors.ts";

export type TradingRuntimeMode =
  | "LOCAL_DEVELOPMENT"
  | "HOSTED_PREVIEW"
  | "HOSTED_PRODUCTION";

export function getTradingRuntimeMode(): TradingRuntimeMode {
  const explicit = process.env.TRADING_RUNTIME_MODE?.toUpperCase();
  if (
    ["LOCAL_DEVELOPMENT", "HOSTED_PREVIEW", "HOSTED_PRODUCTION"].includes(
      explicit ?? "",
    )
  )
    return explicit as TradingRuntimeMode;
  if (
    process.env.VERCEL_ENV === "production" ||
    process.env.RAILWAY_ENVIRONMENT
  )
    return "HOSTED_PRODUCTION";
  if (process.env.VERCEL_ENV === "preview") return "HOSTED_PREVIEW";
  return "LOCAL_DEVELOPMENT";
}

const forbiddenHostedBroker =
  /localhost|127\.0\.0\.1|\b4001\b|\b4002\b|\b7496\b|\b7497\b|ib\s*gateway|tws\s*gateway/i;

export function assertHostedBrokerEligible(
  runtime: TradingRuntimeMode,
  adapter: string,
  endpoint = "",
) {
  if (runtime === "LOCAL_DEVELOPMENT") return;
  if (
    adapter !== "ALPACA_PAPER" ||
    forbiddenHostedBroker.test(`${adapter} ${endpoint}`)
  )
    throw new BrokerError(
      "LIVE_TRADING_LOCKED",
      "Hosted runtimes permit only the cloud-native Alpaca PAPER broker.",
    );
}

export const runtimeLabel = (runtime: TradingRuntimeMode) =>
  runtime === "LOCAL_DEVELOPMENT"
    ? "Local Development"
    : runtime === "HOSTED_PRODUCTION"
      ? "Hosted Production"
      : "Hosted Preview";
