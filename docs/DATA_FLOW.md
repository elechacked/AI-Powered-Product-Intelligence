# DATA_FLOW.md — Data Flow & User Flow
# AI-Powered Product Intelligence for Industrial Commerce

**Version:** 2.0

---

## 1. High-Level Data Flow

```
INPUT (6 columns)                    PROCESSING                        OUTPUT (252 columns)
-----------------                    ----------                        --------------------

CSV Upload / Text Paste
        |
        v
[Ingestion Layer]
  - Parse CSV with pandas
  - Strip placeholders ("-- Unbranded --" -> null)
  - Create product record in SQLite
  - Create background job
        |
        v
[AGENT 1: Scraper]
  - Infer MFR URL from brand + MPN (LLM)
  - Scrape with httpx (fast path)
  - Fallback: playwright (JS pages)
  - Cache result in scrape_cache (1hr TTL)
  Output: scraped_text, source_quality, ref_urls
        |
        v
[AGENT 2: Classifier]
  - Model: Groq Llama 3.3 70B (fast)
  - Input: part_desc + scraped_text
  - Output: Dept, Class, Fine, Classpath, UNSPSC
        |
        v
[AGENT 3: Extractor]
  - Model: Gemini 2.0 Flash
  - Input: scraped_text + classpath
  - DYNAMIC: LLM decides which attributes apply
  - Output: up to 50 attributes with confidence + source_snippet
  - Also extracts: features, certifications, physical dims, brand
        |
        v
[AGENT 4: Normalizer]
  - Deterministic rules + LLM assist
  - UOM: "120v" -> "120 V" | "24in" -> "24 in"
  - Fractions: "0.5 in" -> "1/2 in"
  - Brand: "Frigidaire" -> "FRIGIDAIRE®"
  - Material: "SS" -> "Stainless Steel"
        |
        v
[AGENT 5: Writer]
  - Model: Gemini 2.0 Flash
  - Generates all 5 description variants per formula
  - Generates 20 ITEM_FEATURES
  - Generates MARKETING_DESCRIPTION
        |
        v
[AGENT 6: Validator]
  - Pure deterministic code
  - Char limit checks
  - Casing checks
  - UOM format checks
  - Cross-source conflict detection
  - Per-field confidence scoring
  - commerce_ready determination
        |
        v
[SQLite Storage]
  - enriched_fields: per-field rows
  - enriched_records: full 252-col JSON
  - validation_issues: all flags
        |
        v
[REST API -> React UI]
        |
    +---+---+
    |       |
Dashboard  Export
(status)   252-col CSV
```

---

## 2. Field Transformation Trace — One Real Product

Input row:
```
Mfg_Part_Num: PDSH4816AF
Part_Desc:    PDSH4816AF Dishwasher SS - Display Only
E1_Brand:     -- Unbranded --
Unilog_Brand: -- No Unilog Brand --
DIB_Brand:    -- No DIB Brand --
Part_Manuf:   Appliance Dealers Cooperative (APPDE)
```

### Step 1 — After Scraper Agent
```json
{
  "mfr_url": "https://www.frigidaire.com/en/p/owner-center/product-support/PDSH4816AF",
  "ref_urls": ["https://www.frigidaire.com/...spec-sheet.pdf"],
  "source_quality": "high",
  "scraped_text": "FRIGIDAIRE Professional Series PDSH4816AF Dishwasher. 120V, 15A. 5 wash cycles. CleanBoost technology. Stainless Steel interior. Leg mounting. 47 dBA sound level. 24 in W x 24-1/4 in D. Depth with door open: 50-1/4 in. ENERGY STAR Certified. NSF Certified...",
  "from_cache": false
}
```

### Step 2 — After Classifier Agent
```json
{
  "dept": "Appliances",
  "class_": "Large Appliances",
  "fine": "Dishwashers",
  "classpath": "Appliances & Consumer Electronics>Kitchen Appliances>Built-In Dishwashers",
  "unspsc_code": "52141501",
  "confidence": 0.97
}
```

