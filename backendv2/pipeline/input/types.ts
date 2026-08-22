/**
 * types.ts — Input normalization layer types
 *
 * Raw CSV row → NormalizedProduct (internal canonical representation)
 * These types are the contract between the CSV reader and the orchestration layer.
 */

// ─── Raw CSV Row ────────────────────────────────────────────────────────────

export interface RawCsvRow {
  Mfg_Part_Num: string;
  Part_Desc: string;
  E1_Brand: string;
  Unilog_Brand: string;
  DIB_Brand: string;
  Part_Manuf: string;
}

// ─── Normalized sub-shapes ───────────────────────────────────────────────────

export interface BrandHints {
  /** Brand from E1 source — null when placeholder or empty */
  e1_brand: string | null;
  /** Brand from Unilog source — null when placeholder or empty */
  unilog_brand: string | null;
  /** Brand from DIB source — null when placeholder or empty */
  dib_brand: string | null;
}

export interface ManufacturerInfo {
  /** Full raw string as it appeared in the CSV, e.g. "Freud Inc (2435)" */
  raw: string;
  /** Company name stripped of supplier code, e.g. "Freud Inc" */
  company_name: string;
  /** Alphanumeric supplier code extracted from parentheses, e.g. "2435" or "JAMIN" */
  supplier_code: string | null;
}

// ─── Canonical Internal Product Record ───────────────────────────────────────

export interface NormalizedProduct {
  /** Manufacturer part number — always present */
  mfg_part_num: string;
  /** Full part description */
  part_desc: string;
  /** Resolved brand hints from all 3 sources */
  brand_hints: BrandHints;
  /** Parsed manufacturer / supplier metadata */
  part_manuf: ManufacturerInfo;
}

// ─── Parse result ─────────────────────────────────────────────────────────────

export interface ParseResult {
  /** Successfully normalized rows */
  products: NormalizedProduct[];
  /** Rows that could not be parsed, with 0-based original CSV row index */
  errors: Array<{ row_index: number; raw: RawCsvRow; reason: string }>;
}
