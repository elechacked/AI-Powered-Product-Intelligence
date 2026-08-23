import { db } from './db.mjs';
import { discoverUrlsForProduct } from './url_discovery.mjs';
import { processProductSanitization } from '../sanitizer.mjs';
import { runExtractorAgent } from '../extractor/agent.mjs';
import { runTaxonomyClassifierAgent } from '../classifier/agent.mjs';
import { processAttributeTaxonomy } from '../attribute_taxonomy/agent.mjs';
import { processNormalizer } from '../normalizer/agent.mjs';
import { processWriter } from '../writer/agent.mjs';
import { processValidator } from '../validator/agent.mjs';
import { CONFIG, limiters } from './limiters.mjs';

let activeWorkers = 0;
let isWaking = false;


export function recoverStaleProducts() {
    try {
        const tx = db.transaction(() => {
            const stale = db.prepare("SELECT DISTINCT product_id FROM product_pipeline_runs WHERE status = 'processing'").all();
            if (stale.length === 0) return 0;
            
            for (const { product_id } of stale) {
                db.prepare("DELETE FROM product_pipeline_runs WHERE product_id = ? AND status = 'processing'").run(product_id);
                const dedup = db.prepare("SELECT id FROM product_pipeline_runs WHERE product_id = ? AND stage = 'deduplicator'").get(product_id);
                if (dedup) {
                    db.prepare("UPDATE product_pipeline_runs SET status = 'pending' WHERE id = ?").run(dedup.id);
                }
            }
            return stale.length;
        });
        const count = tx();
        if (count > 0) {
            console.log(`[Worker Pool] Recovered ${count} stale products on startup.`);
            setTimeout(wakeUpWorkers, 1000);
        }
    } catch(e) {
        console.error("Failed to recover stale products:", e.message);
    }
}

export function executePipelineForProducts(insertedProducts) {
    wakeUpWorkers();
}

function wakeUpWorkers() {
    if (isWaking) return;
    isWaking = true;
    
    try {
        while (activeWorkers < CONFIG.PRODUCT_CONCURRENCY) {
            const product = claimNextProduct();
            if (!product) break;
            
            activeWorkers++;
            processProduct(product).catch(err => {
                console.error(`Product ${product.id} failed globally:`, err);
            }).finally(() => {
                activeWorkers--;
                setTimeout(wakeUpWorkers, 100);
            });
        }
    } finally {
        isWaking = false;
    }
}

function claimNextProduct() {
    const claimTx = db.transaction(() => {
        const p = db.prepare(`
            SELECT p.* FROM products p 
            JOIN product_pipeline_runs r ON p.id = r.product_id 
            WHERE r.stage = 'deduplicator' AND r.status = 'pending' 
              AND p.normalized_mfg_part_num NOT IN (
                  SELECT p2.normalized_mfg_part_num 
                  FROM products p2
                  JOIN product_pipeline_runs r2 ON p2.id = r2.product_id
                  WHERE r2.status = 'processing'
              )
            ORDER BY p.id ASC LIMIT 1
        `).get();
        if (p) {
            db.prepare("UPDATE product_pipeline_runs SET status = 'processing', updated_at = ? WHERE product_id = ? AND stage = 'deduplicator'").run(new Date().toISOString(), p.id);
            return p;
        }
        return null;
    });
    return claimTx();
}

