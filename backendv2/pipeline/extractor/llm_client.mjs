import { GoogleGenAI, Type } from "@google/genai";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { extractJsonObject } from '../utils.mjs';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const PRIMARY_MODEL = process.env.EXTRACTOR_PRIMARY_MODEL || 'gemini-3.5-flash-lite'; 
const FALLBACK_MODEL = process.env.EXTRACTOR_FALLBACK_MODEL || 'gemma-4-31b-it';

export const extractorSchema = {
  type: Type.OBJECT,
  properties: {
    manufacturer_name: { type: Type.STRING, nullable: true },
    brand_name: { type: Type.STRING, nullable: true },
    trade_name: { type: Type.STRING, nullable: true },
    manufacturer_part_number: { type: Type.STRING, nullable: true },
    alternate_part_numbers: { type: Type.ARRAY, items: { type: Type.STRING } },
    product_name: { type: Type.STRING, nullable: true },
    marketing_description_raw: { type: Type.STRING, nullable: true },
    attributes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          value: { type: Type.STRING },
          uom: { type: Type.STRING, nullable: true },
          raw_value: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          source_snippet: { type: Type.STRING },
          source_url: { type: Type.STRING },
          source_name: { type: Type.STRING, nullable: true },
          source_role: { type: Type.STRING, nullable: true },
          reasoning: { type: Type.STRING }
        },
        propertyOrdering: ["label", "value", "uom", "raw_value", "confidence", "source_snippet", "source_url", "source_name", "source_role", "reasoning"]
      }
    },
    source_summary: {
      type: Type.OBJECT,
      properties: {
        sources_available: { type: Type.INTEGER },
        sources_used: { type: Type.INTEGER }
      },
      propertyOrdering: ["sources_available", "sources_used"]
    },
    conflicts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          field: { type: Type.STRING },
          values: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                value: { type: Type.STRING },
                source_url: { type: Type.STRING }
              },
              propertyOrdering: ["value", "source_url"]
            }
          },
          resolution: { type: Type.STRING },
          confidence: { type: Type.NUMBER }
        },
        propertyOrdering: ["field", "values", "resolution", "confidence"]
      }
    },
    extraction_status: { type: Type.STRING, description: "success | partial | insufficient_evidence" }
  },
  propertyOrdering: [
    "manufacturer_name", "brand_name", "trade_name", "manufacturer_part_number", "alternate_part_numbers", "product_name", 
    "marketing_description_raw", "attributes", "source_summary", "conflicts", "extraction_status"
  ]
};

export async function callLlmStructured(systemInstruction, userPrompt, productMeta, maxRetries = 2) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY environment variable is not set");
    }

    // Dynamic import of limiters to avoid circular dependencies if any
    const { limiters } = await import('../orchestration/limiters.mjs');

    let attempt = 0;
    let fallbackUsed = false;
    let modelUsed = PRIMARY_MODEL;
    
    // Token estimation
    const estimatedTokens = Math.ceil(userPrompt.length / 4) + 500; // rough estimate
    
    while (attempt < maxRetries) {
        let reservation = null;
        let providerSuccess = false;
        let actual_total_tokens = 0;
        const limiter = (modelUsed === PRIMARY_MODEL) ? limiters.gemini : limiters.gemma;
        
        try {
            reservation = await limiter.acquire(estimatedTokens);
            const startTime = Date.now();
            
            const response = await ai.models.generateContent({
                model: modelUsed,
                contents: userPrompt,
                config: {
                    systemInstruction,
                    responseMimeType: "application/json",
                    responseJsonSchema: extractorSchema,
                    temperature: 0.1,
                }
            });
            
            providerSuccess = true;
            
            const latency_ms = Date.now() - startTime;
            const prompt_tokens = response.usageMetadata?.promptTokenCount || estimatedTokens;
            const completion_tokens = response.usageMetadata?.candidatesTokenCount || 0;
            actual_total_tokens = response.usageMetadata?.totalTokenCount || (prompt_tokens + completion_tokens);
            
            limiter.reconcile(reservation, actual_total_tokens);
            
            const rawText = response.text;
            console.log(`[OBSERVABILITY] Stage: Extractor | Model: ${modelUsed} | ProductID: ${productMeta.id} | Wait: ${reservation.waitMs}ms | Exec: ${latency_ms}ms | EstTokens: ${estimatedTokens} | ActTokens: ${actual_total_tokens}`);
            const parsed = extractJsonObject(rawText);
            
            try {
                const db = require('better-sqlite3')('products.db');
                db.prepare(`INSERT INTO llm_logs 
                    (created_at, agent_name, model_name, product_sku, product_brand, product_id, total_tokens, latency_ms, prompt_tokens, completion_tokens, response_text, user_prompt, system_prompt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).run(
                    new Date().toISOString(),
                    'ExtractorAgent',
                    modelUsed,
                    productMeta.sku,
                    parsed.brand_name || null,
                    productMeta.id,
                    actual_total_tokens,
                    latency_ms,
                    prompt_tokens,
                    completion_tokens,
                    rawText,
                    userPrompt,
                    systemInstruction
                );
            } catch (dbErr) {
                console.error("Failed to write to llm_logs:", dbErr);
            }

            if (!parsed || !Array.isArray(parsed.attributes)) {
                throw new Error("Invalid output: 'attributes' must be an array");
            }
            if (!parsed.extraction_status) {
                parsed.extraction_status = "partial";
            }
            
            return { parsed, modelUsed, fallbackUsed, retryCount: attempt, error: null };
        } catch (err) {
            console.error(`LLM Call failed (Model: ${modelUsed}, Attempt: ${attempt}):`, err.message);
            if (reservation && !providerSuccess) {
                limiter.reconcile(reservation, 0);
            }
            attempt++;
            
            if (attempt >= maxRetries && !fallbackUsed) {
                console.warn(`Switching to fallback model: ${FALLBACK_MODEL}`);
                modelUsed = FALLBACK_MODEL;
                fallbackUsed = true;
                attempt = 0; 
                maxRetries = 1; 
            }
        }
    }
    
    throw new Error(`Extraction failed after retries using both primary and fallback models.`);
}