### Step 3 — After Extractor Agent (dynamic, LLM decides attributes)
```json
{
  "manufacturer_name": "Rheem Manufacturing",
  "brand_name": "FRIGIDAIRE",
  "attributes": [
    {"label": "Voltage Rating", "value": "120", "uom": "V", "confidence": 0.95, "source_snippet": "120V outlet required", "is_inferred": false},
    {"label": "Amperage Rating", "value": "15", "uom": "A", "confidence": 0.95, "source_snippet": "15A circuit", "is_inferred": false},
    {"label": "Number of Wash Cycles", "value": "5", "uom": "", "confidence": 0.93, "source_snippet": "5 wash cycles", "is_inferred": false},
    {"label": "Sound Level", "value": "47", "uom": "dBA", "confidence": 0.92, "source_snippet": "47 dBA", "is_inferred": false},
    {"label": "Mounting Type", "value": "Leg", "uom": "", "confidence": 0.90, "source_snippet": "Leg mounting", "is_inferred": false},
    {"label": "Material", "value": "Stainless Steel", "uom": "", "confidence": 0.88, "source_snippet": "Stainless Steel interior", "is_inferred": false},
    {"label": "Size", "value": "24 in W x 24-1/4 in D", "uom": "", "confidence": 0.91, "source_snippet": "24 in W x 24-1/4 in D", "is_inferred": false},
    {"label": "Depth With Door Open", "value": "50-1/4", "uom": "in", "confidence": 0.90, "source_snippet": "50-1/4 in depth with door open", "is_inferred": false}
  ],
  "features": ["CleanBoost technology", "5 wash cycles", "ENERGY STAR Certified", "47 dBA quiet operation"],
  "certifications": ["ENERGY STAR", "NSF Certified", "UL Listed", "cUL Listed"]
}
```

### Step 4 — After Normalizer Agent
Changes applied:
- `"FRIGIDAIRE"` -> `"FRIGIDAIRE®"` (brand canonicalization)
- `"Rheem Manufacturing"` -> `"Rheem Manufacturing"` (already correct)
- All UOM values verified: `"120 V"` has space (correct), `"50-1/4 in"` has space (correct)
- `"Stainless Steel"` already normalized (was "SS" in part_desc — corrected)

### Step 5 — After Writer Agent
```json
{
  "invoice_desc": "DISHWASHER LEG 5 SST 120V 15A 50-1/4IN",
  "mobile_desc": "Rheem Manufacturing FRIGIDAIRE®, Dishwasher, Professional Series, PDSH4816AF",
  "short_desc": "FRIGIDAIRE® Professional Series PDSH4816AF Dishwasher With CleanBoost, Leg Mounting, 5-Wash Cycle, Stainless Steel",
  "long_desc1": "FRIGIDAIRE® Dishwasher With CleanBoost, Professional Series, 5 Wash Cycles, 120 V, 15 A, Leg Mounting, 24 in W x 24-1/4 in D, 50-1/4 in Depth With Door Open, 47 dBA Sound Level, Stainless Steel",
  "retail_desc": "Professional Series Dishwasher, Leg Mounting, 5-Wash Cycle, Stainless Steel",
  "marketing_description": "Load more and run less with the FRIGIDAIRE® Professional Series dishwasher featuring CleanBoost technology. With 5 wash cycles and a whisper-quiet 47 dBA operation, it delivers exceptional cleaning performance for any household.",
  "item_features": [
    "CleanBoost technology for superior cleaning",
    "5 flexible wash cycles",
    "47 dBA ultra-quiet operation",
    "ENERGY STAR Certified for energy efficiency",
    "Leg mounting for flexible installation",
    "NSF Certified for safety",
    "Stainless Steel interior for durability",
    "50-1/4 in depth with door open"
  ]
}
```

### Step 6 — After Validator Agent
```json
{
  "commerce_ready": true,
  "overall_confidence": 0.923,
  "char_limit_compliance": 1.0,
  "uom_compliance": 1.0,
  "field_validations": [
    {"field": "INVOICE_DESC", "value": "DISHWASHER LEG 5 SST 120V 15A 50-1/4IN", "len": 39, "passes_limit": true, "is_upper": true, "confidence": 0.95},
    {"field": "MOBILE_DESC", "value": "Rheem Manufacturing FRIGIDAIRE®...", "len": 74, "in_range_60_80": true, "confidence": 0.91}
  ],
  "validation_issues": []
}
```

### Final Output — 252-Column Row (key fields shown)
```
MFR URL:              https://www.frigidaire.com/en/p/...PDSH4816AF
PART_NUMBER:          PDSH4816AF
MANUFACTURER_NAME:    Rheem Manufacturing
BRAND_NAME:           FRIGIDAIRE®
Classpath:            Appliances & Consumer Electronics>Kitchen Appliances>Built-In Dishwashers
INVOICE_DESC:         DISHWASHER LEG 5 SST 120V 15A 50-1/4IN
MOBILE_DESC:          Rheem Manufacturing FRIGIDAIRE®, Dishwasher, Professional Series, PDSH4816AF
SHORT_DESC:           FRIGIDAIRE® Professional Series PDSH4816AF Dishwasher...
ATTRIBUTE_LABEL 1:    Voltage Rating
ATTRIBUTE_VALUE 1:    120
ATTRIBUTE_UOM 1:      V
...
commerce_ready:       true (confidence: 92.3%)
```

---

## 3. Confidence Scoring Data Flow

