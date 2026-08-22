/**
 * index.ts — Public barrel for the input normalization layer
 *
 * Usage:
 *   import { readAndNormalizeCsv } from "../pipeline/input/index.js";
 *
 *   const result = await readAndNormalizeCsv("./products.csv");
 *   console.log(result.products);  // NormalizedProduct[]
 *   console.log(result.errors);    // failed rows with reason
 */

import { readCsvFileAsync } from "./csv_reader.js";
import { normalizeRows } from "./normalizer.js";
import type { NormalizedProduct, ParseResult, RawCsvRow } from "./types.js";

/**
 * Full pipeline: read CSV from disk → normalize all rows → return ParseResult.
 *
 * @param filePath  Path to the input CSV file
 */
export async function readAndNormalizeCsv(
  filePath: string
): Promise<ParseResult> {
  const rawRows = await readCsvFileAsync(filePath);
  return normalizeRows(rawRows);
}

// Named re-exports for consumers who need individual pieces
export { readCsvFileAsync, readCsvFile } from "./csv_reader.js";
export { parseCsvString } from "./csv_reader.js";
export { normalizeRows, normalizeOne } from "./normalizer.js";
export type { BrandHints, ManufacturerInfo, NormalizedProduct, ParseResult, RawCsvRow } from "./types.js";
