const db = require('better-sqlite3')('products.db');
const issues = db.prepare("SELECT product_id, description FROM validation_issues WHERE field_name = 'MANUFACTURER_NAME'").all();
console.log('Issues:', issues);
for (const i of issues) {
  const ext = db.prepare('SELECT extraction_json FROM product_extractions WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(i.product_id);
  console.log('Product', i.product_id, 'Extractor:', ext ? ext.extraction_json.substring(0, 200) : 'none');
}
