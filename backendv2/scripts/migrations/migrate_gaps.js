import Database from 'better-sqlite3';
import fs from 'fs';

const db = new Database('D:\\Built Apps\\AI-powered product intelligence\\backendv2\\products.db');

console.log("Applying DB migrations for validation readiness...");

const statements = [
    // 1. products table additions
    "ALTER TABLE products ADD COLUMN manufacturer_name TEXT;",
    "ALTER TABLE products ADD COLUMN commerce_ready BOOLEAN;",
    "ALTER TABLE products ADD COLUMN overall_confidence REAL;",
    "ALTER TABLE products ADD COLUMN validation_status TEXT;",

    // 2. taxonomy_attributes additions
    "ALTER TABLE taxonomy_attributes ADD COLUMN is_dimensional BOOLEAN DEFAULT 0;",

    // 3. product_attribute_values additions
    "ALTER TABLE product_attribute_values ADD COLUMN uom TEXT;",
    "ALTER TABLE product_attribute_values ADD COLUMN is_inferred BOOLEAN DEFAULT 0;"
];

for (const stmt of statements) {
    try {
        db.exec(stmt);
        console.log(`Success: ${stmt}`);
    } catch (e) {
        if (e.message.includes("duplicate column name")) {
            console.log(`Skipped (already exists): ${stmt}`);
        } else {
            console.error(`Error on ${stmt}: ${e.message}`);
        }
    }
}

// 4. validation_issues table
db.exec(`
CREATE TABLE IF NOT EXISTS validation_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    field_name TEXT NOT NULL,
    issue_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    description TEXT,
    value_a TEXT,
    value_b TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);
`);
console.log("Success: CREATE TABLE validation_issues");

// Backfill manufacturer_name from product_extractions
console.log("Backfilling manufacturer_name...");
const extractions = db.prepare("SELECT product_id, extraction_json FROM product_extractions WHERE extraction_json IS NOT NULL").all();
let updated = 0;
for (const ext of extractions) {
    try {
        const parsed = JSON.parse(ext.extraction_json);
        if (parsed.manufacturer_name) {
            db.prepare("UPDATE products SET manufacturer_name = ? WHERE id = ?").run(parsed.manufacturer_name, ext.product_id);
            updated++;
        }
    } catch (e) {}
}
console.log(`Backfilled manufacturer_name for ${updated} products.`);

console.log("Migrations complete.");
db.close();
