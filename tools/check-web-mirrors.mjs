import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function filesUnder(relative) {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    return (await Promise.all(entries.map(entry => {
        const child = path.join(relative, entry.name);
        return entry.isDirectory() ? filesUnder(child) : [child];
    }))).flat();
}
const files = ['index.html', 'style.css', ...(await Promise.all(
    ['js', 'css', 'licenses', 'webfonts'].map(filesUnder)
)).flat()];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const file of files) {
    const [source, mirror] = await Promise.all([
        readFile(path.join(root, file)), readFile(path.join(root, 'www', file))
    ]);
    if (hash(source) !== hash(mirror)) throw new Error(`root/www mirror mismatch: ${file}`);
}
console.log(`${files.length} root/www assets match (SHA-256).`);
