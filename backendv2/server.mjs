import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { db } from './pipeline/orchestration/db.mjs';
import { parseCsvString } from './pipeline/input/csv_reader.ts';
import { normalizeRows } from './pipeline/input/normalizer.ts';
import { discoverUrlsForProduct } from './pipeline/orchestration/url_discovery.mjs';
import { processProductSanitization } from './pipeline/sanitizer.mjs';

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

        // --- START CRAWLER ---
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'crawler', 'processing', ?, ?)").run(p.id, doneTime, doneTime);
        
        const validSources = orchestrationResult.filter(s => s.product_url && s.url_status === 'success');
        
        const insertSource = db.prepare(`
          INSERT INTO product_sources (product_id, source_name, source_role, source_domain, source_url, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'processing', ?, ?)
        `);
        
        const insertCrawlResult = db.prepare(`
          INSERT INTO source_crawl_results (product_source_id, source_type, url, status, output_json, error_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const sourceMap = new Map();
        for (const s of validSources) {
           const row = insertSource.run(p.id, s.source_name, s.source_role, s.official_domain, s.product_url, doneTime, doneTime);
           sourceMap.set(s.product_url, { dbId: row.lastInsertRowid, source: s });
        }
        
        const crawlUrls = validSources.map(s => s.product_url);
        
        let crawlerStatus = 'done';
        if (crawlUrls.length > 0) {
            const { crawl } = await import('thecrawler');
            
            const crawlResult = await crawl({
                urls: crawlUrls,
                extractMarkdown: true,
                extractStructuredData: true,
                extractTables: true,
                adaptiveCrawling: true,
                cache: { enabled: false }
            });
            
            let successes = 0;
            let failures = 0;
            
            // For matching, create an array of unmapped dbIds
            const unmappedDbIds = new Set(Array.from(sourceMap.values()).map(x => x.dbId));

            for (let i = 0; i < crawlResult.pages.length; i++) {
                const page = crawlResult.pages[i];
                // Best effort matching: exact URL, or original requested URL based on index if array sizes match
                let mapInfo = sourceMap.get(page.url);
                if (!mapInfo && crawlUrls[i]) {
                    mapInfo = sourceMap.get(crawlUrls[i]);
                }
                if (!mapInfo) continue;
                
                const dbId = mapInfo.dbId;
                if (!unmappedDbIds.has(dbId)) continue; // already processed
                unmappedDbIds.delete(dbId);
                
                if (page.status === 'success' || page.statusCode === 200) {
                    successes++;
                    db.prepare("UPDATE product_sources SET status = 'done', updated_at = ? WHERE id = ?").run(new Date().toISOString(), dbId);
                    
                    const outputData = {
                        text: page.text,
                        markdown: page.markdown,
                        structuredData: page.structuredData,
                        commerceData: page.commerceData,
                        microdata: page.microdata,
                        tables: page.tables,
                        meta: page.meta,
                        openGraph: page.openGraph,
                        twitterCard: page.twitterCard,
                        images: (page.images || []).filter(img => {
                            const src = (img.src || '').toLowerCase();
                            const alt = (img.alt || '').toLowerCase();
                            if (src.includes('logo') || alt.includes('logo')) return false;
                            if (src.includes('/icon/') || alt.includes('icon') || src.includes('facebook') || src.includes('twitter') || src.includes('instagram')) return false;
                            if (src.includes('banner') || alt.includes('banner')) return false;
                            if (src.endsWith('.svg') || src.endsWith('.gif')) return false;
                            return true;
                        })
                    };
                    
                    insertCrawlResult.run(dbId, 'product_page', page.url, 'done', JSON.stringify(outputData), null, new Date().toISOString(), new Date().toISOString());
                    
                    // Document Discovery
                    const docLinks = (page.links || []).filter(link => {
                        const href = link.url || '';
                        const txt = (link.text || '').toLowerCase();
                        if (href.match(/\.(pdf|docx?|xlsx?|csv)$/i)) return true;
                        if (txt.includes('datasheet') || txt.includes('data sheet') || txt.includes('specification') || txt.includes('technical data') || txt.includes('manual') || txt.includes('brochure')) {
                            return true;
                        }
                        return false;
                    });
                    
                    const uniqueDocs = new Map();
                    for (const l of docLinks) {
                        if (l.url && !uniqueDocs.has(l.url)) uniqueDocs.set(l.url, l);
                    }
                    
                    for (const doc of uniqueDocs.values()) {
                       const docExtMatch = doc.url.match(/\.(pdf|docx?|xlsx?|csv)$/i);
                       const docType = docExtMatch ? docExtMatch[1].toLowerCase() : 'document';
                       const isSupported = docType === 'pdf' || docType === 'doc' || docType === 'docx';
                       
                       const docStatus = isSupported ? 'processing' : 'unsupported';
                       const docRow = insertCrawlResult.run(dbId, docType, doc.url, docStatus, JSON.stringify({ anchorText: doc.text }), null, new Date().toISOString(), new Date().toISOString());
                       
                       if (isSupported) {
                           try {
                               const docCrawl = await crawl({
                                   urls: [doc.url],
                                   extractMarkdown: true,
                                   adaptiveCrawling: false
                               });
                               const docPage = docCrawl.pages[0];
                               if (docPage && (docPage.status === 'success' || docPage.text || docPage.markdown)) {
                                   const docOut = { text: docPage.text, markdown: docPage.markdown, meta: docPage.meta || docPage.metadata, anchorText: doc.text };
                                   db.prepare("UPDATE source_crawl_results SET status = 'done', output_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(docOut), new Date().toISOString(), docRow.lastInsertRowid);
                               } else {
                                   db.prepare("UPDATE source_crawl_results SET status = 'failed', error_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({error: docPage?.error || 'Document parse failed'}), new Date().toISOString(), docRow.lastInsertRowid);
                               }
                           } catch (docErr) {
                               db.prepare("UPDATE source_crawl_results SET status = 'failed', error_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({error: docErr.message}), new Date().toISOString(), docRow.lastInsertRowid);
                           }
                       }
                    }
                    
                } else {
                    failures++;
                    db.prepare("UPDATE product_sources SET status = 'failed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), dbId);
                    insertCrawlResult.run(dbId, 'product_page', page.url, 'failed', null, JSON.stringify({ error: page.error, errorType: page.errorType }), new Date().toISOString(), new Date().toISOString());
                }
            }
            
            if (successes > 0 && failures > 0) crawlerStatus = 'partial';
            else if (successes === 0 && failures > 0) crawlerStatus = 'failed';
            else crawlerStatus = 'done';
        }
        
        db.prepare("UPDATE product_pipeline_runs SET status = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'crawler'").run(crawlerStatus, new Date().toISOString(), new Date().toISOString(), p.id);
        if (crawlerStatus === 'done' || crawlerStatus === 'partial' || crawlerStatus === 'failed') {
            // Queue next step: evidence_sanitization
            db.prepare(`INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'evidence_sanitization', 'pending', ?, ?)`).run(p.id, Date.now().toString(), Date.now().toString());
        }
        
      } catch (err) {
        console.error('Orchestration/Crawler failed for product', p.id, err);
        const errTime = new Date().toISOString();
        db.prepare("UPDATE product_pipeline_runs SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage IN ('orchestration', 'crawler') AND status = 'processing'").run(JSON.stringify({ error: err.message }), errTime, errTime, p.id);
      }
    }

    // PHASE 3: Evidence Sanitization
    const pendingSanitization = db.prepare("SELECT product_id FROM product_pipeline_runs WHERE stage = 'evidence_sanitization' AND status = 'pending'").all();
    for (let p of pendingSanitization) {
        const startTime = new Date().toISOString();
        db.prepare("UPDATE product_pipeline_runs SET status = 'processing', updated_at = ? WHERE product_id = ? AND stage = 'evidence_sanitization'").run(startTime, p.product_id);
        try {
            const status = processProductSanitization(p.product_id);
            const completeTime = new Date().toISOString();
            db.prepare("UPDATE product_pipeline_runs SET status = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'evidence_sanitization'").run(status, completeTime, completeTime, p.product_id);
            // Next stage logic will go here
        } catch(err) {
            console.error('Sanitization failed for product', p.product_id, err);
            const errTime = new Date().toISOString();
            db.prepare("UPDATE product_pipeline_runs SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'evidence_sanitization'").run(JSON.stringify({ error: err.message }), errTime, errTime, p.product_id);
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

  // Gather crawler results
  const sources = db.prepare('SELECT * FROM product_sources WHERE product_id = ?').all(product.id);
  const crawlerData = sources.map(source => {
      const crawlResults = db.prepare('SELECT source_type, url, status, output_json, error_json FROM source_crawl_results WHERE product_source_id = ?').all(source.id);
      return {
          source_name: source.source_name,
          source_role: source.source_role,
          source_domain: source.source_domain,
          source_url: source.source_url,
          status: source.status,
          crawl_results: crawlResults.map(cr => ({
              ...cr,
              output_json: cr.output_json ? JSON.parse(cr.output_json) : null,
              error_json: cr.error_json ? JSON.parse(cr.error_json) : null
          }))
      };
  });
  
  const evidenceData = sources.map(source => {
      const evi = db.prepare('SELECT status, evidence_json, stats_json, error_json FROM sanitized_evidence WHERE product_source_id = ?').get(source.id);
      if (!evi) return null;
      return {
          source_name: source.source_name,
          source_url: source.source_url,
          status: evi.status,
          evidence_json: evi.evidence_json ? JSON.parse(evi.evidence_json) : null,
          stats_json: evi.stats_json ? JSON.parse(evi.stats_json) : null,
          error_json: evi.error_json ? JSON.parse(evi.error_json) : null
      };
  }).filter(Boolean);
  
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
    crawler_json: JSON.stringify(crawlerData),
    evidence_json: JSON.stringify(evidenceData),
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
