# DATABASE_SCHEMA.md — SQLite Database Schema
# AI-Powered Product Intelligence for Industrial Commerce

**Version:** 2.0

---

## 1. Entity Relationship Overview

```
+------------------+       +--------------------+       +---------------------+
|    products      |       |  enriched_fields   |       |  enriched_records   |
|------------------|       |--------------------|       |---------------------|
| id (PK)          |1-----N| product_id (FK)    |       | product_id (FK, UQ) |
| mfg_part_num     |       | field_name         |1-----1| record_json         |
| part_desc        |       | field_value        |       | exported_at         |
| batch_id         |       | confidence         |       +---------------------+
| job_status       |       | source_url         |
| commerce_ready   |       | is_inferred        |       +--------------------+
+------------------+       +--------------------+       | validation_issues  |
         |                                              |--------------------|
         |1                                             | product_id (FK)    |
         |                                              | field_name         |
         |N                                             | issue_type         |
+------------------+       +--------------------+       | severity           |
|  ingestion_jobs  |       |   scrape_cache     |       | value_a, value_b   |
|------------------|       |--------------------|       | resolved           |
| product_id (FK)  |       | url (UQ)           |       +--------------------+
| agent_name       |       | scraped_text       |
| event_type       |       | source_quality     |
| message          |       | expires_at         |
+------------------+       +--------------------+
```

---

## 2. Complete Table Definitions

