# IMPLEMENTATION_PLAN.md — Complete Phased Implementation Guide
# AI-Powered Product Intelligence for Industrial Commerce
# Built for execution by AI coding models (Gemini, Claude, GPT-4)

**Version:** 3.0 — Authoritative implementation reference
**Stack:** FastAPI + SQLite + React (shadcn-admin) + Gemini 2.0 Flash + Groq Llama 3.3 70B
**Output Format:** 2-sheet XLSX (Input + Delivery Format with 252 columns)
**Input Format:** CSV or XLSX (6 columns: Mfg_Part_Num, Part_Desc, E1_Brand, Unilog_Brand, DIB_Brand, Part_Manuf)

---

## HOW TO USE THIS DOCUMENT
This plan is structured for sequential execution by an AI coding assistant.
Each phase has numbered sub-phases specifying:
- Files to create (exact paths)
- Class signatures and dependencies
- Business logic in plain English
- Edge cases to handle
- How to verify it works before moving on

All imports must use the project package structure: `from app.xxx import yyy`

---

## PHASE 0 — PROJECT BOOTSTRAP

### 0.1 — Directory Structure
Create this exact structure:
```
ai-product-intelligence/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── models/ (product.py, enriched_field.py, enriched_record.py, validation_issue.py, scrape_cache.py, ingestion_job.py)
│   │   ├── schemas/ (product.py, enrichment.py, export.py)
│   │   ├── routers/ (upload.py, products.py, export.py, stats.py)
│   │   ├── agents/ (base.py, orchestrator.py, scraper.py, classifier.py, extractor.py, normalizer.py, writer.py, validator.py)
│   │   ├── services/ (llm_router.py, export_service.py)
│   │   └── utils/ (text_cleaner.py, validation_rules.py, unilog_headers.py)
│   ├── uploads/
│   ├── products.db (created at runtime)
│   ├── requirements.txt
│   └── .env
└── frontend/
    └── (shadcn-admin clone)
```

### 0.2 — Python Environment
Initialize a `venv` and install:
`fastapi uvicorn sqlalchemy aiosqlite httpx playwright pandas openpyxl python-multipart python-dotenv pydantic pydantic-settings tenacity google-generativeai groq beautifulsoup4 lxml`
Run `playwright install chromium`

### 0.3 — Environment & Config
Create `backend/.env`:
`SQLITE_URL=sqlite+aiosqlite:///./products.db`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `UPLOAD_DIR=./uploads`, `MAX_UPLOAD_SIZE_MB=10`, `CONFIDENCE_THRESHOLD=0.60`, `COMMERCE_READY_THRESHOLD=0.70`, `SCRAPE_CACHE_TTL_HOURS=1`

### 0.4 — Frontend Setup
Clone `https://github.com/satnaing/shadcn-admin` into `frontend/`. 
Remove irrelevant features (`auth/`, `chats/`, `kanban/`, `calendar/`). 
Set `.env` with `VITE_API_BASE_URL=http://localhost:8000`.

---

## PHASE 1 — CONFIGURATION & DATABASE

### 1.1 — `app/config.py`
Use `pydantic_settings.BaseSettings` to load environment variables.

### 1.2 — `app/database.py`
Setup `sqlalchemy.ext.asyncio` with `aiosqlite`.
Include an `init_db()` function that also seeds `app_config` table (for daily LLM quotas).

### 1.3 — SQLAlchemy Models (`app/models/*.py`)
Implement the exact SQLite schema from `DATABASE_SCHEMA.md`:
- `Product`: master record (mfg_part_num, job_status, commerce_ready, overall_confidence, etc.)
- `EnrichedField`: fine-grained fields for explainability (value, uom, confidence, is_inferred, source_snippet, reasoning)
- `EnrichedRecord`: stores the full 252-column JSON for fast export
- `ValidationIssue`: schema for tracking conflicts (value_a vs value_b) and formatting errors
- `ScrapeCache`: url, scraped_text, expires_at
- `IngestionJob`: audit trail of agent executions per product

### 1.4 — `app/main.py`
Initialize FastAPI with CORS. Wire up the database `lifespan` and skeleton routers.

---

## PHASE 2 — PYDANTIC SCHEMAS

### 2.1 — `app/schemas/product.py` & `export.py`
Define request/response models for UI endpoints (`ProductListItem`, `JobStatusResponse`, `BatchExportRequest`).

### 2.2 — `app/schemas/enrichment.py`
Define exact I/O contracts for each agent:
- `ScraperOutput`: mfr_url, scraped_text, source_quality, from_cache
- `ClassifierOutput`: dept, class_, fine, classpath, unspsc_code, confidence
- `ExtractorOutput`: attributes (List of `AttributeItem`), physical dimensions, certifications
- `NormalizerOutput`: normalized_attributes, canonical brands
- `WriterOutput`: invoice_desc, mobile_desc, short_desc, long_desc1, retail_desc, marketing_description, item_features
- `ValidatorOutput`: field_validations, commerce_ready boolean, compliance scores

---

## PHASE 3 — UTILITIES & LLM ROUTER

### 3.1 — `app/utils/unilog_headers.py`
Store the exact 252 headers string array (starts with MFR URL, ends with Actual Image Yes/No).

### 3.2 — `app/utils/validation_rules.py`
Implement deterministic rules:
- `CHAR_LIMITS` (INVOICE_DESC=40, MOBILE_DESC=60-80)
- `CASING_RULES` (INVOICE_DESC="upper")
- `UOM_CORRECTIONS` (regex for converting "120v" to "120 V", "24in" to "24 in")
- `MATERIAL_NORMALIZATIONS` (SS -> Stainless Steel)
- `KNOWN_BRANDS_WITH_SYMBOLS` (frigidaire -> FRIGIDAIRE®, 3m -> 3M) *Use Unicode `\u00ae`*

