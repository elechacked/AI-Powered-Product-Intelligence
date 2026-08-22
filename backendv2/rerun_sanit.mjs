import { db } from './pipeline/orchestration/db.mjs';
import { processProductSanitization } from './pipeline/sanitizer.mjs';

const products = db.prepare("SELECT product_id FROM product_pipeline_runs WHERE stage = 'evidence_sanitization'").all();
const unique = new Set(products.map(p => p.product_id));

console.log(`Re-running sanitization for ${unique.size} products.`);

for (let id of unique) {
    try {
        processProductSanitization(id);
        console.log(`Product ${id} done.`);
    } catch (e) {
        console.error(`Product ${id} failed:`, e);
    }
}
