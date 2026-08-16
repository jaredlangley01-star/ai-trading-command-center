export type BrokerSafetyCode =
  | "LIVE_TRADING_LOCKED"
  | "PAPER_CONFIRMATION_REQUIRED"
  | "TRADE_PERMISSION_DENIED";
export type BrokerFailureCode =
  | "IBKR_UNAVAILABLE"
  | "GATEWAY_UNAVAILABLE"
  | "AUTHENTICATION_EXPIRED"
  | "ACCOUNT_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "ORDER_REJECTED"
  | "WORKER_UNAVAILABLE"
  | "BROKER_NOT_CONFIGURED"
  | "BROKER_AUTH_FAILED"
  | "ORDER_TIMEOUT"
  | "SYNC_FAILED"
  | "DISCONNECTED_SESSION";
export class BrokerError extends Error {
  readonly code: BrokerSafetyCode | BrokerFailureCode;
  readonly retryable: boolean;
  constructor(
    code: BrokerSafetyCode | BrokerFailureCode,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "BrokerError";
    this.code = code;
    this.retryable = retryable;
  }
}
export class RiskDecisionError extends BrokerError {
  readonly decision: RiskDecision;
  constructor(decision: RiskDecision) {
    super("TRADE_PERMISSION_DENIED", `${decision.status}: ${decision.reason}`);
    this.name = "RiskDecisionError";
    this.decision = decision;
  }
}
export const brokerErrorPayload = (error: unknown) =>
  error instanceof RiskDecisionError
    ? {
        code: error.code,
        message: error.message,
        retryable: false,
        decision: error.decision,
        status: error.decision.status,
        reason: error.decision.reason,
      }
    : error instanceof BrokerError
      ? { code: error.code, message: error.message, retryable: error.retryable }
      : {
          code: "SYNC_FAILED",
          message: "The PAPER execution request failed safely.",
          retryable: true,
        };
import type { RiskDecision } from "../../domain/models.ts";
