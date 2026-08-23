import Database from 'better-sqlite3';
import { runValidatorAgent } from './pipeline/validator/agent.mjs';

const db = new Database('products.db');
const products = db.prepare("SELECT * FROM products").all();

(async () => {
    for (const p of products) {
        try {
            console.log('Re-validating', p.id);
            await runValidatorAgent(p, {}, db);
        } catch (e) {
            console.error('Error on', p.id, e.message);
        }
    }
    console.log('Done');
})();
