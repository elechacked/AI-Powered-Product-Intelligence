import Database from 'better-sqlite3';
import { generateExport } from './pipeline/export/service.mjs';

const db = new Database('products.db');
const output = generateExport(db, 1);
const lines = output.split('\n');

console.log('Exported Row Count (excluding header):', lines.length - 1);

const headers = lines[0].split(',');
// super basic CSV split for testing
const val1 = lines[1].split(',');
const val2 = lines[2].split(',');

console.log('\n--- Original Product 33 ---');
console.log('Mfg Part Num:', val1[headers.indexOf('Mfg_Part_Num')]);
console.log('Brand_Name:', val1[headers.indexOf('BRAND_NAME')]);
console.log('Marketing_Description:', val1[headers.indexOf('MARKETING_DESCRIPTION')]);

console.log('\n--- Duplicate Product ---');
console.log('Mfg Part Num (own row):', val2[headers.indexOf('Mfg_Part_Num')]);
console.log('E1 Brand (own row):', val2[headers.indexOf('E1_Brand')]);
console.log('Part Desc (own row):', val2[headers.indexOf('Part_Desc')]);
console.log('Brand_Name (inherited):', val2[headers.indexOf('BRAND_NAME')]);
console.log('Marketing_Description (inherited):', val2[headers.indexOf('MARKETING_DESCRIPTION')]);
