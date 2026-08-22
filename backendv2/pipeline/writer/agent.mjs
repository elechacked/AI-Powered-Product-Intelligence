import { callWriterLlm } from './llm_client.mjs';
import { ensureWriterSchema, upsertProductDescriptions } from './db.mjs';

const SYSTEM_INSTRUCTION = `You are a product content writer for an industrial commerce catalog system.

Your ONLY job is to generate structured product descriptions from verified, evidence-backed product data.

STRICT RULES:
- You must NEVER invent, infer, or hallucinate specifications, dimensions, certifications, compatibility claims, performance claims, or any product facts.
- Only use the facts explicitly provided in the input.
- If a field cannot be generated from the available facts, return null for that field.
- Invoice description must be UPPERCASE, <= 40 characters, terse. Format: BRAND TYPE KEY-SPEC (e.g. "3M CUBITRON DISC 5IN 120+").
- Mobile description: ~80 chars, clear and factual.
- In-app description: ~150 chars, key attributes listed factually.
- Short description: 1-2 sentences, ~200 chars, factual summary.
- Long description: Full paragraph covering all verified attributes. May be 400+ characters if facts support it.
- Retail description: Benefit-driven but strictly factual, ~250 chars.
- Marketing description: Return the manufacturer's exact marketing copy verbatim from the input if provided. If not provided, return null. Do NOT rewrite or create one.
- generation_status must be one of: "success" (all 6 core fields generated), "partial" (some fields generated), "insufficient_data" (too few facts to generate useful descriptions).
- fields_generated must be the exact count of non-null description fields in your response.

Do not add filler text to reach a target length. Shorter accurate descriptions are better than longer inaccurate ones.`;

function buildUserPrompt(product, classJson, attrs, extractorJson) {
    const attrLines = attrs.map(a => `  - ${a.attribute_name}: ${a.normalized_value || a.extracted_value}`).join('\n');

    const marketingRaw = extractorJson?.marketing_description_raw || null;

    return `Generate structured product descriptions for the following industrial product.

PRODUCT IDENTITY:
  MPN: ${product.mfg_part_num}
  Original Description: ${product.part_desc}
  Brand: ${extractorJson?.brand_name || product.e1_brand || product.unilog_brand || 'Unknown'}
  Manufacturer: ${extractorJson?.manufacturer_name || product.part_manuf_company_name || 'Unknown'}
  Product Name: ${extractorJson?.product_name || product.part_desc}
  Trade Name: ${extractorJson?.trade_name || null}

TAXONOMY CLASSIFICATION:
  ${classJson?.classpath || 'Unclassified'}

NORMALIZED PRODUCT ATTRIBUTES:
${attrLines || '  (no attributes available)'}

MANUFACTURER MARKETING DESCRIPTION (verbatim, preserve as-is if provided):
${marketingRaw ? `  "${marketingRaw}"` : '  Not available'}

Generate ALL description fields based ONLY on the above verified facts.`;
}

export async function processWriter(productId, db) {
    // Ensure schema exists
    ensureWriterSchema(db);

    // Check for canonical (duplicate) product
    const pRow = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!pRow) throw new Error(`Product ${productId} not found`);

    if (pRow.canonical_product_id) {
        db.prepare("UPDATE product_pipeline_runs SET status = 'reused', updated_at = ? WHERE product_id = ? AND stage = 'writer'")
            .run(new Date().toISOString(), productId);
        return { status: 'reused', canonical_product_id: pRow.canonical_product_id };
    }

    // Check upstream: Normalizer must be done or skipped (not failed, not pending)
    const normRun = db.prepare("SELECT status FROM product_pipeline_runs WHERE product_id = ? AND stage = 'normalizer' ORDER BY id DESC LIMIT 1").get(productId);
    if (!normRun || normRun.status === 'failed' || normRun.status === 'pending' || normRun.status === 'processing') {
        const reason = `upstream normalizer status: ${normRun?.status || 'missing'}`;
        console.warn(`[WriterAgent] Skipping product ${productId}: ${reason}`);
        return { status: 'skipped', reason };
    }

    // Gather classifier output
    const classRow = db.prepare('SELECT classification_json FROM product_classifications WHERE product_id = ?').get(productId);
    const classJson = classRow?.classification_json ? JSON.parse(classRow.classification_json) : null;

    // Gather normalized attributes
    const attrs = db.prepare(`
        SELECT ta.attribute_name, pa.extracted_value, pa.normalized_value
        FROM product_attribute_values pa
        JOIN taxonomy_attributes ta ON pa.taxonomy_attribute_id = ta.id
        WHERE pa.product_id = ?
    `).all(productId);

    // Gather extractor output for marketing_description_raw + brand
    const extRow = db.prepare('SELECT extraction_json FROM product_extractions WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(productId);
    const extractorJson = extRow?.extraction_json ? JSON.parse(extRow.extraction_json) : null;

    // If no extractor output and no attrs, skip
    if (!extractorJson && attrs.length === 0) {
        console.warn(`[WriterAgent] Skipping product ${productId}: no extractor data and no attributes`);
        return { status: 'skipped', reason: 'no_extractor_data_and_no_attributes' };
    }

    // Resolve marketing description provenance: find which crawled source provided it.
    // The extractor stores attributes with per-attribute source_url/source_name.
    // The marketing copy itself comes from the same crawl session — use the first
    // source that has a non-null source_url as the provenance anchor.
    let marketingSourceUrl = null;
    let marketingSourceName = null;
    if (extractorJson?.marketing_description_raw) {
        // Prefer a source explicitly labelled 'part_manuf', else use first available
        const mfgAttr = (extractorJson.attributes || []).find(a => a.source_role === 'part_manuf' && a.source_url);
        const firstAttr = (extractorJson.attributes || []).find(a => a.source_url);
        const chosen = mfgAttr || firstAttr;
        marketingSourceUrl = chosen?.source_url || null;
        marketingSourceName = chosen?.source_name || null;
    }

    const systemInstruction = SYSTEM_INSTRUCTION;
    const userPrompt = buildUserPrompt(pRow, classJson, attrs, extractorJson);

    const result = await callWriterLlm(systemInstruction, userPrompt, {
        sku: pRow.mfg_part_num,
        brand: extractorJson?.brand_name || pRow.e1_brand,
        id: productId
    }, db);

    upsertProductDescriptions(db, productId, result.parsed, {
        ...result,
        marketingSourceUrl,
        marketingSourceName
    });

    return {
        status: 'completed',
        generation_status: result.parsed.generation_status,
        fields_generated: result.parsed.fields_generated,
        model_used: result.modelUsed,
        fallback_used: result.fallbackUsed,
        retry_count: result.retryCount,
        total_tokens: result.total_tokens,
        latency_ms: result.latency_ms,
        descriptions: result.parsed
    };
}
