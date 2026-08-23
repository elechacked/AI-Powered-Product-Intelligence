# AI_PIPELINE.md — AI Pipeline Specification
# AI-Powered Product Intelligence for Industrial Commerce

**Version:** 2.0

---

## 1. Pipeline Overview

```
Input Row (6 cols)
       |
       v
+------------------+      httpx / playwright
|  AGENT 1:        | ---> MFR Website
|  Scraper         | <--- scraped_text, source_quality
+------------------+
       |
       v
+------------------+      Groq Llama 3.3 70B
|  AGENT 2:        | ---> classpath inference
|  Classifier      | <--- dept, class, fine, classpath, unspsc
+------------------+
       |
       v
+------------------+      Gemini 2.0 Flash
|  AGENT 3:        | ---> attribute extraction
|  Extractor       | <--- attributes[], features[], physical, certs
+------------------+
       |
       v
+------------------+      Deterministic rules + LLM assist
|  AGENT 4:        | ---> canonicalization
|  Normalizer      | <--- normalized_attributes, brand_canonical
+------------------+
       |
       v
+------------------+      Gemini 2.0 Flash
|  AGENT 5:        | ---> description generation
|  Writer          | <--- 5 desc variants + 20 features
+------------------+
       |
       v
+------------------+      Pure Python (no LLM)
|  AGENT 6:        | ---> validation rules + scoring
|  Validator       | <--- confidence scores, commerce_ready, issues
+------------------+
       |
       v
SQLite -> React UI -> 252-col CSV Export
```

---

## 2. Agent 1 — Scraper

**Purpose:** Discover the manufacturer URL and scrape authoritative product content.

**Strategy:**
1. Use Gemini to infer the MFR URL from {brand, mfg_part_num, part_manuf}
2. Try httpx GET (2s timeout) — fast for static pages
3. If response is empty or JS-heavy: launch playwright, wait for DOM
4. Extract text with BeautifulSoup (strip nav, footer, ads)
5. Check scrape_cache first — return cached result if < 1 hour old

**URL Inference Prompt (Gemini):**
```
Given this product info, infer the most likely official manufacturer product page URL.
Return ONLY the URL, nothing else.

Brand: {brand}
Manufacturer: {part_manuf}
Part Number: {mfg_part_num}
Description: {part_desc}

If you cannot determine a reliable URL, return "UNKNOWN".
```

**Output Schema:**
```python
class ScraperOutput(BaseModel):
    mfr_url: Optional[str]
    ref_urls: List[str] = []        # up to 5 support/spec URLs
    scraped_text: str               # clean text, max 8000 chars
    source_quality: str             # "high" | "medium" | "low" | "fallback"
    from_cache: bool
    scrape_method: str              # "httpx" | "playwright" | "none"
```

**Source Quality Rules:**
- `high`: URL contains official brand domain (frigidaire.com, milwaukee.com)
- `medium`: Distributor or reseller site
- `low`: Generic search result or indirect source
- `fallback`: Scraping failed — LLM will infer from part_desc only

**Failure Handling:**
If scraping fails entirely, ScraperOutput.scraped_text = part_desc + " " + part_manuf
Downstream agents continue but all fields will be marked is_inferred=true with lower confidence.

---

## 3. Agent 2 — Classifier

**Purpose:** Assign the Unilog taxonomy: Dept, Class, Fine, Classpath, UNSPSC code.

**Model:** Groq Llama 3.3 70B (fast, short context, good for classification)

**System Prompt:**
```
You are a product taxonomy specialist for industrial and commercial product catalogs.
You classify products into the Unilog taxonomy format.

Classpath format: "Department>Class>Fine Category"

Examples of valid classpaths:
- "Appliances & Consumer Electronics>Kitchen Appliances>Built-In Dishwashers"
- "Abrasives & Finishing>Coated Abrasives>Sanding Belts"
- "Building Materials>Decking & Railing>Composite Decking"
- "Tools & Hardware>Power Tool Accessories>Cut-Off Wheels"
- "Windows, Doors & Skylights>Patio Doors>Sliding Patio Doors"

UNSPSC codes follow the 8-digit format: MMCCSSFF
Return ONLY valid JSON. No markdown, no explanation.
```

