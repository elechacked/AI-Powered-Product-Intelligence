import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'products.db');
export const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS company_domain_cache (
    normalized_company_name TEXT PRIMARY KEY,
    official_domain TEXT,
    status TEXT,
    resolution_confidence REAL,
    resolution_method TEXT,
    validated_at TEXT,
    resolved_at TEXT,
    updated_at TEXT,
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS product_url_cache (
    official_domain TEXT,
    normalized_mfg_part_num TEXT,
    product_url TEXT,
    sku_match_status TEXT,
    url_status TEXT,
    checked_at TEXT,
    expires_at TEXT,
    PRIMARY KEY (official_domain, normalized_mfg_part_num)
  );

  CREATE TABLE IF NOT EXISTS import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_filename TEXT,
    total_products INTEGER,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_batch_id INTEGER,
    mfg_part_num TEXT,
    part_desc TEXT,
    e1_brand TEXT,
    unilog_brand TEXT,
    dib_brand TEXT,
    part_manuf_raw TEXT,
    part_manuf_company_name TEXT,
    part_manuf_supplier_code TEXT,
    input_json TEXT,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY(import_batch_id) REFERENCES import_batches(id)
  );

  CREATE TABLE IF NOT EXISTS product_pipeline_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    stage TEXT,
    status TEXT,
    output_json TEXT,
    error_json TEXT,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT,
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS product_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    source_name TEXT,
    source_role TEXT,
    source_domain TEXT,
    source_url TEXT,
    status TEXT,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS source_crawl_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_source_id INTEGER,
    source_type TEXT,
    url TEXT,
    status TEXT,
    output_json TEXT,
    error_json TEXT,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY(product_source_id) REFERENCES product_sources(id)
  );

  CREATE TABLE IF NOT EXISTS sanitized_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_source_id INTEGER,
    status TEXT,
    evidence_json TEXT,
    stats_json TEXT,
    error_json TEXT,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY(product_source_id) REFERENCES product_sources(id)
  );
`);