### 3.3 — `app/services/llm_router.py`
Implement `LLMRouter`:
- Call Gemini 2.0 Flash (`complete_gemini`) with `response_mime_type="application/json"`
- Call Groq Llama 3.3 70B (`complete_groq`) as primary classifier and Gemini fallback
- Track daily token/call usage in DB to prevent 429s

---

## PHASE 4 — THE AGENT WORKERS

### 4.1 — `app/agents/base.py`
Create `BaseAgent` class with `_log_event()` and `_update_product_status()` methods for DB tracking.

### 4.2 — `app/agents/scraper.py`
- Check `scrape_cache` for existing data.
- If miss: use Groq to infer Manufacturer URL from `part_desc` + `part_manuf`.
- Try `httpx`. If JS-heavy/empty, try `playwright`.
- Clean text with `BeautifulSoup` (remove scripts/nav/footer). Cache result.

### 4.3 — `app/agents/classifier.py`
- Prompt Groq to map product into Unilog taxonomy.
- Must return `Dept>Class>Fine`. 

### 4.4 — `app/agents/extractor.py`
- Prompt Gemini 2.0 Flash to dynamically extract up to 50 attributes.
- Schema must return `label`, `value`, `uom` separately.
- Note: It's valid to return a label with an empty value if not found.

### 4.5 — `app/agents/normalizer.py`
- Pure Python (no LLM). Applies `validation_rules.py`.
- Converts decimals to fractions, normalizes UOM spacing, maps brand to Unicode (®).

### 4.6 — `app/agents/writer.py`
- Prompt Gemini to write all 5 description fields (INVOICE, MOBILE, SHORT, LONG, RETAIL).
- Apply exact rules: INVOICE_DESC <= 40 chars uppercase.
- Fallback loop: If INVOICE_DESC violates limit, re-prompt specifically for it.

### 4.7 — `app/agents/validator.py`
- Pure Python (no LLM).
- Computes confidence scores: Base + Source Quality + Cross-verification bonuses.
- Detects conflicts (e.g., MFR site says 120V, title says 240V).
- Sets `commerce_ready = True` if threshold met and no high-severity conflicts.

---

## PHASE 5 — ORCHESTRATION & EXPORT

### 5.1 — `app/agents/orchestrator.py`
- Chain Agents 1-6 sequentially.
- Update `job_status` in DB.
- At the end, save all `EnrichedField` rows.
- Construct the 252-column JSON dictionary mapping to `unilog_headers.py`. Save as `EnrichedRecord`.

### 5.2 — `app/services/export_service.py`
- Accept product IDs. Fetch their `EnrichedRecord` JSONs.
- Construct a Pandas DataFrame.
- Create 2-sheet XLSX using `openpyxl`:
  - Sheet 1 "Input": The original 6 sparse columns.
  - Sheet 2 "Delivery Format": The fully mapped 252 columns in exact order.

---

## PHASE 6 — FASTAPI ROUTERS

### 6.1 — `app/routers/upload.py`
- Accept `.csv` or `.xlsx` via `UploadFile`.
- Parse with pandas, insert into `products` table as `pending`.
- Spawn `BackgroundTasks` to call `orchestrator.run()` for each product.

### 6.2 — `app/routers/products.py`
- `GET /api/products`: Pagination, filtering by `status`, `commerce_ready`.
- `GET /api/products/{id}`: Fetch product + validation issues + fields.
- `GET /api/products/{id}/diff`: Return Input dict and Output dict for frontend diff viewer.
- `GET /api/products/{id}/trace`: Return explainability data (source snippets, LLM reasoning).
- `PATCH /api/products/{id}/conflicts/{conflict_id}/resolve`: Update resolved value in DB.

### 6.3 — `app/routers/export.py` & `stats.py`
- Export triggers `export_service.py` and returns `FileResponse` (.xlsx).
- Stats returns aggregations for the dashboard (counts of processed, failed, commerce_ready).

---

## PHASE 7 — FRONTEND DEVELOPMENT

### 7.1 — Dashboard (`pages/Dashboard.tsx`)
- Status Cards (Total, Commerce Ready, Avg Confidence).
- Product Table with status badges and realtime job polling.

### 7.2 — Diff View & Detail (`pages/ProductDetail.tsx`, `components/DiffView.tsx`)
- Show original 6 columns next to enriched attributes.
- Use green/yellow/red badges for confidence scores.
- "Resolve Conflict" cards for any validation issues flagged by ValidatorAgent.

### 7.3 — Explainability Drawer (`components/ExplainabilityDrawer.tsx`)
- Slide-out drawer when an attribute is clicked.
- Shows: "Value", "Confidence %", "Extracted From [URL]", "Exact Snippet Quote", and "Agent Reasoning".

### 7.4 — Export View
- Trigger batch XLSX download.

---

## PHASE 8 — TESTING & DEMO PREP

### 8.1 — End-to-End Pipeline Check
1. Upload `Unihack Sample Dataset - Input.csv` (10 rows).
2. Verify SQLite tables populate correctly.
3. Check `EnrichedField` values against `Unihack Expected Output - Delivery Format.csv` ground truth.
4. Download the XLSX export and verify headers match exactly 252 items.
5. Verify `®` symbol renders correctly in export.
