/**
 * Writer DB helpers: schema migration + UPSERT for product_descriptions.
 */

export function ensureWriterSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS product_descriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL UNIQUE,
            invoice_description TEXT,
            mobile_description TEXT,
            in_app_description TEXT,
            short_description TEXT,
            long_description TEXT,
            retail_description TEXT,
            marketing_description TEXT,
            marketing_description_source_url TEXT,
            marketing_description_source_name TEXT,
            generation_status TEXT,
            fields_generated INTEGER,
            model_used TEXT,
            provider_used TEXT,
            fallback_used INTEGER DEFAULT 0,
            retry_count INTEGER DEFAULT 0,
            prompt_tokens INTEGER,
            completion_tokens INTEGER,
            total_tokens INTEGER,
            latency_ms INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
        );
    `);

    // Migrate existing tables that lack the provenance columns (safe on repeated runs)
    try {
        db.exec(`ALTER TABLE product_descriptions ADD COLUMN marketing_description_source_url TEXT;`);
    } catch (_) { /* column already exists */ }
    try {
        db.exec(`ALTER TABLE product_descriptions ADD COLUMN marketing_description_source_name TEXT;`);
    } catch (_) { /* column already exists */ }
}

export function upsertProductDescriptions(db, productId, parsed, meta) {
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT id FROM product_descriptions WHERE product_id = ?').get(productId);
    if (existing) {
        db.prepare(`
            UPDATE product_descriptions SET
                invoice_description = ?,
                mobile_description = ?,
                in_app_description = ?,
                short_description = ?,
                long_description = ?,
                retail_description = ?,
                marketing_description = ?,
                marketing_description_source_url = ?,
                marketing_description_source_name = ?,
                generation_status = ?,
                fields_generated = ?,
                model_used = ?,
                provider_used = ?,
                fallback_used = ?,
                retry_count = ?,
                prompt_tokens = ?,
                completion_tokens = ?,
                total_tokens = ?,
                latency_ms = ?,
                updated_at = ?
            WHERE product_id = ?
        `).run(
            parsed.invoice_description || null,
            parsed.mobile_description || null,
            parsed.in_app_description || null,
            parsed.short_description || null,
            parsed.long_description || null,
            parsed.retail_description || null,
            parsed.marketing_description || null,
            meta.marketingSourceUrl || null,
            meta.marketingSourceName || null,
            parsed.generation_status || 'partial',
            parsed.fields_generated || 0,
            meta.modelUsed,
            'google-ai-studio',
            meta.fallbackUsed ? 1 : 0,
            meta.retryCount,
            meta.prompt_tokens,
            meta.completion_tokens,
            meta.total_tokens,
            meta.latency_ms,
            now,
            productId
        );
    } else {
        db.prepare(`
            INSERT INTO product_descriptions (
                product_id, invoice_description, mobile_description, in_app_description,
                short_description, long_description, retail_description,
                marketing_description, marketing_description_source_url, marketing_description_source_name,
                generation_status, fields_generated, model_used, provider_used, fallback_used,
                retry_count, prompt_tokens, completion_tokens, total_tokens, latency_ms,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            productId,
            parsed.invoice_description || null,
            parsed.mobile_description || null,
            parsed.in_app_description || null,
            parsed.short_description || null,
            parsed.long_description || null,
            parsed.retail_description || null,
            parsed.marketing_description || null,
            meta.marketingSourceUrl || null,
            meta.marketingSourceName || null,
            parsed.generation_status || 'partial',
            parsed.fields_generated || 0,
            meta.modelUsed,
            'google-ai-studio',
            meta.fallbackUsed ? 1 : 0,
            meta.retryCount,
            meta.prompt_tokens,
            meta.completion_tokens,
            meta.total_tokens,
            meta.latency_ms,
            now,
            now
        );
    }
}
