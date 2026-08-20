const dangerous = /^[=+\-@\t\r]/;
export function csvCell(value: unknown) {
  const raw =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const safe =
    typeof value === "string" && dangerous.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function toCsv(
  columns: Array<{ key: string; label: string }>,
  rows: Array<Record<string, unknown>>,
) {
  return [
    columns.map((column) => csvCell(column.label)).join(","),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column.key])).join(","),
    ),
  ].join("\r\n");
}
