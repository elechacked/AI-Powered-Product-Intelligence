import Database from 'better-sqlite3';
import { generateExport, CSV_HEADERS } from './pipeline/export/service.mjs';

const db = new Database('products.db');
const output = generateExport(db);

const lines = output.split('\n');
// We need to parse headers carefully because of commas in quotes if any, 
// but our headers don't have commas so a simple split is fine for the first line.
const generatedHeaders = lines[0].split(',');

console.log('Total Generated Headers:', generatedHeaders.length);
console.log('Expected Headers:', 252);
if (generatedHeaders.length !== 252) {
    console.error('FAILED: Output header count does not match 252');
    process.exit(1);
}

let mismatch = false;
for (let i = 0; i < 252; i++) {
    const got = generatedHeaders[i].replace(/"/g, '');
    if (got !== CSV_HEADERS[i]) {
        console.error('Mismatch at column', i, 'Expected:', CSV_HEADERS[i], 'Got:', got);
        mismatch = true;
    }
}
if (!mismatch) {
    console.log('SUCCESS: Generated CSV strictly conforms to the 252-column requirement.');
}
console.log('Total valid products exported:', lines.length - 1);
