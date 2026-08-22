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
