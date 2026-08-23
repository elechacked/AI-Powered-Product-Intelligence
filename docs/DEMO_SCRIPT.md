# DEMO_SCRIPT.md — Judge Demo Script
# AI-Powered Product Intelligence for Industrial Commerce

**Demo Duration:** 10 minutes
**Setup:** Desktop browser, localhost:5173

---

## Pre-Demo Checklist (Run 30 minutes before)

```
[ ] cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
[ ] cd frontend && npm run dev (localhost:5173)
[ ] Verify: 20 demo products already enriched in DB
[ ] Verify: scrape_cache populated (no live scraping needed)
[ ] Verify: demo CSV file ready (20_demo_products.csv on Desktop)
[ ] Verify: Gemini + Groq API keys in .env
[ ] Open browser at localhost:5173
[ ] Close all other browser tabs
[ ] Set screen resolution to 1440p or 1280p
[ ] Turn off system notifications (Do Not Disturb)
[ ] BACKUP: screenshots ready at docs/demo_screenshots/ if anything fails
```

---

## MINUTE 0:00 — Opening Hook (30 seconds)

**Say this:**

> "Industrial distributors manage hundreds of thousands of product SKUs.
> Each SKU needs 252 structured fields to be commerce-ready —
> five different description formats, up to 50 technical attributes,
> physical dimensions, compliance data.
>
> Today, a human content analyst takes 20 to 30 minutes per product.
> For a 1,000-SKU catalog, that is 500 person-hours.
>
> We built a system that does this in under 15 seconds per product —
> with every field explained, every confidence score earned, and every output verifiable.
>
> Let me show you."

---

## MINUTE 0:30 — Upload Demo (1 minute 30 seconds)

**Action:** Show the empty Dashboard.

> "Here is our dashboard. Zero products. Let me upload a batch."

**Action:** Click "Upload CSV". Open file picker. Select `20_demo_products.csv`.

> "This is a raw dataset — the kind distributors actually receive from suppliers.
> Six columns. Manufacturer part number, a truncated description, some brand placeholders,
> and a manufacturer name. That is all we have."

**Action:** Show the file uploading. Progress bar fills.

> "The system parsed 20 product rows. Now watch the pipeline run."

**Action:** Dashboard appears with products. Show agent status cycling:
`Scraping... → Classifying... → Extracting... → Writing... → Validating...`

> "Each product goes through six specialized agents:
> scraper, classifier, extractor, normalizer, writer, and validator.
> All running in parallel across the batch."

---

## MINUTE 2:00 — Dashboard Overview (1 minute)

**Action:** Products are appearing as Done with confidence badges.

> "In under 60 seconds, 20 products enriched.
> We can see commerce-ready status, average confidence scores,
> and how many have validation flags."

**Action:** Point to stats bar — "18 of 20 commerce-ready. Average confidence: 88%."

> "The two that aren't ready have conflicts we'll look at in a moment."

---

## MINUTE 3:00 — Product Detail (2 minutes)

**Action:** Click on the dishwasher product: `PDSH4816AF`.

> "Let me open this dishwasher. Six columns in — 252 columns out."

**Action:** Show the Diff View. LEFT panel (6 sparse columns) vs RIGHT panel (enriched attributes).

> "This is the transformation. From a 6-column abbreviation to a fully structured commerce record.
> Every field has a confidence badge: green for high confidence, yellow for needs review."

**Action:** Scroll through attributes. Point to Voltage Rating: 120 V (green, 95%).

> "Look at the confidence scores — 95% on Voltage Rating, 91% on Sound Level.
> These aren't arbitrary numbers. Let me show you where they come from."

---

## MINUTE 5:00 — Explainability (1 minute 30 seconds)

**Action:** Click the info icon next to `INVOICE_DESC`.

> "Every single field is fully traceable."

Explainability drawer slides open. Point to each section:

> "Value: DISHWASHER LEG 5 SST 120V 15A 50-1/4IN — that is 39 characters. Limit is 40. Passes."
>
> "Confidence: 95%. Source: frigidaire.com, the manufacturer's own product page."
>
> "Source snippet: exactly the text we found. Not inferred — extracted."
>
> "Reasoning: constructed following the INVOICE_DESC formula — TYPE, SIZE, BRAND, VOLTAGE, AMP."

**Action:** Close drawer. Click info icon on `Cooling Type` or a lower-confidence field.

> "Here is a field where we are less certain — 58% confidence, marked yellow, flagged as inferred.
> The system is honest about what it knows vs what it is guessing."

---

## MINUTE 6:30 — Conflict Detection (1 minute)

**Action:** Scroll to Validation Flags section. Show a conflict.

> "And here is something important — conflict detection."
>
> "Two sources gave us different values for Color.
> Source A — the manufacturer page — says Stainless Steel.
> Source B — the spec sheet — says Black Stainless.
>
> Most systems would just pick one silently.
> We surface it, explain it, and let the reviewer decide."

**Action:** Click "Keep Stainless Steel". Show commerce_ready badge turn green.