async function processProduct(p) {
    const now = new Date().toISOString();
    const normalizedSku = p.normalized_mfg_part_num || p.mfg_part_num.toLowerCase().replace(/[^a-z0-9]/g, '');
    const existingRuns = db.prepare("SELECT stage, status FROM product_pipeline_runs WHERE product_id = ?").all(p.id);
    const runState = {};
    for (const r of existingRuns) {
        if (['done', 'skipped', 'reused', 'partial'].includes(r.status)) {
            runState[r.stage] = true;
        }
    }

    // -- PHASE: Deduplicator --
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
        const canonStats = db.prepare("SELECT commerce_ready, overall_confidence, validation_status FROM products WHERE id = ?").get(canonical.id);
        if (canonStats) {
            db.prepare("UPDATE products SET commerce_ready = ?, overall_confidence = ?, validation_status = ? WHERE id = ?").run(
                canonStats.commerce_ready, canonStats.overall_confidence, canonStats.validation_status, p.id
            );
        }
        
        const doneTime = new Date().toISOString();
        db.prepare("UPDATE product_pipeline_runs SET status = 'done', output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'deduplicator'")
          .run(JSON.stringify({ status: 'duplicate_found', canonical_product_id: canonical.id }), doneTime, doneTime, p.id);
          
        ['orchestration', 'crawler', 'evidence_sanitization', 'extractor', 'classifier', 'attribute_taxonomy', 'normalizer', 'writer', 'validator'].forEach(stage => {
            db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, ?, 'reused', ?, ?, ?)").run(p.id, stage, doneTime, doneTime, doneTime);
        });
        return;
    }
    
    const uniqueTime = new Date().toISOString();
    db.prepare("UPDATE product_pipeline_runs SET status = 'done', output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'deduplicator'")
      .run(JSON.stringify({ status: 'unique', normalized_mfg_part_num: normalizedSku }), uniqueTime, uniqueTime, p.id);
      
    // -- PHASE: Orchestration --
    let validSources = [];
    if (!runState['orchestration']) {
    try {
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'orchestration', 'processing', ?, ?)").run(p.id, uniqueTime, uniqueTime);
        
        const orchestrationResult = await discoverUrlsForProduct(p, db);
        const doneTime = new Date().toISOString();
        
        if (orchestrationResult.length === 0) {
            db.prepare("UPDATE product_pipeline_runs SET status = 'done', output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'orchestration'").run(JSON.stringify({ status: 'no_sources_found' }), doneTime, doneTime, p.id);
            db.prepare("DELETE FROM product_pipeline_runs WHERE product_id = ? AND stage IN ('crawler','evidence_sanitization','extractor','classifier','attribute_taxonomy','normalizer','writer','validator')").run(p.id);
            ['crawler', 'evidence_sanitization', 'extractor', 'classifier', 'attribute_taxonomy', 'normalizer', 'writer', 'validator'].forEach(stage => {
                db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, ?, 'skipped', ?, ?, ?)").run(p.id, stage, doneTime, doneTime, doneTime);
            });
            return;
        }

        validSources = orchestrationResult.filter(s => s.product_url && s.url_status === 'success');
        if (validSources.length === 0) {
            db.prepare("UPDATE product_pipeline_runs SET status = 'done', error_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'orchestration'").run(JSON.stringify({error: 'not_found'}), doneTime, doneTime, p.id);
            db.prepare("DELETE FROM product_pipeline_runs WHERE product_id = ? AND stage IN ('crawler','evidence_sanitization','extractor','classifier','attribute_taxonomy','normalizer','writer','validator')").run(p.id);
            ['crawler', 'evidence_sanitization', 'extractor', 'classifier', 'attribute_taxonomy', 'normalizer', 'writer', 'validator'].forEach(stage => {
                db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, ?, 'skipped', ?, ?, ?)").run(p.id, stage, doneTime, doneTime, doneTime);
            });
            return;
        }
        
        db.prepare("UPDATE product_pipeline_runs SET status = 'done', completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'orchestration'").run(doneTime, doneTime, p.id);
        
        const insertSource = db.prepare(`INSERT INTO product_sources (product_id, source_name, source_role, source_domain, source_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'processing', ?, ?)`);
        for (const s of validSources) {
           const row = insertSource.run(p.id, s.source_name, s.source_role, s.official_domain, s.product_url, doneTime, doneTime);
           s.dbId = row.lastInsertRowid;
        }
    } catch (err) {
        failStage(p.id, 'orchestration', err);
        return;
    }
    } else {
        const sourcesRow = db.prepare("SELECT * FROM product_sources WHERE product_id = ? AND (status = 'done' OR status = 'processing')").all(p.id);
        validSources = sourcesRow.map(s => ({
            dbId: s.id,
            source_name: s.source_name,
            source_role: s.source_role,
            official_domain: s.source_domain,
            product_url: s.source_url
        }));
    }

    // -- PHASE: Crawler --
    if (!runState['crawler']) {
    try {
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'crawler', 'processing', ?, ?)").run(p.id, new Date().toISOString(), new Date().toISOString());
        
        const crawlUrls = validSources.map(s => s.product_url);
        const domains = validSources.map(s => {
            try { return new URL(s.product_url).hostname; } catch(e) { return s.official_domain; }
        }).filter(Boolean);

        if (crawlUrls.length > 0) {
            const { crawl } = await import('thecrawler');
            
            // Domain rate limiting
            await limiters.domain.acquireAll(domains);
            let crawlResult;
            try {
                crawlResult = await crawl({
                    urls: crawlUrls,
                    extractMarkdown: true,
                    extractStructuredData: true,
                    extractTables: true,
                    adaptiveCrawling: true,
                    cache: { enabled: false }
                });
            } finally {
                limiters.domain.releaseAll(domains);
            }
            
            let successes = 0, failures = 0;
            const insertCrawlResult = db.prepare(`INSERT INTO source_crawl_results (product_source_id, source_type, url, status, output_json, error_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            
            for (let i = 0; i < crawlResult.pages.length; i++) {
                const page = crawlResult.pages[i];
                let source = validSources.find(s => s.product_url === page.url) || validSources[i];
                if (!source) continue;

                if (page.status === 'success' || page.statusCode === 200) {
                    successes++;
                    db.prepare("UPDATE product_sources SET status = 'done', updated_at = ? WHERE id = ?").run(new Date().toISOString(), source.dbId);
                    const outputData = {
                        text: page.text, markdown: page.markdown, structuredData: page.structuredData, commerceData: page.commerceData,
                        microdata: page.microdata, tables: page.tables, meta: page.meta, openGraph: page.openGraph, twitterCard: page.twitterCard
                    };
                    insertCrawlResult.run(source.dbId, 'product_page', page.url, 'done', JSON.stringify(outputData), null, new Date().toISOString(), new Date().toISOString());
                    
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
                       const docRow = insertCrawlResult.run(source.dbId, docType, doc.url, docStatus, JSON.stringify({ anchorText: doc.text }), null, new Date().toISOString(), new Date().toISOString());
                       
                       if (isSupported) {
                           try {
                               // Domain rate limiting for document
                               const docDomain = new URL(doc.url).hostname.toLowerCase().replace(/^www\./, '');
                               await limiters.domain.acquireAll([docDomain]);
                               let docCrawl;
                               try {
                                   docCrawl = await crawl({
                                       urls: [doc.url],
                                       extractMarkdown: true,
                                       adaptiveCrawling: false,
                                       cache: { enabled: false }
                                   });
                               } finally {
                                   limiters.domain.releaseAll([doc.url]);
                               }
                               
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
                    db.prepare("UPDATE product_sources SET status = 'failed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), source.dbId);
                    insertCrawlResult.run(source.dbId, 'product_page', page.url, 'failed', null, JSON.stringify({ error: page.error, errorType: page.errorType }), new Date().toISOString(), new Date().toISOString());
                }
            }
            
            let crawlerStatus = 'done';
            if (successes > 0 && failures > 0) crawlerStatus = 'partial';
            else if (successes === 0 && failures > 0) crawlerStatus = 'failed';
            
            db.prepare("UPDATE product_pipeline_runs SET status = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'crawler'").run(crawlerStatus, new Date().toISOString(), new Date().toISOString(), p.id);
        }
    } catch (err) {
        failStage(p.id, 'crawler', err);
        return;
    }
    }

    // -- PHASE: Evidence Sanitization --
    if (!runState['evidence_sanitization']) {
    try {
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'evidence_sanitization', 'processing', ?, ?)").run(p.id, new Date().toISOString(), new Date().toISOString());
        const status = processProductSanitization(p.id);
        db.prepare("UPDATE product_pipeline_runs SET status = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'evidence_sanitization'").run(status, new Date().toISOString(), new Date().toISOString(), p.id);
    } catch (err) {
        failStage(p.id, 'evidence_sanitization', err);
        return;
    }
    }

    // -- PHASE: Extractor --
    if (!runState['extractor']) {
    try {
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'extractor', 'processing', ?, ?)").run(p.id, new Date().toISOString(), new Date().toISOString());
        
        const sources = db.prepare("SELECT * FROM product_sources WHERE product_id = ?").all(p.id);
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
        
        const result = await runExtractorAgent(p, evidences);
        
        db.prepare(`INSERT INTO product_extractions (product_id, extraction_status, extraction_json, model_used, provider_used, fallback_used, retry_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            p.id, result.parsed.extraction_status, JSON.stringify(result.parsed), result.modelUsed, "google-ai-studio", result.fallbackUsed ? 1 : 0, result.retryCount, new Date().toISOString(), new Date().toISOString()
        );
        
        let finalManuf = result.parsed.manufacturer_name || p.part_manuf_company_name;
        if (finalManuf) db.prepare("UPDATE products SET manufacturer_name = ? WHERE id = ?").run(finalManuf, p.id);
        
        db.prepare("UPDATE product_pipeline_runs SET status = 'done', output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'extractor'").run(JSON.stringify({ status: result.parsed.extraction_status, model: result.modelUsed }), new Date().toISOString(), new Date().toISOString(), p.id);
    } catch (err) {
        failStage(p.id, 'extractor', err);
        return;
    }
    }

    // -- PHASE: Classifier --
    if (!runState['classifier']) {
    try {
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'classifier', 'processing', ?, ?)").run(p.id, new Date().toISOString(), new Date().toISOString());
        await runTaxonomyClassifierAgent(p);
    } catch (err) {
        failStage(p.id, 'classifier', err);
        return;
    }
    }

    // -- PHASE: Attribute Taxonomy --
    if (!runState['attribute_taxonomy']) {
    try {
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'attribute_taxonomy', 'processing', ?, ?)").run(p.id, new Date().toISOString(), new Date().toISOString());
        const taxRes = await processAttributeTaxonomy(p.id, db);
        db.prepare("UPDATE product_pipeline_runs SET status = ?, output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'attribute_taxonomy'").run(taxRes.status, JSON.stringify(taxRes), new Date().toISOString(), new Date().toISOString(), p.id);
    } catch (err) {
        failStage(p.id, 'attribute_taxonomy', err);
        const skip = new Date().toISOString();
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'normalizer', 'skipped', ?, ?, ?)").run(p.id, skip, skip, skip);
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'writer', 'skipped', ?, ?, ?)").run(p.id, skip, skip, skip);
        return;
    }
    }

    // -- PHASE: Normalizer --
    if (!runState['normalizer']) {
    try {
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'normalizer', 'processing', ?, ?)").run(p.id, new Date().toISOString(), new Date().toISOString());
        const normRes = await processNormalizer(p.id, db);
        const st = normRes.status === 'no_attributes_available' ? 'skipped' : 'done';
        db.prepare("UPDATE product_pipeline_runs SET status = ?, output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'normalizer'").run(st, JSON.stringify(normRes), new Date().toISOString(), new Date().toISOString(), p.id);
    } catch (err) {
        failStage(p.id, 'normalizer', err);
        const skip = new Date().toISOString();
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'writer', 'skipped', ?, ?, ?)").run(p.id, skip, skip, skip);
        return;
    }
    }

    // -- PHASE: Writer --
    if (!runState['writer']) {
    try {
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'writer', 'processing', ?, ?)").run(p.id, new Date().toISOString(), new Date().toISOString());
        const writerRes = await processWriter(p.id, db);
        const wSt = (writerRes.status === 'skipped' || writerRes.status === 'reused') ? writerRes.status : 'done';
        db.prepare("UPDATE product_pipeline_runs SET status = ?, output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'writer'").run(wSt, JSON.stringify(writerRes), new Date().toISOString(), new Date().toISOString(), p.id);
    } catch (err) {
        failStage(p.id, 'writer', err);
        const skip = new Date().toISOString();
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, completed_at, updated_at) VALUES (?, 'validator', 'skipped', ?, ?, ?)").run(p.id, skip, skip, skip);
        return;
    }
    }

    // -- PHASE: Validator --
    if (!runState['validator']) {
    try {
        db.prepare("INSERT INTO product_pipeline_runs (product_id, stage, status, started_at, updated_at) VALUES (?, 'validator', 'processing', ?, ?)").run(p.id, new Date().toISOString(), new Date().toISOString());
        const valRes = await processValidator(p.id, db);
        const vSt = (valRes.status === 'skipped' || valRes.status === 'reused') ? valRes.status : 'done';
        db.prepare("UPDATE product_pipeline_runs SET status = ?, output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'validator'").run(vSt, JSON.stringify(valRes), new Date().toISOString(), new Date().toISOString(), p.id);
    } catch (err) {
        failStage(p.id, 'validator', err);
    }
    }
}

function failStage(productId, stage, err) {
    console.error(`[Orchestrator] Product ${productId} failed at ${stage}:`, err);
    const now = new Date().toISOString();
    db.prepare("UPDATE product_pipeline_runs SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = ?")
      .run(JSON.stringify({ error: err.message }), now, now, productId, stage);
}
