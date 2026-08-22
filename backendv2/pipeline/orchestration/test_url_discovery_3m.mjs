/**
 * test_url_discovery_3m.mjs
 * Smoke test for url_discovery.mjs using 3M product
 */

import { discoverUrlsForProduct } from './url_discovery.mjs';

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
  console.log(`Starting URL discovery for: ${product.mfg_part_num}...`);
  const results = await discoverUrlsForProduct(product);
  
  console.log("\n--- Discovery Results ---");
  for (const r of results) {
    console.log(JSON.stringify(r, null, 2));
  }
}

run();