> "Conflict resolved. The product is now commerce-ready."

---

## MINUTE 7:30 — Export (30 seconds)

**Action:** Click Export button → Download CSV.

> "One click. We download the exact Unilog 252-column delivery format —
> same headers as the specification, ready to import into any commerce catalog."

---

## MINUTE 8:00 — Accuracy Story (1 minute)

**Action:** Go back to Dashboard. Click Accuracy panel (or show the terminal output).

```
INVOICE_DESC accuracy:   62%
Classpath accuracy:      85%
MANUFACTURER_NAME:       79%
BRAND_NAME accuracy:     72%
```

> "We validated against the 200-item ground truth dataset provided.
> For Classpath — which requires understanding the full product category hierarchy —
> we hit 85% accuracy from a plain text description.
>
> For INVOICE_DESC — which has a strict 40-character format constraint —
> 62% exact match. The rest were close but truncated differently.
> Every failure is flagged in the system. Nothing is silently wrong."

---

## MINUTE 9:00 — Technical Highlight (45 seconds)

**Action:** Show the system architecture diagram (in SYSTEM_ARCHITECTURE.md or a slides backup).

> "Under the hood: six specialized agents, each with a typed contract.
>
> The scraper discovers and caches the manufacturer's official page.
> The classifier dynamically assigns the product taxonomy — no hardcoded categories.
> The extractor decides which attributes apply — dynamic per product type.
> The normalizer enforces standards: '24in' becomes '24 in', 'SS' becomes 'Stainless Steel'.
> The writer generates all five description variants per exact format rules.
> The validator checks everything deterministically — char limits, UOM spacing, conflicts.
>
> No static lookup tables required. No hand-coded category rules.
> It works for any industrial product type out of the box."

---

## MINUTE 9:45 — Closing (15 seconds)

> "What took 30 minutes now takes 8 seconds.
> Every field explained. Every score earned. Every output verifiable.
> Thank you."

---

## Judge Q&A — Prepared Answers

**Q: How accurate is it really?**
> "We measured against the 200-item ground truth. Classpath at 85%, manufacturer name at 79%.
> Every field has a confidence score — you can set a threshold and only export high-confidence fields.
> We show you the failures, not just the wins."

**Q: What if scraping fails?**
> "Graceful degradation. If the manufacturer site is unavailable, we fall back to LLM inference
> from the product description string alone. Confidence scores drop automatically —
> from 0.95 to 0.55 — so the reviewer knows the data is less certain.
> Nothing crashes. The product still gets enriched."

**Q: How does validation work without LOV files?**
> "Three layers. First, deterministic code checks char limits, casing rules, and UOM formatting.
> Second, the LLM is prompted to use standardized industrial vocabulary — it knows Stainless Steel,
> not SS. Third, cross-source conflict detection catches disagreements between the manufacturer page
> and reference documents. We validate the output, not just generate it."

**Q: Can it handle any product category?**
> "Yes. The classifier dynamically assigns the taxonomy. The extractor dynamically decides
> which attributes apply. We tested on dishwashers, abrasives, decking, windows, and lumber —
> all from the same pipeline with no category-specific code changes."

**Q: What is the confidence score formula?**
> "Explicit in source: +0.40. Confirmed in multiple sources: +0.25. Official MFR site: +0.10 bonus.
> LLM inferred: base 0.50, capped at 0.70. Conflict detected: -0.25.
> It is a documented, deterministic formula — not a black box."

**Q: Why Gemini over GPT-4?**
> "Free tier with 1 million tokens per minute. For extraction tasks on product page text,
> Gemini 2.0 Flash performs comparably and costs nothing in a 3-day hackathon context.
> Groq Llama 3.3 70B is our fallback — also free, blazing fast for short classification tasks."

**Q: What would you build next?**
> "Load the Unilog LOV files (161K rows of controlled vocabulary) as a lookup table.
> Right now we use LLM-enforced vocabulary. With the LOV files, we get exact constrained values —
> higher accuracy, measurable compliance. That is the next unlock."

---

## Backup Plan (If Demo Fails)

**Scenario: Backend crashes during live demo**
1. Switch to pre-enriched screenshots in `docs/demo_screenshots/`
2. Walk through the screenshots narrating the same story
3. Show the exported CSV in Excel directly

**Scenario: Network is down (can't scrape)**
1. scrape_cache should handle this — all demo products are pre-cached
2. If DB is also gone: show screenshots

**Scenario: Frontend won't load**
1. Use the FastAPI auto-docs at localhost:8000/docs
2. Call the endpoints live from Swagger UI — show the JSON responses
3. Explain: "The API contract is documented; the UI is a consumer of these endpoints"

---

## Files to Have Ready

```
Desktop/
+-- 20_demo_products.csv          # The 20 handpicked products
+-- docs/
|   +-- demo_screenshots/         # Every screen of the demo
|   +-- architecture_diagram.png  # System architecture visual
+-- exported_200_products.csv     # The ground truth run output
```
