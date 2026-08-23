import { normalizeValue } from '../normalizer/rules.mjs';

export async function processValidator(productId, db) {
    // Check if Canonical - duplicates reuse canonical validation
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
    if (!product) return { status: 'skipped' };
    
    // We already handle deduplication properly via Orchestrator or inside server loop. 
    // Just in case, check if we need to sync canonical state.
    if (product.canonical_product_id) {
        const canonRun = db.prepare("SELECT status FROM product_pipeline_runs WHERE product_id = ? AND stage = 'validator'").get(product.canonical_product_id);
        if (canonRun && (canonRun.status === 'done' || canonRun.status === 'skipped')) {
            const canonProd = db.prepare("SELECT commerce_ready, overall_confidence, validation_status FROM products WHERE id = ?").get(product.canonical_product_id);
            if (canonProd) {
                db.prepare("UPDATE products SET commerce_ready = ?, overall_confidence = ?, validation_status = ? WHERE id = ?").run(
                    canonProd.commerce_ready, canonProd.overall_confidence, canonProd.validation_status, productId
                );
            }
            return { status: 'reused' };
        }
    }

    // 1. Clear old validation issues to be idempotent
    db.prepare("DELETE FROM validation_issues WHERE product_id = ?").run(productId);
    
    const issues = [];
    const now = new Date().toISOString();
    
    function addIssue(field, type, severity, desc, valA = null, valB = null) {
        issues.push({
            product_id: productId,
            field_name: field,
            issue_type: type,
            severity,
            description: desc,
            value_a: valA ? String(valA) : null,
            value_b: valB ? String(valB) : null,
            created_at: now
        });
    }

    // Gather data
    const descRow = db.prepare("SELECT * FROM product_descriptions WHERE product_id = ?").get(productId) || {};
    const classRow = db.prepare("SELECT classification_json FROM product_classifications WHERE product_id = ?").get(product.canonical_product_id || productId);
    let classPath = null;
    if (classRow && classRow.classification_json) {
        try { 
            const parsed = JSON.parse(classRow.classification_json);
            classPath = parsed.classpath || parsed.matched_path;
        } catch(e){}
    }

    // --- Description Rules ---
    const charLimits = {
        invoice_description: 40,
        mobile_description: 80,
        retail_description: 100,
        short_description: 150,
        long_description: 2000
    };
    
    for (const [key, limit] of Object.entries(charLimits)) {
        const val = descRow[key];
        if (val && val.length > limit) {
            addIssue(key.toUpperCase(), 'char_limit', 'high', `Value is ${val.length} chars, limit is ${limit}`, val.length, limit);
        }
    }
    
    if (descRow.invoice_description && descRow.invoice_description !== descRow.invoice_description.toUpperCase()) {
        addIssue('INVOICE_DESCRIPTION', 'casing', 'medium', 'Must be ALL CAPS');
    }

    // --- Completeness ---
    if (!product.manufacturer_name) addIssue('MANUFACTURER_NAME', 'completeness', 'high', 'Missing manufacturer name');
    
    let brand = null;
    const extRow = db.prepare("SELECT extraction_json FROM product_extractions WHERE product_id = ?").get(product.canonical_product_id || productId);
    if (extRow && extRow.extraction_json) {
        try { brand = JSON.parse(extRow.extraction_json).brand_name; } catch(e){}
    }
    if (!brand) addIssue('BRAND_NAME', 'completeness', 'high', 'Missing canonical extracted brand name');
    
    if (!classPath) addIssue('CLASSPATH', 'completeness', 'high', 'Missing taxonomy classification path');
    if (!descRow.invoice_description) addIssue('INVOICE_DESCRIPTION', 'completeness', 'high', 'Missing invoice description');
    if (!descRow.short_description) addIssue('SHORT_DESCRIPTION', 'completeness', 'high', 'Missing short description');
    if (!descRow.long_description) addIssue('LONG_DESCRIPTION', 'completeness', 'high', 'Missing long description');

    // --- Attributes Validation ---
    const pAttrs = db.prepare(`
        SELECT pa.*, ta.attribute_name, ta.is_dimensional 
        FROM product_attribute_values pa
        JOIN taxonomy_attributes ta ON pa.taxonomy_attribute_id = ta.id
        WHERE pa.product_id = ?
    `).all(productId);

    if (!pAttrs || pAttrs.length === 0) {
        addIssue('ATTRIBUTES', 'completeness', 'high', 'Missing at least one product attribute');
    }

    const CRITICAL_ATTRIBUTES = ["voltage rating", "amperage rating", "power rating", "frequency"];
    let hasHighSeverityConflict = false;
    let totalConfidence = 0;
    
    const numPattern = "\\d+(?:\\.\\d+)?(?:\\/\\d+)?";
    const dimsPattern = `${numPattern}(?:\\s*[x×X]\\s*${numPattern})*`;
    const uomRegex = new RegExp(`^${dimsPattern}\\s+[a-zA-Z]+$`);

    for (const pa of pAttrs) {
        const attrName = (pa.attribute_name || '').toLowerCase();
        
        // Dimensional / UOM Rule
        if (pa.is_dimensional === 1 && pa.normalized_value) {
            if (!uomRegex.test(pa.normalized_value)) {
                addIssue(pa.attribute_name, 'uom_spacing', 'medium', 'Value does not match required number + space + unit format', pa.normalized_value);
            }
        }
        
        // Casing rule
        if (pa.normalized_value && pa.normalized_value !== pa.normalized_value.toUpperCase()) {
            addIssue(pa.attribute_name, 'casing', 'medium', 'Value contains lowercase characters', pa.normalized_value);
        }

        // Conflicts
        let fieldConflict = false;
        let localConflictSev = 'none';
        
        // "Detect scraped vs inferred conflicts" using is_inferred, extracted_value, normalized_value
        // Correct conflict rule: Compare semantic meaning, not raw strings.
        const scrapedExtracted = pa.extracted_value || '';
        const finalNormalized = pa.normalized_value || '';
        const deterministicallyNormalized = normalizeValue(pa.attribute_name, scrapedExtracted).value || '';
        
        const valA = deterministicallyNormalized.toLowerCase().trim();
        const valB = finalNormalized.toLowerCase().trim();
        
        if (pa.is_inferred === 1 && valA && valB && valA !== valB) {
            fieldConflict = true;
            localConflictSev = CRITICAL_ATTRIBUTES.includes(attrName) ? 'high' : 'medium';
            if (localConflictSev === 'high') hasHighSeverityConflict = true;
            addIssue(pa.attribute_name, 'conflict', localConflictSev, 'Inferred value semantically conflicts with final value', scrapedExtracted, finalNormalized);
        } else if (valA && valB && valA !== valB) {
            // General scraped conflict
            fieldConflict = true;
            localConflictSev = CRITICAL_ATTRIBUTES.includes(attrName) ? 'high' : 'medium';
            if (localConflictSev === 'high') hasHighSeverityConflict = true;
            addIssue(pa.attribute_name, 'conflict', localConflictSev, 'Scraped value semantically conflicts with final value', scrapedExtracted, finalNormalized);
        }

        // Confidence Calculation
        let provenance = [];
        if (pa.provenance_json) {
            try { provenance = JSON.parse(pa.provenance_json); } catch(e){}
        }
        
        const hasManufSource = provenance.some(p => p.source_role === 'part_manuf');
        const isWeakSource = provenance.length > 0 && !hasManufSource && !provenance.some(p => ['e1_brand', 'unilog_brand', 'dib_brand'].includes(p.source_role));

        // --- New Nuanced Confidence Calculation ---
        let score = 0.0;
        if (pa.is_inferred !== 1) {
            score = 0.70; // Direct extraction base
        } else {
            score = 0.45; // Inferred base
        }

        if (hasManufSource) {
            score += 0.15; // High-quality official source bonus
        }
        
        // Count total independent sources providing this attribute
        const sourceCount = provenance.length;

        if (sourceCount >= 3) {
            score += 0.15; // +0.10 for 2nd, +0.05 for 3rd
        } else if (sourceCount === 2) {
            score += 0.10;
        }

        // Apply penalties
        if (fieldConflict) {
            if (localConflictSev === 'high') {
                score -= 0.35; // Major conflict
            } else {
                score -= 0.15; // Minor conflict
            }
        }
        
        if (isWeakSource) {
            score -= 0.10; // Weak/low-quality source penalty
        }

        score = Math.max(0.0, Math.min(1.0, score));
        totalConfidence += score;
    }

    const fieldCount = pAttrs.length;
    const overallConfidence = fieldCount > 0 ? (totalConfidence / fieldCount) : 0;
    
    const hasHighSeverityIssue = issues.some(i => i.severity === 'high');
    const isReady = (overallConfidence >= 0.70 && !hasHighSeverityIssue && fieldCount > 0);
    const valStatus = hasHighSeverityIssue ? 'error' : (issues.length > 0 ? 'warning' : 'ok');

    // Persist issues
    const insertIssue = db.prepare("INSERT INTO validation_issues (product_id, field_name, issue_type, severity, description, value_a, value_b, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const is of issues) {
        insertIssue.run(is.product_id, is.field_name, is.issue_type, is.severity, is.description, is.value_a, is.value_b, is.created_at);
    }

    // Update product
    db.prepare("UPDATE products SET commerce_ready = ?, overall_confidence = ?, validation_status = ? WHERE id = ?").run(
        isReady ? 1 : 0, overallConfidence, valStatus, productId
    );

    return {
        status: 'done',
        commerce_ready: isReady,
        overall_confidence: overallConfidence,
        validation_status: valStatus,
        issues_count: issues.length
    };
}
