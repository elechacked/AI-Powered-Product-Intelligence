# TRD — Technical Requirements Document
# AI-Powered Product Intelligence for Industrial Commerce

**Version:** 2.0
**Stack:** FastAPI + SQLite + React (shadcn-admin) + Gemini 2.0 Flash + Groq Llama 3.3 70B
**Deployment:** Local only (demo)
**Last Updated:** 2026-08-20

---

## 1. System Architecture

```
+----------------------------------------------------------+
|                    React Frontend                        |
|   shadcn-admin (satnaing/shadcn-admin template)          |
|                                                          |
|  / Dashboard   /upload   /products/:id   /export        |
|  Diff View     Explainability Drawer     Batch Export    |
+---------------------------+------------------------------+
                            | HTTP REST (axios + TanStack Query)
+---------------------------v------------------------------+
|                   FastAPI Backend                        |
|                                                          |
|  /api/upload       -> Ingestion Layer (CSV parse)        |
|  /api/jobs/{id}    -> Job Status Polling                 |
|  /api/products     -> CRUD + Query Layer                 |
|  /api/export       -> Export Service (252-col CSV)       |
|  /api/stats        -> Dashboard Stats                    |
|                                                          |
|  BackgroundTasks -> Orchestrator -> 6 Agent Pipeline     |
+-------+----------------------------+--------------------+
        |                            |
+-------v-------+         +----------v-----------+
| SQLite DB     |         | External Services     |
|               |         |                       |
| products      |         | Gemini 2.0 Flash API  |
| enriched_     |         | Groq Llama 3.3 70B    |
|   records     |         | MFR Websites          |
| enriched_     |         |   (httpx + playwright) |
|   fields      |         +-----------------------+
| validation_   |
|   issues      |         +----------------------+
| scrape_cache  |         | /uploads folder      |
| ingestion_    |         | (CSV files stored)   |
|   jobs        |         +----------------------+
+---------------+

6-AGENT PIPELINE (per product, sequential):
  [Scraper] -> [Classifier] -> [Extractor] -> [Normalizer] -> [Writer] -> [Validator]
     |              |               |               |              |            |
  httpx/       Groq Fast       Gemini Long      Rule-based    Gemini       Pure Code
  playwright   Classpath       Attr Extract     + LLM assist  5 Descs      Format Check
```

---

## 2. Tech Stack — Exact Versions

### Backend
| Package | Version | Purpose |
|---|---|---|
| `fastapi` | 0.111.x | API framework |
| `uvicorn` | 0.30.x | ASGI server |
| `sqlalchemy` | 2.0.x | ORM (async) |
| `aiosqlite` | 0.20.x | Async SQLite driver |
| `httpx` | 0.27.x | Async HTTP for scraping + AI APIs |
| `playwright` | 1.44.x | JS-rendered page scraping fallback |
| `pandas` | 2.2.x | CSV parsing + batch processing |
| `python-multipart` | 0.0.9 | File upload handling |
| `python-dotenv` | 1.0.x | Environment variables |
| `pydantic` | 2.x | Request/response validation |
| `tenacity` | 8.x | Retry logic with exponential backoff |
| `google-generativeai` | 0.8.x | Gemini 2.0 Flash client |
| `groq` | 0.9.x | Groq Llama 3.3 70B client |
| `beautifulsoup4` | 4.12.x | HTML parsing from scraped pages |
| `lxml` | 5.x | Fast HTML parser backend for bs4 |
| `python-jose` | N/A | NOT needed (no auth) |

### AI Services (Free Tier)
| Service | Model | Use | Limits |
|---|---|---|---|
| Google Gemini | `gemini-2.0-flash` | Extraction + Writing (2 agents) | 200 RPD, 15 RPM, 1M TPM |
| Groq | `llama-3.3-70b-versatile` | Classification + fallback | 1000 RPD, 30 RPM, 12K TPM |

### Frontend
| Package | Purpose |
|---|---|
| `satnaing/shadcn-admin` | Base template (clone from GitHub) |
| `shadcn/ui` | Component library |
| `tailwindcss` | Styling |
| `recharts` | Confidence score charts |
| `react-dropzone` | Drag-and-drop file upload |
| `axios` | HTTP client |
| `@tanstack/react-query` | Server state + polling |
| `react-router-dom` | Client-side routing |

