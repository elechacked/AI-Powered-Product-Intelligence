export const CONFIG = {
    PRODUCT_CONCURRENCY: 10,

    GEMINI_SAFE_RPM: 12,
    GEMINI_SAFE_TPM: 250000,
    GEMINI_SAFE_RPD: 500,

    QWEN_SAFE_RPM: 25,
    QWEN_SAFE_TPM: 7000,
    QWEN_SAFE_RPD: 1000,

    GEMMA_SAFE_RPM: 25,
    GEMMA_SAFE_TPM: 14000,
    GEMMA_SAFE_RPD: 14400,

    CRAWLER_MAX_CONCURRENCY_PER_DOMAIN: 1,
};

export class RateLimiter {
    constructor({ rpm, tpm, rpd, name }) {
        this.name = name;
        this.rpmLimit = rpm;
        this.tpmLimit = tpm;
        this.rpdLimit = rpd;

        this.requestLog = []; // { ts, expectedTokens }
        this.dailyRequests = 0;
        this.currentDay = new Date().toISOString().split('T')[0];

        this.queue = []; 
        this.activeCount = 0;
        
        this.actualTokensUsed = 0;
        this.limiterWaitMsTotal = 0;
        this._timeoutId = null;
    }

    async acquire(estimatedTokens) {
        const startTime = Date.now();
        return new Promise((resolve, reject) => {
            const task = { estimatedTokens, resolve, reject, startTime };
            this.queue.push(task);
            this._pump();
        });
    }
    
    _pump() {
        if (this._timeoutId) {
            clearTimeout(this._timeoutId);
            this._timeoutId = null;
        }

        if (this.queue.length === 0) return;

        const now = Date.now();
        
        // Clean old requests from sliding window
        this.requestLog = this.requestLog.filter(req => now - req.ts < 60000);
        
        const today = new Date().toISOString().split('T')[0];
        if (this.currentDay !== today) {
            this.currentDay = today;
            this.dailyRequests = 0;
        }

        const task = this.queue[0];
        const rollingTpmUsed = this.requestLog.reduce((sum, req) => sum + req.expectedTokens, 0);
        
        const canRun = 
            this.requestLog.length < this.rpmLimit &&
            (rollingTpmUsed + task.estimatedTokens) <= this.tpmLimit &&
            this.dailyRequests < this.rpdLimit;

        if (canRun) {
            this.queue.shift();
            
            const waitMs = now - task.startTime;
            this.limiterWaitMsTotal += waitMs;
            
            const reservation = { ts: now, expectedTokens: task.estimatedTokens, waitMs };
            this.requestLog.push(reservation);
            this.dailyRequests++;
            this.activeCount++;
            
            task.resolve(reservation);
            
            if (this.queue.length > 0) {
                this._timeoutId = setTimeout(() => this._pump(), 0); 
            }
        } else {
            if (this.requestLog.length > 0) {
                const oldest = this.requestLog[0];
                const timeToWait = 60000 - (now - oldest.ts);
                this._timeoutId = setTimeout(() => this._pump(), Math.max(timeToWait, 50));
            } else {
                if (task.estimatedTokens > this.tpmLimit) {
                    console.warn(`[RateLimiter ${this.name}] Request exceeds TPM limit by itself! Admitting anyway.`);
                    this.queue.shift();
                    
            const waitMs = now - task.startTime;
            this.limiterWaitMsTotal += waitMs;
            
            const reservation = { ts: now, expectedTokens: task.estimatedTokens, waitMs };
            this.requestLog.push(reservation);
            this.dailyRequests++;
            this.activeCount++;
            
            task.resolve(reservation);
                    if (this.queue.length > 0) {
                        this._timeoutId = setTimeout(() => this._pump(), 0);
                    }
                } else {
                     if (this.dailyRequests >= this.rpdLimit) {
                         console.error(`[RateLimiter ${this.name}] RPD limit reached!`);
                         this._timeoutId = setTimeout(() => this._pump(), 60000);
                     }
                }
            }
        }
    }

