# PRD — AI-Powered Product Intelligence for Industrial Commerce

**Version:** 2.0
**Status:** Approved for Implementation
**Owner:** Aryan
**Type:** Hackathon MVP (3-day sprint)
**Last Updated:** 2026-08-20

---

## 1. Overview

Industrial distributors manage hundreds of thousands of SKUs across fragmented sources. Each SKU must be described across 252 structured fields — five description formats, up to 50 attribute pairs, physical dimensions, compliance data, and digital assets — before it can go live in a commerce catalog.

Today, a human content analyst takes 20–30 minutes per product. This system does it in under 15 seconds.

**What we build:** A multi-agent AI pipeline that takes a sparse 6-column product row and produces a fully enriched, self-validated, 252-column commerce-ready record in the Unilog delivery format — with every field carrying a confidence score, source attribution, and reasoning trace.

**This is NOT a transformer/electrical-component tool.** It handles any industrial product category dynamically: abrasives, dishwashers, decking, lumber, windows, roofing, faucets, fittings — anything in the input dataset.

---

## 2. Problem Statement

| Pain | Current Reality |
|---|---|
| Sparse input data | A product row has 6 fields: part number, truncated description, brand placeholders, and manufacturer name |
| 252 fields required | Commerce platforms need classpath, UNSPSC, 5 description variants, up to 50 attribute pairs, physical dims, images, compliance data |
| Strict format rules | INVOICE_DESC <= 40 chars ALL CAPS; UOMs must have space (24 in not 24in); brand names need (R) and (TM) symbols |
| No consistency | Same product listed differently across manufacturer site, distributor site, and catalog |
| No trust signal | Buyers cannot tell if a spec was read from the MFR page or guessed |
| Manual process | A human analyst takes 20-30 min per SKU; 1,000 SKUs = 333+ person-hours |

---

## 3. Goals

### Must Have — P0 (Demo Day)
- Accept a CSV upload with sparse product rows and enrich them to 252-column Unilog delivery format
- Scrape manufacturer URLs to gather product data from authoritative sources
- Dynamically classify each product into Dept / Class / Fine / Classpath / UNSPSC
- Extract all relevant attributes per product category (not a fixed schema — fully dynamic)
- Normalize values: UOM spacing, brand canonicalization, fraction conversion (1/2 in)
- Generate all 5 description variants with correct formatting formulas and character limits
- Assign per-field confidence scores (0.0–1.0) with source attribution and AI reasoning
- Detect cross-source conflicts (scraper says X, inference says Y — flag)
- Validate all format rules deterministically (char limits, casing, UOM spacing, required fields)
- Export enriched records as a valid 252-column Unilog delivery format CSV
- Dashboard showing enrichment status, commerce-ready %, average confidence
- Before/after diff view: 6 sparse input columns vs 252 enriched output columns
- Explainability panel: click any field to see value + confidence + source + reasoning

### Should Have — P1
- Batch progress view (N of M products processed) with per-agent status
- Conflict resolution UI (user picks value_a, value_b, or types custom)
- Field-level accuracy report against the 200-item ground truth
- Re-enrichment with a second source URL for a product
- Retry failed products

### Wont Have — for hackathon demo
- Authentication / login / user roles
- Multi-tenancy or team collaboration
- LOV file dependency (Unicat_Lov_v1_0 — unavailable; dynamic LLM validation used instead)
- Real-time websockets (polling every 2s is sufficient)
- Cloud deployment (local demo only)
- Production error recovery / alerting

---

## 4. Users

**Primary (demo persona):**
A product data manager at an industrial distributor who needs to onboard 200-1,000 SKUs into their commerce catalog. They have the manufacturer part number and a truncated description string. They need 252 fields of structured, validated content per product.

**Secondary:**
A procurement analyst validating that a supplier product data matches the manufacturer official specifications before publishing.

**Hackathon judges:**
Technical evaluators assessing: AI pipeline quality, enrichment accuracy, format compliance, explainability, and demo impact.

---

## 5. Core Features

### F1 — Multi-Source Ingestion
- Accept: CSV file upload (multiple products), single product paste (free text)
- Parse CSV with pandas; handle messy headers and placeholder values (-- Unbranded -- treated as null)
- Store raw input in SQLite, assign UUID per product, create background job
- File types: .csv, .txt (max 10MB)

### F2 — Scraper Agent
- Given manufacturer name + MPN, discover the likely MFR URL (LLM-assisted URL inference)
- Scrape with httpx (fast; for static pages)
- Fall back to playwright (for JS-rendered pages)
- Extract up to 5 reference URLs (support docs, spec sheets)
- Cache results in SQLite scrape_cache (TTL: 1 hour — critical for demo stability)
- Source quality rating: high (official MFR site), medium (distributor), low (inferred)

### F3 — AI Enrichment Pipeline (6 Agents)

