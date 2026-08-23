import Database from 'better-sqlite3';
const db = new Database('products.db');
const logs = db.prepare("SELECT response_text FROM llm_logs WHERE agent_name='WriterAgent' ORDER BY id DESC LIMIT 5").all();
logs.forEach(l => {
    console.log('--- RESPONSE TEXT ---');
    console.log(l.response_text);
});
