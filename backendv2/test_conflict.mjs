import { processValidator } from './pipeline/validator/agent.mjs';
import { db } from './pipeline/orchestration/db.mjs';

db.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE IF EXISTS taxonomy_attributes;
    CREATE TABLE taxonomy_attributes (id INTEGER, attribute_name TEXT, is_dimensional INTEGER);
    INSERT INTO taxonomy_attributes VALUES (1, 'Weight', 0);
    
    DROP TABLE IF EXISTS product_attribute_values;
    CREATE TABLE product_attribute_values (
        product_id INTEGER, taxonomy_attribute_id INTEGER, 
        extracted_value TEXT, normalized_value TEXT, is_inferred INTEGER, confidence REAL
    );
    INSERT INTO product_attribute_values VALUES (9999, 1, '5 lbs', '2 kg', 1, 0.9);
    
    DROP TABLE IF EXISTS import_batches;
    CREATE TABLE import_batches (id INTEGER PRIMARY KEY);
    INSERT INTO import_batches VALUES (999);
    
    DROP TABLE IF EXISTS products;
    CREATE TABLE products (id INTEGER, canonical_product_id INTEGER, manufacturer_name TEXT, import_batch_id INTEGER, commerce_ready INTEGER, overall_confidence REAL, validation_status TEXT);
    INSERT INTO products VALUES (9999, NULL, 'Test Manuf', 999, 0, 0.0, 'pending');
    
    DROP TABLE IF EXISTS product_descriptions;
    CREATE TABLE product_descriptions (product_id INTEGER, short_description TEXT);
    INSERT INTO product_descriptions VALUES (9999, 'Test');
    
    DROP TABLE IF EXISTS product_classifications;
    CREATE TABLE product_classifications (product_id INTEGER, classification_json TEXT);
    
    DROP TABLE IF EXISTS product_extractions;
    CREATE TABLE product_extractions (product_id INTEGER, extraction_json TEXT);
    
    DROP TABLE IF EXISTS validation_issues;
    CREATE TABLE validation_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, field_name TEXT, issue_type TEXT, 
        severity TEXT, description TEXT, value_a TEXT, value_b TEXT, created_at TEXT
    );
`);

async function run() {
    await processValidator(9999, db);
    const issues = db.prepare("SELECT * FROM validation_issues WHERE issue_type = 'conflict'").all();
    console.log("Validation Issues length:", issues.length);
    console.log("Validation Issues:", issues);
}
run();
