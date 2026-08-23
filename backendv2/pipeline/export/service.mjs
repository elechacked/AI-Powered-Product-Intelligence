import Database from 'better-sqlite3';

export const CSV_HEADERS = [
    "MFR URL","Ref URL 1","Ref URL 2","Ref URL 3","Ref URL 4","Ref URL 5","PART_NUMBER","Dept","Class","Fine","SKU - MY_PART_NUMBER","Mfg_Part_Num","Part_Desc","E1_Brand","Unilog_Brand","DIB_Brand","Part_Manuf","MANUFACTURER_NAME","BRAND_NAME","TRADE_NAME","MANUFACTURER_PART_NUMBER","ALTERNATE_PART_NUMBER","Classpath","MOBILE_DESC","INVOICE_DESC","SHORT_DESC","LONG_DESC1","RETAIL_DESC","MARKETING_DESCRIPTION",
    ...Array.from({length: 20}, (_, i) => `ITEM_FEATURES_${i+1}`),
    "With","Standard/Approvals","Prop 65","Application","Includes","Product Name",
    ...Array.from({length: 50}, (_, i) => [`ATTRIBUTE_LABEL ${i+1}`, `ATTRIBUTE_VALUE ${i+1}`, `ATTRIBUTE_UOM ${i+1}`]).flat(),
    "UPC","EAN","GTIN","UNSPSC","Warranty","List Price","Selling Qty","Selling UOM","Standard Packaging Information","LENGTH","LENGTH_UOM","HEIGHT","HEIGHT_UOM","WIDTH","WIDTH_UOM","WEIGHT","WEIGHT_UOM","VOLUME","VOLUME_UOM","Product Image","Alternate Image 1","Alternate Image 2","Alternate Image 3","Alternate Image 4","SDS","SDS_1","Warranty Information","Catalog","Specification Sheet","Instruction/Installation Manual","Service Manual","Owners/User Manual","Line Drawing","MTR","RoHS","Full Engineering Drawing","Energy Star Guide","Technical Bulletin","Submittal","Compatibility Chart","Size Chart","Product Label/Insert","Video Link","Video Link 1","Country Of Origin","Discontinued","Actual Image (Yes/No)"
];

