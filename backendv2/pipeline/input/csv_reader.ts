/**
 * csv_reader.ts — CSV parsing layer
 *
 * Reads a CSV file from disk and emits typed RawCsvRow objects.
 * Uses Node.js built-ins only (no extra deps beyond what TheCrawler already uses).
 *
 * Handles:
 *   - Quoted fields (including embedded commas and escaped double-quotes)
 *   - Windows CRLF and Unix LF line endings
 *   - Trailing empty rows
 */

import * as fs from "fs";
import * as path from "path";
import type { RawCsvRow } from "./types.js";

// ─── Minimal RFC 4180-compliant CSV parser ────────────────────────────────────

/**
 * Parses a raw CSV string into an array of row-objects keyed by header names.
 * Returns empty array when the file has no data rows.
 */
export function parseCsvString(csvText: string): RawCsvRow[] {
  // Normalize line endings
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  // Filter out completely empty trailing lines
  const nonEmpty = lines.filter((l, i) => !(i > 0 && l.trim() === ""));

  if (nonEmpty.length === 0) return [];

  const headers = splitCsvLine(nonEmpty[0]);
  const rows: RawCsvRow[] = [];

  for (let i = 1; i < nonEmpty.length; i++) {
    const fields = splitCsvLine(nonEmpty[i]);
    if (fields.length === 0 || (fields.length === 1 && fields[0] === "")) {
      continue; // skip blank rows
    }

    const obj: Record<string, string> = {};
    for (let h = 0; h < headers.length; h++) {
      obj[headers[h]] = fields[h] ?? "";
    }
    rows.push(obj as unknown as RawCsvRow);
  }

  return rows;
}

/**
 * Splits a single CSV line respecting RFC 4180 quoting rules.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;

  while (i <= line.length) {
    if (i === line.length) {
      // trailing comma → empty last field
      fields.push("");
      break;
    }

    if (line[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      let field = "";
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            // Escaped double-quote
            field += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          field += line[i++];
        }
      }
      fields.push(field);
      if (line[i] === ",") i++; // skip delimiter
    } else {
      // Unquoted field
      const end = line.indexOf(",", i);
      if (end === -1) {
        fields.push(line.slice(i));
        break;
      } else {
        fields.push(line.slice(i, end));
        i = end + 1;
      }
    }
  }

  return fields;
}

// ─── File reader ──────────────────────────────────────────────────────────────

/**
 * Reads a CSV file synchronously and returns typed RawCsvRow objects.
 *
 * @param filePath  Absolute or relative path to the .csv file
 */
export function readCsvFile(filePath: string): RawCsvRow[] {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`CSV file not found: ${resolved}`);
  }
  const text = fs.readFileSync(resolved, "utf-8");
  return parseCsvString(text);
}

/**
 * Reads a CSV file asynchronously and returns typed RawCsvRow objects.
 *
 * @param filePath  Absolute or relative path to the .csv file
 */
export async function readCsvFileAsync(filePath: string): Promise<RawCsvRow[]> {
  const resolved = path.resolve(filePath);
  const text = await fs.promises.readFile(resolved, "utf-8");
  return parseCsvString(text);
}