| Agent | Model | Purpose |
|---|---|---|
| Scraper | httpx + playwright | Discover + scrape MFR URL and ref pages |
| Classifier | Groq Llama 3.3 70B | Assign Dept/Class/Fine/Classpath/UNSPSC |
| Extractor | Gemini 2.0 Flash | Extract all attributes dynamically per classpath |
| Normalizer | Deterministic + LLM assist | Canonicalize UOM, casing, brand names |
| Writer | Gemini 2.0 Flash | Generate all 5 description variants per formula |
| Validator | Deterministic code | Format checks, confidence scoring, conflict detection |

### F4 — Dynamic Attribute Extraction
- The Extractor agent does NOT use a fixed attribute list
- It reads the product classpath and scraped content, then determines which attributes are relevant
- Output: up to 50 attribute pairs (ATTRIBUTE_LABEL / ATTRIBUTE_VALUE / ATTRIBUTE_UOM)
- This makes the system genuinely category-agnostic

### F5 — Self-Validation Engine
Validation runs on three layers:
1. Deterministic rules (code): char limits, casing, UOM spacing, required fields check
2. LLM vocabulary normalization (prompt-enforced): standard English material names, approved abbreviations
3. Cross-source conflict detection: if scraped value differs from inferred value — flag with severity

### F6 — Confidence Scoring

| Condition | Score Effect |
|---|---|
| Explicitly stated in scraped MFR source | +0.40 |
| Confirmed in 2+ sources | +0.25 |
| High-quality source (official MFR site) | +0.10 bonus |
| LLM inferred (not scraped) | Base 0.50, capped at 0.70 |
| Cross-source conflict on this field | -0.25 |

commerce_ready = true when: all required fields present AND all required fields confidence >= 0.70 AND no unresolved HIGH severity conflicts.

### F7 — Description Generation (5 Variants)

| Variant | Length | Format | Example |
|---|---|---|---|
| INVOICE_DESC | <= 40 chars | ALL CAPS | DISHWASHER LEG 5 SST 120V 15A 50-1/4IN |
| MOBILE_DESC | 60-80 chars | Title Case | Rheem Manufacturing FRIGIDAIRE, Dishwasher, Professional Series, PDSH4816AF |
| SHORT_DESC | ~120 chars | Title Case | FRIGIDAIRE Professional Series PDSH4816AF Dishwasher With CleanBoost, Leg Mounting, 5-Wash Cycle, Stainless Steel |
| LONG_DESC1 | Paragraph | Sentence case | Full spec paragraph with all key attributes |
| RETAIL_DESC | ~80 chars | Title Case | Professional Series Dishwasher, Leg Mounting, 5-Wash Cycle, Stainless Steel |
| MARKETING_DESCRIPTION | 2-3 sentences | Prose | Benefit-focused consumer language |

### F8 — Commerce Export
- Export single product or full batch as 252-column Unilog delivery format CSV
- Exact headers preserved (no modifications to the delivery format headers)
- Confidence threshold filter (default: fields with confidence >= 0.60)
- Flags unresolved conflicts in export metadata
- commerce_ready column populated per row

### F9 — Dashboard + Diff View
- Product list table: name, category, job status, confidence %, commerce_ready badge
- Stats row: total products, % commerce-ready, % flagged, avg confidence
- Filter: by status, category, commerce_ready, confidence range
- Diff view: side-by-side before (6 cols) / after (252 cols) with color-coded confidence

### F10 — Explainability Panel
- Click any field to open slide-in drawer
- Shows: value, confidence %, source URL, source snippet, AI reasoning, is_inferred flag
- Primary trust-building mechanism for judges

---

## 6. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Enrichment time per product | < 15 seconds (includes scraping + 3 LLM calls) |
| CSV parse time | < 2 seconds for 1,000 rows |
| UI responsiveness | No loading state > 2s without spinner |
| Demo stability | Works for 5 consecutive demo runs without failure |
| Scrape cache hit rate | 100% on second run (demo safety) |
| Gemini API budget | <= 200 calls/day (free tier limit) |
| Export correctness | 252 columns, exact Unilog headers, valid CSV |
| Fallback coverage | Every product must produce some output even if scraping fails |

---

## 7. Success Metrics (Hackathon Judging)

| Metric | Target | How Measured |
|---|---|---|
| Field-level accuracy | > 80% on 200-item ground truth | Compare export vs expected_output.csv |
| Char-limit compliance | 100% (INVOICE_DESC <= 40, etc.) | Deterministic validator |
| UOM format compliance | > 95% | Deterministic validator |
| Brand canonicalization | > 90% (R and TM where applicable) | Manual spot-check |
| Confidence score usefulness | Scores correlate with actual accuracy | Regression vs ground truth |
| Demo stability | 0 crashes during judge demo | Rehearsal runs |
| Explainability | Every field has source + reasoning | UI inspection |

---

## 8. Out of Scope

- Authentication, login, roles, sessions
- Multi-user / team collaboration
- LOV file dependency (not available — dynamic validation used instead)
- Production deployment / cloud hosting
- Mobile-optimized UI (desktop demo only)
- Payment or subscription features
- Real-time WebSocket updates
- Electrical-component domain specifics (transformers, inductors) — incorrect for this dataset
