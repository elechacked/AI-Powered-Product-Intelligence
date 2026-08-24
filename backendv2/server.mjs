import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { db } from './pipeline/orchestration/db.mjs';
import { parseCsvString } from './pipeline/input/csv_reader.js';
import { normalizeRows } from './pipeline/input/normalizer.js';
import { discoverUrlsForProduct } from './pipeline/orchestration/url_discovery.mjs';
import { processProductSanitization } from './pipeline/sanitizer.mjs';
import { runExtractorAgent } from './pipeline/extractor/agent.mjs';
import { runTaxonomyClassifierAgent } from './pipeline/classifier/agent.mjs';
import { processAttributeTaxonomy } from './pipeline/attribute_taxonomy/agent.mjs';
import { processNormalizer } from './pipeline/normalizer/agent.mjs';
import { processWriter } from './pipeline/writer/agent.mjs';
import { processValidator } from './pipeline/validator/agent.mjs';
import { executePipelineForProducts, recoverStaleProducts } from './pipeline/orchestration/product_worker_pool.mjs';

const app = express();
const allowedOrigins = [
  'https://product-intelligence.pska.org.in',
  'http://127.0.0.1:4174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://localhost:')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
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

// Recover any stale products from a previous crash
recoverStaleProducts();

app.get('/api/stats', (req, res) => {
  const totalRow = db.prepare('SELECT COUNT(*) as c FROM products').get();
  
  const failedRow = db.prepare(`
    SELECT COUNT(DISTINCT p.id) as c 
    FROM products p
    WHERE EXISTS (
      SELECT 1 FROM product_pipeline_runs pr 
      WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id) 
      AND pr.status = 'failed'
    )
  `).get();

  const enrichedRow = db.prepare(`
    SELECT COUNT(DISTINCT p.id) as c 
    FROM products p
    WHERE NOT EXISTS (
      SELECT 1 FROM product_pipeline_runs pr 
      WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id) 
      AND (pr.status IN ('failed', 'pending', 'processing'))
    ) 
    AND EXISTS (
      SELECT 1 FROM product_pipeline_runs pr 
      WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id)
    )
  `).get();

  const commerceReadyRow = db.prepare('SELECT COUNT(*) as c FROM products WHERE commerce_ready = 1').get();

  const statusBreakdown = db.prepare(`
    WITH ProductStatuses AS (
      SELECT 
        p.id as product_id,
        CASE 
          WHEN EXISTS (SELECT 1 FROM product_pipeline_runs pr WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id) AND pr.status = 'failed') THEN 'failed'
          WHEN EXISTS (SELECT 1 FROM product_pipeline_runs pr WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id) AND pr.stage = 'orchestration' AND pr.error_json LIKE '%not_found%') THEN 'No URLs Found'
          WHEN EXISTS (SELECT 1 FROM product_pipeline_runs pr WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id) AND pr.status IN ('pending', 'processing')) THEN 
            (SELECT stage FROM product_pipeline_runs pr WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id) AND pr.status IN ('pending', 'processing') ORDER BY id DESC LIMIT 1)
          ELSE 'completed'
        END as current_status
      FROM products p
      WHERE EXISTS (SELECT 1 FROM product_pipeline_runs pr WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id))
    )
    SELECT current_status as status, COUNT(*) as count
    FROM ProductStatuses
    GROUP BY current_status
    ORDER BY count DESC
  `).all();

  res.json({
    total: totalRow.c,
    enriched: enrichedRow.c,
    failed: failedRow.c,
    commerceReady: commerceReadyRow.c,
    statusBreakdown
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

  app.get('/api/categories/:nodeId/attributes/:attrName/sources', (req, res) => {
    const { nodeId, attrName } = req.params;
    
    const attr = db.prepare('SELECT id FROM taxonomy_attributes WHERE taxonomy_id = ? AND attribute_name = ?').get(nodeId, attrName);
    if (!attr) return res.json([]);

    const values = db.prepare(`
      SELECT pa.provenance_json, p.part_desc, p.mfg_part_num, p.id as product_id
      FROM product_attribute_values pa
      JOIN products p ON pa.product_id = p.id
      WHERE pa.taxonomy_attribute_id = ? AND pa.provenance_json IS NOT NULL
    `).all(attr.id);

    const results = [];
    for (const v of values) {
      let prov = [];
      try { prov = JSON.parse(v.provenance_json); } catch(e){}
      
      const sources = db.prepare("SELECT source_url FROM product_sources WHERE product_id = ? AND status='done' ORDER BY id ASC LIMIT 1").get(v.product_id);
      const product_url = sources ? sources.source_url : '';

      for (const p of prov) {
        results.push({
            product_name: v.part_desc || v.mfg_part_num,
            product_url: product_url,
            source_name: p.source_name || '',
            source_url: p.source_url || '',
            reasoning: p.reasoning || '',
            source_snippet: p.source_snippet || ''
        });
      }
    }

    res.json(results);
  });

app.get('/api/products', (req, res) => {
  const batchId = req.query.batch_id;
  const confMin = req.query.confidence_min;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const statusFilter = req.query.status;
  const search = req.query.search;
  
  const offset = (page - 1) * limit;

  let baseQuery = ' FROM products p WHERE 1=1';
  const params = [];
  
  if (batchId) { baseQuery += ' AND p.import_batch_id = ?'; params.push(batchId); }
  if (confMin) { baseQuery += ' AND p.overall_confidence >= ?'; params.push(parseFloat(confMin)); }
  if (search) { baseQuery += ' AND p.mfg_part_num LIKE ?'; params.push(`%${search}%`); }

  if (statusFilter === 'failed') {
    baseQuery += ` AND EXISTS (
      SELECT 1 FROM product_pipeline_runs pr 
      WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id) 
      AND pr.status = 'failed'
    )`;
  } else if (statusFilter === 'enriched') {
    baseQuery += ` AND NOT EXISTS (
      SELECT 1 FROM product_pipeline_runs pr 
      WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id) 
      AND (pr.status IN ('failed', 'pending', 'processing'))
    ) 
    AND EXISTS (
      SELECT 1 FROM product_pipeline_runs pr 
      WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id)
    )`;
  } else if (statusFilter === 'commerce_ready') {
    baseQuery += ' AND p.commerce_ready = 1';
  } else if (statusFilter === 'pending') {
    baseQuery += ` AND EXISTS (
      SELECT 1 FROM product_pipeline_runs pr 
      WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id) 
      AND (pr.status IN ('pending', 'processing'))
    )`;
  } else if (statusFilter === 'No URLs Found') {
    baseQuery += ` AND EXISTS (
      SELECT 1 FROM product_pipeline_runs pr 
      WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id) 
      AND pr.stage = 'orchestration' AND pr.error_json LIKE '%not_found%'
    )`;
  } else if (statusFilter === 'completed') {
    baseQuery += ` AND NOT EXISTS (
      SELECT 1 FROM product_pipeline_runs pr 
      WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id) 
      AND (pr.status IN ('failed', 'pending', 'processing'))
    ) AND EXISTS (
      SELECT 1 FROM product_pipeline_runs pr 
      WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id)
    )`;
  } else if (statusFilter) {
    baseQuery += ` AND NOT EXISTS (
      SELECT 1 FROM product_pipeline_runs pr 
      WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id) AND pr.status = 'failed'
    ) AND NOT EXISTS (
      SELECT 1 FROM product_pipeline_runs pr 
      WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id) AND pr.stage = 'orchestration' AND pr.error_json LIKE '%not_found%'
    ) AND ? = (
      SELECT stage FROM product_pipeline_runs pr 
      WHERE pr.product_id = COALESCE(p.canonical_product_id, p.id) 
      AND pr.status IN ('pending', 'processing') 
      ORDER BY id DESC LIMIT 1
    )`;
    params.push(statusFilter);
  }

  const countQuery = 'SELECT COUNT(DISTINCT p.id) as total' + baseQuery;
  const totalRow = db.prepare(countQuery).get(...params);
  const total = totalRow.total;

  const dataQuery = 'SELECT p.*' + baseQuery + ' ORDER BY p.id DESC LIMIT ? OFFSET ?';
  const rows = db.prepare(dataQuery).all(...params, limit, offset);
  
  const items = rows.map(r => {
    const targetId = r.canonical_product_id || r.id;
    const runs = db.prepare('SELECT * FROM product_pipeline_runs WHERE product_id = ?').all(targetId);
    const hasFailed = runs.some(run => run.status === 'failed');
    const hasPending = runs.some(run => run.status === 'pending' || run.status === 'processing');
    const notFound = runs.some(run => run.stage === 'orchestration' && run.error_json && run.error_json.includes('not_found'));
    let jobStatus = 'completed';
    if (hasFailed) jobStatus = 'failed';
    else if (hasPending) jobStatus = 'pending';
    else if (notFound) jobStatus = 'not_found';
    
    let commerceReady = r.commerce_ready;
    let overallConfidence = r.overall_confidence;
    
    if (r.canonical_product_id) {
       const canon = db.prepare('SELECT commerce_ready, overall_confidence FROM products WHERE id = ?').get(r.canonical_product_id);
       if (canon) {
          commerceReady = canon.commerce_ready;
          overallConfidence = canon.overall_confidence;
       }
    }

    return {
      id: r.id,
      mfg_part_num: r.mfg_part_num,
      part_desc: r.part_desc,
      job_status: jobStatus,
      commerce_ready: commerceReady === 1,
      overall_confidence: overallConfidence
    };
  });
  
  res.json({
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
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
    const primarySource = evidenceData && evidenceData.length > 0 ? evidenceData[0] : null;
    const primaryUrl = primarySource ? (primarySource.source_url || primarySource.source_name) : '';

    if (product.manufacturer_name) {
      enriched_fields.push({ field_name: 'Manufacturer Name', field_value: product.manufacturer_name, reasoning: 'Identified manufacturer of the product.', source_url: primaryUrl });
    }
    if (extractorJsonStr) {
      try {
        const extObj = JSON.parse(extractorJsonStr);
        if (extObj.brand_name) enriched_fields.push({ field_name: 'Brand Name', field_value: extObj.brand_name, reasoning: 'Extracted brand name.', source_url: primaryUrl });
        if (extObj.trade_name) enriched_fields.push({ field_name: 'Trade Name', field_value: extObj.trade_name, reasoning: 'Extracted trade name.', source_url: primaryUrl });
        if (extObj.manufacturer_part_number) enriched_fields.push({ field_name: 'Manufacturer Part Number', field_value: extObj.manufacturer_part_number, reasoning: 'Extracted MPN.', source_url: primaryUrl });
        if (extObj.alternate_part_numbers && extObj.alternate_part_numbers.length > 0) enriched_fields.push({ field_name: 'Alternate Part Number', field_value: extObj.alternate_part_numbers.join(' | '), reasoning: 'Extracted alternate part numbers.', source_url: primaryUrl });
      } catch(e){}
    }
    if (classJson) {
      try {
        const cObj = JSON.parse(classJson);
        if (cObj.department) enriched_fields.push({ field_name: 'Dept', field_value: cObj.department, reasoning: 'AI Taxonomy classification (Department level).' });
        if (cObj.class) enriched_fields.push({ field_name: 'Class', field_value: cObj.class, reasoning: 'AI Taxonomy classification (Class level).' });
        if (cObj.fine) enriched_fields.push({ field_name: 'Fine', field_value: cObj.fine, reasoning: 'AI Taxonomy classification (Fine level).' });
        if (cObj.classpath) enriched_fields.push({ field_name: 'Classpath', field_value: cObj.classpath, reasoning: 'Canonical taxonomy path.', is_inferred: true });
      } catch(e){}
    }
    if (writerJsonStr) {
      try {
        const wObj = JSON.parse(writerJsonStr);
        if (wObj.invoice_description) enriched_fields.push({ field_name: 'Invoice Desc', field_value: wObj.invoice_description, reasoning: 'Generated by AI Writer Agent.' });
        if (wObj.mobile_description) enriched_fields.push({ field_name: 'Mobile Desc', field_value: wObj.mobile_description, reasoning: 'Generated by AI Writer Agent.' });
        if (wObj.short_description) enriched_fields.push({ field_name: 'Short Desc', field_value: wObj.short_description, reasoning: 'Generated by AI Writer Agent.' });
        if (wObj.long_description) enriched_fields.push({ field_name: 'Long Desc', field_value: wObj.long_description, reasoning: 'Generated by AI Writer Agent.' });
        if (wObj.retail_description) enriched_fields.push({ field_name: 'Retail Desc', field_value: wObj.retail_description, reasoning: 'Generated by AI Writer Agent.' });
        if (wObj.marketing_description) enriched_fields.push({ field_name: 'Marketing Desc', field_value: wObj.marketing_description, reasoning: 'Generated by AI Writer Agent.' });
      } catch(e){}
    }
    if (product_attributes_json) {
      product_attributes_json.forEach(pa => {
        if (pa.normalized_value) {
          let source_snippet = '';
          let reasoning = '';
          let source_url = '';
          if (pa.provenance && pa.provenance.length > 0) {
            source_snippet = pa.provenance[0].source_snippet || '';
            reasoning = pa.provenance[0].reasoning || '';
            source_url = pa.provenance[0].source_url || '';
          }
          let displayValue = pa.normalized_value;
          if (pa.uom) {
             displayValue = displayValue.replace(/[a-zA-Z\s]+$/, '').trim();
          }
          enriched_fields.push({
            field_name: pa.attribute_name,
            field_value: displayValue,
            field_uom: pa.uom || '',
            source_snippet,
            reasoning,
            source_url,
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
      // Clear caches to force a fresh search!
      db.prepare("DELETE FROM product_url_cache WHERE normalized_mfg_part_num = ? AND url_status = 'not_found'").run(product.mfg_part_num.toLowerCase().trim());
      db.prepare("DELETE FROM company_domain_cache WHERE status = 'not_found' OR status = 'failed'").run();
      
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
  const search = req.query.search;
  try {
    let query = 'SELECT * FROM llm_logs WHERE 1=1';
    const params = [];
    if (search) {
      query += ' AND product_sku LIKE ?';
      params.push(`%${search}%`);
    }
    query += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);
    const logs = db.prepare(query).all(...params);
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

const PORT = process.env.PORT || 9001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
