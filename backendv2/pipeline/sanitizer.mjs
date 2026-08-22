import { db } from './orchestration/db.mjs';

function cleanMarkdown(md) {
    if (!md) return "";
    let lines = md.split('\n');
    let preserved = [];
    let noisePatterns = [
        /skip to content/i,
        /skip to footer/i,
        /sign in/i,
        /explore by categories/i,
        /explore by category/i,
        /cookie policy/i,
        /privacy policy/i,
        /terms of use/i,
        /all rights reserved/i,
        /do not sell my personal/i,
        /website accessibility/i,
        /dealer locator/i,
        /recent saves/i,
        /compare products/i,
        /where to buy/i,
        /scroll to top/i,
        /be the first to ask/i,
        /find a store/i,
        /^menu$/i,
        /^home$/i,
        /^cart$/i,
        /^search$/i,
        /^account$/i,
        /^contact us$/i,
        /^about us$/i,
        /^careers$/i
    ];

    let lastLine = "";
    for (let line of lines) {
        let trimmed = line.trim();
        if (!trimmed) continue;
        
        let isNoise = noisePatterns.some(p => p.test(trimmed));
        if (isNoise) continue;
        
        if (trimmed.startsWith('![') && trimmed.endsWith(')') && trimmed.length < 150 && trimmed.toLowerCase().includes('icon')) {
            continue;
        }

        if (trimmed === lastLine) continue;

        preserved.push(trimmed);
        lastLine = trimmed;
    }
    return preserved.join('\n');
}

function cleanStructuredData(sdArray) {
    if (!Array.isArray(sdArray)) return [];
    const validTypes = ['Product', 'Offer', 'AggregateOffer', 'Brand', 'PropertyValue', 'ItemList'];
    return sdArray.filter(item => {
        if (!item || !item['@type']) return false;
        let type = item['@type'];
        if (Array.isArray(type)) {
            return type.some(t => validTypes.includes(t));
        }
        return validTypes.includes(type);
    });
}

function cleanTables(tables) {
    if (!Array.isArray(tables)) return [];
    return tables.filter(t => t.rows && t.rows.length > 0);
}

function cleanMetadata(meta) {
    if (!meta) return {};
    let clean = {};
    if (meta.title) clean.title = meta.title;
    if (meta.description) clean.description = meta.description;
    if (meta.canonical) clean.canonical = meta.canonical;
    return clean;
}

