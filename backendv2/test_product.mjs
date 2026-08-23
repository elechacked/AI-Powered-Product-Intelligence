import { db } from './pipeline/orchestration/db.mjs';
import { executePipelineForProducts } from './pipeline/orchestration/product_worker_pool.mjs';

const insertBatch = db.prepare('INSERT INTO import_batches (original_filename, total_products, created_at) VALUES (?, ?, ?)');
const batchId = insertBatch.run('test.csv', 1, new Date().toISOString()).lastInsertRowid;

const insertProduct = db.prepare(`
    INSERT INTO products (
        import_batch_id, mfg_part_num, part_desc, created_at, updated_at, normalized_mfg_part_num
    ) VALUES (?, ?, ?, ?, ?, ?)
`);

const now = new Date().toISOString();
const result = insertProduct.run(batchId, 'TEST-1234', 'Test Industrial Motor 5HP', now, now, 'test1234');
const productId = result.lastInsertRowid;

const insertPipelineRun = db.prepare(`
    INSERT INTO product_pipeline_runs (product_id, stage, status, output_json, started_at, completed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
`);

insertPipelineRun.run(productId, 'input', 'done', null, now, now, now);
insertPipelineRun.run(productId, 'deduplicator', 'pending', null, now, null, now);

const products = [{
    id: productId,
    mfg_part_num: 'TEST-1234',
    part_desc: 'Test Industrial Motor 5HP',
    normalized_mfg_part_num: 'test1234'
}];

console.log('Starting pipeline for product', productId);
executePipelineForProducts(products);

// Keep alive for 60 seconds to let the background jobs finish
setTimeout(() => console.log('Done waiting'), 60000);
