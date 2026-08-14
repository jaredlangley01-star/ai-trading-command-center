export const notificationTypes = [
  "TRADE_OPENED",
  "TRADE_CLOSED",
  "STOP_LOSS_HIT",
  "TAKE_PROFIT_HIT",
  "BIG_MONEY_RECOMMENDATION",
  "APPROVAL_REQUIRED",
  "DAILY_LOSS_LIMIT_REACHED",
  "DAILY_PROFIT_TARGET_REACHED",
  "RISK_MANAGER_WARNING",
  "EMERGENCY_STOP",
  "BROKER_DISCONNECTED",
  "BROKER_RECOVERED",
  "MARKET_DATA_PROBLEM",
  "MARKET_DATA_RECOVERED",
  "TRADING_ENGINE_OFFLINE",
  "TRADING_ENGINE_RECOVERED",
  "RESEARCH_OPPORTUNITY_FOUND",
  "BACKTEST_COMPLETED",
  "BACKTEST_FAILED",
  "ORDER_SUBMITTED",
  "ORDER_REJECTED",
  "PROTECTIVE_EXIT_FAILURE",
  "TEST",
] as const;
export type NotificationType = (typeof notificationTypes)[number];
export type Severity = "INFO" | "WARNING" | "CRITICAL";
export type NotificationPreferences = {
  pushEnabled: boolean;
  criticalOnly: boolean;
  minimumOpportunityScore: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  cooldownMinutes: number;
  types: Record<NotificationType, boolean>;
};
export const criticalProtectedTypes: NotificationType[] = [
  "EMERGENCY_STOP",
  "BROKER_DISCONNECTED",
  "PROTECTIVE_EXIT_FAILURE",
  "RISK_MANAGER_WARNING",
  "TRADING_ENGINE_OFFLINE",
];
export const defaultNotificationPreferences: NotificationPreferences = {
  pushEnabled: false,
  criticalOnly: false,
  minimumOpportunityScore: 75,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  timezone: "UTC",
  cooldownMinutes: 15,
  types: Object.fromEntries(
    notificationTypes.map((type) => [type, true]),
  ) as Record<NotificationType, boolean>,
};
export function isQuietHour(
  preferences: NotificationPreferences,
  now = new Date(),
) {
  if (!preferences.quietHoursEnabled) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: preferences.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const minute =
    Number(parts.find((p) => p.type === "hour")?.value) * 60 +
    Number(parts.find((p) => p.type === "minute")?.value);
  const toMinute = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };
  const start = toMinute(preferences.quietHoursStart),
    end = toMinute(preferences.quietHoursEnd);
  return start <= end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}
export function shouldDeliver(
  input: {
    type: NotificationType;
    severity: Severity;
    opportunityScore?: number;
    createdAt?: Date;
  },
  preferences: NotificationPreferences,
) {
  if (!preferences.pushEnabled || !preferences.types[input.type])
    return { deliver: false, reason: "DISABLED" };
  if (preferences.criticalOnly && input.severity !== "CRITICAL")
    return { deliver: false, reason: "CRITICAL_ONLY" };
  if (
    (input.type === "BIG_MONEY_RECOMMENDATION" ||
      input.type === "RESEARCH_OPPORTUNITY_FOUND" ||
      input.type === "APPROVAL_REQUIRED") &&
    (input.opportunityScore ?? 0) < preferences.minimumOpportunityScore
  )
    return { deliver: false, reason: "BELOW_SCORE_THRESHOLD" };
  if (
    input.severity !== "CRITICAL" &&
    isQuietHour(preferences, input.createdAt)
  )
    return { deliver: false, reason: "QUIET_HOURS" };
  return { deliver: true, reason: "ELIGIBLE" };
}
export function requiresCriticalConfirmation(
  previous: NotificationPreferences,
  next: NotificationPreferences,
) {
  return criticalProtectedTypes.some(
    (type) => previous.types[type] && !next.types[type],
  );
}
export function redactNotificationPayload(value: Record<string, unknown>) {
  const forbidden =
    /secret|token|password|credential|api[_-]?key|authorization|account[_-]?number/i;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !forbidden.test(key)),
  );
}
export function deepLink(type: NotificationType, entityId?: string) {
  if (
    [
      "BIG_MONEY_RECOMMENDATION",
      "APPROVAL_REQUIRED",
      "RESEARCH_OPPORTUNITY_FOUND",
    ].includes(type)
  )
    return `/?section=Big%20Money${entityId ? `&recommendation=${encodeURIComponent(entityId)}` : ""}`;
  if (type.startsWith("BACKTEST")) return "/?section=Backtesting";
  if (type.includes("RISK") || type === "EMERGENCY_STOP")
    return "/?section=Risk%20Manager";
  return "/?section=Notifications";
}
