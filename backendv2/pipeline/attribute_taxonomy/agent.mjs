import fs from 'fs';

const ALIASES = {
  "pack qty": "pack quantity",
  "qty per pack": "pack quantity",
  "quantity per pack": "pack quantity",
  "product width": "width",
  "overall width": "width",
  "product length": "length",
  "overall length": "length"
};

function normalizeAttributeName(name) {
    if (!name) return '';
    let n = name.toLowerCase().trim();
    n = n.replace(/[\/\-_]/g, ' ');
    n = n.replace(/\s+/g, ' ');
    if (ALIASES[n]) return ALIASES[n];
    return n;
}

function normalizeValue(value) {
    if (value === null || value === undefined) return '';
    let v = String(value).trim();
    v = v.replace(/\s+/g, ' ');
    return v;
}

export async function processAttributeTaxonomy(productId, db) {
    const runCheck = db.prepare("SELECT status, output_json, error_json FROM product_pipeline_runs WHERE product_id = ? AND stage = 'attribute_taxonomy'").get(productId);
    if (!runCheck) {
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'attribute_taxonomy', 'pending', ?, ?)").run(
            productId, new Date().toISOString(), new Date().toISOString()
        );
    }
    
    db.prepare("UPDATE product_pipeline_runs SET status = 'processing', updated_at = ? WHERE product_id = ? AND stage = 'attribute_taxonomy'").run(new Date().toISOString(), productId);
    
    const pRow = db.prepare("SELECT canonical_product_id FROM products WHERE id = ?").get(productId);
    if (pRow && pRow.canonical_product_id) {
        db.prepare("UPDATE product_pipeline_runs SET status = 'reused', updated_at = ? WHERE product_id = ? AND stage = 'attribute_taxonomy'").run(new Date().toISOString(), productId);
        return { status: 'reused' };
    }
    
    const classRun = db.prepare("SELECT status, output_json FROM product_pipeline_runs WHERE product_id = ? AND stage = 'classifier'").get(productId);
    if (!classRun || classRun.status === 'skipped' || classRun.status === 'failed' || classRun.status === 'reused') {
        const stat = classRun ? classRun.status : 'skipped';
        db.prepare("UPDATE product_pipeline_runs SET status = ?, updated_at = ? WHERE product_id = ? AND stage = 'attribute_taxonomy'").run(stat, new Date().toISOString(), productId);
        return { status: stat };
    }
    
    let taxId = null;
    let taxPath = null;
    try {
        const classOutput = JSON.parse(classRun.output_json || '{}');
        taxId = classOutput.selected_taxonomy_id || classOutput.taxonomy_id;
        taxPath = classOutput.matched_path || classOutput.new_path;
    } catch(e) {}
    
    if (!taxId) {
        db.prepare("UPDATE product_pipeline_runs SET status = 'skipped', updated_at = ? WHERE product_id = ? AND stage = 'attribute_taxonomy'").run(new Date().toISOString(), productId);
        return { status: 'skipped' };
    }
    
    const extRow = db.prepare("SELECT extraction_json FROM product_extractions WHERE product_id = ?").get(productId);
    let attributes = [];
    if (extRow && extRow.extraction_json) {
        try {
            const extParsed = JSON.parse(extRow.extraction_json);
            if (extParsed.attributes && Array.isArray(extParsed.attributes)) {
                attributes = extParsed.attributes;
            }
        } catch(e){}
    }
    
    if (attributes.length === 0) {
        const finalJson = JSON.stringify({
            taxonomy_id: taxId,
            attributes_processed: 0,
            attributes_created: 0,
            attributes_reused: 0,
            status: "no_attributes_available"
        });
        db.prepare("UPDATE product_pipeline_runs SET status = 'done', output_json = ?, updated_at = ? WHERE product_id = ? AND stage = 'attribute_taxonomy'").run(finalJson, new Date().toISOString(), productId);
        return { status: 'done' };
    }
    
    let processed = 0, aCreated = 0, aReused = 0, vCreated = 0, vReused = 0;
    let summary = [];
    
    for (const attr of attributes) {
        const rawName = attr.label || attr.attribute_name;
        const rawValue = attr.raw_value || attr.value;
        if (!rawName) continue;
        
        processed++;
        const normName = normalizeAttributeName(rawName);
        const normVal = normalizeValue(rawValue);
        
        let attrId = null;
        const existingAttr = db.prepare("SELECT id FROM taxonomy_attributes WHERE taxonomy_id = ? AND normalized_name = ?").get(taxId, normName);
        if (existingAttr) {
            attrId = existingAttr.id;
            aReused++;
            summary.push({ name: rawName, action: 'reused' });
        } else {
            const res = db.prepare("INSERT INTO taxonomy_attributes (taxonomy_id, attribute_name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(taxId, rawName, normName, new Date().toISOString(), new Date().toISOString());
            attrId = res.lastInsertRowid;
            aCreated++;
            summary.push({ name: rawName, action: 'created' });
        }
        
        let valId = null;
        if (normVal !== '') {
            const existingVal = db.prepare("SELECT id FROM taxonomy_attribute_values WHERE taxonomy_attribute_id = ? AND normalized_value = ?").get(attrId, normVal);
            if (existingVal) {
                vReused++;
                valId = existingVal.id;
            } else {
                const r = db.prepare("INSERT INTO taxonomy_attribute_values (taxonomy_attribute_id, value_text, normalized_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(attrId, rawValue, normVal, new Date().toISOString(), new Date().toISOString());
                vCreated++;
                valId = r.lastInsertRowid;
            }
        }
        
        // --- Fix: UOM and Inference extraction ---
        const uom = attr.uom || null;
        const isInferred = attr.is_inferred === true ? 1 : 0;
        if (uom) {
            db.prepare("UPDATE taxonomy_attributes SET is_dimensional = 1 WHERE id = ?").run(attrId);
        }

        // --- Fix: Ensure combined value + uom is passed to normalizer ---
        let extractedValue = attr.value;
        if (uom && attr.value !== undefined && attr.value !== null) {
            const valStr = String(attr.value).trim();
            if (!valStr.toLowerCase().endsWith(uom.toLowerCase())) {
                extractedValue = `${valStr} ${uom.trim()}`;
            } else {
                extractedValue = valStr;
            }
        }

        // --- NEW: Product Attribute Persistence ---
        // Support multi-source logic deterministically by fetching existing provenance if any
        let provenance = [];
        const existingProdAttr = db.prepare("SELECT id, provenance_json FROM product_attribute_values WHERE product_id = ? AND taxonomy_attribute_id = ?").get(productId, attrId);
        
        if (existingProdAttr && existingProdAttr.provenance_json) {
            try {
                provenance = JSON.parse(existingProdAttr.provenance_json);
            } catch(e) {}
        }
        
        // Ensure we don't duplicate the exact same source
        const sourceUrl = attr.source_url || null;
        const existsInProv = provenance.find(p => p.source_url === sourceUrl && p.source_snippet === attr.source_snippet);
        if (!existsInProv) {
            provenance.push({
                source_url: sourceUrl,
                source_name: attr.source_name || null,
                source_role: attr.source_role || null,
                source_snippet: attr.source_snippet || null,
                confidence: attr.confidence || null,
                reasoning: attr.reasoning || null,
                is_inferred: isInferred === 1
            });
        }
        const provStr = JSON.stringify(provenance);
        
        if (existingProdAttr) {
            db.prepare("UPDATE product_attribute_values SET taxonomy_attribute_value_id = ?, raw_value = ?, extracted_value = ?, uom = ?, is_inferred = ?, provenance_json = ?, updated_at = ? WHERE id = ?")
              .run(valId, attr.raw_value || extractedValue, extractedValue, uom, isInferred, provStr, new Date().toISOString(), existingProdAttr.id);
        } else {
            db.prepare("INSERT INTO product_attribute_values (product_id, taxonomy_attribute_id, taxonomy_attribute_value_id, raw_value, extracted_value, uom, is_inferred, provenance_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run(productId, attrId, valId, attr.raw_value || extractedValue, extractedValue, uom, isInferred, provStr, new Date().toISOString(), new Date().toISOString());
        }
    }
    
    const finalResult = {
        taxonomy_id: taxId,
        taxonomy_path: taxPath,
        status: "completed",
        attributes_processed: processed,
        attributes_created: aCreated,
        attributes_reused: aReused,
        values_created: vCreated,
        values_reused: vReused,
        attribute_summary: summary
    };
    
    db.prepare("UPDATE product_pipeline_runs SET status = 'done', output_json = ?, updated_at = ? WHERE product_id = ? AND stage = 'attribute_taxonomy'").run(JSON.stringify(finalResult), new Date().toISOString(), productId);
    return finalResult;
}
