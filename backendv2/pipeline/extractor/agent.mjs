import { callLlmStructured } from './llm_client.mjs';

const SYSTEM_PROMPT = `You are a strict, factual product data extractor. Your job is to extract factual structured product information from the provided sanitized evidence.

CRITICAL RULES:
1. EVIDENCE-ONLY: Extract only facts explicitly supported by the evidence. Do NOT hallucinate, infer missing technical specs, or use general knowledge.
2. DYNAMIC ATTRIBUTES: Extract ALL useful factual attributes (dimensions, material, voltage, grit, etc.) supported by evidence. Do not restrict to a fixed list.
3. PROVENANCE: Every attribute must have a 'source_snippet' exactly quoting the evidence, 'source_url', 'source_name', and 'source_role'.
4. CONFLICTS: If sources conflict, preserve the strongest supported value and log the conflict in the 'conflicts' array.
5. NO MARKETING: Do not write a new product description or marketing copy. Preserve raw text only if it belongs in 'marketing_description_raw'.
6. IDENTIFIERS: Distinguish carefully between Manufacturer Part Number, alternate part numbers, and general product names.
7. INSUFFICIENT EVIDENCE: If the evidence is sparse or missing, return 'extraction_status': 'insufficient_evidence', but return any facts you *do* find.

Source Authority Order (highest to lowest):
1. official_manufacturer
2. authorized distributor
3. other source

Output ONLY the requested JSON schema.`;

function buildUserPrompt(productInfo, evidences) {
    let prompt = `--- PRODUCT INPUT CONTEXT ---\n`;
    prompt += `Mfg Part Num: ${productInfo.mfg_part_num || 'Unknown'}\n`;
    prompt += `Description: ${productInfo.part_desc || 'Unknown'}\n\n`;
    
    prompt += `--- SANITIZED EVIDENCE (${evidences.length} sources) ---\n\n`;
    
    for (let i = 0; i < evidences.length; i++) {
        const ev = evidences[i];
        prompt += `[SOURCE ${i + 1}]\n`;
        prompt += `Name: ${ev.source_name || 'Unknown'}\n`;
        prompt += `Role: ${ev.source_role || 'Unknown'}\n`;
        prompt += `URL: ${ev.source_url || 'Unknown'}\n`;
        
        if (!ev.evidence_json || !ev.evidence_json.crawls) {
             prompt += `Content: No usable content.\n\n`;
             continue;
        }
        
        for (const crawl of ev.evidence_json.crawls) {
             const data = crawl.data;
             prompt += `Data from URL: ${crawl.url}\n`;
             if (data.metadata && data.metadata.description) prompt += `Meta Desc: ${data.metadata.description}\n`;
             if (data.markdown) prompt += `Markdown Content:\n${data.markdown}\n`;
             
             if (data.tables && data.tables.length > 0) {
                 prompt += `Tables:\n${JSON.stringify(data.tables, null, 2)}\n`;
             }
        }
        prompt += `\n`;
    }
    
    return prompt;
}

export async function runExtractorAgent(product, evidences) {
    if (!evidences || evidences.length === 0) {
        return {
            parsed: {
                extraction_status: "insufficient_evidence",
                source_summary: { sources_available: 0, sources_used: 0 },
                attributes: [],
                conflicts: []
            },
            modelUsed: null,
            fallbackUsed: false,
            retryCount: 0,
            error: "No evidence available"
        };
    }
    
    const userPrompt = buildUserPrompt(product, evidences);
    const start = Date.now();
    try {
        const productMeta = {
            id: product.id,
            sku: product.mfg_part_num
        };
        const result = await callLlmStructured(SYSTEM_PROMPT, userPrompt, productMeta);
        result.processing_duration_ms = Date.now() - start;
        return result;
    } catch (err) {
        throw new Error(`Extractor LLM Failure: ${err.message}`);
    }
}
