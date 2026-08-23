import { db } from '../orchestration/db.mjs';
import { generateEmbedding, cosineSimilarity } from './embedder.mjs';
import { getAllTaxonomyNodes, findSimilarTaxonomyCandidates, getOrCreateTaxonomyPath, saveProductClassification } from './db.mjs';
import { invokeClassifierLLM } from './llm_client.mjs';

const SYSTEM_PROMPT = `You are an expert product taxonomist and classifier for industrial, MRO, and construction supplies.
Your task is to classify the product based strictly on the provided evidence.

You MUST output ONLY valid JSON matching this exact structure:
{
  "classification_status": "classified | insufficient_evidence",
  "department": "string",
  "class": "string",
  "fine": "string",
  "classpath": "string (Department > Class > Fine)",
  "taxonomy_action": "reused | created",
  "selected_taxonomy_id": number or null,
  "confidence": number (0.0 to 1.0),
  "confidence_reason": "string",
  "review_required": boolean,
  "review_reason": "string or null",
  "candidate_summary": {
    "candidates_considered": number,
    "selected_candidate_rank": number or null
  }
}

Guidelines:
1. Examine the provided candidates. If one is a PERFECT fit for the product, select it. Set taxonomy_action="reused" and provide its selected_taxonomy_id.
2. If NO candidate is a perfect fit, or candidates_provided=0, create a new canonical path. Set taxonomy_action="created" and selected_taxonomy_id=null.
3. Be precise with leaf categories. E.g., 'Sanding Discs' instead of just 'Discs'.
4. Do NOT create duplicate branches if a provided candidate means the exact same thing.
5. If the evidence is insufficient to confidently classify, set classification_status="insufficient_evidence", confidence below 0.40, and review_required=true.
6. Only set review_required=true if there is genuine ambiguity. High confidence (0.90+) means review_required=false.
`;

export async function runTaxonomyClassifierAgent(product) {
    const now = new Date().toISOString();
    
    // Check if the product is reusing another (duplicate)
    if (product.canonical_product_id) {
        db.prepare("UPDATE product_pipeline_runs SET status = 'reused', updated_at = ? WHERE product_id = ? AND stage = 'classifier'").run(now, product.id);
        return; // Short-circuit, it reuses the canonical product's classification natively in API
    }
    
    db.prepare("UPDATE product_pipeline_runs SET status = 'processing', updated_at = ? WHERE product_id = ? AND stage = 'classifier'").run(now, product.id);
    
    try {
        // Fetch extractor output to build context
        const extractionRow = db.prepare('SELECT extraction_json FROM product_extractions WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(product.id);
        const extraction = extractionRow && extractionRow.extraction_json ? JSON.parse(extractionRow.extraction_json) : null;
        
        let productRepresentation = `Product: ${product.part_desc}\\nMFG Part Num: ${product.mfg_part_num}\\n`;
        
        if (extraction && extraction.attributes) {
            productRepresentation += 'Extracted facts:\\n';
            for (const f of extraction.attributes) {
                productRepresentation += `${f.label}: ${f.value}\\n`;
            }
        }
        
        // Generate embedding for similarity search
        let productVector = [];
        try {
            productVector = await generateEmbedding(productRepresentation);
        } catch (err) {
            console.error('Embedding failed for product', product.id, err.message);
        }
        
        // Find candidates
        const candidates = findSimilarTaxonomyCandidates(productVector, 5);
        
        const userPrompt = `
Product Context:
---
${productRepresentation}
---

Existing Taxonomy Candidates (Top ${candidates.length}):
${candidates.map((c, idx) => `[${idx + 1}] ID: ${c.id} | Path: ${c.canonical_path}`).join('\\n') || 'None'}

Please classify this product.`;

        // Invoke LLM
        const llmResult = await invokeClassifierLLM(SYSTEM_PROMPT, userPrompt, product.id);
        const resultData = llmResult.data;
        
        // If LLM says "created", we must persist the new taxonomy node and embed it
        let taxonomyId = resultData.selected_taxonomy_id;
        
        if (resultData.classification_status === 'classified') {
            if (resultData.taxonomy_action === 'created' || !taxonomyId) {
                const pathStr = `${resultData.department} > ${resultData.class} > ${resultData.fine}`;
                // Generate embedding for the new path
                let pathVector = [];
                try {
                    pathVector = await generateEmbedding(pathStr);
                } catch(e) {
                    // Ignore if embedding fails here
                }
                taxonomyId = getOrCreateTaxonomyPath(resultData.department, resultData.class, resultData.fine, pathVector);
                resultData.selected_taxonomy_id = taxonomyId; // Update the JSON
                llmResult.raw = JSON.stringify(resultData);
            }
        }
        
        saveProductClassification(
            product.id,
            taxonomyId || null,
            resultData.classification_status,
            llmResult.raw,
            llmResult.model,
            llmResult.provider,
            llmResult.fallback
        );
        
        const doneTime = new Date().toISOString();
        db.prepare("UPDATE product_pipeline_runs SET status = 'done', output_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'classifier'")
          .run(llmResult.raw, doneTime, doneTime, product.id);
          
    } catch (err) {
        console.error('Classifier failed for product', product.id, err);
        const failTime = new Date().toISOString();
        db.prepare("UPDATE product_pipeline_runs SET status = 'failed', error_json = ?, completed_at = ?, updated_at = ? WHERE product_id = ? AND stage = 'classifier'")
          .run(JSON.stringify({ error: err.message }), failTime, failTime, product.id);
    }
}