**User Prompt:**
```
Product Description: {part_desc}
Manufacturer: {part_manuf}
Brand: {effective_brand}
Additional context from manufacturer page:
"""
{scraped_text[:2000]}
"""

Return this JSON:
{
  "dept": "...",
  "class_": "...",
  "fine": "...",
  "classpath": "...",
  "unspsc_code": "...",
  "confidence": 0.0
}
```

**Output Schema:**
```python
class ClassifierOutput(BaseModel):
    dept: str
    class_: str
    fine: str
    classpath: str
    unspsc_code: str
    confidence: float
```

---

## 4. Agent 3 — Extractor

**Purpose:** Extract ALL relevant attributes from scraped content. Fully dynamic — no fixed attribute list.

**Model:** Gemini 2.0 Flash

**System Prompt:**
```
You are a product data specialist for industrial and commercial catalogs.
Your job is to extract every meaningful product attribute from raw product page text.

CRITICAL RULES:
1. Extract ONLY attributes that are explicitly stated in the source text.
2. If you must infer a value, set "is_inferred": true and confidence <= 0.65.
3. UOM formatting: ALWAYS use "number space unit" — "120 V" not "120v", "24 in" not "24in".
4. Use standard English names: "Stainless Steel" not "SS", "Aluminum" not "Alum".
5. Convert decimals to fractions for measurements: "0.5 in" -> "1/2 in".
6. Brand names: include registered/trademark symbols where known (FRIGIDAIRE®, 3M).
7. Return ONLY valid JSON. No markdown fences, no explanation outside JSON.
8. Extract up to 50 attributes. Focus on attributes a buyer would filter by.

Product category: {classpath}
```

**User Prompt:**
```
Product: {mfg_part_num} — {part_desc}
Brand: {brand}
Manufacturer: {manufacturer}

Product page content:
"""
{scraped_text}
"""

Return this EXACT JSON structure:
{
  "manufacturer_name": "exact legal manufacturer name",
  "brand_name": "brand with (R) or (TM) where applicable",
  "trade_name": "product line or series name if present",
  "manufacturer_part_number": "{mfg_part_num}",
  "alternate_part_number": "if found",
  "attributes": [
    {
      "label": "Attribute Name in Title Case",
      "value": "normalized value",
      "uom": "unit abbreviation or empty string",
      "raw_value": "original text from source",
      "confidence": 0.0,
      "source_snippet": "exact quote from text supporting this value",
      "is_inferred": false
    }
  ],
  "physical": {
    "length": "", "length_uom": "",
    "height": "", "height_uom": "",
    "width": "", "width_uom": "",
    "weight": "", "weight_uom": ""
  },
  "certifications": ["ENERGY STAR", "UL Listed"],
  "standards": "ASSE 1006|CEE Tier 2 Qualified|...",
  "features": ["feature 1", "feature 2"],
  "prop65": "Yes/No/Unknown",
  "rohs": "Yes/No/Unknown",
  "country_of_origin": "",
  "upc": "",
  "ean": "",
  "gtin": "",
  "warranty": "",
  "list_price": "",
  "selling_uom": ""
}
```

**Output Schema:**
```python
class AttributeItem(BaseModel):
    label: str
    value: str
    uom: str = ""
    raw_value: str
    confidence: float
    source_snippet: str
    is_inferred: bool = False

class ExtractorOutput(BaseModel):
    manufacturer_name: str
    brand_name: str
    trade_name: Optional[str]
    manufacturer_part_number: str
    alternate_part_number: Optional[str]
    attributes: List[AttributeItem]
    physical: Dict[str, str]
    certifications: List[str]
    standards: Optional[str]
    features: List[str]
    prop65: Optional[str]
    rohs: Optional[str]
    country_of_origin: Optional[str]
    upc: Optional[str]
    ean: Optional[str]
    gtin: Optional[str]
    warranty: Optional[str]
    list_price: Optional[str]
    selling_uom: Optional[str]
```

---

## 5. Agent 4 — Normalizer

**Purpose:** Canonicalize all extracted values against known formatting standards.

**Model:** Primarily deterministic Python; Gemini only for ambiguous brand lookup.

**Deterministic Rules (in validation_rules.py):**