```sql
-- ============================================================
-- TABLE: products
-- Master record per product. Created on upload, updated
-- by each agent as the pipeline progresses.
-- ============================================================
CREATE TABLE products (
  id                  TEXT PRIMARY KEY,
  -- Input columns (raw from CSV)
  mfg_part_num        TEXT NOT NULL,
  part_desc           TEXT,
  e1_brand            TEXT,
  unilog_brand        TEXT,
  dib_brand           TEXT,
  part_manuf          TEXT,
  -- Upload metadata
  source_type         TEXT DEFAULT 'csv_upload',
  -- Values: csv_upload | single_paste | url
  source_filename     TEXT,
  batch_id            TEXT,
  -- Pipeline tracking
  job_status          TEXT DEFAULT 'pending',
  -- Values: pending|scraping|classifying|extracting|
  --         normalizing|writing|validating|done|failed
  job_progress        INTEGER DEFAULT 0,
  current_agent       TEXT,
  error_message       TEXT,
  retry_count         INTEGER DEFAULT 0,
  -- Output summary (denormalized for fast dashboard queries)
  dept                TEXT,
  class_name          TEXT,
  fine_category       TEXT,
  classpath           TEXT,
  manufacturer_name   TEXT,
  brand_name          TEXT,
  commerce_ready      INTEGER DEFAULT 0,
  overall_confidence  REAL DEFAULT 0.0,
  total_fields        INTEGER DEFAULT 0,
  confident_fields    INTEGER DEFAULT 0,
  -- Timestamps
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_products_batch_id     ON products(batch_id);
CREATE INDEX idx_products_job_status   ON products(job_status);
CREATE INDEX idx_products_commerce_ready ON products(commerce_ready);
CREATE INDEX idx_products_classpath    ON products(classpath);


-- ============================================================
-- TABLE: enriched_fields
-- One row per output field per product.
-- Supports the explainability panel (every field traceable).
-- ============================================================
CREATE TABLE enriched_fields (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id          TEXT NOT NULL,
  -- Field identity
  field_name          TEXT NOT NULL,
  -- e.g. INVOICE_DESC, ATTRIBUTE_LABEL_1, ATTRIBUTE_VALUE_1,
  --      MANUFACTURER_NAME, SHORT_DESC, Classpath
  field_value         TEXT,
  field_uom           TEXT,
  -- Enrichment metadata
  confidence          REAL DEFAULT 0.0,
  is_inferred         INTEGER DEFAULT 0,
  source_url          TEXT,
  source_snippet      TEXT,
  reasoning           TEXT,
  original_value      TEXT,
  validation_status   TEXT DEFAULT 'ok',
  -- Values: ok | warning | error
  -- Agent that produced this field
  producing_agent     TEXT,
  -- e.g. extractor | writer | normalizer | manual
  -- Timestamps
  created_at          TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX idx_enriched_product_id  ON enriched_fields(product_id);
CREATE INDEX idx_enriched_field_name  ON enriched_fields(field_name);
CREATE INDEX idx_enriched_confidence  ON enriched_fields(confidence);


-- ============================================================
-- TABLE: enriched_records
-- Full 252-column record stored as JSON.
-- Used for fast CSV export without re-joining enriched_fields.
-- ============================================================
CREATE TABLE enriched_records (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id          TEXT NOT NULL UNIQUE,
  record_json         TEXT NOT NULL,
  -- Full 252-col object: {"INVOICE_DESC": "...", "Classpath": "...", ...}
  schema_version      TEXT DEFAULT '2.0',
  char_limit_compliance REAL DEFAULT 0.0,
  uom_compliance      REAL DEFAULT 0.0,
  exported_at         TEXT,
  export_count        INTEGER DEFAULT 0,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);


-- ============================================================
-- TABLE: validation_issues
-- All format errors, conflicts, and warnings.
-- Supports the conflict resolution UI.
-- ============================================================
CREATE TABLE validation_issues (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id          TEXT NOT NULL,
  field_name          TEXT,
  -- Issue classification
  issue_type          TEXT NOT NULL,
  -- Values: char_limit | casing | uom_format | conflict |
  --         self_consistency | missing_required | brand_format
  severity            TEXT NOT NULL,
  -- Values: low | medium | high
  description         TEXT,
  -- For conflicts: two competing values
  value_a             TEXT,
  source_a            TEXT,
  value_b             TEXT,
  source_b            TEXT,
  -- Resolution
  resolved            INTEGER DEFAULT 0,
  resolved_value      TEXT,
  resolved_by         TEXT DEFAULT 'user',
  resolved_at         TEXT,
  created_at          TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX idx_issues_product_id ON validation_issues(product_id);
CREATE INDEX idx_issues_resolved   ON validation_issues(resolved);
CREATE INDEX idx_issues_severity   ON validation_issues(severity);


-- ============================================================
-- TABLE: scrape_cache
-- Avoids re-scraping during demo. URL-keyed, TTL-based.
-- ============================================================
CREATE TABLE scrape_cache (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  url                 TEXT NOT NULL UNIQUE,
  scraped_text        TEXT NOT NULL,
  source_quality      TEXT DEFAULT 'medium',
  scrape_method       TEXT DEFAULT 'httpx',
  scraped_at          TEXT DEFAULT (datetime('now')),
  expires_at          TEXT NOT NULL
  -- Set to datetime('now', '+1 hours') on insert
);

CREATE INDEX idx_cache_url        ON scrape_cache(url);
CREATE INDEX idx_cache_expires_at ON scrape_cache(expires_at);


-- ============================================================
-- TABLE: ingestion_jobs
-- Per-product event log. One row per significant event.
-- Used for real-time pipeline progress visibility.
-- ============================================================
CREATE TABLE ingestion_jobs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id          TEXT NOT NULL,
  agent_name          TEXT NOT NULL,
  -- Values: orchestrator|scraper|classifier|extractor|
  --         normalizer|writer|validator
  event_type          TEXT NOT NULL,
  -- Values: started|completed|failed|progress|cached
  message             TEXT,
  metadata            TEXT,
  -- JSON string for extra data (e.g. {"confidence": 0.9, "url": "..."})
  created_at          TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX idx_jobs_product_id  ON ingestion_jobs(product_id);
CREATE INDEX idx_jobs_agent_name  ON ingestion_jobs(agent_name);


-- ============================================================
-- TABLE: app_config
-- Runtime configuration (API call counters, thresholds).
-- ============================================================
CREATE TABLE app_config (
  key                 TEXT PRIMARY KEY,
  value               TEXT NOT NULL,
  updated_at          TEXT DEFAULT (datetime('now'))
);

-- Seed values
INSERT INTO app_config VALUES ('gemini_calls_today', '0', datetime('now'));
INSERT INTO app_config VALUES ('groq_calls_today', '0', datetime('now'));
INSERT INTO app_config VALUES ('confidence_threshold', '0.60', datetime('now'));
INSERT INTO app_config VALUES ('commerce_ready_threshold', '0.70', datetime('now'));
INSERT INTO app_config VALUES ('last_reset_date', date('now'), datetime('now'));
```