function normalizeImageUrl(url) {
    if (!url) return "";
    let normalized = url;
    // Strip common CDN resizing params to find the canonical base image
    // e.g. https://images.freudnation.com/s/ik-seo/tr:w-100/ldgrb8iy8kqbr9srmlla/diablo-1-2-x-...
    // -> strip tr:w-100/
    normalized = normalized.replace(/\/tr:[^/]+\//i, '/');
    normalized = normalized.replace(/\?w=\d+&?/i, '?');
    normalized = normalized.replace(/\?width=\d+&?/i, '?');
    if (normalized.endsWith('?')) normalized = normalized.slice(0, -1);
    return normalized;
}

function processImagesWithContext(images, context) {
    if (!Array.isArray(images)) return { images: [], videos: [] };
    
    let resultImages = [];
    let resultVideos = [];
    
    const sku = (context.sku || '').toLowerCase();
    const normalizedSku = sku.replace(/[^a-z0-9]/g, '');
    const titleTokens = (context.title || '').toLowerCase().split(/\s+/).filter(t => t.length > 3);
    
    // Build a map to deduplicate by normalized URL
    let uniqueMap = new Map();

    for (let img of images) {
        if (!img || !img.src) continue;
        let src = img.src;
        let alt = img.alt || '';
        let srcLower = src.toLowerCase();
        let altLower = alt.toLowerCase();
        
        let classification = 'unknown_image';
        let signals = [];

        // 1. Detect if it's actually a video poster
        if (srcLower.includes('vimeocdn.com/video') || srcLower.includes('youtube.com/vi/')) {
            classification = 'product_video';
            signals.push('video_cdn_detected');
            resultVideos.push({
                url: null, // Don't invent URL
                poster: src,
                title: alt || 'Product Video',
                source: 'page_video',
                classification: classification,
                signals: signals
            });
            continue;
        }

        // 2. Reject obvious structural/technical noise
        if (srcLower.includes('logo') || altLower.includes('logo')) classification = 'rejected';
        else if (srcLower.includes('/icon/') || altLower.includes('icon')) classification = 'rejected';
        else if (srcLower.includes('social') || srcLower.includes('facebook') || srcLower.includes('twitter') || srcLower.includes('instagram')) classification = 'rejected';
        else if (srcLower.includes('banner') || altLower.includes('banner')) classification = 'rejected';
        else if (srcLower.endsWith('.svg') || srcLower.endsWith('.gif')) classification = 'rejected';
        else if (srcLower.includes('tracking') || srcLower.includes('pixel')) classification = 'rejected';
        
        if (classification === 'rejected') continue;

        // 3. Check for related products / wrong SKU
        let isRelatedProduct = false;
        
        // Common phrases indicating another product
        if (altLower.includes('featured product:') || altLower.includes('related product') || altLower.includes('customers also bought')) {
            isRelatedProduct = true;
            signals.push('related_product_phrase_in_alt');
        }

        // If the alt or url contains a recognizable part number that is NOT our SKU
        // Very simplistic heuristic: if we see something that looks like an ID in alt/url but it doesn't match our sku
        // E.g. "Featured product: DMAPLA4440" -> DMAPLA4440 is different from DCB518ASTS06G
        let altWords = alt.split(/[\s:,-]+/);
        for (let word of altWords) {
            let wUpper = word.toUpperCase();
            // Looks like a part number (mix of letters and numbers, length > 5)
            if (wUpper.length > 5 && /[A-Z]/.test(wUpper) && /[0-9]/.test(wUpper)) {
                if (normalizedSku && !wUpper.includes(sku.toUpperCase()) && !sku.toUpperCase().includes(wUpper)) {
                    isRelatedProduct = true;
                    signals.push('different_sku_detected');
                }
            }
        }

        if (isRelatedProduct) {
            classification = 'related_product_image';
        } else {
            // 4. Strong Keep Signals for primary/secondary
            let isPrimary = false;
            let isSecondary = false;
            
            if (sku && (srcLower.includes(sku) || srcLower.includes(normalizedSku) || altLower.includes(sku))) {
                isPrimary = true;
                signals.push('sku_match');
            }
            
            // Match title tokens
            let titleMatches = 0;
            for (let t of titleTokens) {
                if (altLower.includes(t) || srcLower.includes(t)) titleMatches++;
            }
            if (titleMatches >= 4) {
                isPrimary = true;
                signals.push('strong_title_match');
            } else if (titleMatches >= 2) {
                if (!isPrimary) isSecondary = true;
                signals.push('title_terms_match');
            }
            
            if (altLower.includes('packaging') || altLower.includes('in package') || srcLower.includes('packaging')) {
                isSecondary = true;
                isPrimary = false;
                signals.push('packaging_keyword');
            }
            
            if (isPrimary) classification = 'primary_product_image';
            else if (isSecondary) classification = 'secondary_product_image';
        }
        
        if (classification === 'related_product_image' || classification === 'rejected') continue;
        
        const normUrl = normalizeImageUrl(src);
        
        // Deduplicate: if we already have it, maybe upgrade its classification if it's better
        if (uniqueMap.has(normUrl)) {
            let existing = uniqueMap.get(normUrl);
            if (classification === 'primary_product_image' && existing.classification !== 'primary_product_image') {
                existing.classification = classification;
                existing.signals = [...new Set([...existing.signals, ...signals])];
            }
            // Keep the one with the higher resolution if identifiable? 
            // Often tr:w-600 is better than tr:w-100.
            let extMatch1 = src.match(/w-(\d+)/);
            let extMatch2 = existing.url.match(/w-(\d+)/);
            if (extMatch1 && extMatch2) {
                if (parseInt(extMatch1[1]) > parseInt(extMatch2[1])) {
                    existing.url = src; // Upgrade to higher res variant
                }
            }
        } else {
            uniqueMap.set(normUrl, {
                url: src,
                alt: alt,
                source: 'page_image',
                classification: classification,
                signals: signals
            });
        }
    }
    
    resultImages = Array.from(uniqueMap.values());
    
    return { images: resultImages, videos: resultVideos };
}

export function sanitizeEvidence(rawJsonString, context = {}) {
    let raw;
    try {
        raw = JSON.parse(rawJsonString);
    } catch (e) {
        return { error: "Invalid JSON" };
    }

    const startBytes = Buffer.byteLength(rawJsonString, 'utf8');

    let titleToUse = context.title || '';
    if (raw.meta && raw.meta.title && raw.meta.title.length > titleToUse.length) {
        titleToUse = raw.meta.title;
    } else if (raw.openGraph && raw.openGraph.title && raw.openGraph.title.length > titleToUse.length) {
        titleToUse = raw.openGraph.title;
    }
    
    if (titleToUse.length < 30 && raw.markdown) {
        let h1Match = raw.markdown.match(/^#\s+(.+)$/m);
        if (h1Match && h1Match[1].length > titleToUse.length) {
            titleToUse = h1Match[1].trim();
        }
    }
    
    context.title = titleToUse;

    const media = processImagesWithContext(raw.images, context);

    let evidence = {
        text: raw.text ? cleanMarkdown(raw.text) : "",
        markdown: raw.markdown ? cleanMarkdown(raw.markdown) : "",
        structuredData: cleanStructuredData(raw.structuredData),
        commerceData: raw.commerceData || [], 
        microdata: cleanStructuredData(raw.microdata), 
        tables: cleanTables(raw.tables),
        metadata: cleanMetadata(raw.meta)
    };
    
    if (media.images.length > 0) {
        // Only keep highly probable product images to save tokens, drop unknown/unclassified images
        const filteredImages = media.images.filter(img => img.classification !== 'unknown_image');
        if (filteredImages.length > 0) evidence.images = filteredImages;
    }
    if (media.videos.length > 0) evidence.videos = media.videos;
    
    if (raw.openGraph && raw.openGraph.image) {
        evidence.metadata.og_image = raw.openGraph.image;
        // Optionally classify OG image
        const ogNorm = normalizeImageUrl(raw.openGraph.image);
        if (evidence.images) {
            let found = evidence.images.find(i => normalizeImageUrl(i.url) === ogNorm);
            if (found) {
                found.classification = 'primary_product_image';
                found.signals.push('og_image_match');
            } else {
                evidence.images.unshift({
                    url: raw.openGraph.image,
                    alt: context.title || '',
                    source: 'open_graph',
                    classification: 'primary_product_image',
                    signals: ['og_image_match']
                });
            }
        } else {
            evidence.images = [{
                url: raw.openGraph.image,
                alt: context.title || '',
                source: 'open_graph',
                classification: 'primary_product_image',
                signals: ['og_image_match']
            }];
        }
    }
    
    let sectionsPresent = [];
    if (evidence.text.length > 50) sectionsPresent.push('text');
    if (evidence.markdown.length > 50) sectionsPresent.push('markdown');
    if (evidence.structuredData.length > 0) sectionsPresent.push('structuredData');
    if (evidence.commerceData.length > 0) sectionsPresent.push('commerceData');
    if (evidence.tables.length > 0) sectionsPresent.push('tables');
    if (Object.keys(evidence.metadata).length > 0) sectionsPresent.push('metadata');
    if (evidence.images && evidence.images.length > 0) sectionsPresent.push('images');
    if (evidence.videos && evidence.videos.length > 0) sectionsPresent.push('videos');

    const sanitizedStr = JSON.stringify(evidence);
    const endBytes = Buffer.byteLength(sanitizedStr, 'utf8');
    
    let stats = {
        raw_size_bytes: startBytes,
        sanitized_size_bytes: endBytes,
        reduction_percent: startBytes > 0 ? Math.round(((startBytes - endBytes) / startBytes) * 100) : 0,
        sections_present: sectionsPresent,
        truncated: false
    };

    return {
        evidence,
        stats,
        isMeaningful: sectionsPresent.length > 0
    };
}

export function processProductSanitization(productId) {
    const product = db.prepare(`SELECT mfg_part_num, part_desc, part_manuf_company_name FROM products WHERE id = ?`).get(productId);
    
    const sources = db.prepare(`SELECT id, source_name, source_role, source_domain, source_url FROM product_sources WHERE product_id = ? AND status = 'done'`).all(productId);
    
    let anySuccess = false;
    let anyPartial = false;

    for (let source of sources) {
        const crawls = db.prepare(`SELECT * FROM source_crawl_results WHERE product_source_id = ? AND status = 'done'`).all(source.id);
        
        let mergedEvidence = {
            crawls: []
        };
        
        let allStats = {
            raw_size_bytes: 0,
            sanitized_size_bytes: 0,
            sections_present: new Set()
        };
        
        let sourceSuccess = false;
        let sourceHasMeaningfulData = false;
        
        for (let crawl of crawls) {
            if (!crawl.output_json) continue;
            
            const context = {
                sku: product?.mfg_part_num,
                title: product?.part_desc,
                source_url: source.source_url,
                source_domain: source.source_domain
            };
            
            const res = sanitizeEvidence(crawl.output_json, context);
            if (res.error) continue;
            
            mergedEvidence.crawls.push({
                url: crawl.url,
                source_type: crawl.source_type,
                data: res.evidence
            });
            
            allStats.raw_size_bytes += res.stats.raw_size_bytes;
            allStats.sanitized_size_bytes += res.stats.sanitized_size_bytes;
            res.stats.sections_present.forEach(s => allStats.sections_present.add(s));
            
            if (res.isMeaningful) {
                sourceHasMeaningfulData = true;
                sourceSuccess = true;
            }
        }
        
        const existing = db.prepare(`SELECT id FROM sanitized_evidence WHERE product_source_id = ?`).get(source.id);
        
        const finalStatus = sourceSuccess ? 'done' : 'failed';
        const statsJson = JSON.stringify({
            raw_size_bytes: allStats.raw_size_bytes,
            sanitized_size_bytes: allStats.sanitized_size_bytes,
            reduction_percent: allStats.raw_size_bytes > 0 ? Math.round(((allStats.raw_size_bytes - allStats.sanitized_size_bytes) / allStats.raw_size_bytes) * 100) : 0,
            sections_present: Array.from(allStats.sections_present),
            truncated: false
        });
        
        const timeNow = new Date().toISOString();
        if (existing) {
            db.prepare(`UPDATE sanitized_evidence SET status = ?, evidence_json = ?, stats_json = ?, updated_at = ? WHERE id = ?`).run(
                finalStatus, JSON.stringify(mergedEvidence), statsJson, timeNow, existing.id
            );
        } else {
            db.prepare(`INSERT INTO sanitized_evidence (product_source_id, status, evidence_json, stats_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
                source.id, finalStatus, JSON.stringify(mergedEvidence), statsJson, timeNow, timeNow
            );
        }
        
        if (finalStatus === 'done') anySuccess = true;
        else anyPartial = true;
    }
    
    let overallStatus = 'failed';
    if (anySuccess && !anyPartial) overallStatus = 'done';
    else if (anySuccess && anyPartial) overallStatus = 'partial';
    else if (!anySuccess && sources.length === 0) overallStatus = 'done'; 
    
    return overallStatus;
}