```
Per-Field Confidence Calculation:

base_score = 0.0

IF value explicitly in scraped MFR page:
    base_score += 0.40
    IF source is official MFR website (source_quality = "high"):
        base_score += 0.10
    IF confirmed in 2+ ref URLs:
        base_score += 0.25

ELSE IF value is LLM-inferred:
    base_score = min(0.50 + inference_certainty_bonus, 0.70)

IF cross-source conflict on this field:
    base_score -= 0.25

final_confidence = max(0.0, min(1.0, base_score))

Commerce-Ready Gate:
  required_fields_present = all(f in enriched for f in REQUIRED_FIELDS)
  all_required_confident  = all(enriched[f].confidence >= 0.70 for f in REQUIRED_FIELDS)
  no_high_conflicts        = count(issues where severity='high' and resolved=false) == 0

  commerce_ready = required_fields_present AND all_required_confident AND no_high_conflicts
```

---

## 4. User Flows

### Flow A — CSV Upload (Batch)
```
1. User opens Dashboard
2. Clicks "Upload CSV"
3. Drags CSV file to drop zone
4. POST /api/upload -> {batch_id, product_ids[], total: 200}
5. Dashboard shows batch progress: "0 / 200 enriched"
6. Background: Orchestrator processes products sequentially (rate-limit safe)
7. Frontend polls GET /api/batches/{batch_id} every 2s
8. Each product card updates: Scraping -> Classifying -> Extracting -> Done
9. User clicks any product -> ProductDetail page
10. "Enrich All Done" -> batch export button available
```

### Flow B — Single Product Paste
```
1. User opens Upload page
2. Pastes: "Mfg_Part_Num: DCB518ASTS06G, Diablo 1/2x18 Sanding Belt 6pc, Freud Inc"
3. POST /api/ingest/text -> {product_id, job_id}
4. Redirect to /products/{product_id} (shows "Processing...")
5. Frontend polls GET /api/jobs/{job_id} every 2s
6. Job done -> page refreshes with full enriched data
```

### Flow C — Conflict Resolution
```
1. Product detail shows WARNING badge: "2 conflicts detected"
2. User clicks conflict: "Voltage Rating — Source A: 120 V, Source B: 240 V"
3. User clicks "Keep 120 V"
4. PATCH /api/products/{id}/conflicts/{cid}/resolve {choice: "a"}
5. Conflict marked resolved
6. Validator re-runs commerce_ready check
7. If now passes -> badge turns green
```

### Flow D — Batch Export
```
1. Dashboard shows "48 of 200 products commerce_ready"
2. User clicks "Export All Commerce-Ready"
3. POST /api/export/batch {product_ids: [...], confidence_threshold: 0.6}
4. Backend builds 252-col CSV with exact Unilog headers
5. GET /api/export/batch/{batch_id}/csv -> file download
6. Browser downloads "unilog_enriched_products.csv"
```

---

## 5. Polling Strategy (Frontend)

```typescript
// hooks/useJobStatus.ts
const { data: job } = useQuery({
  queryKey: ['job', jobId],
  queryFn: () => api.get(`/api/jobs/${jobId}`),
  refetchInterval: (data) => {
    const terminal = ['done', 'failed']
    if (terminal.includes(data?.status)) return false
    return 2000  // poll every 2 seconds
  },
  enabled: !!jobId
})

// hooks/useBatchProgress.ts
const { data: batch } = useQuery({
  queryKey: ['batch', batchId],
  queryFn: () => api.get(`/api/batches/${batchId}`),
  refetchInterval: (data) => {
    if (data?.done + data?.failed >= data?.total) return false
    return 3000
  },
  enabled: !!batchId
})
```

---

## 6. Export Flow

```
User clicks Export
        |
    +---+---+
    |       |
Single    Batch
  |         |
  v         v
GET /api/products/{id}/export/csv    POST /api/export/batch
        |                                    |
Backend filters:                     Backend iterates:
  - confidence >= threshold            - All specified product_ids
  - Maps to 252-col headers            - For each: map enriched_records to 252 cols
  - Fills missing fields as ""         - confidence filter
  - Flags unresolved conflicts         - Assemble CSV with exact Unilog headers
        |                                    |
        v                                    v
Browser download trigger            GET /api/export/batch/{id}/csv -> download
```

---

## 7. Job Status State Machine

```
[upload received]
        |
        v
    PENDING
        |
  [pipeline starts — Scraper begins]
        |
        v
    SCRAPING
        |
  [Scraper done — Classifier begins]
        |
        v
   CLASSIFYING
        |
  [Classifier done — Extractor begins]
        |
        v
   EXTRACTING
        |
  [Extractor done — Normalizer begins]
        |
        v
   NORMALIZING
        |
  [Normalizer done — Writer begins]
        |
        v
    WRITING
        |
  [Writer done — Validator begins]
        |
        v
   VALIDATING
        |
   [success]   [any agent fails]
      |               |
      v               v
    DONE           FAILED
                      |
                [user clicks retry]
                      |
                      v
                  PENDING (restart)
```