### Database
| Item | Detail |
|---|---|
| Engine | SQLite (file-based, no server process) |
| ORM | SQLAlchemy 2.0 async |
| File | `backend/products.db` |
| Migrations | Alembic (optional; can use `create_all` for hackathon) |

---

## 3. Database Schema

```sql
-- Master product record (input + job tracking)
CREATE TABLE products (
  id              TEXT PRIMARY KEY,         -- UUID v4
  mfg_part_num    TEXT NOT NULL,
  part_desc       TEXT,
  e1_brand        TEXT,
  unilog_brand    TEXT,
  dib_brand       TEXT,
  part_manuf      TEXT,
  source_type     TEXT DEFAULT 'csv_upload', -- csv_upload | single_paste | url
  source_filename TEXT,
  batch_id        TEXT,                     -- groups products from same upload
  job_status      TEXT DEFAULT 'pending',   -- pending|scraping|classifying|extracting|normalizing|writing|validating|done|failed
  job_progress    INTEGER DEFAULT 0,        -- 0-100
  current_agent   TEXT,                     -- which agent is currently running
  error_message   TEXT,
  commerce_ready  INTEGER DEFAULT 0,        -- 0 or 1
  overall_confidence REAL DEFAULT 0.0,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- One row per enriched output field per product
CREATE TABLE enriched_fields (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field_name      TEXT NOT NULL,            -- e.g. INVOICE_DESC, ATTRIBUTE_VALUE_1
  field_value     TEXT,
  field_uom       TEXT,                     -- unit of measure if applicable
  confidence      REAL DEFAULT 0.0,         -- 0.0 to 1.0
  is_inferred     INTEGER DEFAULT 0,        -- 0 = extracted, 1 = inferred
  source_url      TEXT,
  source_snippet  TEXT,                     -- exact text from source supporting this value
  reasoning       TEXT,                     -- AI explanation
  original_value  TEXT,                     -- pre-normalization value for audit
  validation_status TEXT DEFAULT 'ok'       -- ok | warning | error
);

-- Full 252-column output stored as JSON (for export)
CREATE TABLE enriched_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id      TEXT NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  record_json     TEXT NOT NULL,            -- full 252-col record as JSON object
  exported_at     TEXT,
  export_count    INTEGER DEFAULT 0
);

-- Validation issues (format errors, conflicts, warnings)
CREATE TABLE validation_issues (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field_name      TEXT,
  issue_type      TEXT,                     -- char_limit | casing | uom_format | conflict | self_consistency | missing_required
  severity        TEXT,                     -- low | medium | high
  description     TEXT,
  value_a         TEXT,                     -- first value (for conflicts)
  value_b         TEXT,                     -- second value (for conflicts)
  source_a        TEXT,
  source_b        TEXT,
  resolved        INTEGER DEFAULT 0,
  resolved_value  TEXT,
  resolved_at     TEXT
);

-- Scrape cache (avoid re-scraping during demo)
CREATE TABLE scrape_cache (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  url             TEXT NOT NULL UNIQUE,
  scraped_text    TEXT NOT NULL,
  source_quality  TEXT DEFAULT 'medium',    -- high | medium | low
  scraped_at      TEXT DEFAULT (datetime('now')),
  expires_at      TEXT                      -- 1 hour TTL
);

-- Per-product job log (agent progress events)
CREATE TABLE ingestion_jobs (
  id              TEXT PRIMARY KEY,         -- UUID
  product_id      TEXT REFERENCES products(id) ON DELETE CASCADE,
  agent_name      TEXT,                     -- which agent emitted this
  event_type      TEXT,                     -- started | completed | failed | progress
  message         TEXT,
  metadata        TEXT,                     -- JSON for extra data
  created_at      TEXT DEFAULT (datetime('now'))
);
```

---

## 4. API Endpoints

