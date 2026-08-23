import Database from 'better-sqlite3';
const db = new Database('products.db');
const res = db.prepare("UPDATE product_pipeline_runs SET status = 'done' WHERE stage = 'attribute_taxonomy' AND status = 'completed'").run();
console.log('Fixed', res.changes, 'runs');