---

## 3. Common Query Examples

```sql
-- Dashboard stats
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN job_status = 'done' THEN 1 ELSE 0 END) as done,
  SUM(CASE WHEN job_status = 'failed' THEN 1 ELSE 0 END) as failed,
  SUM(CASE WHEN commerce_ready = 1 THEN 1 ELSE 0 END) as commerce_ready,
  AVG(CASE WHEN job_status = 'done' THEN overall_confidence END) as avg_confidence
FROM products;

-- Category breakdown
SELECT
  COALESCE(classpath, 'Unclassified') as category,
  COUNT(*) as count,
  AVG(overall_confidence) as avg_confidence,
  SUM(commerce_ready) as ready_count
FROM products
GROUP BY classpath
ORDER BY count DESC;

-- Batch progress
SELECT
  batch_id,
  COUNT(*) as total,
  SUM(CASE WHEN job_status = 'done' THEN 1 ELSE 0 END) as done,
  SUM(CASE WHEN job_status = 'failed' THEN 1 ELSE 0 END) as failed,
  ROUND(100.0 * SUM(CASE WHEN job_status = 'done' THEN 1 ELSE 0 END) / COUNT(*), 1) as pct_complete
FROM products
WHERE batch_id = :batch_id
GROUP BY batch_id;

-- Products needing attention (low confidence OR unresolved conflicts)
SELECT p.id, p.mfg_part_num, p.part_desc, p.overall_confidence,
  COUNT(vi.id) as conflict_count
FROM products p
LEFT JOIN validation_issues vi
  ON vi.product_id = p.id AND vi.resolved = 0 AND vi.severity = 'high'
WHERE p.job_status = 'done'
  AND (p.overall_confidence < 0.70 OR COUNT(vi.id) > 0)
GROUP BY p.id
ORDER BY p.overall_confidence ASC;

-- Field-level accuracy (when ground truth available)
-- Compare enriched field values against expected output
SELECT
  ef.field_name,
  COUNT(*) as total_fields,
  SUM(CASE WHEN LOWER(ef.field_value) = LOWER(gt.expected_value) THEN 1 ELSE 0 END) as exact_matches,
  ROUND(100.0 * SUM(CASE WHEN LOWER(ef.field_value) = LOWER(gt.expected_value) THEN 1 ELSE 0 END) / COUNT(*), 1) as accuracy_pct,
  AVG(ef.confidence) as avg_confidence
FROM enriched_fields ef
JOIN ground_truth gt ON gt.product_id = ef.product_id AND gt.field_name = ef.field_name
GROUP BY ef.field_name
ORDER BY accuracy_pct ASC;

-- Explainability trace for one product
SELECT
  field_name,
  field_value,
  field_uom,
  ROUND(confidence * 100) as confidence_pct,
  is_inferred,
  source_url,
  source_snippet,
  reasoning,
  validation_status
FROM enriched_fields
WHERE product_id = :product_id
ORDER BY confidence DESC;

-- Validation compliance report
SELECT
  issue_type,
  severity,
  COUNT(*) as count,
  ROUND(100.0 * SUM(resolved) / COUNT(*), 1) as resolution_rate
FROM validation_issues
GROUP BY issue_type, severity
ORDER BY severity DESC, count DESC;
```

