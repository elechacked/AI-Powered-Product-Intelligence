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

  CREATE TABLE IF NOT EXISTS product_extractions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    extraction_status TEXT,
    extraction_json TEXT,
    model_used TEXT,
    provider_used TEXT,
    fallback_used BOOLEAN,
    retry_count INTEGER,
    error TEXT,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS llm_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    created_at TEXT, 
    agent_name TEXT, 
    model_name TEXT, 
    product_sku TEXT, 
    product_brand TEXT, 
    product_id INTEGER, 
    total_tokens INTEGER, 
    latency_ms INTEGER, 
    prompt_tokens INTEGER, 
    completion_tokens INTEGER, 
    response_text TEXT, 
    user_prompt TEXT, 
    system_prompt TEXT
  );

  CREATE TABLE IF NOT EXISTS taxonomy_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    parent_id INTEGER, 
    level TEXT, 
    name TEXT, 
    canonical_path TEXT UNIQUE, 
    embedding TEXT, 
    created_at TEXT, 
    updated_at TEXT, 
    FOREIGN KEY(parent_id) REFERENCES taxonomy_nodes(id)
  );

  CREATE TABLE IF NOT EXISTS product_classifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    product_id INTEGER UNIQUE, 
    taxonomy_id INTEGER, 
    classification_status TEXT, 
    classification_json TEXT, 
    model_used TEXT, 
    provider_used TEXT, 
    fallback_used BOOLEAN, 
    retry_count INTEGER, 
    error TEXT, 
    created_at TEXT, 
    updated_at TEXT, 
    FOREIGN KEY(product_id) REFERENCES products(id), 
    FOREIGN KEY(taxonomy_id) REFERENCES taxonomy_nodes(id) 
  );

  CREATE TABLE IF NOT EXISTS taxonomy_attributes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    taxonomy_id INTEGER NOT NULL, 
    attribute_name TEXT NOT NULL, 
    normalized_name TEXT NOT NULL, 
    created_at TEXT NOT NULL, 
    updated_at TEXT NOT NULL, 
    is_dimensional BOOLEAN DEFAULT 0, 
    UNIQUE(taxonomy_id, normalized_name)
  );

  CREATE TABLE IF NOT EXISTS taxonomy_attribute_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    taxonomy_attribute_id INTEGER NOT NULL, 
    value_text TEXT NOT NULL, 
    normalized_value TEXT NOT NULL, 
    created_at TEXT NOT NULL, 
    updated_at TEXT NOT NULL, 
    UNIQUE(taxonomy_attribute_id, normalized_value), 
    FOREIGN KEY(taxonomy_attribute_id) REFERENCES taxonomy_attributes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS product_attribute_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    product_id INTEGER NOT NULL, 
    taxonomy_attribute_id INTEGER NOT NULL, 
    taxonomy_attribute_value_id INTEGER, 
    raw_value TEXT, 
    extracted_value TEXT, 
    provenance_json TEXT, 
    created_at TEXT NOT NULL, 
    updated_at TEXT NOT NULL, 
    normalized_value TEXT, 
    normalization_status TEXT, 
    normalization_method TEXT, 
    uom TEXT, 
    is_inferred BOOLEAN DEFAULT 0, 
    UNIQUE(product_id, taxonomy_attribute_id), 
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE, 
    FOREIGN KEY(taxonomy_attribute_id) REFERENCES taxonomy_attributes(id) ON DELETE CASCADE, 
    FOREIGN KEY(taxonomy_attribute_value_id) REFERENCES taxonomy_attribute_values(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS product_descriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL UNIQUE,
    invoice_description TEXT,
    mobile_description TEXT,
    in_app_description TEXT,
    short_description TEXT,
    long_description TEXT,
    retail_description TEXT,
    marketing_description TEXT,
    generation_status TEXT,
    fields_generated INTEGER,
    model_used TEXT,
    provider_used TEXT,
    fallback_used INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    latency_ms INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, 
    marketing_description_source_url TEXT, 
    marketing_description_source_name TEXT,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS validation_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    field_name TEXT NOT NULL,
    issue_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    description TEXT,
    value_a TEXT,
    value_b TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );
`);

[
 'canonical_product_id INTEGER REFERENCES products(id)',
 'normalized_mfg_part_num TEXT',
 'manufacturer_name TEXT',
 'commerce_ready BOOLEAN',
 'overall_confidence REAL',
 'validation_status TEXT'
].forEach(col => {
    try {
        db.exec(`ALTER TABLE products ADD COLUMN ${col}`);
    } catch(e) {}
});

db.exec(`CREATE INDEX IF NOT EXISTS idx_products_normalized_sku ON products(normalized_mfg_part_num)`);
