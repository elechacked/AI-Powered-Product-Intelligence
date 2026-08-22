/**
 * test_url_discovery_3m_cached.mjs
 * Runs the discovery test twice to prove caching works.
 */

import { discoverUrlsForProduct } from './url_discovery.mjs';
import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.resolve(process.cwd(), 'pipeline/orchestration/.discovery_cache.json');

const product = {
  "mfg_part_num": "3MABR-7100075678",
  "part_desc": "3M 775L Stikit Film P150 - Cubitron II 50 Disc/Box",
  "brand_hints": {
    "e1_brand": null,
    "unilog_brand": null,
    "dib_brand": null
  },
  "part_manuf": {
    "raw": "Jam Industrial Supply LLC (JAMIN)",
    "company_name": "Jam Industrial Supply LLC",
    "supplier_code": "JAMIN"
  }
};

async function run() {
  // Clear cache before starting
  if (fs.existsSync(CACHE_FILE)) {
    fs.unlinkSync(CACHE_FILE);
  }

  console.log("=== FIRST RUN (EXPECT LIVE SEARCHES & CACHE MISSES) ===");
  let start = Date.now();
  let results = await discoverUrlsForProduct(product);
  console.log(`Time taken: ${Date.now() - start}ms\n`);
  for (const r of results) {
    console.log(`- ${r.source_name} (Role: ${r.source_role})`);
    console.log(`  Domain: ${r.official_domain} | Hit: ${r.domain_cache_hit}`);
    console.log(`  URL: ${r.product_url} | Hit: ${r.product_lookup_cache_hit}\n`);
  }

  console.log("=== SECOND RUN (EXPECT 0 LIVE SEARCHES & CACHE HITS) ===");
  start = Date.now();
  results = await discoverUrlsForProduct(product);
  console.log(`Time taken: ${Date.now() - start}ms\n`);
  for (const r of results) {
    console.log(`- ${r.source_name} (Role: ${r.source_role})`);
    console.log(`  Domain: ${r.official_domain} | Hit: ${r.domain_cache_hit}`);
    console.log(`  URL: ${r.product_url} | Hit: ${r.product_lookup_cache_hit}\n`);
  }
}

run();
