# API_CONTRACT.md — REST API Contract
# AI-Powered Product Intelligence for Industrial Commerce

**Version:** 2.0
**Base URL:** http://localhost:8000

---

## 1. Ingestion Endpoints

### POST /api/upload
Upload a CSV file containing product rows.

**Request:** `multipart/form-data`
```
file: <CSV file>
```

**Response 200:**
```json
{
  "batch_id": "uuid-v4",
  "product_ids": ["uuid1", "uuid2"],
  "total_count": 200,
  "message": "200 products queued for enrichment"
}
```

**Errors:**
- `400` File type not .csv or .txt
- `413` File exceeds 10MB
- `422` CSV has no valid rows after parsing

---

### POST /api/ingest/text
Submit a single product as free text.

**Request:**
```json
{
  "text": "Mfg_Part_Num: PDSH4816AF, Part_Desc: Dishwasher SS, Part_Manuf: Appliance Dealers Cooperative"
}
```
Or minimal:
```json
{
  "mfg_part_num": "PDSH4816AF",
  "part_desc": "PDSH4816AF Dishwasher SS - Display Only",
  "part_manuf": "Appliance Dealers Cooperative (APPDE)",
  "e1_brand": ""
}
```

**Response 201:**
```json
{
  "product_id": "uuid-v4",
  "job_id": "uuid-v4",
  "message": "Product queued for enrichment"
}
```

---

### GET /api/jobs/{job_id}
Poll job status for a product.

**Response 200:**
```json
{
  "job_id": "uuid",
  "product_id": "uuid",
  "status": "extracting",
  "progress": 40,
  "current_agent": "extractor",
  "error_message": null,
  "events": [
    {"agent": "scraper", "event": "completed", "message": "Scraped frigidaire.com (cached)", "at": "2026-08-20T10:00:01Z"},
    {"agent": "classifier", "event": "completed", "message": "Classpath: Appliances>Kitchen>Dishwashers", "at": "2026-08-20T10:00:02Z"},
    {"agent": "extractor", "event": "started", "message": "Extracting attributes...", "at": "2026-08-20T10:00:03Z"}
  ]
}
```

**Status values:** `pending | scraping | classifying | extracting | normalizing | writing | validating | done | failed`

---

### GET /api/batches/{batch_id}
Get progress for a full batch upload.

**Response 200:**
```json
{
  "batch_id": "uuid",
  "total": 200,
  "done": 48,
  "failed": 2,
  "pending": 150,
  "pct_complete": 25.0,
  "avg_confidence": 0.84,
  "commerce_ready_count": 31
}
```

---

## 2. Product Endpoints

### GET /api/products
List all products with optional filters.

**Query params:**
- `status` — filter by job_status (done, failed, pending)
- `commerce_ready` — true/false
- `category` — filter by classpath contains
- `confidence_min` — float 0.0-1.0
- `batch_id` — filter by batch
- `page` — default 1
- `limit` — default 50, max 200

**Response 200:**
```json
{
  "items": [
    {
      "id": "uuid",
      "mfg_part_num": "PDSH4816AF",
      "part_desc": "PDSH4816AF Dishwasher SS - Display Only",
      "manufacturer_name": "Rheem Manufacturing",
      "brand_name": "FRIGIDAIRE(R)",
      "classpath": "Appliances & Consumer Electronics>Kitchen Appliances>Built-In Dishwashers",
      "job_status": "done",
      "job_progress": 100,
      "commerce_ready": true,
      "overall_confidence": 0.923,
      "conflict_count": 0,
      "created_at": "2026-08-20T10:00:00Z"
    }
  ],
  "total": 200,
  "page": 1,
  "limit": 50
}
```

---

### GET /api/products/{id}
Full product detail with all enriched fields.

**Response 200:**
```json
{
  "id": "uuid",
  "mfg_part_num": "PDSH4816AF",
  "part_desc": "PDSH4816AF Dishwasher SS - Display Only",
  "source_type": "csv_upload",
  "job_status": "done",
  "commerce_ready": true,
  "overall_confidence": 0.923,
  "classpath": "Appliances & Consumer Electronics>Kitchen Appliances>Built-In Dishwashers",
  "manufacturer_name": "Rheem Manufacturing",
  "brand_name": "FRIGIDAIRE(R)",
  "enriched_fields": [
    {
      "field_name": "INVOICE_DESC",
      "field_value": "DISHWASHER LEG 5 SST 120V 15A 50-1/4IN",
      "field_uom": null,
      "confidence": 0.95,
      "is_inferred": false,
      "source_url": "https://www.frigidaire.com/...",
      "source_snippet": "Professional Series, 5 wash cycles, 120V",
      "reasoning": "Constructed from scraped spec data following INVOICE_DESC formula",
      "validation_status": "ok"
    }
  ],
  "validation_issues": [
    {
      "id": 1,
      "field_name": "Color",
      "issue_type": "conflict",
      "severity": "medium",
      "description": "Source A says Stainless Steel, Source B says Black Stainless",
      "value_a": "Stainless Steel",
      "source_a": "frigidaire.com/product-page",
      "value_b": "Black Stainless",
      "source_b": "spec-sheet.pdf",
      "resolved": false
    }
  ],
  "mfr_url": "https://www.frigidaire.com/...",
  "ref_urls": []
}
```

---

### DELETE /api/products/{id}
Delete product and all related data.

**Response 200:**
```json
{"message": "Product uuid deleted"}
```

---

### PATCH /api/products/{id}/field
Manually override a field value.

**Request:**
```json
{
  "field_name": "INVOICE_DESC",
  "value": "DISHWASHER PRO 5CY SST 120V 15A",
  "uom": null
}
```