---

## 4. SQLAlchemy Models (Python)

```python
# app/models/product.py
from sqlalchemy import Column, Text, Integer, Float, String
from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase

class Base(AsyncAttrs, DeclarativeBase):
    pass

class Product(Base):
    __tablename__ = "products"
    id                  = Column(Text, primary_key=True)
    mfg_part_num        = Column(Text, nullable=False)
    part_desc           = Column(Text)
    e1_brand            = Column(Text)
    unilog_brand        = Column(Text)
    dib_brand           = Column(Text)
    part_manuf          = Column(Text)
    source_type         = Column(Text, default="csv_upload")
    source_filename     = Column(Text)
    batch_id            = Column(Text)
    job_status          = Column(Text, default="pending")
    job_progress        = Column(Integer, default=0)
    current_agent       = Column(Text)
    error_message       = Column(Text)
    retry_count         = Column(Integer, default=0)
    dept                = Column(Text)
    class_name          = Column(Text)
    fine_category       = Column(Text)
    classpath           = Column(Text)
    manufacturer_name   = Column(Text)
    brand_name          = Column(Text)
    commerce_ready      = Column(Integer, default=0)
    overall_confidence  = Column(Float, default=0.0)
    total_fields        = Column(Integer, default=0)
    confident_fields    = Column(Integer, default=0)
    created_at          = Column(Text)
    updated_at          = Column(Text)

class EnrichedField(Base):
    __tablename__ = "enriched_fields"
    id                  = Column(Integer, primary_key=True, autoincrement=True)
    product_id          = Column(Text, nullable=False)
    field_name          = Column(Text, nullable=False)
    field_value         = Column(Text)
    field_uom           = Column(Text)
    confidence          = Column(Float, default=0.0)
    is_inferred         = Column(Integer, default=0)
    source_url          = Column(Text)
    source_snippet      = Column(Text)
    reasoning           = Column(Text)
    original_value      = Column(Text)
    validation_status   = Column(Text, default="ok")
    producing_agent     = Column(Text)
    created_at          = Column(Text)

class ValidationIssue(Base):
    __tablename__ = "validation_issues"
    id                  = Column(Integer, primary_key=True, autoincrement=True)
    product_id          = Column(Text, nullable=False)
    field_name          = Column(Text)
    issue_type          = Column(Text, nullable=False)
    severity            = Column(Text, nullable=False)
    description         = Column(Text)
    value_a             = Column(Text)
    source_a            = Column(Text)
    value_b             = Column(Text)
    source_b            = Column(Text)
    resolved            = Column(Integer, default=0)
    resolved_value      = Column(Text)
    resolved_by         = Column(Text, default="user")
    resolved_at         = Column(Text)
    created_at          = Column(Text)
```

---

## 5. Data Lifecycle

```
PRODUCT CREATED (job_status=pending)
    -> SCRAPING    : scrape_cache populated OR live scrape
    -> CLASSIFYING : dept/class/fine/classpath written to products table
    -> EXTRACTING  : enriched_fields rows inserted (one per attribute)
    -> NORMALIZING : enriched_fields rows updated (normalized values)
    -> WRITING     : enriched_fields rows for all 5 descs inserted
    -> VALIDATING  : validation_issues inserted; confidence computed
                     enriched_records.record_json assembled and saved
                     products.commerce_ready and overall_confidence updated
    -> DONE        : product available for UI and export

EXPORT TRIGGERED:
    -> Read enriched_records.record_json
    -> Map to 252-column Unilog delivery format headers
    -> Write CSV with exact headers from expected output template
    -> Update enriched_records.exported_at and export_count

CONFLICT RESOLVED:
    -> Update validation_issues.resolved=1, resolved_value
    -> Update enriched_fields.field_value for the affected field
    -> Re-run validator commerce_ready check
    -> Update products.commerce_ready
```
