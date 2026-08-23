import Database from 'better-sqlite3';
const db = new Database('products.db');
const res = db.prepare("DELETE FROM validation_issues WHERE field_name = 'MANUFACTURER_NAME' AND issue_type = 'completeness'").run();
console.log('Deleted', res.changes, 'validation issues');