```python
import re

UOM_CORRECTIONS = {
    r"(\d+)\s*v\b": r"\1 V",          # 120v -> 120 V
    r"(\d+)\s*a\b": r"\1 A",          # 15a -> 15 A
    r"(\d+)\s*hz\b": r"\1 Hz",        # 60hz -> 60 Hz
    r"(\d+)\s*w\b": r"\1 W",          # 100w -> 100 W
    r"(\d+)\s*in\.?": r"\1 in",       # 24in -> 24 in
    r"(\d+)\s*ft\.?": r"\1 ft",       # 6ft -> 6 ft
    r"(\d+)\s*lb\.?s?": r"\1 lb",     # 25lbs -> 25 lb
    r"(\d+)\s*kg\b": r"\1 kg",        # 10kg -> 10 kg
    r"(\d+)\s*dba\b": r"\1 dBA",      # 47dba -> 47 dBA
}

MATERIAL_NORMALIZATIONS = {
    "ss": "Stainless Steel",
    "stainless": "Stainless Steel",
    "alum": "Aluminum",
    "aluminium": "Aluminum",
    "galv": "Galvanized",
    "pvc": "PVC",
    "pe": "Polyethylene",
}

DECIMAL_TO_FRACTION = {
    "0.0625": "1/16", "0.125": "1/8", "0.25": "1/4",
    "0.375": "3/8",   "0.5": "1/2",   "0.625": "5/8",
    "0.75": "3/4",    "0.875": "7/8",
}

KNOWN_BRANDS_WITH_SYMBOLS = {
    "frigidaire": "FRIGIDAIRE®",
    "whirlpool":  "Whirlpool®",
    "ge":         "GE®",
    "milwaukee":  "Milwaukee®",
    "3m":         "3M",
    "dewalt":     "DEWALT®",
    "bosch":      "Bosch®",
    "makita":     "Makita®",
    "diablo":     "Diablo®",
    "mirka":      "Mirka®",
    "trex":       "Trex®",
    "timbertech": "TimberTech®",
    "provia":     "ProVia®",
    "velux":      "VELUX®",
    "hager":      "Hager®",
}
```

**Output Schema:**
```python
class NormalizerOutput(BaseModel):
    normalized_attributes: List[AttributeItem]
    brand_name_canonical: str
    manufacturer_name_canonical: str
    trade_name_canonical: Optional[str]
    corrections_applied: List[str]  # audit log of what was changed
```

---

## 6. Agent 5 — Writer

**Purpose:** Generate all 5 description variants + features + marketing copy.

**Model:** Gemini 2.0 Flash

**System Prompt:**
```
You are a product content specialist writing for industrial and commercial catalogs.
You generate multiple product description formats from structured product data.

CRITICAL FORMATTING RULES — must be followed exactly:

INVOICE_DESC:
  - Maximum 40 characters (COUNT CAREFULLY)
  - ALL UPPERCASE
  - Formula: TYPE SIZE/KEY_SPEC BRAND VOLTAGE AMP FINISH
  - Example: "DISHWASHER LEG 5 SST 120V 15A 50-1/4IN"

MOBILE_DESC:
  - 60 to 80 characters (COUNT CAREFULLY)
  - Title Case
  - Formula: Manufacturer_Name Brand, Product_Type, Series, MPN
  - Example: "Rheem Manufacturing FRIGIDAIRE®, Dishwasher, Professional Series, PDSH4816AF"

SHORT_DESC:
  - ~100-150 characters
  - Title Case
  - Formula: Brand(R) Series MPN Product_Type With Feature1, KeySpec1, Finish
  - Example: "FRIGIDAIRE® Professional Series PDSH4816AF Dishwasher With CleanBoost, Leg Mounting, 5-Wash Cycle, Stainless Steel"

LONG_DESC1:
  - Full paragraph, no hard limit but keep under 500 characters
  - Sentence case
  - Include ALL key attributes in natural language
  - Example: "FRIGIDAIRE® Dishwasher With CleanBoost, Professional Series, 5 Wash Cycles, 120 V, 15 A, Leg Mounting, 24 in W x 24-1/4 in D, 50-1/4 in Depth With Door Open, 47 dBA Sound Level, Stainless Steel"

RETAIL_DESC:
  - ~80 characters max
  - Title Case
  - Series + Type + 2-3 key features
  - Example: "Professional Series Dishwasher, Leg Mounting, 5-Wash Cycle, Stainless Steel"

MARKETING_DESCRIPTION:
  - 2-3 sentences, consumer-friendly, benefit-focused
  - Do NOT include raw specs — translate to benefits
  - Example: "Load more and run less with CleanBoost technology..."

ITEM_FEATURES (up to 20):
  - Each a standalone bullet point
  - Start with a noun or verb, Title Case
  - Example: "CleanBoost technology for superior cleaning performance"

Return ONLY valid JSON. No markdown, no preamble.
```

