import { Groq } from 'groq-sdk';
import { GoogleGenAI, Type } from '@google/genai';
import { db } from '../orchestration/db.mjs';
import { extractJsonObject } from '../utils.mjs';

const PRIMARY_MODEL = 'qwen/qwen3.6-27b';
const FALLBACK_MODEL = 'gemma-4-31b-it';

let groq = null;
let genai = null;

if (process.env.GROQ_API_KEY) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
}
if (process.env.GEMINI_API_KEY) {
    genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

function logLlmCall(agent, model, productId, promptTokens, completionTokens, requestText, responseText, systemPrompt, latencyMs) {
    try {
        const pRow = db.prepare('SELECT mfg_part_num FROM products WHERE id = ?').get(productId);
        const sku = pRow ? pRow.mfg_part_num : null;
        
        let totalTokens = 0;
        if (promptTokens && completionTokens) {
            totalTokens = promptTokens + completionTokens;
        }
        
        db.prepare(`
            INSERT INTO llm_logs (created_at, agent_name, model_name, product_id, product_sku, total_tokens, latency_ms, prompt_tokens, completion_tokens, user_prompt, response_text, system_prompt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(new Date().toISOString(), agent, model, productId, sku, totalTokens, latencyMs || 0, promptTokens || 0, completionTokens || 0, requestText, responseText, systemPrompt);
    } catch (err) {
        console.error('Failed to log LLM call:', err.message);
    }
}

export async function invokeClassifierLLM(systemPrompt, userPrompt, productId) {
    // Dynamic import of limiters
    const { limiters } = await import('../orchestration/limiters.mjs');
    
    // Estimate tokens
    const estimatedTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4) + 100;
    
    const startTime = Date.now();
    
    // Try Primary (Groq)
    if (groq) {
        let reservation = null;
        let providerSuccess = false;
        try {
            reservation = await limiters.qwen.acquire(estimatedTokens);
            
            const completion = await groq.chat.completions.create({
                model: PRIMARY_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.1,
                response_format: { type: 'json_object' }
            });

            providerSuccess = true;
            
            const prompt_tokens = completion.usage?.prompt_tokens || estimatedTokens;
            const completion_tokens = completion.usage?.completion_tokens || 0;
            const total_tokens = prompt_tokens + completion_tokens;
            
            limiters.qwen.reconcile(reservation, total_tokens);
            
            const responseText = completion.choices[0].message.content;
            const latencyMs = Date.now() - startTime;
            
            console.log(`[OBSERVABILITY] Stage: Classifier | Model: ${PRIMARY_MODEL} | ProductID: ${productId} | Wait: ${reservation.waitMs}ms | Exec: ${latencyMs}ms | EstTokens: ${estimatedTokens} | ActTokens: ${total_tokens}`);
            logLlmCall('Classifier', PRIMARY_MODEL, productId, prompt_tokens, completion_tokens, userPrompt, responseText, systemPrompt, latencyMs);

            // Parse JSON to ensure validity
            const parsed = extractJsonObject(responseText);
            return {
                data: parsed,
                raw: responseText,
                model: PRIMARY_MODEL,
                provider: 'Groq',
                fallback: false
            };
        } catch (err) {
            console.error(`Primary model ${PRIMARY_MODEL} via Groq failed: ${err.message}. Attempting fallback...`);
            if (reservation && !providerSuccess) limiters.qwen.reconcile(reservation, 0);
        }
    }

    // Try Fallback (Gemini via @google/genai)
    if (genai) {
        let reservation = null;
        let providerSuccess = false;
        try {
            reservation = await limiters.gemma.acquire(estimatedTokens);
            
            const response = await genai.models.generateContent({
                model: FALLBACK_MODEL,
                contents: systemPrompt + '\\n\\n' + userPrompt,
                config: {
                    temperature: 0.1,
                    responseMimeType: 'application/json'
                }
            });
            
            providerSuccess = true;
            
            const prompt_tokens = response.usageMetadata?.promptTokenCount || estimatedTokens;
            const completion_tokens = response.usageMetadata?.candidatesTokenCount || 0;
            const total_tokens = response.usageMetadata?.totalTokenCount || (prompt_tokens + completion_tokens);
            
            limiters.gemma.reconcile(reservation, total_tokens);
            
            const responseText = response.text;
            const latencyMs = Date.now() - startTime;
            
            console.log(`[OBSERVABILITY] Stage: Classifier | Model: ${FALLBACK_MODEL} | ProductID: ${productId} | Wait: ${reservation.waitMs}ms | Exec: ${latencyMs}ms | EstTokens: ${estimatedTokens} | ActTokens: ${total_tokens}`);
            logLlmCall('Classifier', FALLBACK_MODEL, productId, prompt_tokens, completion_tokens, userPrompt, responseText, systemPrompt, latencyMs);
            
            const parsed = extractJsonObject(responseText);
            return {
                data: parsed,
                raw: responseText,
                model: FALLBACK_MODEL,
                provider: 'Google AI Studio',
                fallback: true
            };
        } catch (err) {
            console.error(`Fallback model ${FALLBACK_MODEL} failed: ${err.message}`);
            if (reservation && !providerSuccess) limiters.gemma.reconcile(reservation, 0);
            throw err;
        }
    }

    throw new Error('No valid LLM client configured (missing API keys?)');
}
