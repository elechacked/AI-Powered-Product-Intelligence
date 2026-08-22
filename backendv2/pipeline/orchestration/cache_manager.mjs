/**
 * cache_manager.mjs
 * Database-backed cache repository for domain resolution and product URL lookups.
 */
import { db } from './db.mjs';

/**
 * Gets cached domain resolution for a company name, respecting TTL.
 */
export function getDomainCache(companyName) {
  const normalized = companyName.toLowerCase().trim();
  const stmt = db.prepare('SELECT * FROM company_domain_cache WHERE normalized_company_name = ?');
  const row = stmt.get(normalized);
  
  if (row) {
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return null; // Expired
    }
    
    return {
      official_domain: row.official_domain,
      status: row.status,
      resolution_confidence: row.resolution_confidence,
      resolution_method: row.resolution_method,
      validated_at: row.validated_at,
      resolved_at: row.resolved_at
    };
  }
  return null;
}

/**
 * Sets a domain resolution in the cache with TTL.
 */
export function setDomainCache(companyName, data) {
  const normalized = companyName.toLowerCase().trim();
  const now = new Date();
  
  let expires = new Date();
  if (data.status === 'success' && data.resolution_confidence > 0.8) {
    expires.setDate(expires.getDate() + 30);
  } else if (data.status === 'success') {
    expires.setDate(expires.getDate() + 7);
  } else {
    expires.setDate(expires.getDate() + 1);
  }
  
  const stmt = db.prepare(`
    INSERT INTO company_domain_cache (
      normalized_company_name, official_domain, status, 
      resolution_confidence, resolution_method, validated_at, 
      resolved_at, updated_at, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_company_name) DO UPDATE SET
      official_domain=excluded.official_domain,
      status=excluded.status,
      resolution_confidence=excluded.resolution_confidence,
      resolution_method=excluded.resolution_method,
      validated_at=excluded.validated_at,
      updated_at=excluded.updated_at,
      expires_at=excluded.expires_at
  `);
  
  stmt.run(
    normalized, 
    data.official_domain, 
    data.status, 
    data.resolution_confidence || 0,
    data.resolution_method || 'none',
    data.validated_at || now.toISOString(),
    now.toISOString(), 
    now.toISOString(), 
    expires.toISOString()
  );
}

/**
 * Gets cached product URL lookup for a domain + mpn combo, respecting TTL.
 */
export function getProductCache(domain, mpn) {
  const normDomain = domain.toLowerCase().trim();
  const normMpn = mpn.toLowerCase().trim();
  
  const stmt = db.prepare('SELECT * FROM product_url_cache WHERE official_domain = ? AND normalized_mfg_part_num = ?');
  const row = stmt.get(normDomain, normMpn);
  
  if (row) {
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return null;
    }
    
    return {
      product_url: row.product_url,
      sku_match_status: row.sku_match_status,
      url_status: row.url_status,
      checked_at: row.checked_at
    };
  }
  return null;
}

/**
 * Sets a product URL lookup in the cache with TTL.
 */
export function setProductCache(domain, mpn, data) {
  const normDomain = domain.toLowerCase().trim();
  const normMpn = mpn.toLowerCase().trim();
  const now = new Date();
  
  let expires = new Date();
  if (data.url_status === 'success') {
    expires.setDate(expires.getDate() + 30);
  } else {
    expires.setDate(expires.getDate() + 3);
  }
  
  const stmt = db.prepare(`
    INSERT INTO product_url_cache (
      official_domain, normalized_mfg_part_num, product_url, 
      sku_match_status, url_status, checked_at, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(official_domain, normalized_mfg_part_num) DO UPDATE SET
      product_url=excluded.product_url,
      sku_match_status=excluded.sku_match_status,
      url_status=excluded.url_status,
      checked_at=excluded.checked_at,
      expires_at=excluded.expires_at
  `);
  
  stmt.run(
    normDomain, 
    normMpn, 
    data.product_url, 
    data.sku_match_status, 
    data.url_status, 
    now.toISOString(),
    expires.toISOString()
  );
}
