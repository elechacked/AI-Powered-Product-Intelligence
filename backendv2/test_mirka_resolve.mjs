import { resolveOfficialDomain } from './pipeline/orchestration/url_discovery.mjs';
import fs from 'fs';
const env = fs.readFileSync('.env', 'utf8');
const serperMatch = env.match(/SERPER_API_KEY="?([^"\\s]+)"?/);
process.env.SERPER_API_KEY = serperMatch ? serperMatch[1] : null;

resolveOfficialDomain('Mirka Abrasives Inc').then(console.log);
