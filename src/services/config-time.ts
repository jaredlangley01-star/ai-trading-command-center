export function normalizeDatabaseTime(value: unknown, fallback: string) {
  const match = String(value ?? "").match(/^([01]\d|2[0-3]):([0-5]\d)/);
  return match ? `${match[1]}:${match[2]}` : fallback;
}
