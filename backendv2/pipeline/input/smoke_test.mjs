/**
 * smoke_test.mjs — Verifies input normalization against the real dataset
 * Run: node pipeline/input/smoke_test.mjs
 *
 * Pure .mjs — no TypeScript compiler needed. Inline the normalizer logic
 * so we can test it before the project has a build step.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Inline CSV parser (mirrors csv_reader.ts) ───────────────────────────────

function splitCsvLine(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { fields.push(""); break; }
    if (line[i] === '"') {
      i++;
      let field = "";
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { field += '"'; i += 2; }
          else { i++; break; }
        } else { field += line[i++]; }
      }
      fields.push(field);
      if (line[i] === ",") i++;
    } else {
      const end = line.indexOf(",", i);
      if (end === -1) { fields.push(line.slice(i)); break; }
      else { fields.push(line.slice(i, end)); i = end + 1; }
    }
  }
  return fields;
}

function parseCsvString(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.filter((l, i) => !(i > 0 && l.trim() === ""));
  if (nonEmpty.length === 0) return [];
  const headers = splitCsvLine(nonEmpty[0]);
  const rows = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const fields = splitCsvLine(nonEmpty[i]);
    if (fields.length === 0 || (fields.length === 1 && fields[0] === "")) continue;
    const obj = {};
    for (let h = 0; h < headers.length; h++) obj[headers[h]] = fields[h] ?? "";
    rows.push(obj);
  }
  return rows;
}

// ─── Inline normalizer (mirrors normalizer.ts) ───────────────────────────────

const BRAND_PLACEHOLDERS = new Set([
  "-- unbranded --",
  "-- no unilog brand --",
  "-- no dib brand --",
  "",
]);

function normalizeBrand(raw) {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (BRAND_PLACEHOLDERS.has(trimmed.toLowerCase())) return null;
  return trimmed === "" ? null : trimmed;
}

const MANUF_PATTERN = /^(.+?)\s*\(([^)]+)\)\s*$/;

function parseManufacturer(raw) {
  const rawStr = raw == null ? "" : String(raw).trim();
  if (rawStr === "") return { raw: rawStr, company_name: "", supplier_code: null };
  const match = MANUF_PATTERN.exec(rawStr);
  if (match) return { raw: rawStr, company_name: match[1].trim(), supplier_code: match[2].trim() };
  return { raw: rawStr, company_name: rawStr, supplier_code: null };
}

function normalizeRow(row) {
  const mfg_part_num = String(row.Mfg_Part_Num ?? "").trim();
  const part_desc    = String(row.Part_Desc    ?? "").trim();
  if (!mfg_part_num) throw new Error("Mfg_Part_Num is required but was empty");
  if (!part_desc)    throw new Error("Part_Desc is required but was empty");
  return {
    mfg_part_num,
    part_desc,
    brand_hints: {
      e1_brand:     normalizeBrand(row.E1_Brand),
      unilog_brand: normalizeBrand(row.Unilog_Brand),
      dib_brand:    normalizeBrand(row.DIB_Brand),
    },
    part_manuf: parseManufacturer(row.Part_Manuf),
  };
}

function normalizeRows(rows) {
  const products = [], errors = [];
  for (let i = 0; i < rows.length; i++) {
    try { products.push(normalizeRow(rows[i])); }
    catch (err) { errors.push({ row_index: i, raw: rows[i], reason: err.message }); }
  }
  return { products, errors };
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const CSV_PATH = resolve(
  __dirname,
  "../../..",
  "Unihack_ 10 products Dataset - Input.csv"
);

console.log("📄 Reading:", CSV_PATH, "\n");
const text    = readFileSync(CSV_PATH, "utf-8");
const rawRows = parseCsvString(text);
const { products, errors } = normalizeRows(rawRows);

console.log(`✅ ${rawRows.length} raw rows → ${products.length} normalized, ${errors.length} errors\n`);

for (const p of products) {
  console.log(JSON.stringify(p, null, 2));
  console.log("---");
}

if (errors.length > 0) {
  console.warn("\n⚠️  Parse errors:");
  for (const e of errors) console.warn(`  Row ${e.row_index}: ${e.reason}`);
}
