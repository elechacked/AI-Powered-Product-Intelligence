import { crawl } from './engine/dist/engine.js';
import fs from 'fs';
import path from 'path';

async function run() {
    console.log('Running Cheerio-only test...');
    await crawl({ urls: ['https://example.com'], adaptiveCrawling: false, requestRetries: 0 });
    
    console.log('Running Fallback test...');
    const result = await crawl({ urls: ['https://example.com'], adaptiveCrawling: true, requestRetries: 0 });
    console.log('Fallback Reason:', result.pages[0]?.fallback_reason);
    
    const queuesDir = path.join(process.cwd(), 'storage', 'request_queues');
    if (fs.existsSync(queuesDir)) {
        const queues = fs.readdirSync(queuesDir);
        console.log(`Remaining queues: ${queues.length}`);
    } else {
        console.log('Remaining queues: 0 (dir missing or clean)');
    }
}
run().catch(console.error);
