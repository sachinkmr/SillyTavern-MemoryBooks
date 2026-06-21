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

const COLD_TAGS = new Set(['knows', 'believes', 'suspects']);
const PHRASE = { knows: 'knows', believes: 'believes (possibly falsely)', suspects: 'suspects' };

export function isDeepSaveEligible(tag) {
    return COLD_TAGS.has(String(tag || '').trim().toLowerCase());
}

function slug(s, n = 48) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
}

/** Stable, dedup-bearing title (upsert-by-title => idempotent). */
export function coldFactTitle(charName, item) {
    return `[Deep][${charName}] ${item.tag}:${item.about} — ${slug(item.fact)}`;
}

/** Cold-fact lorebook entry gated to the knower. null if tag not cold-eligible. */
export function buildColdFactEntry(item, charTarget, rosterRows, opts = {}) {
    if (!item || !charTarget || !isDeepSaveEligible(item.tag)) return null;
    const charName = String(charTarget.name);
    const cf = buildEntryCharacterFilter([charName.toLowerCase()], rosterRows);
    // Witness fail-safe: if we cannot build a non-empty gate (knower unresolved), write NO cold
    // entry — a null/empty characterFilter would leak the fact to every character.
    if (!cf || !Array.isArray(cf.names) || cf.names.length === 0) return null;
    const characterFilter = { isExclude: false, names: cf.names, tags: cf.tags || [] };
    const content = `${charName} ${PHRASE[item.tag]} about ${item.about}: ${item.fact}.`;
    const metadata = {
        STMB_deep: true,
        STMB_deepTag: item.tag,
        STMB_deepAbout: item.about,
        STMB_deepReason: item.reason || '',
        STMB_deepSince: opts.updateNum ?? null,
    };
    if (item.tag === 'believes') metadata.STMB_deepFalse = true;
    return { title: coldFactTitle(charName, item), content, keys: [item.about], characterFilter, metadata };
}

/**
 * Eviction -> cold store. PURE via injected deps:
 *   deps.resolveBookName(tpl) -> string
 *   deps.ensureBook(name)     -> Promise<lorebookData>
 *   deps.upsertByTitle(name, data, title, content, opts) -> Promise<any>
 */
export async function writeDeepFacts({ tpl, charTarget, resultText, rosterRows, updateNum } = {}, deps) {
    if (!tpl?.settings?.deepSave?.enabled) return { written: 0, skipped: 'disabled' };
    if (!charTarget) return { written: 0, skipped: 'no-char' };
    const items = parseToDeepStorage(resultText);
    if (!items.length) return { written: 0 };
    const bookName = deps.resolveBookName(tpl);
    if (!bookName) return { written: 0, skipped: 'no-book' };
    const since = updateNum ?? parseUpdateNum(resultText);
    const data = await deps.ensureBook(bookName);
    let written = 0;
    for (const item of items) {
        const entry = buildColdFactEntry(item, charTarget, rosterRows, { updateNum: since });
        if (!entry) continue;
        await deps.upsertByTitle(bookName, data, entry.title, entry.content, {
            defaults: { vectorized: true },
            entryOverrides: { key: entry.keys, characterFilter: entry.characterFilter, ...entry.metadata },
        });
        written++;
    }
    return { written, bookName };
}
