import Database from 'better-sqlite3';
import { generateExport, CSV_HEADERS } from './pipeline/export/service.mjs';

const db = new Database('products.db');
const output = generateExport(db);
const lines = output.split('\n');

const firstRow = lines[1];
console.log(firstRow.substring(0, 500));
