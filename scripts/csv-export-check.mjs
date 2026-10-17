import assert from "node:assert/strict";
import { serializeCsv } from "../src/csv.js";

// Parse CSV independently so delimiter/quote injection is tested as records.
function parseCsv(csv) {
  if (csv.charCodeAt(0) === 0xFEFF) csv = csv.slice(1);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
      if (char === "\r") {
        // CRLF support for Excel Windows exports: lone CR or CRLF both end the cell;
        // LF in a CRLF pair is consumed here to avoid a double record.
        if (csv[i + 1] === "\n") i++;
      }
      row.push(cell);
      cell = "";
      if (char === "\n" || char === "\r") {
        rows.push(row);
        row = [];
      }
    } else {
      cell += char;
    }
  }
  assert.equal(quoted, false, "CSV quotes must be balanced");
  row.push(cell);
  rows.push(row);
  return rows;
}

const headers = ["id", "type", "created_utc", "subreddit", "author", "score", "permalink", "text"];

// Excel compatibility: UTF-8 BOM + CRLF line endings.
const bomProbe = serializeCsv([headers, headers]);
assert.equal(bomProbe.charCodeAt(0), 0xFEFF, "CSV must start with a BOM so Excel detects UTF-8");
assert.ok(bomProbe.includes("\r\n"), "CSV must use CRLF line endings for Excel on Windows");
const malicious = ['=1+1', '+1+1', '-1+1', '@SUM(1)', ' \t=1', '\r\n=1', '\0=1', '＝1'];
const parsed = parseCsv(serializeCsv([headers, malicious]));
assert.deepEqual(parsed[0], headers);
assert.equal(parsed[1].length, 8);
assert.ok(parsed[1].every(cell => cell.startsWith("\t")), "Every column must protect formula text");

for (const prefix of ["=", "+", "-", "@", "＝", "＋", "－", "＠"]) {
  const [[cell]] = parseCsv(serializeCsv([[` \t\0${prefix}1`]]));
  assert.ok(cell.startsWith("\t"));
}

const safe = ['a,"b"\n=1', "comment", 123, "κόσμος", null, -3, "https://example.com/a,b", 'say "hello"'];
const roundTrip = parseCsv(serializeCsv([headers, safe, safe]));
assert.equal(roundTrip.length, 3, "Injected newlines must not create records");
assert.deepEqual(roundTrip[1], ['a,"b" =1', "comment", "123", "κόσμος", "", "-3", "https://example.com/a,b", 'say "hello"']);
assert.deepEqual(roundTrip[2], roundTrip[1]);
assert.deepEqual(parseCsv(serializeCsv([[undefined, "", "-3", 0]])), [["", "", "\t-3", "0"]]);
console.log("CSV export checks passed");
