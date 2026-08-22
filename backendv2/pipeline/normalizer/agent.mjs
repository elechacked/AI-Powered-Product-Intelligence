import { normalizeValue } from './rules.mjs';

export async function processNormalizer(productId, db) {
    const summary = [];
    let processed = 0;
    let normalized = 0;
    let unchanged = 0;
    
    // Get all product attributes
    const productAttrs = db.prepare(`
        SELECT pa.id, pa.extracted_value, ta.attribute_name, pa.normalized_value
        FROM product_attribute_values pa
        JOIN taxonomy_attributes ta ON pa.taxonomy_attribute_id = ta.id
        WHERE pa.product_id = ?
    `).all(productId);
    
    if (!productAttrs || productAttrs.length === 0) {
        return {
            status: "no_attributes_available",
            processed: 0,
            normalized: 0,
            unchanged: 0,
            summary: []
        };
    }
    
    const updateStmt = db.prepare(`
        UPDATE product_attribute_values 
        SET normalized_value = ?, normalization_status = ?, normalization_method = ?, updated_at = ?
        WHERE id = ?
    `);
    
    for (const attr of productAttrs) {
        processed++;
        const raw = attr.extracted_value;
        if (!raw) {
            unchanged++;
            continue;
        }
        
        try {
            const result = normalizeValue(attr.attribute_name, raw);
            
            const isChanged = (result.normalized !== raw);
            const status = isChanged ? 'normalized' : 'unchanged';
            
            updateStmt.run(
                result.normalized,
                status,
                result.method,
                new Date().toISOString(),
                attr.id
            );
            
            if (isChanged) {
                normalized++;
            } else {
                unchanged++;
            }
            
            summary.push({
                attribute: attr.attribute_name,
                original: raw,
                normalized: result.normalized,
                status: status,
                method: result.method
            });
        } catch (err) {
            console.error(`Error normalizing attribute '${attr.attribute_name}' with value '${raw}':`, err);
            unchanged++;
            updateStmt.run(
                raw,
                'error',
                'error_isolation',
                new Date().toISOString(),
                attr.id
            );
            summary.push({
                attribute: attr.attribute_name,
                original: raw,
                normalized: raw,
                status: 'error',
                method: 'error_isolation'
            });
        }
    }
    
    return {
        status: "completed",
        processed,
        normalized,
        unchanged,
        summary
    };
}
