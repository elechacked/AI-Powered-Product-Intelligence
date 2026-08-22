/**
 * test_url_discovery.mjs
 * Smoke test for url_discovery.mjs using DCB518ASTS06G
 */

import { discoverUrlsForProduct } from './url_discovery.mjs';

const product = {
  mfg_part_num: "DCB518ASTS06G",
  part_desc: "DCB518ASTS06G Diablo 1/2\"x18\" - Sanding Belt 6pc",
  brand_hints: {
    e1_brand: null,
    unilog_brand: null,
    dib_brand: null
  },
  part_manuf: {
    raw: "Freud Inc (2435)",
    company_name: "Freud Inc",
    supplier_code: "2435"
  }
};

async function run() {
  console.log(`Starting URL discovery for: ${product.mfg_part_num}...`);
  const results = await discoverUrlsForProduct(product);
  
  console.log("\n--- Discovery Results ---");
  for (const r of results) {
    console.log(JSON.stringify(r, null, 2));
  }
}

run();