### Ingestion
```
POST   /api/upload                -> Upload CSV file; returns {batch_id, product_ids[], total_count}
POST   /api/ingest/text           -> Single product paste; returns {product_id, job_id}
GET    /api/jobs/{job_id}         -> Poll status {status, progress, current_agent, error}
GET    /api/batches/{batch_id}    -> Batch progress {total, done, failed, pct_complete}
```

### Products
```
GET    /api/products              -> List (filters: status, commerce_ready, category, confidence_min)
GET    /api/products/{id}         -> Full detail with all enriched fields
DELETE /api/products/{id}         -> Hard delete product + cascade
PATCH  /api/products/{id}/field   -> Manual field override {field_name, value} -> confidence=1.0
POST   /api/products/{id}/re-enrich -> Re-run full pipeline
```

### Enrichment & Explainability
```
GET    /api/products/{id}/trace      -> All fields with full source + reasoning
GET    /api/products/{id}/diff       -> Before/after comparison object
GET    /api/products/{id}/conflicts  -> All unresolved conflicts
PATCH  /api/products/{id}/conflicts/{conflict_id}/resolve -> {choice: 'a'|'b'|'custom', custom_value: ''}
```

### Export
```
GET    /api/products/{id}/export/json   -> Single product JSON
GET    /api/products/{id}/export/csv    -> Single 252-col CSV row
POST   /api/export/batch                -> {product_ids[], format, confidence_threshold}
GET    /api/export/batch/{batch_id}/csv -> Download 252-col batch CSV
```

### Dashboard
```
GET    /api/stats     -> {total, done, failed, commerce_ready, avg_confidence, by_category{}}
GET    /api/accuracy  -> Field-level accuracy vs ground truth (if ground truth loaded)
```

---

## 5. Agent Input/Output Contracts

### ScraperAgent
```python
class ScraperInput(BaseModel):
    mfg_part_num: str
    part_desc: str
    part_manuf: str
    e1_brand: str

class ScraperOutput(BaseModel):
    mfr_url: Optional[str]
    ref_urls: List[str]         # up to 5
    scraped_text: str           # combined text from all pages
    source_quality: str         # high | medium | low
    from_cache: bool
```

### ClassifierAgent
```python
class ClassifierInput(BaseModel):
    part_desc: str
    scraped_text: str
    mfg_part_num: str

class ClassifierOutput(BaseModel):
    dept: str
    class_: str
    fine: str
    classpath: str              # "Appliances & Consumer Electronics > Kitchen > Dishwashers"
    unspsc_code: str
    confidence: float
```

### ExtractorAgent
```python
class AttributeItem(BaseModel):
    label: str
    value: str
    uom: Optional[str]
    raw_value: str              # before normalization
    confidence: float
    source_snippet: str
    is_inferred: bool

class ExtractorOutput(BaseModel):
    manufacturer_name: str
    brand_name: str
    trade_name: Optional[str]
    alternate_part_number: Optional[str]
    attributes: List[AttributeItem]  # dynamic, up to 50
    physical: dict              # {length, height, width, weight with uoms}
    certifications: List[str]
    features: List[str]         # up to 20 bullet points
    prop65: Optional[str]
    rohs: Optional[str]
    country_of_origin: Optional[str]
    upc: Optional[str]
    warranty: Optional[str]
```

### NormalizerAgent
```python
class NormalizerOutput(BaseModel):
    normalized_attributes: List[AttributeItem]
    brand_name_canonical: str   # with (R) and (TM) symbols
    manufacturer_name_canonical: str
    uom_issues: List[str]       # list of fields that needed UOM correction
```

### WriterAgent
```python
class WriterOutput(BaseModel):
    invoice_desc: str           # <= 40 chars, ALL CAPS
    mobile_desc: str            # 60-80 chars
    short_desc: str             # ~120 chars
    long_desc1: str             # full paragraph
    retail_desc: str            # ~80 chars
    marketing_description: str  # 2-3 sentences
    item_features: List[str]    # up to 20
    with_accessories: Optional[str]
    includes: Optional[str]
    application: Optional[str]
```

