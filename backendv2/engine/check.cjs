const fs = require('fs'); 
const d = JSON.parse(fs.readFileSync('../../test_out.json', 'utf8')); 
const cheerio = require('cheerio'); 
const $ = cheerio.load(d.pages[0].rawHtml); 
let c=0; $('dl dt').each(()=>c++); console.log('dt:', c); 
let r=0; $('div.row').each((_,el)=> { if($(el).children().length === 2) r++; }); 
console.log('row:', r);
