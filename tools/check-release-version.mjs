import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const config = JSON.parse(fs.readFileSync('app-release.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(config.versionName) || !Number.isSafeInteger(config.versionCode) || config.versionCode < 2) throw new Error('Invalid version');
// Read version metadata from published app tags in Git, never from scene tags.
const tags = execFileSync('git', ['tag', '--list', 'app-v*'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
for (const tag of tags) {
    if (!/^app-v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Invalid app release tag');
    if (tag === `app-v${config.versionName}`) {
        const tagged = execFileSync('git', ['rev-parse', `${tag}^{commit}`], { encoding: 'utf8' }).trim();
        const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        if (tagged !== head) throw new Error('Current version tag points to a different commit');
        continue;
    }
    const previous = JSON.parse(execFileSync('git', ['show', `${tag}:app-release.json`], { encoding: 'utf8' }));
    if (config.versionCode <= previous.versionCode) throw new Error(`versionCode must exceed ${tag}`);
    const a = config.versionName.split('.').map(Number), b = previous.versionName.split('.').map(Number);
    const order = a.findIndex((value, i) => value !== b[i]);
    if (order < 0 || a[order] <= b[order]) throw new Error(`versionName must exceed ${tag}`);
}
console.log(`Release version ${config.versionName} (${config.versionCode}) is monotonic.`);