**User Prompt:**
```
Product data:
Manufacturer: {manufacturer_name}
Brand: {brand_name_canonical}
Series/Trade Name: {trade_name}
Part Number: {mfg_part_num}
Classpath: {classpath}
Attributes: {attributes_json}
Features: {features_list}
Certifications: {certifications}

Generate all description fields.
```

**Output Schema:**
```python
class WriterOutput(BaseModel):
    invoice_desc: str
    mobile_desc: str
    short_desc: str
    long_desc1: str
    retail_desc: str
    marketing_description: str
    item_features: List[str]        # up to 20
    with_accessories: Optional[str]
    includes: Optional[str]
    application: Optional[str]
    product_name: str               # clean product name for display
```

**Post-Write Validation (in WriterAgent before returning):**
```python
def validate_descriptions(writer_output: WriterOutput) -> List[str]:
    issues = []
    if len(writer_output.invoice_desc) > 40:
        issues.append(f"INVOICE_DESC too long: {len(writer_output.invoice_desc)} chars")
    if not writer_output.invoice_desc.isupper():
        issues.append("INVOICE_DESC not ALL CAPS")
    if not (60 <= len(writer_output.mobile_desc) <= 80):
        issues.append(f"MOBILE_DESC length {len(writer_output.mobile_desc)} not in 60-80 range")
    return issues
    # If issues exist: re-prompt Gemini ONCE with stricter constraint
```

---

## 7. Agent 6 — Validator (Deterministic — No LLM)

**Purpose:** Final format validation, confidence scoring, conflict detection, commerce_ready determination.

**This agent is pure Python — no LLM calls.**

```python
def compute_field_confidence(
    field_name: str,
    value: str,
    is_inferred: bool,
    source_quality: str,  # high | medium | low | fallback
    confirmed_in_multiple_sources: bool,
    has_conflict: bool
) -> float:
    score = 0.0

    if not is_inferred:
        score += 0.40  # explicitly extracted
        if source_quality == "high":
            score += 0.10  # bonus for official MFR source
        if confirmed_in_multiple_sources:
            score += 0.25
    else:
        score = 0.50  # base for inferred
        # cap inferred at 0.70
        score = min(score, 0.70)

    if has_conflict:
        score -= 0.25

    return max(0.0, min(1.0, score))

def validate_format_rules(writer_output: WriterOutput) -> List[ValidationIssue]:
    issues = []
    # Char limits
    limits = {"invoice_desc": 40, "mobile_desc": 80, "short_desc": 150}
    for field, limit in limits.items():
        val = getattr(writer_output, field, "")
        if val and len(val) > limit:
            issues.append(ValidationIssue(
                field_name=field.upper(),
                issue_type="char_limit",
                severity="high",
                description=f"Value is {len(val)} chars, limit is {limit}"
            ))
    # Casing
    if writer_output.invoice_desc and not writer_output.invoice_desc.isupper():
        issues.append(ValidationIssue(
            field_name="INVOICE_DESC",
            issue_type="casing",
            severity="medium",
            description="Must be ALL CAPS"
        ))
    # UOM spacing (check all attribute UOM fields)
    # Uses regex: value must be "number(fraction)? space unit"
    return issues

def detect_conflicts(
    scraped_attrs: Dict[str, str],
    inferred_attrs: Dict[str, str]
) -> List[ValidationIssue]:
    conflicts = []
    for field in scraped_attrs:
        scraped_val = scraped_attrs[field].strip().lower()
        inferred_val = inferred_attrs.get(field, "").strip().lower()
        if inferred_val and scraped_val != inferred_val:
            conflicts.append(ValidationIssue(
                field_name=field,
                issue_type="conflict",
                severity="high" if field in CRITICAL_ATTRIBUTES else "medium",
                value_a=scraped_attrs[field],
                value_b=inferred_attrs[field],
            ))
    return conflicts

CRITICAL_ATTRIBUTES = ["Voltage Rating", "Amperage Rating", "Power Rating", "Frequency"]
```

