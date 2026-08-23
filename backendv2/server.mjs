import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { db } from './pipeline/orchestration/db.mjs';
import { parseCsvString } from './pipeline/input/csv_reader.ts';
import { normalizeRows } from './pipeline/input/normalizer.ts';
import { discoverUrlsForProduct } from './pipeline/orchestration/url_discovery.mjs';
import { processProductSanitization } from './pipeline/sanitizer.mjs';
import { runExtractorAgent } from './pipeline/extractor/agent.mjs';
import { runTaxonomyClassifierAgent } from './pipeline/classifier/agent.mjs';
import { processAttributeTaxonomy } from './pipeline/attribute_taxonomy/agent.mjs';
import { processNormalizer } from './pipeline/normalizer/agent.mjs';
import { processWriter } from './pipeline/writer/agent.mjs';
import { processValidator } from './pipeline/validator/agent.mjs';

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
      part_manuf_raw, part_manuf_company_name, part_manuf_supplier_code, input_json, created_at, updated_at,
      normalized_mfg_part_num
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPipelineRun = db.prepare(`
    INSERT INTO product_pipeline_runs (product_id, stage, status, output_json, started_at, completed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertedProducts = [];

  for (const p of products) {
    const now = new Date().toISOString();
    const normalizedSku = p.mfg_part_num.toLowerCase().replace(/[^a-z0-9]/g, '');
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
      now,
      normalizedSku
    );
    const productId = result.lastInsertRowid;
    insertedProducts.push({ id: productId, ...p, normalized_mfg_part_num: normalizedSku });

    // Mark input stage done
    insertPipelineRun.run(productId, 'input', 'done', null, now, now, now);
    // Mark deduplicator pending
    insertPipelineRun.run(productId, 'deduplicator', 'pending', null, now, null, now);
  }

  // 4. Respond to frontend immediately
  res.json({ batch_id: batchId, products_count: products.length, errors });

  // 5. Run Pipeline in the background
  executePipelineForProducts(insertedProducts);
});

async function executePipelineForProducts(insertedProducts) {
    for (const p of insertedProducts) {
      const now = new Date().toISOString();
      const normalizedSku = p.mfg_part_num.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      // -- PHASE: Deduplicator --
      db.prepare("UPDATE product_pipeline_runs SET status = 'processing', updated_at = ? WHERE product_id = ? AND stage = 'deduplicator'").run(now, p.id);
      
      const canonical = db.prepare(`
        SELECT id FROM products 
        WHERE normalized_mfg_part_num = ? 
          AND id != ? 
          AND canonical_product_id IS NULL 
          AND id IN (
            SELECT product_id FROM product_pipeline_runs 
            WHERE stage = 'validator' AND status IN ('done', 'skipped')
          )
        ORDER BY id DESC LIMIT 1
      `).get(normalizedSku, p.id);
      
      if (canonical) {
          db.prepare("UPDATE products SET canonical_product_id = ? WHERE id = ?").run(canonical.id, p.id);
          
          const doneTime = new Date().toISOString();
          db.prepare("UPDATE product_pipeline_runs SET status = 'done', output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'deduplicator'")
            .run(JSON.stringify({ status: 'duplicate_found', canonical_product_id: canonical.id }), doneTime, doneTime, p.id);
            
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'orchestration', 'reused', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'crawler', 'reused', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'evidence_sanitization', 'reused', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'extractor', 'reused', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'classifier', 'reused', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'attribute_taxonomy', 'reused', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'normalizer', 'reused', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'writer', 'reused', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'validator', 'reused', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          
          continue; // Short circuit, use canonical
      }
      
      const uniqueTime = new Date().toISOString();
      db.prepare("UPDATE product_pipeline_runs SET status = 'done', output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'deduplicator'")
        .run(JSON.stringify({ status: 'unique', normalized_mfg_part_num: normalizedSku }), uniqueTime, uniqueTime, p.id);
        
      db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'orchestration', 'pending', ?, ?)").run(p.id, uniqueTime, uniqueTime);
      
      // -- PHASE: Orchestration --
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
        
        if (validSources.length === 0) {
          const finalJson = JSON.stringify({ sku: p.mfg_part_num, sources: orchestrationResult, error: 'no_product_urls_found' });
          const doneTime = new Date().toISOString();
          
          // Mark orchestration as done (the search completed successfully, just found nothing)
          db.prepare("UPDATE product_pipeline_runs SET status = 'done', output_json = ?, error_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'orchestration'").run(finalJson, JSON.stringify({error: 'not_found'}), doneTime, doneTime, p.id);
          
          // Mark crawler (which was already inserted as processing) as skipped
          db.prepare("UPDATE product_pipeline_runs SET status = 'skipped', completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'crawler'").run(doneTime, doneTime, p.id);
          
          // Insert downstream stages as skipped
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'evidence_sanitization', 'skipped', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'extractor', 'skipped', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'classifier', 'skipped', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'attribute_taxonomy', 'skipped', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'normalizer', 'skipped', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'writer', 'skipped', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'validator', 'skipped', ?, ?, ?)").run(p.id, doneTime, doneTime, doneTime);
          
          continue; // Short circuit
        }
        
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
            const nowIso = new Date().toISOString();
            db.prepare(`INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'evidence_sanitization', 'pending', ?, ?)`).run(p.id, nowIso, nowIso);
        }
        
      } catch (err) {
        console.error('Orchestration/Crawler failed for product', p.id, err);
        const errTime = new Date().toISOString();
        db.prepare("UPDATE product_pipeline_runs SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage IN ('orchestration', 'crawler') AND status = 'processing'").run(JSON.stringify({ error: err.message }), errTime, errTime, p.id);
      }
    }

    // PHASE 3: Evidence Sanitization
    const pendingSanitization = db.prepare("UPDATE product_pipeline_runs SET status = 'processing', updated_at = ? WHERE stage = 'evidence_sanitization' AND status = 'pending' RETURNING product_id").all(new Date().toISOString());
    for (let p of pendingSanitization) {
        try {
            const status = processProductSanitization(p.product_id);
            const completeTime = new Date().toISOString();
            db.prepare("UPDATE product_pipeline_runs SET status = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'evidence_sanitization'").run(status, completeTime, completeTime, p.product_id);
            if (status === 'done' || status === 'partial' || status === 'failed') {
                const nowIso = new Date().toISOString();
                db.prepare(`INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'extractor', 'pending', ?, ?)`).run(p.product_id, nowIso, nowIso);
            }
        } catch(err) {
            console.error('Sanitization failed for product', p.product_id, err);
            const errTime = new Date().toISOString();
            db.prepare("UPDATE product_pipeline_runs SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'evidence_sanitization'").run(JSON.stringify({ error: err.message }), errTime, errTime, p.product_id);
        }
    }

    // PHASE 4: Extractor
    const pendingExtractor = db.prepare("UPDATE product_pipeline_runs SET status = 'processing', updated_at = ? WHERE stage = 'extractor' AND status = 'pending' RETURNING product_id").all(new Date().toISOString());
    for (let p of pendingExtractor) {
        try {
            const product = db.prepare("SELECT * FROM products WHERE id = ?").get(p.product_id);
            const sources = db.prepare("SELECT * FROM product_sources WHERE product_id = ?").all(p.product_id);
            const evidences = sources.map(source => {
                const evi = db.prepare("SELECT * FROM sanitized_evidence WHERE product_source_id = ?").get(source.id);
                if (!evi) return null;
                return {
                    source_name: source.source_name,
                    source_role: source.source_role,
                    source_url: source.source_url,
                    evidence_json: evi.evidence_json ? JSON.parse(evi.evidence_json) : null
                };
            }).filter(Boolean);
            
            const result = await runExtractorAgent(product, evidences);
            const now = new Date().toISOString();
            
            db.prepare(`INSERT INTO product_extractions 
              (product_id, extraction_status, extraction_json, model_used, provider_used, fallback_used, retry_count, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
                p.product_id,
                result.parsed.extraction_status,
                JSON.stringify(result.parsed),
                result.modelUsed,
                "google-ai-studio",
                result.fallbackUsed ? 1 : 0,
                result.retryCount,
                now, now
            );
            
            let finalManufacturerName = result.parsed.manufacturer_name;
            if (!finalManufacturerName && p.part_manuf_company_name) {
                finalManufacturerName = p.part_manuf_company_name;
            }
            if (finalManufacturerName) {
                db.prepare("UPDATE products SET manufacturer_name = ? WHERE id = ?").run(finalManufacturerName, p.product_id);
            }

            db.prepare("UPDATE product_pipeline_runs SET status = 'done', output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'extractor'")
              .run(JSON.stringify({ status: result.parsed.extraction_status, model: result.modelUsed }), now, now, p.product_id);
              
            const nextTime = new Date().toISOString();
            db.prepare(`INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'classifier', 'pending', ?, ?)`).run(p.product_id, nextTime, nextTime);
              
        } catch(err) {
            console.error('Extractor failed for product', p.product_id, err);
            const errTime = new Date().toISOString();
            db.prepare("UPDATE product_pipeline_runs SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'extractor'")
              .run(JSON.stringify({ error: err.message }), errTime, errTime, p.product_id);
        }
    }

    // PHASE 5: Classifier
    const pendingClassifier = db.prepare("UPDATE product_pipeline_runs SET status = 'processing', updated_at = ? WHERE stage = 'classifier' AND status = 'pending' RETURNING product_id").all(new Date().toISOString());
    for (let p of pendingClassifier) {
        try {
            const product = db.prepare("SELECT * FROM products WHERE id = ?").get(p.product_id);
            await runTaxonomyClassifierAgent(product);
            
            // --- PHASE 5b: Attribute Taxonomy ---
            const timeTax = new Date().toISOString();
            db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'attribute_taxonomy', 'processing', ?, ?)").run(p.product_id, timeTax, timeTax);
            
            try {
                const taxRes = await processAttributeTaxonomy(p.product_id, db);
                const timeTaxDone = new Date().toISOString();
                db.prepare("UPDATE product_pipeline_runs SET status = ?, output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'attribute_taxonomy'").run(taxRes.status, JSON.stringify(taxRes), timeTaxDone, timeTaxDone, p.product_id);
                
                // --- PHASE 6: Normalizer ---
                const timeNorm = new Date().toISOString();
                db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'normalizer', 'processing', ?, ?)").run(p.product_id, timeNorm, timeNorm);
                
                try {
                    const normRes = await processNormalizer(p.product_id, db);
                    const timeNormDone = new Date().toISOString();
                    const finalNormStatus = normRes.status === 'no_attributes_available' ? 'skipped' : 'done';
                    db.prepare("UPDATE product_pipeline_runs SET status = ?, output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'normalizer'").run(finalNormStatus, JSON.stringify(normRes), timeNormDone, timeNormDone, p.product_id);

                    // --- PHASE 7: Writer ---
                    const timeWriter = new Date().toISOString();
                    db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'writer', 'processing', ?, ?)").run(p.product_id, timeWriter, timeWriter);
                    try {
                        const writerRes = await processWriter(p.product_id, db);
                        const timeWriterDone = new Date().toISOString();
                        const wStatus = (writerRes.status === 'skipped' || writerRes.status === 'reused') ? writerRes.status : 'done';
                        db.prepare("UPDATE product_pipeline_runs SET status = ?, output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'writer'").run(wStatus, JSON.stringify(writerRes), timeWriterDone, timeWriterDone, p.product_id);
                        
                        // --- PHASE 8: Validator ---
                        const timeValidator = new Date().toISOString();
                        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'validator', 'processing', ?, ?)").run(p.product_id, timeValidator, timeValidator);
                        try {
                            const valRes = await processValidator(p.product_id, db);
                            const timeValDone = new Date().toISOString();
                            const vStatus = (valRes.status === 'skipped' || valRes.status === 'reused') ? valRes.status : 'done';
                            db.prepare("UPDATE product_pipeline_runs SET status = ?, output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'validator'").run(vStatus, JSON.stringify(valRes), timeValDone, timeValDone, p.product_id);
                        } catch (ve) {
                            console.error(`[Orchestrator] Product ${p.product_id} Validator failed:`, ve);
                            const tVErr = new Date().toISOString();
                            db.prepare("UPDATE product_pipeline_runs SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'validator'").run(JSON.stringify({ error: ve.message }), tVErr, tVErr, p.product_id);
                        }
                    } catch (we) {
                        console.error(`[Orchestrator] Product ${p.product_id} Writer failed:`, we);
                        const tWErr = new Date().toISOString();
                        db.prepare("UPDATE product_pipeline_runs SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'writer'").run(JSON.stringify({ error: we.message }), tWErr, tWErr, p.product_id);
                        
                        // Explicitly skip downstream Validator on Writer failure
                        const tVSkip = new Date().toISOString();
                        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'validator', 'skipped', ?, ?, ?)").run(p.product_id, tVSkip, tVSkip, tVSkip);
                    }
                } catch (ne) {
                    console.error(`[Orchestrator] Product ${p.product_id} Normalizer failed:`, ne);
                    const timeNormFail = new Date().toISOString();
                    db.prepare("UPDATE product_pipeline_runs SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'normalizer'").run(JSON.stringify({ error: ne.message }), timeNormFail, timeNormFail, p.product_id);
                    const skipWriterTime = new Date().toISOString();
                    db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'writer', 'skipped', ?, ?, ?)").run(p.product_id, skipWriterTime, skipWriterTime, skipWriterTime);
                }
                
            } catch (e) {
                console.error(`[Orchestrator] Product ${p.product_id} Attribute Taxonomy failed:`, e);
                const timeTaxFail = new Date().toISOString();
                db.prepare("UPDATE product_pipeline_runs SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'attribute_taxonomy'").run(JSON.stringify({ error: e.message }), timeTaxFail, timeTaxFail, p.product_id);
                
                const skipTime = new Date().toISOString();
                db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'normalizer', 'skipped', ?, ?, ?)").run(p.product_id, skipTime, skipTime, skipTime);
                db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'writer', 'skipped', ?, ?, ?)").run(p.product_id, skipTime, skipTime, skipTime);
            }
            
        } catch (err) {
            console.error('Classifier wrapper failed for product', p.product_id, err);
        }
    }
}


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

