export type DayTraderSession = "OPEN" | "CLOSING" | "CLOSED";
export type IntradayExitReason =
  | "STOP_LOSS"
  | "TAKE_PROFIT"
  | "SIGNAL_WEAKENED"
  | "SIGNAL_REVERSED"
  | "STRATEGY_INVALIDATED"
  | "RISK_EXIT"
  | "MAX_HOLD_TIME"
  | "END_OF_SESSION"
  | "MANUAL"
  | "EMERGENCY_EXIT";

export type IntradaySchedule = {
  timezone: string;
  sessionStart: string;
  sessionEnd: string;
  entryStart: string;
  lastEntryTime: string;
  forceExitTime: string;
  maxHoldMinutes: number | null;
  minimumExitScore: number;
};

const minutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
};

export function zonedTradingMinutes(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}

export function dayTraderSession(
  now: Date,
  schedule: IntradaySchedule,
): DayTraderSession {
  const current = zonedTradingMinutes(now, schedule.timezone);
  if (
    current >= minutes(schedule.forceExitTime) &&
    current < minutes(schedule.sessionEnd)
  )
    return "CLOSING";
  if (
    current >= minutes(schedule.sessionStart) &&
    current < minutes(schedule.forceExitTime)
  )
    return "OPEN";
  return "CLOSED";
}

export function canOpenIntradayEntry(now: Date, schedule: IntradaySchedule) {
  const current = zonedTradingMinutes(now, schedule.timezone);
  return (
    dayTraderSession(now, schedule) === "OPEN" &&
    current >= minutes(schedule.entryStart) &&
    current < minutes(schedule.lastEntryTime)
  );
}

export function timeUntilForcedExitMs(now: Date, schedule: IntradaySchedule) {
  const current = zonedTradingMinutes(now, schedule.timezone);
  return Math.max(0, (minutes(schedule.forceExitTime) - current) * 60_000);
}

export function evaluateIntradayExit(input: {
  now: Date;
  openedAt: string;
  schedule: IntradaySchedule;
  stopTriggered?: boolean;
  targetTriggered?: boolean;
  emergencyStop?: boolean;
  riskExit?: boolean;
  originalDirection?: "BUY" | "SELL" | "LONG" | "SHORT";
  currentDirection?: "BUY" | "SELL" | "NO_TRADE";
  currentScore?: number | null;
  strategyValid?: boolean;
}): IntradayExitReason | null {
  if (input.emergencyStop) return "EMERGENCY_EXIT";
  if (input.stopTriggered) return "STOP_LOSS";
  if (input.targetTriggered) return "TAKE_PROFIT";
  if (input.riskExit) return "RISK_EXIT";
  if (dayTraderSession(input.now, input.schedule) === "CLOSING")
    return "END_OF_SESSION";
  if (dayTraderSession(input.now, input.schedule) === "CLOSED") {
    const opened = Date.parse(input.openedAt);
    if (Number.isFinite(opened) && opened < input.now.getTime())
      return "END_OF_SESSION";
  }
  if (
    input.schedule.maxHoldMinutes != null &&
    input.now.getTime() - Date.parse(input.openedAt) >=
      input.schedule.maxHoldMinutes * 60_000
  )
    return "MAX_HOLD_TIME";
  if (input.strategyValid === false) return "STRATEGY_INVALIDATED";
  const original = ["BUY", "LONG"].includes(input.originalDirection ?? "")
    ? "BUY"
    : "SELL";
  if (
    input.currentDirection &&
    input.currentDirection !== "NO_TRADE" &&
    input.currentDirection !== original
  )
    return "SIGNAL_REVERSED";
  if (
    input.currentDirection === "NO_TRADE" ||
    (input.currentScore != null &&
      input.currentScore < input.schedule.minimumExitScore)
  )
    return "SIGNAL_WEAKENED";
  return null;
}

export function isOvernightViolation(
  openedAt: string,
  now: Date,
  timezone: string,
) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(openedAt)) !== formatter.format(now);
}
