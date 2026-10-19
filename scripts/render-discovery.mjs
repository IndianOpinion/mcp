// Write discovery/server-card.json and discovery/agents.txt exactly as
// src/discovery.js renders them (the Worker serves the rendered text; these
// copies are for readers of the repository). The tests fail if they drift.
//   npm run discovery
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverCard, agentsTxt } from '../src/discovery.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(ROOT, 'discovery'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'discovery', 'server-card.json'), JSON.stringify(serverCard(), null, 2) + '\n');
fs.writeFileSync(path.join(ROOT, 'discovery', 'agents.txt'), agentsTxt());
console.log('discovery/server-card.json and discovery/agents.txt written');