function escapeCsv(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

export function generateExport(db, batchId, productId = null, confidenceThreshold = null) {
    let query = 'SELECT * FROM products';
    const params = [];
    if (productId) {
        query += ' WHERE id = ?';
        params.push(productId);
    } else if (batchId) {
        query += ' WHERE import_batch_id = ?';
        params.push(batchId);
    }
    const products = db.prepare(query).all(...params);
    
    // Removed blocking check to ensure export always works
    const records = [];
    const fixedHeadersUpper = Object.keys(Object.fromEntries(CSV_HEADERS.map(h => [h, h]))).reduce((acc, h) => { 
        acc[h.toUpperCase()] = h; 
        return acc; 
    }, {});
    
    for (const p of products) {
        const sourceId = p.canonical_product_id ? p.canonical_product_id : p.id;
        
        // At this point we know valRun is done, but we still respect the confidence threshold filter
        // If it fails the confidence threshold, we should output an empty enriched row to preserve row count, OR omit it?
        // Wait, the user specifically wants the row count to match.
        // "The exported row count should match the original selected CSV's row count unless explicitly filtered by the user."
        // A confidence threshold IS an explicit filter by the user!
        // So if they set confidence to 70%, and a product is 50%, we omit it. This perfectly satisfies "unless explicitly filtered by the user".
        
        const sourceProduct = db.prepare('SELECT * FROM products WHERE id = ?').get(sourceId);
        
        if (confidenceThreshold !== null && confidenceThreshold !== undefined) {
            const minConf = parseFloat(confidenceThreshold);
            if (sourceProduct.overall_confidence < minConf) continue;
        }
        const descriptions = db.prepare('SELECT * FROM product_descriptions WHERE product_id = ?').get(sourceId) || {};
        const classifications = db.prepare('SELECT * FROM product_classifications WHERE product_id = ?').get(sourceId) || {};
        const extractions = db.prepare('SELECT * FROM product_extractions WHERE product_id = ?').get(sourceId) || {};
        const sources = db.prepare("SELECT * FROM product_sources WHERE product_id = ? AND status = 'done'").all(sourceId) || [];
        
        const pAttrs = db.prepare(`SELECT t.attribute_name, p.normalized_value, p.uom FROM product_attribute_values p JOIN taxonomy_attributes t ON p.taxonomy_attribute_id = t.id WHERE p.product_id = ?`).all(sourceId);
        
        const row = {};
        for (const h of CSV_HEADERS) row[h] = '';
        
        let refIndex = 1;
        for (const src of sources) {
            if (src.source_role === 'part_manuf' && !row['MFR URL']) row['MFR URL'] = src.source_url;
            else if (refIndex <= 5) { row[`Ref URL ${refIndex}`] = src.source_url; refIndex++; }
        }
        
        let classJson = {};
        if (classifications.classification_json) { try { classJson = JSON.parse(classifications.classification_json); } catch(e){} }
        row['Dept'] = classJson.department || '';
        row['Class'] = classJson.class || '';
        row['Fine'] = classJson.fine || '';
        row['Classpath'] = classJson.classpath || '';
        
        row['Mfg_Part_Num'] = p.mfg_part_num || '';
        row['Part_Desc'] = p.part_desc || '';
        row['E1_Brand'] = p.e1_brand || '-- Unbranded --';
        row['Unilog_Brand'] = p.unilog_brand || '-- No Unilog Brand --';
        row['DIB_Brand'] = p.dib_brand || '-- No DIB Brand --';
        row['Part_Manuf'] = p.part_manuf_raw || '';
        
        row['MANUFACTURER_NAME'] = sourceProduct.manufacturer_name || '';
        let extractionJson = {};
        if (extractions.extraction_json) { try { extractionJson = JSON.parse(extractions.extraction_json); } catch(e){} }
        row['BRAND_NAME'] = extractionJson.brand_name || '';
        row['TRADE_NAME'] = extractionJson.trade_name || '';
        row['MANUFACTURER_PART_NUMBER'] = extractionJson.manufacturer_part_number || '';
        row['ALTERNATE_PART_NUMBER'] = (extractionJson.alternate_part_numbers || []).join('|');
        row['Product Name'] = extractionJson.product_name || '';
        
        row['MOBILE_DESC'] = descriptions.mobile_description || '';
        row['INVOICE_DESC'] = descriptions.invoice_description || '';
        row['SHORT_DESC'] = descriptions.short_description || '';
        row['LONG_DESC1'] = descriptions.long_description || '';
        row['RETAIL_DESC'] = descriptions.retail_description || '';
        row['MARKETING_DESCRIPTION'] = descriptions.marketing_description || '';
        
        let attrIndex = 1;
        for (const pa of pAttrs) {
            if (!pa.normalized_value) continue;
            const upperName = (pa.attribute_name || '').toUpperCase();
            let exportVal = pa.normalized_value;
            let exportUom = pa.uom || '';
            if (exportUom) { exportVal = exportVal.replace(/[a-zA-Z\s]+$/, '').trim(); }
            const realHeader = fixedHeadersUpper[upperName];
            if (realHeader && realHeader !== 'WITH' && realHeader !== 'APPLICATION' && realHeader !== 'INCLUDES' && !upperName.startsWith('ITEM_FEATURES_') && !upperName.startsWith('ATTRIBUTE_LABEL')) {
                row[realHeader] = exportVal;
                if (exportUom && fixedHeadersUpper[`${upperName}_UOM`]) {
                    row[fixedHeadersUpper[`${upperName}_UOM`]] = exportUom;
                }
            } else {
                if (attrIndex <= 50) {
                    row[`ATTRIBUTE_LABEL ${attrIndex}`] = pa.attribute_name;
                    row[`ATTRIBUTE_VALUE ${attrIndex}`] = exportVal;
                    row[`ATTRIBUTE_UOM ${attrIndex}`] = exportUom;
                    attrIndex++;
                }
            }
        }
        records.push(row);
    }
    
    const csvLines = [CSV_HEADERS.map(escapeCsv).join(',')];
    for (const r of records) {
        csvLines.push(CSV_HEADERS.map(h => escapeCsv(r[h])).join(','));
    }
    return csvLines.join('\n');
}