### ValidatorAgent (deterministic — no LLM)
```python
class FieldValidation(BaseModel):
    field_name: str
    value: str
    confidence: float
    issues: List[str]           # list of validation failures

class ValidatorOutput(BaseModel):
    field_validations: List[FieldValidation]
    validation_issues: List[dict]  # written to DB
    commerce_ready: bool
    overall_confidence: float
    char_limit_compliance: float   # % of fields passing char limits
    uom_compliance: float          # % of UOM fields correctly formatted
```

---

## 6. Self-Validation Rules (Deterministic)

```python
CHAR_LIMITS = {
    "INVOICE_DESC":   40,
    "MOBILE_DESC":    80,
    "SHORT_DESC":     150,
    "LONG_DESC1":     2000,
    "RETAIL_DESC":    100,
}

CASING_RULES = {
    "INVOICE_DESC": "upper",
    "MOBILE_DESC":  "title",
    "SHORT_DESC":   "title",
    "RETAIL_DESC":  "title",
}

UOM_PATTERN = r"^\d+(\.\d+)?(\/\d+)?\s+[a-zA-Z]+"  # "24 in", "120 V", "1/2 in"

REQUIRED_FIELDS = [
    "MANUFACTURER_NAME", "BRAND_NAME", "Classpath",
    "INVOICE_DESC", "SHORT_DESC", "LONG_DESC1",
    "ATTRIBUTE_LABEL 1",  # at least one attribute required
]
```

---

## 7. LLM Rate Limit Strategy

```python
# Gemini 2.0 Flash free tier
GEMINI_RPD = 200      # requests per day
GEMINI_RPM = 15       # requests per minute
GEMINI_TPM = 1000000  # tokens per minute

# Groq Llama 3.3 70B free tier
GROQ_RPD = 1000
GROQ_RPM = 30
GROQ_TPM = 12000      # much lower — only for short tasks

# Routing logic:
# - Extractor + Writer -> Gemini (long context, quality matters)
# - Classifier -> Groq (short input/output, speed matters)
# - On Gemini 429 -> retry 3x with backoff, then switch to Groq
# - Track daily usage in SQLite config table
```

---

## 8. Error Handling Matrix

| Error | Handling |
|---|---|
| Gemini 429 rate limit | Retry 3x (2s, 4s, 8s backoff), then route to Groq |
| Gemini malformed JSON | Re-prompt once with stricter instruction, then mark field as failed |
| Scraping blocked (403/bot) | Fall back to LLM inference from part_desc only; lower confidence |
| Playwright timeout | 10s timeout; fall back to httpx result or LLM inference |
| SQLite locked | Auto-retry 3x (WAL mode enabled) |
| CSV parse error | Skip malformed rows, log error, continue with valid rows |
| Product pipeline failure | Mark product as failed; do not break batch; surface error in UI |

---

## 9. Environment Variables

```env
# .env
SQLITE_URL=sqlite+aiosqlite:///./products.db
GEMINI_API_KEY=your_gemini_key_here
GROQ_API_KEY=your_groq_key_here
UPLOAD_DIR=./uploads
MAX_UPLOAD_SIZE_MB=10
CONFIDENCE_THRESHOLD=0.60
COMMERCE_READY_THRESHOLD=0.70
SCRAPE_CACHE_TTL_HOURS=1
DEMO_MODE=true
CORS_ORIGINS=http://localhost:5173
```

---

## 10. Frontend Page Structure

| Route | Component | Key Features |
|---|---|---|
| `/` | Dashboard | Stats cards, product table, filters, batch progress |
| `/upload` | UploadPage | Drag-drop zone, paste text, upload progress |
| `/products/:id` | ProductDetail | Attribute grid, confidence badges, validation flags, diff view |
| `/products/:id/trace` | ExplainabilityDrawer | Field-by-field source + reasoning (sheet component) |
| `/export` | ExportPage | Batch export, confidence threshold slider, download |

---

## 11. Performance Targets

| Operation | Target |
|---|---|
| Single product end-to-end | < 15 seconds |
| Scraping (cached) | < 100ms |
| Scraping (live httpx) | < 3 seconds |
| Scraping (live playwright) | < 10 seconds |
| Gemini API call | < 5 seconds |
| Groq API call | < 1 second |
| CSV export (200 rows) | < 2 seconds |
| Dashboard page load | < 500ms |
