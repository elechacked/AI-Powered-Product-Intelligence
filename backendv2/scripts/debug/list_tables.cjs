const db = require('better-sqlite3')('products.db');
const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
console.log(tables.map(t => t.name).join(', '));
