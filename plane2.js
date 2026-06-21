// plane2.js — PURE Epistemic deep-save helpers (Plane-2c). No SillyTavern imports.
// All ST impurity (load/save/upsert) is injected via `deps` into writeDeepFacts.
import { buildEntryCharacterFilter } from './memoryEntry.js';

/** Parse the "## To Deep Storage" section -> [{tag, about, fact, reason}]. Malformed lines skipped. */
export function parseToDeepStorage(text) {
    const out = [];
    let inSection = false;
    for (const raw of String(text || '').split('\n')) {
        const line = raw.trim();
        if (/^##\s+/.test(line)) { inSection = /^##\s+to\s+deep\s+storage\b/i.test(line); continue; }
        if (!inSection || !line.startsWith('-')) continue;
        const parts = line.replace(/^-\s*/, '').split('|').map(s => s.trim());
        if (parts.length < 4) continue;
        const [tag, about, fact, reason] = parts;
        if (!tag || !about || !fact) continue;
        out.push({ tag: tag.toLowerCase(), about, fact, reason: (reason || '').toLowerCase() });
    }
    return out;
}

/** Read the "Epistemic #N" header number, or null. */
export function parseUpdateNum(text) {
    const m = String(text || '').match(/Epistemic\s+#(\d+)/i);
    return m ? Number(m[1]) : null;
}
