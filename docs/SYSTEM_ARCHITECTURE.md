# System Architecture — AI-Powered Product Intelligence for Industrial Commerce

> **Hackathon Project** | Unilog × Industrial Commerce Enrichment Pipeline  
> Stack: React · FastAPI · SQLite · Gemini 2.0 Flash · Groq Llama 3.3 70B · Playwright

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Full Architecture Diagram](#2-full-architecture-diagram)
3. [Agent Architecture](#3-agent-architecture)
4. [Data Stores](#4-data-stores)
5. [Request Lifecycle](#5-request-lifecycle)
6. [API Surface](#6-api-surface)
7. [Scalability Considerations](#7-scalability-considerations)
8. [Security Considerations](#8-security-considerations)

---

## 1. System Overview

The system ingests sparse 6-column CSV rows from industrial distributors and produces fully enriched 252-column Unilog delivery records. A six-agent LLM pipeline — orchestrated by a FastAPI backend — performs sequential web scraping, classification, attribute extraction, normalization, copywriting, and validation. The React frontend provides real-time job tracking, diff visualization, and export.

### Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Agent coordination | Synchronous chain via FastAPI BackgroundTasks | Simple, auditable, no broker overhead for hackathon scale |
| LLM routing | Gemini primary → Groq fallback | Rate limit protection; Gemini 200 RPD, Groq 1000 RPD |
| Schema enforcement | No LOV files — deterministic regex/JSON validation | LLM-driven extraction, format rules applied post-hoc |
| Web scraping | httpx for static + Playwright for JS-rendered | Cost-effective: httpx first, Playwright only on JS check failure |
| Database | SQLite with WAL mode | Zero-infrastructure for hackathon; swap to Postgres trivially |
| Enrichment caching | In-memory TTL cache (1 hour) per MFR URL | Eliminates redundant scrapes across CSV rows with same MFR |

---

## 2. Full Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                          REACT FRONTEND  (Vite + shadcn/ui)                     ║
║                                                                                  ║
║  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────┐ ║
║  │   Dashboard   │  │  CSV Upload  │  │  Product Detail  │  │   Diff / Export  │ ║
║  │  (job queue, │  │  (drag-drop, │  │  (252-col view, │  │  (side-by-side   │ ║
║  │   progress)  │  │   paste row) │  │   conf. scores) │  │   delta, export) │ ║
║  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘  └────────┬─────────┘ ║
║         └─────────────────┴──────────────┬─────┘                   │           ║
║                                          │   Axios / fetch (REST)  │           ║
╚══════════════════════════════════════════╪═════════════════════════╪═══════════╝
                                           │                         │
                    ┌──────────────────────▼─────────────────────────▼──────────┐
                    │                  FastAPI Backend  (:8000)                  │
                    │                                                            │
                    │  ┌─────────────────────────────────────────────────────┐  │
                    │  │               REST API Layer                         │  │
                    │  │  POST /jobs/upload   GET /jobs/{id}/status           │  │
                    │  │  POST /jobs/single   GET /jobs/{id}/result           │  │
                    │  │  POST /jobs/retry    GET /products/export            │  │
                    │  └────────────────────────┬────────────────────────────┘  │
                    │                           │                               │
                    │  ┌────────────────────────▼────────────────────────────┐  │
                    │  │          Agent Orchestrator (BackgroundTasks)        │  │
                    │  │                                                      │  │
                    │  │   for each row in job:                               │  │
                    │  │   ┌──────────┐  ┌────────────┐  ┌───────────────┐   │  │
                    │  │   │  Scraper │→ │ Classifier │→ │   Extractor   │   │  │
                    │  │   │  Agent   │  │   Agent    │  │     Agent     │   │  │
                    │  │   │ [httpx / │  │ [Gemini /  │  │  [Gemini /    │   │  │
                    │  │   │Playwright│  │   Groq]    │  │    Groq]      │   │  │
                    │  │   └──────────┘  └────────────┘  └──────┬────────┘   │  │
                    │  │                                         │             │  │
                    │  │   ┌──────────┐  ┌────────────┐  ┌──────▼────────┐   │  │
                    │  │   │Validator │← │   Writer   │← │  Normalizer   │   │  │
                    │  │   │  Agent   │  │   Agent    │  │    Agent      │   │  │
                    │  │   │[determin.]│  │ [Gemini /  │  │  [Gemini /    │   │  │
                    │  │   │           │  │   Groq]    │  │    Groq]      │   │  │
                    │  │   └──────────┘  └────────────┘  └───────────────┘   │  │
                    │  └────────────────────────────────────────────────────┘  │
                    │                                                            │
                    │  ┌─────────────────────────────────────────────────────┐  │
                    │  │          In-Memory Scrape Cache (TTL = 1h)          │  │
                    │  │    key: normalized_mfr_url → value: raw_text        │  │
                    │  └─────────────────────────────────────────────────────┘  │
                    │                                                            │
                    │  ┌────────────────────┐   ┌──────────────────────────┐   │
                    │  │  SQLite (WAL mode) │   │  File System             │   │
                    │  │  · jobs            │   │  /uploads/  (raw CSVs)   │   │
                    │  │  · products        │   │  /exports/  (output CSVs)│   │
                    │  │  · scrape_results  │   │  /logs/     (agent logs) │   │
                    │  │  · agent_logs      │   └──────────────────────────┘   │
                    │  └────────────────────┘                                   │
                    └────────────────┬──────────────────┬─────────────────────┘
                                     │                  │
               ┌─────────────────────▼──┐   ┌──────────▼──────────────────────┐
               │   GEMINI 2.0 FLASH API │   │          GROQ API               │
               │   (Google AI Studio)   │   │   (Llama 3.3 70B Versatile)     │
               │   · 200 RPD free       │   │   · 1000 RPD free               │
               │   · 1M TPM             │   │   · 6000 TPM                    │
               │   · Primary LLM        │   │   · Fallback LLM                │
               └────────────────────────┘   └─────────────────────────────────┘
                                     │
               ┌─────────────────────▼────────────────────────────────────────┐
               │                  MFR WEBSITES (External)                      │
               │  frigidaire.com · homedepot.com · grainger.com · etc.         │
               │  ┌─────────────────────┐   ┌──────────────────────────────┐  │
               │  │  httpx (static HTML) │   │  Playwright (JS-rendered)    │  │
               │  │  < 500ms avg        │   │  fallback when JS detection  │  │
               │  └─────────────────────┘   └──────────────────────────────┘  │
               └──────────────────────────────────────────────────────────────┘
```

---

## 3. Agent Architecture

The six agents form a sequential, auditable pipeline. Each agent receives a structured input contract, performs its function, writes results to SQLite, and passes a context object to the next agent. On failure, the orchestrator retries up to 2 times before marking the job row as `FAILED`.

---

### 3.1 Scraper Agent

**Purpose:** Discover and retrieve raw product content from manufacturer websites for a given part number. Acts as the knowledge acquisition layer — everything downstream depends on the quality of this raw text.

**Input Contract:**
```json
{
  "mfg_part_num": "PDSH4816AF",
  "part_desc": "PDSH4816AF Dishwasher SS - Display Only",
  "e1_brand": "-- Unbranded --",
  "unilog_brand": "",
  "dib_brand": "",
  "part_manuf": "Frigidaire"
}
```

**Output Contract:**
```json
{
  "source_url": "https://www.frigidaire.com/Kitchen-Appliances/Dishwashers/Built-In-Dishwasher/PDSH4816AF/",
  "raw_text": "PDSH4816AF Built-In Dishwasher... Capacity: 14 place settings...",
  "scrape_method": "httpx | playwright",
  "scrape_timestamp": "2026-08-20T11:30:00Z",
  "cache_hit": false,
  "http_status": 200,
  "confidence": 0.91
}
```

**LLM Usage:** None during scraping. Gemini is used only for URL candidate ranking if search fallback is invoked (part number not directly constructable as URL).

**Failure Handling:**

1. Try direct URL construction: `{brand_domain}/{part_num}`
2. If 404 → try Google search via `httpx` with `site:{brand_domain} {part_num}`
3. If static HTML is empty or under 500 chars → fall back to Playwright
4. If Playwright also fails → set `source_url = null`, `raw_text = ""`, continue pipeline with degraded confidence
5. All failures logged to `agent_logs` table with error detail

**Caching:** URL-keyed in-memory dict with `time.time()` expiry (TTL = 3600s). Cache checked before any HTTP request.

---

### 3.2 Classifier Agent

**Purpose:** Determine the Unilog `Classpath` (product taxonomy path) from the raw text and input row. This classification gates all downstream attribute extraction since expected attributes are classpath-dependent.

**Input Contract:**
```json
{
  "mfg_part_num": "PDSH4816AF",
  "part_desc": "...",
  "raw_text": "Built-In Dishwasher with 14 place settings...",
  "source_url": "https://..."
}
```

**Output Contract:**
```json
{
  "classpath": "Appliances & Consumer Electronics > Kitchen Appliances > Built-In Dishwashers",
  "classpath_confidence": 0.96,
  "alternative_classpaths": [
    {"path": "Appliances & Consumer Electronics > Kitchen Appliances > Dishwashers", "confidence": 0.72}
  ],
  "classification_source": "gemini-2.0-flash"
}
```

**LLM Used:** Gemini 2.0 Flash (primary). Groq Llama 3.3 70B (fallback if Gemini rate-limited or returns non-JSON).

**Prompt Strategy:** Zero-shot with chain-of-thought disabled. System prompt includes the full Unilog classpath taxonomy as a reference list. LLM is instructed to return valid JSON only — no prose.

**Failure Handling:**
- JSON parse failure → retry once with stricter "return ONLY valid JSON" instruction
- Confidence < 0.5 → flag as `NEEDS_REVIEW`, continue with best guess
- Complete failure → classpath = `"Uncategorized"`, confidence = 0.0

---

### 3.3 Extractor Agent

**Purpose:** Extract structured product attributes from raw scraped text, guided by the determined classpath. Produces a raw (un-normalized) attribute dictionary with 20–60 fields depending on product category.

**Input Contract:**
```json
{
  "raw_text": "...",
  "classpath": "Appliances & Consumer Electronics > Kitchen Appliances > Built-In Dishwashers",
  "mfg_part_num": "PDSH4816AF",
  "expected_fields": ["Voltage", "Capacity", "Color", "Width", "Depth", "Height", "Wash Cycles"]
}
```

**Output Contract:**
```json
{
  "attributes": {
    "Voltage": "120v",
    "Capacity": "14 place settings",
    "Color/Finish": "SS",
    "Width": "24\"",
    "Height": "34 1/2\"",
    "Depth": "25 9/16\"",
    "Number of Wash Cycles": "5",
    "Energy Star Certified": "Yes",
    "Warranty": "1 Year"
  },
  "extraction_confidence": 0.88,
  "missing_fields": ["Sound Level", "Annual Energy Use"],
  "extraction_source": "gemini-2.0-flash"
}
```

**LLM Used:** Gemini 2.0 Flash (primary). Groq Llama 3.3 70B (fallback).

**Prompt Strategy:** Few-shot with 2 examples per classpath category. The `expected_fields` list is injected dynamically. LLM is instructed to return `null` for unknown fields rather than guess.

**Failure Handling:**
- Missing fields → stored in `missing_fields` array; confidence penalty applied
- Hallucinated values (values not found in raw_text) → caught by Validator Agent later
- Complete extraction failure → empty `attributes` dict, `extraction_confidence = 0.0`

---

### 3.4 Normalizer Agent

**Purpose:** Transform raw extracted attribute values into Unilog-compliant standardized format. This is the most rule-dense agent — handles unit normalization, trademark symbols, case standardization, and value canonicalization.

**Input Contract:**
```json
{
  "attributes": {
    "Voltage": "120v",
    "Color/Finish": "SS",
    "Brand": "Frigidaire"
  },
  "classpath": "...",
  "source_brand": "Frigidaire"
}
```

**Output Contract:**
```json
{
  "normalized_attributes": {
    "Voltage": "120 V",
    "Color/Finish": "Stainless Steel",
    "Brand": "FRIGIDAIRE®"
  },
  "normalization_rules_applied": [
    "voltage_unit_spacing",
    "color_abbreviation_expansion",
    "brand_trademark_append"
  ],
  "normalization_confidence": 0.94
}
```

**LLM Used:** Gemini 2.0 Flash for semantic normalization (e.g., color name expansion, description rewriting). Deterministic Python rules for unit formatting, trademark symbols, and case rules.

**Normalization Rule Categories:**

| Category | Example In | Example Out | Method |
|---|---|---|---|
| Unit spacing | `120v`, `60hz` | `120 V`, `60 Hz` | Regex |
| Color expansion | `SS`, `BLK`, `WHT` | `Stainless Steel`, `Black`, `White` | Dict lookup |
| Brand trademark | `Frigidaire`, `Bosch` | `FRIGIDAIRE®`, `BOSCH®` | Dict lookup |
| Dimension format | `34 1/2"` | `34.5 in` | Python math |
| Boolean fields | `yes`, `Y`, `TRUE` | `Yes` | Regex |
| Unilog caps | `energy star` | `ENERGY STAR®` | Dict lookup |

**Failure Handling:** Normalization failures are non-fatal; raw value is preserved and a `normalization_warning` flag is set per field.

---

### 3.5 Writer Agent

**Purpose:** Generate all five Unilog description variants from normalized attributes. This is the most creative agent — it produces marketing-grade copywriting for industrial products.

**Input Contract:**
```json
{
  "normalized_attributes": { "...": "..." },
  "mfg_part_num": "PDSH4816AF",
  "classpath": "...",
  "brand": "FRIGIDAIRE®"
}
```

**Output Contract:**
```json
{
  "descriptions": {
    "Short_Desc": "FRIGIDAIRE® 24 in. Built-In Dishwasher - Stainless Steel",
    "Long_Desc": "This FRIGIDAIRE® 24 in. Built-In Dishwasher delivers powerful cleaning...",
    "Mini_Desc": "Built-In Dishwasher, 24 in., Stainless Steel, 14 Place Settings",
    "Keywords": "frigidaire dishwasher, built-in dishwasher, 24 inch dishwasher, stainless steel dishwasher",
    "SEO_Title": "FRIGIDAIRE® 24 in. Built-In Dishwasher PDSH4816AF | Stainless Steel"
  },
  "bullet_features": [
    "14 place settings for large family loads",
    "ENERGY STAR® certified for efficiency",
    "5 wash cycles including heavy and delicate"
  ],
  "writing_confidence": 0.92
}
```

**LLM Used:** Gemini 2.0 Flash (primary). Groq Llama 3.3 70B (fallback). Higher temperature (0.4) than other agents to allow natural language variation.

**Description Variant Specs:**

| Variant | Max Length | Purpose | Required |
|---|---|---|---|
| `Short_Desc` | 80 chars | Product listing title | Yes |
| `Long_Desc` | 2000 chars | Full PDP description | Yes |
| `Mini_Desc` | 255 chars | Search result snippet | Yes |
| `Keywords` | 500 chars | SEO / search indexing | Yes |
| `SEO_Title` | 70 chars | Meta title tag | Yes |

**Failure Handling:** If any description exceeds character limits → truncated at word boundary with `…`. If LLM returns no content → template fallback using `"{Brand} {Part_Num} - {Classpath_Leaf}"`.

---

### 3.6 Validator Agent

**Purpose:** Perform deterministic quality assurance on the complete enriched record before writing to the `products` table. Computes field-level confidence scores, detects conflicts between input data and enriched data, and determines `commerce_ready` status.

**Input Contract:** Full enriched product record (all normalized attributes + all descriptions).

**Output Contract:**
```json
{
  "commerce_ready": true,
  "overall_confidence": 0.89,
  "field_scores": {
    "Short_Desc": 0.95,
    "Voltage": 1.0,
    "Color/Finish": 0.92,
    "Long_Desc": 0.88
  },
  "flags": [
    {
      "field": "Sound Level",
      "type": "MISSING",
      "severity": "WARNING",
      "message": "Field not found in source — MFR page may not list this spec"
    }
  ],
  "conflicts": [
    {
      "field": "Brand",
      "input_value": "-- Unbranded --",
      "enriched_value": "FRIGIDAIRE®",
      "resolution": "enriched_preferred",
      "confidence": 0.96
    }
  ],
  "validation_rules_passed": 47,
  "validation_rules_failed": 2
}
```

**LLM Used:** None. Fully deterministic rule engine.

**Validation Rule Categories:**

| Rule Type | Count | Examples |
|---|---|---|
| Format rules | 18 | Voltage pattern, URL format, char limits |
| Completeness rules | 12 | Required fields per classpath |
| Consistency rules | 9 | Brand in desc matches Brand field |
| Business rules | 8 | `commerce_ready` threshold = overall_confidence ≥ 0.75 |

**Failure Handling:** Validation always completes — it never blocks the pipeline. Low-confidence records are stored with `commerce_ready = false` for human review.

---

## 4. Data Stores

### 4.1 SQLite Schema (WAL Mode)

```sql
-- Job tracking table
CREATE TABLE jobs (
    id          TEXT PRIMARY KEY,          -- UUID v4
    status      TEXT NOT NULL,             -- PENDING | PROCESSING | DONE | FAILED | RETRY
    source_type TEXT NOT NULL,             -- csv_upload | single_paste
    file_path   TEXT,                      -- path to uploaded CSV (nullable for single_paste)
    total_rows  INTEGER DEFAULT 0,
    done_rows   INTEGER DEFAULT 0,
    failed_rows INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    error_msg   TEXT
);

-- Enriched product records — 252 columns represented as JSON blob + key scalars
CREATE TABLE products (
    id                   TEXT PRIMARY KEY,    -- UUID v4
    job_id               TEXT NOT NULL,
    mfg_part_num         TEXT NOT NULL,
    part_desc            TEXT,
    source_brand         TEXT,               -- best-effort from input
    enriched_brand       TEXT,               -- from Normalizer
    classpath            TEXT,
    source_url           TEXT,
    commerce_ready       BOOLEAN DEFAULT 0,
    overall_confidence   REAL DEFAULT 0.0,
    enriched_data        TEXT NOT NULL,      -- JSON: full 252-col record
    validation_flags     TEXT,               -- JSON array of flag objects
    conflicts            TEXT,               -- JSON array of conflict objects
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- Raw scrape results — stored separately for re-enrichment without re-scraping
CREATE TABLE scrape_results (
    id               TEXT PRIMARY KEY,
    mfg_part_num     TEXT NOT NULL,
    source_url       TEXT NOT NULL,
    raw_text         TEXT NOT NULL,
    scrape_method    TEXT,                   -- httpx | playwright
    http_status      INTEGER,
    scrape_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    ttl_expires_at   DATETIME              -- computed: scrape_timestamp + 24h
);

-- Per-agent execution logs for debugging and audit
CREATE TABLE agent_logs (
    id           TEXT PRIMARY KEY,
    product_id   TEXT,
    job_id       TEXT NOT NULL,
    agent_name   TEXT NOT NULL,             -- scraper|classifier|extractor|normalizer|writer|validator
    status       TEXT NOT NULL,             -- success | failed | retried
    llm_used     TEXT,                      -- gemini-2.0-flash | llama-3.3-70b | deterministic
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    latency_ms   INTEGER,
    error_detail TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_products_job_id ON products(job_id);
CREATE INDEX idx_products_commerce_ready ON products(commerce_ready);
CREATE INDEX idx_agent_logs_job_id ON agent_logs(job_id);
CREATE INDEX idx_scrape_results_part_num ON scrape_results(mfg_part_num);
```

### 4.2 File System Layout

```
/app/
├── uploads/
│   └── {job_id}/
│       └── input.csv                   # Original uploaded CSV (preserved)
├── exports/
│   └── {job_id}/
│       └── export_{timestamp}.csv      # Generated Unilog delivery CSV
├── logs/
│   └── app_{date}.log                  # Structured JSON application logs
└── data/
    └── product_intelligence.db         # SQLite database file
```

### 4.3 In-Memory Scrape Cache

```python
# Located in app/services/scrape_cache.py
from dataclasses import dataclass, field
from time import time
from typing import Optional
import threading

@dataclass
class CacheEntry:
    raw_text: str
    source_url: str
    scrape_method: str
    timestamp: float = field(default_factory=time)

class ScrapeCache:
    TTL_SECONDS = 3600  # 1 hour for demo stability

    def __init__(self):
        self._store: dict[str, CacheEntry] = {}
        self._lock = threading.Lock()

    def get(self, url: str) -> Optional[CacheEntry]:
        with self._lock:
            entry = self._store.get(self._normalize_key(url))
            if entry and (time() - entry.timestamp) < self.TTL_SECONDS:
                return entry
            return None

    def set(self, url: str, entry: CacheEntry) -> None:
        with self._lock:
            self._store[self._normalize_key(url)] = entry

    def _normalize_key(self, url: str) -> str:
        return url.lower().rstrip("/")

# Singleton instance — shared across all agent invocations in process
scrape_cache = ScrapeCache()
```

---

## 5. Request Lifecycle

The following describes the complete flow from user action to enriched record in the database.

```
TIME →

[0ms]    User drags CSV onto Upload page
         React → POST /jobs/upload (multipart/form-data)

[5ms]    FastAPI saves CSV to /uploads/{job_id}/input.csv
         Creates job row: status = PENDING
         Enqueues background task: process_job(job_id)
         Returns: { job_id, status: "PENDING", total_rows: N }

[10ms]   React begins polling GET /jobs/{job_id}/status every 2s

[15ms]   BackgroundTasks picks up process_job()
         job.status → PROCESSING
         Reads CSV rows (pandas), validates column names

FOR EACH ROW:

  [+0ms]    Orchestrator calls ScraperAgent.run(row)
            • Cache miss → httpx GET to MFR URL
            • If JS-rendered → Playwright fallback
            • Writes raw_text to scrape_results table
            • Stores in in-memory cache
            → Output: ScraperResult (raw_text, source_url, confidence)

  [+800ms]  ClassifierAgent.run(scraper_result)
            • Builds prompt with classpath taxonomy list
            • Calls Gemini 2.0 Flash → JSON response
            • Parses classpath string
            → Output: ClassifierResult (classpath, confidence)

  [+400ms]  ExtractorAgent.run(classifier_result + scraper_result)
            • Builds prompt with expected fields for classpath
            • Calls Gemini 2.0 Flash → JSON attribute dict
            • Validates JSON structure
            → Output: ExtractorResult (attributes dict, missing_fields)

  [+300ms]  NormalizerAgent.run(extractor_result)
            • Applies deterministic rules (regex, dict lookup)
            • Calls Gemini for semantic normalization (colors, descriptions)
            → Output: NormalizerResult (normalized_attributes)

  [+600ms]  WriterAgent.run(normalizer_result)
            • Calls Gemini to generate 5 description variants
            • Enforces character limits post-hoc
            → Output: WriterResult (descriptions, bullet_features)

  [+50ms]   ValidatorAgent.run(complete_record)
            • Runs 47 deterministic validation rules
            • Computes field-level confidence scores
            • Determines commerce_ready
            • Writes final record to products table
            • Updates job.done_rows += 1
            → Output: ValidationResult (commerce_ready, flags, conflicts)

[final]  All rows processed
         job.status → DONE
         React polling detects DONE → navigates to results view
```

**Typical Per-Row Latency:** 2–4 seconds (dominated by LLM calls and web scraping)
**Typical 100-row CSV:** 3–7 minutes (sequential processing, no parallelism in v1)

---

## 6. API Surface

### Core Endpoints

| Method | Path | Description | Response |
|---|---|---|---|
| `POST` | `/jobs/upload` | Upload CSV file for batch enrichment | `{ job_id, status, total_rows }` |
| `POST` | `/jobs/single` | Enrich a single pasted row | `{ job_id, status }` |
| `GET` | `/jobs/{id}/status` | Poll job progress | `{ status, done_rows, total_rows, failed_rows }` |
| `GET` | `/jobs/{id}/result` | Get enriched products for job | `{ products: [...] }` |
| `POST` | `/jobs/{id}/retry` | Retry failed rows in job | `{ job_id, retried_rows }` |
| `GET` | `/products/{id}` | Get single product detail (252 cols) | Full product record |
| `GET` | `/products/export` | Export filtered products as CSV | CSV file download |
| `GET` | `/health` | Health check | `{ status: "ok" }` |

### Query Parameters for Export

```
GET /products/export?
  job_id={id}                  # Filter by job
  &min_confidence=0.75         # Only commerce_ready threshold
  &commerce_ready=true         # Only ready products
  &format=unilog_delivery      # CSV column ordering
```

---

## 7. Scalability Considerations

> **Note for hackathon judges:** The current implementation is optimized for demo reliability and code clarity,
> not throughput. The following are straightforward upgrade paths for production scale.

### Bottlenecks in Current Design

| Bottleneck | Current | Production Fix |
|---|---|---|
| Row processing | Sequential (1 row at a time) | Celery + Redis; process N rows concurrently |
| SQLite writes | WAL mode handles demo load | PostgreSQL with connection pooling |
| In-memory cache | Single process, lost on restart | Redis with persistent TTL |
| LLM rate limits | 200 RPD Gemini free tier | Google AI Studio paid tier (1M RPD) |
| Playwright | One browser instance | Playwright pool (4–8 concurrent browsers) |
| File storage | Local disk | S3-compatible blob storage |

### Horizontal Scaling Path

```
Current:    [FastAPI Monolith] → [SQLite]
Stage 1:    [FastAPI] → [Celery Workers (xN)] → [Redis Queue] → [PostgreSQL]
Stage 2:    [K8s FastAPI Pods] → [Celery Workers (xN)] → [Redis Cluster] → [PostgreSQL RDS]
```

### LLM Cost at Scale

| Volume | Gemini 2.0 Flash Cost | Estimated Monthly |
|---|---|---|
| 1,000 products/day | ~$0.04/product | ~$1,200/month |
| 10,000 products/day | ~$0.03/product (caching) | ~$9,000/month |
| 100,000 products/day | Enterprise pricing | Custom contract |

---

## 8. Security Considerations

> **Scope:** Hackathon demo — no authentication required. Basic hardening applied.

### Input Validation

```python
# File upload validation (app/api/routes/jobs.py)
ALLOWED_MIME_TYPES = {"text/csv", "application/vnd.ms-excel"}
MAX_FILE_SIZE_MB = 10
REQUIRED_COLUMNS = {"Mfg_Part_Num", "Part_Desc", "E1_Brand",
                    "Unilog_Brand", "DIB_Brand", "Part_Manuf"}

async def validate_upload(file: UploadFile) -> None:
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(400, "Only CSV files are accepted")
    content = await file.read()
    if len(content) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(413, "File too large (max 10 MB)")
    await file.seek(0)  # Reset for downstream read
```

### SQL Injection Prevention

All database queries use SQLAlchemy ORM or parameterized statements — no string interpolation in SQL.

```python
# Safe: parameterized query
product = db.query(Product).filter(Product.id == product_id).first()

# Never: string interpolation (not present in codebase)
# db.execute(f"SELECT * FROM products WHERE id = '{product_id}'")  <- NEVER
```

### LLM Output Sanitization

LLM responses are parsed as JSON via `json.loads()` — never evaluated with `eval()`. All string values are HTML-escaped before storage to prevent XSS in the React frontend.

### MFR URL Scraping Safety

- Only HTTP GET requests to external URLs (no POST, no cookies forwarded)
- `httpx` timeout set to 10 seconds to prevent hanging
- Playwright runs in sandboxed mode with no local file access
- Scraped URLs are validated against an allowlist of known distributor domains for the hackathon demo

### CORS Configuration

```python
# main.py — restricted to local dev origin for demo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
```

---

*Document version: 1.0 | Last updated: 2026-08-20 | AI-Powered Product Intelligence Hackathon*
