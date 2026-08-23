import { processValidator } from './pipeline/validator/agent.mjs';
import { db } from './pipeline/orchestration/db.mjs';

db.exec(`
  CREATE TABLE IF NOT EXISTS taxonomy_attributes (id INTEGER PRIMARY KEY, attribute_name TEXT, is_dimensional INTEGER);
  INSERT INTO taxonomy_attributes (id, taxonomy_id, attribute_name, is_dimensional) VALUES (1, 1, 'Weight', 0) ON CONFLICT DO NOTHING;
  
  CREATE TABLE IF NOT EXISTS product_attribute_values (
    product_id INTEGER, taxonomy_attribute_id INTEGER, 
    extracted_value TEXT, normalized_value TEXT, is_inferred INTEGER, confidence REAL
  );
  INSERT INTO product_attribute_values (product_id, taxonomy_attribute_id, extracted_value, normalized_value, is_inferred, confidence) 
  VALUES (9999, 1, '5 lbs', '2 kg', 1, 0.9);
  
  INSERT INTO import_batches (id, original_filename) VALUES (999, 'test.csv') ON CONFLICT DO NOTHING;
  INSERT INTO products (id, import_batch_id) VALUES (9999, 999) ON CONFLICT DO NOTHING;
`);

async function runTest() {
    await processValidator(9999, db);
    const issues = db.prepare("SELECT * FROM validation_issues WHERE product_id = 9999 AND issue_type = 'conflict'").all();
    console.log('Issues found:', issues);
    console.log('Conflict detected:', issues.length > 0);
}
runTest();