**Response 200:**
```json
{
  "field_name": "INVOICE_DESC",
  "value": "DISHWASHER PRO 5CY SST 120V 15A",
  "confidence": 1.0,
  "source": "manual",
  "reasoning": "Manually set by reviewer"
}
```

---

### POST /api/products/{id}/re-enrich
Re-run the full pipeline for a product.

**Response 202:**
```json
{
  "product_id": "uuid",
  "job_id": "uuid",
  "message": "Re-enrichment queued"
}
```

---

## 3. Explainability & Diff Endpoints

### GET /api/products/{id}/trace
Full explainability trace for all fields.

**Response 200:**
```json
{
  "product_id": "uuid",
  "fields": [
    {
      "field_name": "Voltage Rating",
      "field_value": "120",
      "field_uom": "V",
      "confidence": 0.95,
      "confidence_label": "high",
      "is_inferred": false,
      "source_url": "https://www.frigidaire.com/...",
      "source_snippet": "requires a 120-volt, 60 Hz, 15 amp outlet",
      "reasoning": "Value 120 V explicitly stated in product specifications section. Not inferred.",
      "producing_agent": "extractor",
      "original_value": "120-volt",
      "validation_status": "ok"
    }
  ]
}
```

---

### GET /api/products/{id}/diff
Before/after comparison for diff view UI.

**Response 200:**
```json
{
  "product_id": "uuid",
  "input": {
    "Mfg_Part_Num": "PDSH4816AF",
    "Part_Desc": "PDSH4816AF Dishwasher SS - Display Only",
    "E1_Brand": "-- Unbranded --",
    "Unilog_Brand": "-- No Unilog Brand --",
    "DIB_Brand": "-- No DIB Brand --",
    "Part_Manuf": "Appliance Dealers Cooperative (APPDE)"
  },
  "output": {
    "MANUFACTURER_NAME": "Rheem Manufacturing",
    "BRAND_NAME": "FRIGIDAIRE(R)",
    "Classpath": "Appliances & Consumer Electronics>Kitchen Appliances>Built-In Dishwashers",
    "INVOICE_DESC": "DISHWASHER LEG 5 SST 120V 15A 50-1/4IN",
    "MOBILE_DESC": "Rheem Manufacturing FRIGIDAIRE(R), Dishwasher, Professional Series, PDSH4816AF",
    "ATTRIBUTE_LABEL 1": "Voltage Rating",
    "ATTRIBUTE_VALUE 1": "120",
    "ATTRIBUTE_UOM 1": "V"
  },
  "summary": {
    "input_columns": 6,
    "output_columns": 252,
    "populated_columns": 48,
    "empty_columns": 204,
    "commerce_ready": true,
    "overall_confidence": 0.923
  }
}
```

---

### GET /api/products/{id}/conflicts
All unresolved conflicts for a product.

**Response 200:**
```json
{
  "product_id": "uuid",
  "conflicts": [
    {
      "id": 1,
      "field_name": "Color",
      "severity": "medium",
      "value_a": "Stainless Steel",
      "source_a": "https://frigidaire.com/product-page",
      "value_b": "Black Stainless",
      "source_b": "spec-sheet.pdf",
      "resolved": false
    }
  ]
}
```

---

### PATCH /api/products/{id}/conflicts/{conflict_id}/resolve
Resolve a conflict.

**Request:**
```json
{
  "choice": "a",
  "custom_value": null
}
```
Or custom:
```json
{
  "choice": "custom",
  "custom_value": "Stainless Steel"
}
```

**Response 200:**
```json
{
  "conflict_id": 1,
  "resolved": true,
  "resolved_value": "Stainless Steel",
  "commerce_ready_updated": true,
  "new_commerce_ready": true
}
```

---

## 4. Export Endpoints

### GET /api/products/{id}/export/json
Single product as JSON.

**Response 200:** Full 252-field JSON object with all Unilog headers as keys.

---

### GET /api/products/{id}/export/csv
Single product as one-row CSV with 252 headers.

**Response:** `Content-Type: text/csv`, file download.

---

### POST /api/export/batch
Trigger batch export.

**Request:**
```json
{
  "product_ids": ["uuid1", "uuid2"],
  "format": "csv",
  "confidence_threshold": 0.60,
  "commerce_ready_only": false
}
```

**Response 202:**
```json
{
  "export_job_id": "uuid",
  "product_count": 200,
  "message": "Export building, download when ready"
}
```

---

### GET /api/export/batch/{export_job_id}/csv
Download the 252-col batch CSV.

**Response:** `Content-Type: text/csv`
`Content-Disposition: attachment; filename="unilog_enriched_products.csv"`

---

## 5. Dashboard & Config

### GET /api/stats
Dashboard summary statistics.

**Response 200:**
```json
{
  "total": 200,
  "done": 185,
  "failed": 3,
  "pending": 12,
  "commerce_ready": 142,
  "commerce_ready_pct": 76.8,
  "avg_confidence": 0.847,
  "flagged": 18,
  "by_category": [
    {"classpath": "Appliances>Kitchen>Dishwashers", "count": 8, "ready": 7, "avg_conf": 0.91},
    {"classpath": "Abrasives>Coated>Sanding Belts", "count": 12, "ready": 10, "avg_conf": 0.88}
  ]
}
```

---

### GET /api/config
Get current config values.

**Response 200:**
```json
{
  "confidence_threshold": 0.60,
  "commerce_ready_threshold": 0.70,
  "gemini_calls_today": 48,
  "gemini_daily_limit": 200,
  "groq_calls_today": 12,
  "groq_daily_limit": 1000
}
```

---

### PATCH /api/config
Update a config value.

**Request:**
```json
{"key": "confidence_threshold", "value": "0.70"}
```

**Response 200:**
```json
{"key": "confidence_threshold", "value": "0.70", "updated": true}
```
