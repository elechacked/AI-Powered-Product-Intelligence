const Database = require('better-sqlite3');
const db = new Database('products.db');
db.pragma('foreign_keys = OFF');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
for (const t of tables) {
    if (t.name === 'app_config') continue; // keep config table
    db.prepare(`DELETE FROM ${t.name}`).run();
}
console.log('All tables cleared!');
