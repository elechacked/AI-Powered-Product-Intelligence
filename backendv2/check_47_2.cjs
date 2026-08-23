const db = require('better-sqlite3')('products.db');
const run = db.prepare("SELECT * FROM product_pipeline_runs WHERE product_id = 47 AND stage = 'orchestration'").get();
console.log(run.output_json, run.error_json);
