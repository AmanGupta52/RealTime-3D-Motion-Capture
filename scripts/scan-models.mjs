// Lists which models from public/models/models.json actually have a file in public/models/.
// Writes public/models/available.json, which the app reads. Run automatically by dev/build/desktop.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const dir = new URL('../public/models/', import.meta.url);
const manifest = new URL('models.json', dir);
if (!existsSync(manifest)) { writeFileSync(new URL('available.json', dir), '[]'); console.log('[models] no models.json found'); process.exit(0); }

const files = new Set(readdirSync(dir).map((f) => f.toLowerCase()));
const all = JSON.parse(readFileSync(manifest, 'utf8'));
const found = [], missing = [];
for (const m of all) {
  const file = basename(String(m.path ?? '').replace(/\\/g, '/'));
  (files.has(file.toLowerCase()) ? found : missing).push({ name: m.name, path: m.path, type: m.type, file });
}
writeFileSync(new URL('available.json', dir), JSON.stringify(found.map(({ name, path, type }) => ({ name, path, type })), null, 2));
console.log(`[models] ${found.length} found: ${found.map((m) => m.name).join(', ') || '-'}`);
if (missing.length) console.log(`[models] ${missing.length} not in public/models/ yet (hidden): ${missing.map((m) => `${m.name} (${m.file})`).join(', ')}`);
