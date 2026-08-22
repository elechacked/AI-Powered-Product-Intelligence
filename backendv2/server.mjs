import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { db } from './pipeline/orchestration/db.mjs';
import { parseCsvString } from './pipeline/input/csv_reader.ts';
import { normalizeRows } from './pipeline/input/normalizer.ts';
import { discoverUrlsForProduct } from './pipeline/orchestration/url_discovery.mjs';

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const csvString = req.file.buffer.toString('utf8');
  const originalFilename = req.file.originalname;

  // 1. Create import batch
  const insertBatch = db.prepare('INSERT INTO import_batches (original_filename, total_products, created_at) VALUES (?, ?, ?)');
  const batchResult = insertBatch.run(originalFilename, 0, new Date().toISOString());
  const batchId = batchResult.lastInsertRowid;

  // 2. Parse and normalize
  const rawRows = parseCsvString(csvString);
  const { products, errors } = normalizeRows(rawRows);

  db.prepare('UPDATE import_batches SET total_products = ? WHERE id = ?').run(products.length, batchId);

  // 3. Insert products and pipeline runs
  const insertProduct = db.prepare(`
    INSERT INTO products (
      import_batch_id, mfg_part_num, part_desc, e1_brand, unilog_brand, dib_brand,
      part_manuf_raw, part_manuf_company_name, part_manuf_supplier_code, input_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPipelineRun = db.prepare(`
    INSERT INTO product_pipeline_runs (product_id, stage, status, output_json, started_at, completed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertedProducts = [];

  for (const p of products) {
    const now = new Date().toISOString();
    const result = insertProduct.run(
      batchId,
      p.mfg_part_num,
      p.part_desc,
      p.brand_hints?.e1_brand || null,
      p.brand_hints?.unilog_brand || null,
      p.brand_hints?.dib_brand || null,
      p.part_manuf?.raw || null,
      p.part_manuf?.company_name || null,
      p.part_manuf?.supplier_code || null,
      JSON.stringify(p),
      now,
      now
    );
    const productId = result.lastInsertRowid;
    insertedProducts.push({ id: productId, ...p });

    // Mark input stage done
    insertPipelineRun.run(productId, 'input', 'done', null, now, now, now);
    // Mark orchestration pending
    insertPipelineRun.run(productId, 'orchestration', 'pending', null, now, null, now);
  }

  // 4. Respond to frontend immediately
  res.json({ batch_id: batchId, products_count: products.length, errors });

  // 5. Run Orchestration in the background
  (async () => {
    for (const p of insertedProducts) {
      const now = new Date().toISOString();
      db.prepare("UPDATE product_pipeline_runs SET status = 'processing', updated_at = ? WHERE product_id = ? AND stage = 'orchestration'").run(now, p.id);
      
      try {
        const orchestrationResult = await discoverUrlsForProduct(p);
        
        const finalJson = JSON.stringify({
          sku: p.mfg_part_num,
          sources: orchestrationResult
        });
        
        const doneTime = new Date().toISOString();
        db.prepare("UPDATE product_pipeline_runs SET status = 'done', output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'orchestration'").run(finalJson, doneTime, doneTime, p.id);
      } catch (err) {
        console.error('Orchestration failed for product', p.id, err);
        const errTime = new Date().toISOString();
        db.prepare("UPDATE product_pipeline_runs SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'orchestration'").run(JSON.stringify({ error: err.message }), errTime, errTime, p.id);
      }
    }
  })();
});

app.get('/api/stats', (req, res) => {
  const totalRow = db.prepare('SELECT COUNT(*) as c FROM products').get();
  res.json({
    total: totalRow.c,
    enriched: 0,
    failed: 0,
    commerceReady: 0
  });
});

app.get('/api/upload/batches/:batchId', (req, res) => {
  const batchId = req.params.batchId;
  const totalRow = db.prepare('SELECT COUNT(*) as c FROM products WHERE import_batch_id = ?').get(batchId);
  const pendingRow = db.prepare('SELECT COUNT(DISTINCT product_id) as c FROM product_pipeline_runs pr JOIN products p ON pr.product_id = p.id WHERE p.import_batch_id = ? AND pr.status IN ("pending", "processing")').get(batchId);
  
  const total = totalRow.c;
  const pending = pendingRow.c;
  const completed = total - pending;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

  res.json({ total, pending, completed, pct_complete: pct });
});

app.get('/api/products', (req, res) => {
  const batchId = req.query.batch_id;
  let query = 'SELECT * FROM products';
  const params = [];
  
  if (batchId) {
    query += ' WHERE import_batch_id = ?';
    params.push(batchId);
  }
  
  query += ' ORDER BY id DESC LIMIT 50';
  
  const rows = db.prepare(query).all(...params);
  
  const items = rows.map(r => {
    // Determine overall status
    const runs = db.prepare('SELECT * FROM product_pipeline_runs WHERE product_id = ?').all(r.id);
    const hasFailed = runs.some(run => run.status === 'failed');
    const hasPending = runs.some(run => run.status === 'pending' || run.status === 'processing');
    
    let jobStatus = 'completed';
    if (hasFailed) jobStatus = 'failed';
    else if (hasPending) jobStatus = 'pending';
    
    return {
      id: r.id,
      mfg_part_num: r.mfg_part_num,
      part_desc: r.part_desc,
      job_status: jobStatus,
      commerce_ready: false,
      overall_confidence: null
    };
  });
  
  res.json({ items, total: rows.length });
});

app.get('/api/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  
  const runs = db.prepare('SELECT * FROM product_pipeline_runs WHERE product_id = ? ORDER BY id ASC').all(product.id);
  
  const hasFailed = runs.some(run => run.status === 'failed');
  const hasPending = runs.some(run => run.status === 'pending' || run.status === 'processing');
  
  let jobStatus = 'completed';
  if (hasFailed) jobStatus = 'failed';
  else if (hasPending) jobStatus = 'pending';

  const pipeline_events = runs.map(run => ({
    event_type: run.stage,
    message: run.status
  }));
  
  res.json({
    id: product.id,
    mfg_part_num: product.mfg_part_num,
    part_desc: product.part_desc,
    job_status: jobStatus,
    commerce_ready: false,
    overall_confidence: null,
    pipeline_events,
    input_json: product.input_json,
    orchestration_json: runs.find(r => r.stage === 'orchestration')?.output_json || null,
    error_message: runs.find(r => r.status === 'failed')?.error_json || null
  });
});

app.post('/api/products/:id/re-enrich', (req, res) => {
  res.json({ message: 'Re-enrichment queued (stub)' });
});

app.get('/api/stats/batches', (req, res) => {
  const rows = db.prepare('SELECT id, original_filename as filename, total_products as total, created_at FROM import_batches ORDER BY id DESC').all();
  res.json(rows);
});

app.get('/api/export', (req, res) => {
  const batchId = req.query.batch_id;
  let query = 'SELECT * FROM products';
  const params = [];
  
  if (batchId) {
    query += ' WHERE import_batch_id = ?';
    params.push(batchId);
  }
  
  const products = db.prepare(query).all(...params);
  
  const csvRows = ['Mfg_Part_Num,Part_Desc,Job_Status'];
  for (const p of products) {
    csvRows.push(`${p.mfg_part_num},"${p.part_desc.replace(/"/g, '""')}","done"`);
  }
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
  res.send(csvRows.join('\n'));
});

app.listen(8000, () => {
  console.log('Server running on port 8000');
});
