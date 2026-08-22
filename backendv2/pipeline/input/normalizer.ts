/**
 * normalizer.ts — Input normalization layer
 *
 * Responsibilities:
 *   1. Parse raw CSV rows into typed RawCsvRow objects
 *   2. Apply placeholder → null normalization rules
 *   3. Parse manufacturer string into company_name + supplier_code
 *   4. Emit NormalizedProduct records ready for the orchestration layer
 *
 * TheCrawler is NOT touched here. This layer sits upstream of crawling.
 */

import type {
  BrandHints,
  ManufacturerInfo,
  NormalizedProduct,
  ParseResult,
  RawCsvRow,
} from "./types.js";

// ─── Placeholder normalization rules ─────────────────────────────────────────

/**
 * Values that represent "no brand" in the source CSV.
 * Matched case-insensitively after trimming whitespace.
 */
const BRAND_PLACEHOLDERS = new Set([
  "-- unbranded --",
  "-- no unilog brand --",
  "-- no dib brand --",
  "",
]);

/**
 * Normalizes a raw brand string.
 * Returns null for placeholders / empty / NaN-like values, the trimmed value otherwise.
 */
function normalizeBrand(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number" && isNaN(raw as unknown as number)) return null;

  const trimmed = String(raw).trim();
  if (BRAND_PLACEHOLDERS.has(trimmed.toLowerCase())) return null;
  return trimmed === "" ? null : trimmed;
}

// ─── Manufacturer parser ──────────────────────────────────────────────────────

/**
 * Parses "Freud Inc (2435)" → { company_name: "Freud Inc", supplier_code: "2435" }
 * Parses "Jam Industrial Supply LLC (JAMIN)" → { company_name: "Jam Industrial Supply LLC", supplier_code: "JAMIN" }
 * If no parenthetical is found, supplier_code is null and company_name is the full raw string.
 */
const MANUF_PATTERN = /^(.+?)\s*\(([^)]+)\)\s*$/;

function parseManufacturer(raw: string | undefined | null): ManufacturerInfo {
  const rawStr = raw == null ? "" : String(raw).trim();

  if (rawStr === "") {
    return { raw: rawStr, company_name: "", supplier_code: null };
  }

  const match = MANUF_PATTERN.exec(rawStr);
  if (match) {
    return {
      raw: rawStr,
      company_name: match[1].trim(),
      supplier_code: match[2].trim(),
    };
  }

  // No supplier code in parentheses — treat the entire string as the company name
  return { raw: rawStr, company_name: rawStr, supplier_code: null };
}

// ─── Row normalizer ───────────────────────────────────────────────────────────

/**
 * Converts a single raw CSV row into a NormalizedProduct.
 * Throws if required fields (mfg_part_num, part_desc) are missing.
 */
function normalizeRow(row: RawCsvRow): NormalizedProduct {
  const mfg_part_num = String(row.Mfg_Part_Num ?? "").trim();
  const part_desc = String(row.Part_Desc ?? "").trim();

  if (!mfg_part_num) {
    throw new Error("Mfg_Part_Num is required but was empty");
  }
  if (!part_desc) {
    throw new Error("Part_Desc is required but was empty");
  }

  const brand_hints: BrandHints = {
    e1_brand: normalizeBrand(row.E1_Brand),
    unilog_brand: normalizeBrand(row.Unilog_Brand),
    dib_brand: normalizeBrand(row.DIB_Brand),
  };

  const part_manuf = parseManufacturer(row.Part_Manuf);

  return { mfg_part_num, part_desc, brand_hints, part_manuf };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalizes an array of raw CSV rows into a ParseResult.
 *
 * @param rows  Array of objects keyed by CSV header names
 * @returns     { products: NormalizedProduct[], errors: [...] }
 */
export function normalizeRows(rows: RawCsvRow[]): ParseResult {
  const products: NormalizedProduct[] = [];
  const errors: ParseResult["errors"] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      products.push(normalizeRow(row));
    } catch (err) {
      errors.push({
        row_index: i,
        raw: row,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { products, errors };
}

/**
 * Convenience: normalizes a single raw row. Throws on validation failure.
 */
export function normalizeOne(row: RawCsvRow): NormalizedProduct {
  return normalizeRow(row);
}

// Re-export types for consumers
export type {
  BrandHints,
  ManufacturerInfo,
  NormalizedProduct,
  ParseResult,
  RawCsvRow,
} from "./types.js";