app.get('/api/categories', (req, res) => {
  try {
    const nodes = db.prepare('SELECT id, parent_id, level, name, canonical_path FROM taxonomy_nodes').all();
    const categories = nodes.map(n => ({
      id: n.id,
      name: n.name,
      parent_id: n.parent_id,
      classpath: n.canonical_path,
      required_attributes: db.prepare('SELECT attribute_name as name FROM taxonomy_attributes WHERE taxonomy_id = ?').all(n.id).map(a => a.name)
    }));
    res.json(categories);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

app.get('/api/products', (req, res) => {
  const batchId = req.query.batch_id;
  const confMin = req.query.confidence_min;
  
  let query = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (batchId) { query += ' AND import_batch_id = ?'; params.push(batchId); }
  if (confMin) { query += ' AND overall_confidence >= ?'; params.push(parseFloat(confMin)); }
  query += ' ORDER BY id DESC LIMIT 50';
  const rows = db.prepare(query).all(...params);
  
  const items = rows.map(r => {
    const runs = db.prepare('SELECT * FROM product_pipeline_runs WHERE product_id = ?').all(r.id);
    const hasFailed = runs.some(run => run.status === 'failed');
    const hasPending = runs.some(run => run.status === 'pending' || run.status === 'processing');
    const notFound = runs.some(run => run.stage === 'orchestration' && run.error_json && run.error_json.includes('not_found'));
    let jobStatus = 'completed';
    if (hasFailed) jobStatus = 'failed';
    else if (hasPending) jobStatus = 'pending';
    else if (notFound) jobStatus = 'not_found';
    
    return {
      id: r.id,
      mfg_part_num: r.mfg_part_num,
      part_desc: r.part_desc,
      job_status: jobStatus,
      commerce_ready: r.commerce_ready === 1,
      overall_confidence: r.overall_confidence
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
    message: (run.stage === 'orchestration' && run.error_json && run.error_json.includes('not_found')) ? 'not_found' : run.status
  }));
  
  const targetId = product.canonical_product_id || product.id;
  const targetRuns = product.canonical_product_id ? db.prepare('SELECT * FROM product_pipeline_runs WHERE product_id = ? ORDER BY id ASC').all(targetId) : runs;

  // Gather crawler results
  const sources = db.prepare('SELECT * FROM product_sources WHERE product_id = ?').all(targetId);
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

  let scraped_text = '';
  evidenceData.forEach(ev => {
    if (ev.evidence_json && ev.evidence_json.crawls) {
      ev.evidence_json.crawls.forEach(crawl => {
        if (crawl.data && crawl.data.markdown) {
          scraped_text += `\n\n--- Source: ${ev.source_url || ev.source_name} ---\n\n${crawl.data.markdown}`;
        }
      });
    }
  });

  const extraction = db.prepare('SELECT extraction_json FROM product_extractions WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(targetId);
  const extractorJsonStr = extraction && extraction.extraction_json ? extraction.extraction_json : null;
  const classJson = (product.canonical_product_id ? db.prepare('SELECT classification_json FROM product_classifications WHERE product_id = ?').get(product.canonical_product_id) : db.prepare('SELECT classification_json FROM product_classifications WHERE product_id = ?').get(product.id))?.classification_json || null;
  
  let extraction_confidence = null;
  if (extractorJsonStr) {
     try {
       const extObj = JSON.parse(extractorJsonStr);
       const confs = [];
       if (extObj.attributes) {
           extObj.attributes.forEach(a => { if (typeof a.confidence === 'number') confs.push(a.confidence); });
       }
       if (extObj.description && typeof extObj.description.confidence === 'number') confs.push(extObj.description.confidence);
       if (confs.length > 0) {
           extraction_confidence = confs.reduce((a, b) => a + b, 0) / confs.length;
           extraction_confidence = Math.round(extraction_confidence * 100) / 100;
       }
     } catch(e) {}
  }
  
  let classification_confidence = null;
  if (classJson) {
      try {
          const cObj = JSON.parse(classJson);
          if (typeof cObj.confidence === 'number') classification_confidence = cObj.confidence;
      } catch(e){}
  }
  
  let product_attributes_json = null;
  try {
      const pAttrRows = db.prepare(`
          SELECT pa.raw_value, pa.extracted_value, pa.provenance_json, pa.normalized_value, pa.normalization_status, pa.normalization_method, pa.uom, pa.is_inferred,
                 ta.attribute_name, ta.normalized_name, ta.is_dimensional,
                 tav.value_text as taxonomy_value
          FROM product_attribute_values pa
          JOIN taxonomy_attributes ta ON pa.taxonomy_attribute_id = ta.id
          LEFT JOIN taxonomy_attribute_values tav ON pa.taxonomy_attribute_value_id = tav.id
          WHERE pa.product_id = ?
      `).all(targetId);
      if (pAttrRows && pAttrRows.length > 0) {
          product_attributes_json = pAttrRows.map(pa => ({
              attribute_name: pa.attribute_name,
              normalized_name: pa.normalized_name,
              value: pa.extracted_value,
              normalized_value: pa.normalized_value,
              normalization_status: pa.normalization_status,
              normalization_method: pa.normalization_method,
              raw_value: pa.raw_value,
              taxonomy_value: pa.taxonomy_value,
              uom: pa.uom,
              is_inferred: pa.is_inferred === 1,
              is_dimensional: pa.is_dimensional === 1,
              provenance: pa.provenance_json ? JSON.parse(pa.provenance_json) : []
          }));
      }
  } catch(e) {
      console.error("Failed to load product attributes API", e);
  }

    const validation_issues = db.prepare('SELECT field_name, issue_type, severity, description, value_a, value_b FROM validation_issues WHERE product_id = ?').all(targetId);

    const writerJsonStr = (() => {
      try {
        const wd = db.prepare('SELECT * FROM product_descriptions WHERE product_id = ?').get(targetId);
        return wd ? JSON.stringify(wd) : (targetRuns.find(r => r.stage === 'writer')?.output_json || null);
      } catch(e) { return null; }
    })();

    const enriched_fields = [];
    if (product.manufacturer_name) {
      enriched_fields.push({ field_name: 'Manufacturer Name', field_value: product.manufacturer_name });
    }
    if (extractorJsonStr) {
      try {
        const extObj = JSON.parse(extractorJsonStr);
        if (extObj.brand_name) enriched_fields.push({ field_name: 'Brand Name', field_value: extObj.brand_name });
        if (extObj.trade_name) enriched_fields.push({ field_name: 'Trade Name', field_value: extObj.trade_name });
        if (extObj.manufacturer_part_number) enriched_fields.push({ field_name: 'Manufacturer Part Number', field_value: extObj.manufacturer_part_number });
        if (extObj.alternate_part_numbers && extObj.alternate_part_numbers.length > 0) enriched_fields.push({ field_name: 'Alternate Part Number', field_value: extObj.alternate_part_numbers.join(' | ') });
      } catch(e){}
    }
    if (classJson) {
      try {
        const cObj = JSON.parse(classJson);
        if (cObj.department) enriched_fields.push({ field_name: 'Dept', field_value: cObj.department });
        if (cObj.class) enriched_fields.push({ field_name: 'Class', field_value: cObj.class });
        if (cObj.fine) enriched_fields.push({ field_name: 'Fine', field_value: cObj.fine });
        if (cObj.classpath) enriched_fields.push({ field_name: 'Classpath', field_value: cObj.classpath });
      } catch(e){}
    }
    if (writerJsonStr) {
      try {
        const wObj = JSON.parse(writerJsonStr);
        if (wObj.invoice_description) enriched_fields.push({ field_name: 'Invoice Desc', field_value: wObj.invoice_description });
        if (wObj.mobile_description) enriched_fields.push({ field_name: 'Mobile Desc', field_value: wObj.mobile_description });
        if (wObj.short_description) enriched_fields.push({ field_name: 'Short Desc', field_value: wObj.short_description });
        if (wObj.long_description) enriched_fields.push({ field_name: 'Long Desc', field_value: wObj.long_description });
        if (wObj.retail_description) enriched_fields.push({ field_name: 'Retail Desc', field_value: wObj.retail_description });
        if (wObj.marketing_description) enriched_fields.push({ field_name: 'Marketing Desc', field_value: wObj.marketing_description });
      } catch(e){}
    }
    if (product_attributes_json) {
      product_attributes_json.forEach(pa => {
        if (pa.normalized_value) {
          let source_snippet = '';
          let reasoning = '';
          if (pa.provenance && pa.provenance.length > 0) {
            source_snippet = pa.provenance[0].source_snippet || '';
            reasoning = pa.provenance[0].reasoning || '';
          }
          enriched_fields.push({
            field_name: pa.attribute_name,
            field_value: pa.normalized_value,
            field_uom: pa.uom || '',
            source_snippet,
            reasoning,
            is_inferred: pa.is_inferred
          });
        }
      });
    }

    res.json({
    id: product.id,
    batch_id: product.import_batch_id,
    mfg_part_num: product.mfg_part_num,
    part_desc: product.part_desc,
    job_status: jobStatus,
    commerce_ready: product.commerce_ready === 1,
    overall_confidence: product.overall_confidence,
    validation_status: product.validation_status,
    manufacturer_name: product.manufacturer_name,
    product_attributes_json,
    enriched_fields,
    confidence_scores: {
        extraction_confidence,
        classification_confidence,
        validation_confidence: product.overall_confidence,
        overall_confidence: product.overall_confidence
    },
    validation_issues,
    pipeline_events,
    input_json: product.input_json,
    orchestration_json: targetRuns.find(r => r.stage === 'orchestration')?.output_json || null,
    crawler_json: JSON.stringify(crawlerData),
    evidence_json: JSON.stringify(evidenceData),
    extractor_json: extractorJsonStr,
    classifier_json: (product.canonical_product_id ? db.prepare('SELECT classification_json FROM product_classifications WHERE product_id = ?').get(product.canonical_product_id) : db.prepare('SELECT classification_json FROM product_classifications WHERE product_id = ?').get(product.id))?.classification_json || null,
    normalizer_json: targetRuns.find(r => r.stage === 'normalizer')?.output_json || null,
    writer_json: writerJsonStr,
    error_message: runs.find(r => r.status === 'failed')?.error_json || null,
    scraped_text
  });
});

app.post('/api/products/:id/re-enrich', (req, res) => {
  const productId = parseInt(req.params.id);
  const now = new Date().toISOString();
  
  try {
    // 1. Fetch the product so we can run the pipeline on it
    const pRow = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
    if (!pRow) return res.status(404).json({ error: 'Product not found' });
    
    // Convert flat DB row back to the object structure expected by the pipeline
    const product = {
      id: pRow.id,
      mfg_part_num: pRow.mfg_part_num,
      part_desc: pRow.part_desc,
      brand_hints: {
        e1_brand: pRow.e1_brand,
        unilog_brand: pRow.unilog_brand,
        dib_brand: pRow.dib_brand
      },
      part_manuf: {
        raw: pRow.part_manuf_raw,
        company_name: pRow.part_manuf_company_name,
        supplier_code: pRow.part_manuf_supplier_code
      }
    };

    // 2. Clear out all downstream data in a transaction
    db.transaction(() => {
      // Clear product URL cache to force a fresh search!
      db.prepare("DELETE FROM product_url_cache WHERE normalized_mfg_part_num = ? AND url_status = 'not_found'").run(product.mfg_part_num.toLowerCase().trim());
      
      // Delete derived data
      db.prepare("DELETE FROM product_extractions WHERE product_id = ?").run(productId);
      db.prepare("DELETE FROM product_classifications WHERE product_id = ?").run(productId);
      db.prepare("DELETE FROM product_attribute_values WHERE product_id = ?").run(productId);
      db.prepare("DELETE FROM product_descriptions WHERE product_id = ?").run(productId);
      db.prepare("DELETE FROM validation_issues WHERE product_id = ?").run(productId);
      
      const sources = db.prepare("SELECT id FROM product_sources WHERE product_id = ?").all(productId);
      for (const s of sources) {
        db.prepare("DELETE FROM sanitized_evidence WHERE product_source_id = ?").run(s.id);
        db.prepare("DELETE FROM source_crawl_results WHERE product_source_id = ?").run(s.id);
      }
      db.prepare("DELETE FROM product_sources WHERE product_id = ?").run(productId);
      
      // Clear previous pipeline runs
      db.prepare("DELETE FROM product_pipeline_runs WHERE product_id = ?").run(productId);
      
      // 3. Reset pipeline state to initial states
      const insertRun = db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
      insertRun.run(productId, 'input', 'done', now, now, now);
      insertRun.run(productId, 'deduplicator', 'pending', now, null, now);
      
      // Detach if it was a duplicate
      db.prepare("UPDATE products SET canonical_product_id = NULL WHERE id = ?").run(productId);
    })();
    
    // 4. Respond to frontend immediately
    res.json({ message: 'Re-enrichment queued', product_id: productId });
    
    // 5. Trigger the pipeline for this product in the background
    executePipelineForProducts([product]);
    
  } catch (err) {
    console.error('Re-enrich failed for product', productId, err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats/logs', (req, res) => {
  const limit = req.query.limit || 100;
  try {
    const logs = db.prepare('SELECT * FROM llm_logs ORDER BY id DESC LIMIT ?').all(limit);
    res.json(logs);
  } catch (err) {
    // Return empty if table doesn't exist yet or error
    res.json([]);
  }
});

app.get('/api/stats/batches', (req, res) => {
  const batches = db.prepare('SELECT id, original_filename as filename, total_products as total, created_at FROM import_batches ORDER BY id DESC').all();
  
  const enriched = batches.map(b => {
    const products = db.prepare('SELECT id, canonical_product_id FROM products WHERE import_batch_id = ?').all(b.id);
    
    let completed = 0;
    let failed = 0;
    let pending = 0;
    let skipped = 0;
    
    for (const p of products) {
        const targetId = p.canonical_product_id || p.id;
        const runs = db.prepare("SELECT status, stage, error_json FROM product_pipeline_runs WHERE product_id = ?").all(targetId);
        
        const hasFailed = runs.some(r => r.status === 'failed');
        const hasPending = runs.some(r => r.status === 'pending' || r.status === 'processing');
        const notFound = runs.some(r => r.stage === 'orchestration' && r.error_json && r.error_json.includes('not_found'));
        
        if (hasFailed) failed++;
        else if (hasPending) pending++;
        else if (notFound) skipped++;
        else completed++;
    }
    
    return {
        ...b,
        completed_count: completed,
        failed_count: failed,
        pending_count: pending,
        skipped_count: skipped
    };
  });
  
  res.json(enriched);
});

app.get('/api/export', async (req, res) => {
  const batchId = req.query.batch_id;
  const productId = req.query.product_id;
  const confidenceThreshold = req.query.confidence_threshold;
  try {
    const { generateExport } = await import('./pipeline/export/service.mjs');
    const csvContent = generateExport(db, batchId, productId, confidenceThreshold);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
    res.send(csvContent);
  } catch (error) {
    console.error('Export Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(8000, () => {
  console.log('Server running on port 8000');
});
