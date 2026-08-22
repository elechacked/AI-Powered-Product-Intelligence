/**
 * test_full_flow.mjs
 * Runs input normalization followed by URL discovery.
 * Checks database for coverage requirements.
 */

import { parseCsvString } from '../input/csv_reader.ts';
import { normalizeRows } from '../input/normalizer.ts';
import { discoverUrlsForProduct, extractSources } from './url_discovery.mjs';
import { db } from './db.mjs';

const csvData = `Mfg_Part_Num,Part_Desc,E1_Brand,Unilog_Brand,DIB_Brand,Part_Manuf
3MABR-7100045865,3M 775L Stikit Film P120 - Cubitron II 50 Disc/Box,-- Unbranded --,-- No Unilog Brand --,-- No DIB Brand --,Jam Industrial Supply LLC (JAMIN)
3MABR-7100075678,3M 775L Stikit Film P150 - Cubitron II 50 Disc/Box,-- Unbranded --,-- No Unilog Brand --,-- No DIB Brand --,Jam Industrial Supply LLC (JAMIN)
DCB518ASTS06G,"DCB518ASTS06G Diablo 1/2""x18"" - Sanding Belt 6pc",-- Unbranded --,-- No Unilog Brand --,-- No DIB Brand --,Freud Inc (2435)`;

async function run() {
  console.log("=== RUNNING INPUT NORMALIZATION ===");
  const rawRows = parseCsvString(csvData);
  const { products, errors } = normalizeRows(rawRows);
  
  if (errors.length > 0) {
    console.error("Errors parsing CSV:", errors);
    return;
  }
  
  console.log(`Normalized ${products.length} products.\n`);

  for (const product of products) {
    console.log(`=== SKU: ${product.mfg_part_num} ===`);
    
    // Log source candidates before domain resolution
    const sources = extractSources(product);
    console.log(`Source candidates: ${sources.map(s => `"${s.name}" (${s.role})`).join(', ')}`);
    
    console.log(`Starting URL discovery...`);
    let start = Date.now();
    const results = await discoverUrlsForProduct(product);
    let duration = Date.now() - start;
    console.log(`Time taken: ${duration}ms`);
    for (const r of results) {
      console.log(` - Source: ${r.source_name}`);
      console.log(`   Domain: ${r.official_domain || 'null'} (${r.domain_resolution_status}, cache: ${r.domain_cache_hit})`);
      if (r.official_domain) {
        console.log(`   Product URL: ${r.product_url || 'null'} (${r.url_status}, cache: ${r.product_lookup_cache_hit})`);
      }
    }
    console.log('');
  }
  
  return products;
}

function checkCoverage(products) {
  console.log("\n=== FINAL COVERAGE REPORT ===");
  
  for (const product of products) {
    const sources = extractSources(product);
    for (const source of sources) {
      const normCompany = source.name.toLowerCase().trim();
      
      const domainRow = db.prepare('SELECT official_domain FROM company_domain_cache WHERE normalized_company_name = ?').get(normCompany);
      const domain = domainRow ? domainRow.official_domain : null;
      
      const domainAttempted = !!domainRow;
      
      let productAttempted = false;
      let productCacheExists = false;
      
      if (domain) {
        const normDomain = domain.toLowerCase().trim();
        const normMpn = product.mfg_part_num.toLowerCase().trim();
        const prodRow = db.prepare('SELECT * FROM product_url_cache WHERE official_domain = ? AND normalized_mfg_part_num = ?').get(normDomain, normMpn);
        
        productAttempted = true;
        productCacheExists = !!prodRow;
      }
      
      console.log(`SKU: ${product.mfg_part_num}`);
      console.log(`Source candidate: ${source.name}`);
      console.log(`Source role: ${source.role}`);
      console.log(`Resolved domain: ${domain || 'null'}`);
      console.log(`Domain lookup attempted: ${domainAttempted}`);
      console.log(`Product lookup attempted: ${productAttempted}`);
      console.log(`Product cache entry exists: ${productCacheExists}`);
      console.log('--------------------------------------------------');
    }
  }
}

async function runTwice() {
  db.exec('DELETE FROM company_domain_cache; DELETE FROM product_url_cache;');
  console.log("Caches cleared.\n");

  console.log(">>>>>>>> FIRST RUN (EXPECT LIVE SEARCHES & CACHE MISSES) <<<<<<<<");
  let products = await run();
  
  console.log("\n>>>>>>>> SECOND RUN (EXPECT 0 LIVE SEARCHES & CACHE HITS) <<<<<<<<");
  await run();
  
  checkCoverage(products);
}

runTwice();
