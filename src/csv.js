function encodeCell(value) {
  // Keep each record on one line, including malformed archive metadata.
  let text = String(value ?? "").replace(/\p{Cc}/gu, " ");
  const numeric = typeof value === "number" && Number.isFinite(value);
  if (!numeric && /^[\s]*[=+\-@＝＋－＠]/u.test(text)) {
    // OWASP's spreadsheet-viewing mitigation; the tab is intentional data.
    // Spreadsheet behavior after editing/resaving still needs consumer testing.
    text = `\t${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function serializeCsv(rows) {
  return rows.map(row => row.map(encodeCell).join(",")).join("\n");
}