    reconcile(reservation, actualTokens) {
        this.activeCount--;
        this.actualTokensUsed += actualTokens;
        
        if (reservation) {
            reservation.expectedTokens = actualTokens;
        }
        
        this._pump();
    }
}

export function normalizeDomain(urlStr) {
    if (!urlStr) return 'unknown';
    try {
        let hostname;
        const lowerUrl = urlStr.toLowerCase();
        if (!lowerUrl.startsWith('http://') && !lowerUrl.startsWith('https://')) {
            hostname = new URL('http://' + urlStr).hostname;
        } else {
            hostname = new URL(urlStr).hostname;
        }
        return hostname.toLowerCase().replace(/^www\./, '');
    } catch (e) {
        return 'unknown';
    }
}

export class DomainLimiter {
    constructor(maxConcurrentPerDomain = CONFIG.CRAWLER_MAX_CONCURRENCY_PER_DOMAIN) {
        this.maxConcurrent = maxConcurrentPerDomain;
        this.active = new Map();
        this.queue = new Map();
    }

    async acquireAll(domains) {
        const normalized = domains.map(normalizeDomain).filter(d => d !== 'unknown');
        const sorted = [...new Set(normalized)].sort();
        for (const domain of sorted) {
            await this._acquire(domain);
        }
    }

    async _acquire(domain) {
        let active = this.active.get(domain) || 0;
        if (active < this.maxConcurrent) {
            this.active.set(domain, active + 1);
            return;
        }
        return new Promise(resolve => {
            let q = this.queue.get(domain) || [];
            q.push(resolve);
            this.queue.set(domain, q);
        });
    }

    releaseAll(domains) {
        const normalized = domains.map(normalizeDomain).filter(d => d !== 'unknown');
        const sorted = [...new Set(normalized)].sort();
        for (const domain of sorted) {
            this._release(domain);
        }
    }

    _release(domain) {
        let q = this.queue.get(domain);
        if (q && q.length > 0) {
            const resolve = q.shift();
            resolve();
        } else {
            let active = this.active.get(domain) || 1;
            this.active.set(domain, Math.max(0, active - 1));
        }
    }
}

export class PacedLimiter {
    constructor(requestsPerSecond) {
        this.intervalMs = Math.ceil(1000 / requestsPerSecond);
        this.queue = [];
        this.lastRunTime = 0;
        this._timeoutId = null;
    }

    async acquire() {
        return new Promise(resolve => {
            this.queue.push(resolve);
            this._pump();
        });
    }

    _pump() {
        if (this._timeoutId) return; // already pumping
        if (this.queue.length === 0) return; // nothing to do

        const now = Date.now();
        const nextAllowedTime = this.lastRunTime + this.intervalMs;

        if (now >= nextAllowedTime) {
            this.lastRunTime = now;
            const resolve = this.queue.shift();
            resolve();
            if (this.queue.length > 0) {
                this._timeoutId = setTimeout(() => {
                    this._timeoutId = null;
                    this._pump();
                }, this.intervalMs);
            }
        } else {
            this._timeoutId = setTimeout(() => {
                this._timeoutId = null;
                this._pump();
            }, nextAllowedTime - now);
        }
    }
}

export const limiters = {
    gemini: new RateLimiter({
        name: 'Gemini',
        rpm: CONFIG.GEMINI_SAFE_RPM,
        tpm: CONFIG.GEMINI_SAFE_TPM,
        rpd: CONFIG.GEMINI_SAFE_RPD,
    }),
    qwen: new RateLimiter({
        name: 'Qwen',
        rpm: CONFIG.QWEN_SAFE_RPM,
        tpm: CONFIG.QWEN_SAFE_TPM,
        rpd: CONFIG.QWEN_SAFE_RPD,
    }),
    gemma: new RateLimiter({
        name: 'Gemma',
        rpm: CONFIG.GEMMA_SAFE_RPM,
        tpm: CONFIG.GEMMA_SAFE_TPM,
        rpd: CONFIG.GEMMA_SAFE_RPD,
    }),
    domain: new DomainLimiter(),
    serper: new PacedLimiter(5)
};