---

## 8. LLM Router

**Purpose:** Central routing, rate limit tracking, fallback management.

```python
class LLMRouter:
    def __init__(self):
        self.gemini_client = genai.GenerativeModel("gemini-2.0-flash")
        self.groq_client = Groq(api_key=GROQ_API_KEY)
        self.gemini_calls_today = 0  # loaded from SQLite on startup
        self.groq_calls_today = 0

    async def call_gemini(self, prompt: str, system: str = "") -> str:
        # Rate limit check
        if self.gemini_calls_today >= 195:  # 5-call safety buffer
            return await self.call_groq(prompt, system)
        try:
            response = await self._gemini_with_retry(prompt, system)
            self.gemini_calls_today += 1
            return response
        except Exception as e:
            if "429" in str(e):
                return await self.call_groq(prompt, system)
            raise

    @retry(stop=stop_after_attempt(3),
           wait=wait_exponential(multiplier=2, min=2, max=8))
    async def _gemini_with_retry(self, prompt: str, system: str) -> str:
        response = await self.gemini_client.generate_content_async(
            f"{system}\n\n{prompt}" if system else prompt,
            generation_config={"temperature": 0.1, "response_mime_type": "application/json"}
        )
        return response.text

    async def call_groq(self, prompt: str, system: str = "") -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        response = self.groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            temperature=0.1,
            response_format={"type": "json_object"}
        )
        self.groq_calls_today += 1
        return response.choices[0].message.content
```

---

## 9. Orchestrator

```python
class Orchestrator:
    def __init__(self, db: AsyncSession, llm_router: LLMRouter):
        self.db = db
        self.llm = llm_router
        self.scraper = ScraperAgent(db)
        self.classifier = ClassifierAgent(llm_router)
        self.extractor = ExtractorAgent(llm_router)
        self.normalizer = NormalizerAgent(llm_router)
        self.writer = WriterAgent(llm_router)
        self.validator = ValidatorAgent()

    async def run(self, product_id: str):
        product = await self._get_product(product_id)
        try:
            await self._update_status(product_id, "scraping", 10)
            scraper_out = await self.scraper.run(ScraperInput.from_product(product))

            await self._update_status(product_id, "classifying", 25)
            classifier_out = await self.classifier.run(ClassifierInput(
                part_desc=product.part_desc,
                scraped_text=scraper_out.scraped_text,
                mfg_part_num=product.mfg_part_num
            ))

            await self._update_status(product_id, "extracting", 40)
            extractor_out = await self.extractor.run(ExtractorInput(
                scraped_text=scraper_out.scraped_text,
                classpath=classifier_out.classpath,
                **product.dict()
            ))

            await self._update_status(product_id, "normalizing", 60)
            normalizer_out = await self.normalizer.run(NormalizerInput(
                attributes=extractor_out.attributes,
                brand_name=extractor_out.brand_name,
                manufacturer_name=extractor_out.manufacturer_name
            ))

            await self._update_status(product_id, "writing", 75)
            writer_out = await self.writer.run(WriterInput(
                classifier_out=classifier_out,
                extractor_out=extractor_out,
                normalizer_out=normalizer_out,
                mfg_part_num=product.mfg_part_num
            ))

            await self._update_status(product_id, "validating", 90)
            validator_out = await self.validator.run(ValidatorInput(
                writer_out=writer_out,
                extractor_out=extractor_out,
                scraper_out=scraper_out,
                classifier_out=classifier_out
            ))

            await self._save_results(product_id, scraper_out, classifier_out,
                                     extractor_out, normalizer_out, writer_out, validator_out)
            await self._update_status(product_id, "done", 100,
                                     commerce_ready=validator_out.commerce_ready,
                                     overall_confidence=validator_out.overall_confidence)
        except Exception as e:
            await self._update_status(product_id, "failed", 0, error=str(e))
            raise
```
