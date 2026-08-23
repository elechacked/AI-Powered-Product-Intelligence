import { GoogleGenAI, Type } from '@google/genai';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { extractJsonObject } from '../utils.mjs';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// PRIMARY: gemma-4-31b-it (quality writing model)
// FALLBACK: gemini-3.5-flash-lite (fast reliable fallback)
const PRIMARY_MODEL = process.env.WRITER_PRIMARY_MODEL || 'gemma-4-31b-it';
const FALLBACK_MODEL = process.env.WRITER_FALLBACK_MODEL || 'gemini-3.5-flash-lite';

export const writerSchema = {
    type: Type.OBJECT,
    properties: {
        invoice_description: {
            type: Type.STRING,
            nullable: true,
            description: 'Strictly <= 40 chars, UPPERCASE. Brand + type + key spec.'
        },
        mobile_description: {
            type: Type.STRING,
            nullable: true,
            description: 'Short sentence for mobile UI display, strictly <= 80 chars.'
        },
        in_app_description: {
            type: Type.STRING,
            nullable: true,
            description: 'Slightly expanded, strictly <= 150 chars, suitable for in-app product listing.'
        },
        short_description: {
            type: Type.STRING,
            nullable: true,
            description: 'Concise product summary, strictly <= 150 chars.'
        },
        long_description: {
            type: Type.STRING,
            nullable: false,
            description: 'REQUIRED field. A descriptive paragraph covering the verified attributes. Write complete sentences. You MUST generate this field. Strictly <= 2000 chars.'
        },
        retail_description: {
            type: Type.STRING,
            nullable: true,
            description: 'Retail-optimized copy. Clear, benefit-driven, factual, strictly <= 100 chars.'
        },
        generation_status: {
            type: Type.STRING,
            description: 'success | partial | insufficient_data'
        },
        fields_generated: {
            type: Type.INTEGER,
            description: 'Count of non-null description fields generated.'
        }
    },
    propertyOrdering: [
        'invoice_description', 'mobile_description', 'in_app_description',
        'short_description', 'long_description', 'retail_description', 'generation_status', 'fields_generated'
    ]
};

export async function callWriterLlm(systemInstruction, userPrompt, productMeta, db, maxRetries = 2) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    let attempt = 0;
    let fallbackUsed = false;
    let modelUsed = PRIMARY_MODEL;
    const startTime = Date.now();

    while (attempt < maxRetries) {
        try {
            const response = await ai.models.generateContent({
                model: modelUsed,
                contents: userPrompt,
                config: {
                    systemInstruction,
                    responseMimeType: 'application/json',
                    responseJsonSchema: writerSchema,
                    temperature: 0.1,
                }
            });

            const latency_ms = Date.now() - startTime;
            const rawText = response.text;
            const parsed = extractJsonObject(rawText);

            const prompt_tokens = response.usageMetadata?.promptTokenCount || 0;
            const completion_tokens = response.usageMetadata?.candidatesTokenCount || 0;
            const total_tokens = response.usageMetadata?.totalTokenCount || 0;

            // Log to llm_logs
            try {
                db.prepare(`INSERT INTO llm_logs
                    (created_at, agent_name, model_name, product_sku, product_brand, product_id,
                     total_tokens, latency_ms, prompt_tokens, completion_tokens, response_text, user_prompt, system_prompt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(
                    new Date().toISOString(),
                    'WriterAgent',
                    modelUsed,
                    productMeta.sku,
                    productMeta.brand || null,
                    productMeta.id,
                    total_tokens,
                    latency_ms,
                    prompt_tokens,
                    completion_tokens,
                    rawText,
                    userPrompt,
                    systemInstruction
                );
            } catch (dbErr) {
                console.error('[WriterAgent] Failed to write to llm_logs:', dbErr);
            }

            // Validate output
            if (!parsed || !parsed.generation_status) {
                throw new Error("Invalid Writer output: missing generation_status");
            }

            return {
                parsed,
                modelUsed,
                fallbackUsed,
                retryCount: attempt,
                latency_ms,
                prompt_tokens,
                completion_tokens,
                total_tokens
            };

        } catch (err) {
            console.error(`[WriterAgent] LLM call failed (Model: ${modelUsed}, Attempt: ${attempt}):`, err.message);
            attempt++;

            if (attempt >= maxRetries && !fallbackUsed) {
                console.warn(`[WriterAgent] Switching to fallback model: ${FALLBACK_MODEL}`);
                modelUsed = FALLBACK_MODEL;
                fallbackUsed = true;
                attempt = 0;
                maxRetries = 1;
            }
        }
    }

    throw new Error('Writer LLM failed after retries using both primary and fallback models.');
}
