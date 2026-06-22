// plane2.js — PURE Epistemic deep-save helpers (Plane-2c). No SillyTavern imports.
// All ST impurity (load/save/upsert) is injected via `deps` into writeDeepFacts.
import { buildEntryCharacterFilter } from './memoryEntry.js';

/** Parse the "## To Deep Storage" section -> [{tag, about, fact, reason, keys}].
 *  Line format (keys field optional, 5th pipe column, comma-separated):
 *    - <tag> | <about> | <fact> | <reason> | <key, key, ...>
 *  Malformed lines (fewer than 4 columns, or missing tag/about/fact) are skipped. */
export function parseToDeepStorage(text) {
    const out = [];
    let inSection = false;
    for (const raw of String(text || '').split('\n')) {
        const line = raw.trim();
        if (/^##\s+/.test(line)) { inSection = /^##\s+to\s+deep\s+storage\b/i.test(line); continue; }
        if (!inSection || !line.startsWith('-')) continue;
        const parts = line.replace(/^-\s*/, '').split('|').map(s => s.trim());
        if (parts.length < 4) continue;
        const [tag, about, fact, reason, keysRaw] = parts;
        if (!tag || !about || !fact) continue;
        out.push({
            tag: tag.toLowerCase(),
            about,
            fact,
            reason: (reason || '').toLowerCase(),
            keys: parseKeyList(keysRaw),
        });
    }
    return out;
}

/** Split a "a, b, c" key list into a trimmed, de-duplicated array (case preserved). */
function parseKeyList(s) {
    const seen = new Set();
    const out = [];
    for (const k of String(s || '').split(',').map(x => x.trim()).filter(Boolean)) {
        const lc = k.toLowerCase();
        if (seen.has(lc)) continue;
        seen.add(lc);
        out.push(k);
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

/** FNV-1a 32-bit hash → short hex string. Pure, no imports. */
function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/** Normalize a fact for dedup (lowercase, collapse whitespace, trim). */
function normalizeFact(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Stable content-dedup key for a fact (independent of title/number/summary). */
export function deepKeyOf(item) {
    return fnv1a(normalizeFact(item && item.fact));
}

/** Proper-noun-ish tokens (Capitalized words) in a string. */
function properNouns(s) {
    return String(s || '').match(/\b[A-Z][a-zA-Z]+\b/g) || [];
}

/** Fallback keys when the tracker did not emit a salient-noun list:
 *  the subject (`about`) plus any proper nouns in the fact. De-duped, case preserved. */
function deriveKeysFallback(item) {
    const seen = new Set();
    const out = [];
    const push = (w) => { const lc = String(w).toLowerCase(); if (w && !seen.has(lc)) { seen.add(lc); out.push(w); } };
    if (item.about) push(item.about);
    for (const w of properNouns(item.fact)) push(w);
    return out;
}

/** Deterministic 2-5 word summary for the title (first ~5 words, trailing punctuation stripped). */
function deriveSummary(fact, maxWords = 5) {
    const words = String(fact || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    return words.slice(0, maxWords).join(' ').replace(/[.,;:!?]+$/, '');
}

/** Human-readable, per-character title: "Shilpa: Fact 3: led Sachin to a café". */
export function coldFactTitle(charName, num, summary) {
    return `${charName}: Fact ${num}: ${summary}`;
}

/** Cold-fact lorebook entry gated to the knower. null if tag not cold-eligible or knower ungateable.
 *  opts: { updateNum, factNum, titleOverride } */
export function buildColdFactEntry(item, charTarget, rosterRows, opts = {}) {
    if (!item || !charTarget || !isDeepSaveEligible(item.tag)) return null;
    const charName = String(charTarget.name);
    const cf = buildEntryCharacterFilter([charName.toLowerCase()], rosterRows);
    // Witness fail-safe: if we cannot build a non-empty gate (knower unresolved), write NO cold
    // entry — a null/empty characterFilter would leak the fact to every character.
    if (!cf || !Array.isArray(cf.names) || cf.names.length === 0) return null;
    const characterFilter = { isExclude: false, names: cf.names, tags: cf.tags || [] };

    const keys = (Array.isArray(item.keys) && item.keys.length) ? item.keys.slice() : deriveKeysFallback(item);
    const summary = opts.summary != null ? String(opts.summary) : deriveSummary(item.fact);
    const factNum = opts.factNum;
    const title = opts.titleOverride != null ? String(opts.titleOverride) : coldFactTitle(charName, factNum, summary);

    const content = `${charName} ${PHRASE[item.tag]} about ${item.about}: ${item.fact}.`;
    const metadata = {
        STMB_deep: true,
        STMB_deepTag: item.tag,
        STMB_deepAbout: item.about,
        STMB_deepReason: item.reason || '',
        STMB_deepSince: opts.updateNum ?? null,
        STMB_deepChar: charName,
        STMB_deepNum: factNum ?? null,
        STMB_deepKey: deepKeyOf(item),
        STMB_deepKeys: keys.slice(),
    };
    if (item.tag === 'believes') metadata.STMB_deepFalse = true;
    return { title, content, keys, characterFilter, metadata };
}

/** Index existing deep entries for one knower: { byKey: Map<deepKey,{num,title}>, maxNum }. */
function indexDeepBook(data, charName) {
    const byKey = new Map();
    let maxNum = 0;
    const entries = (data && data.entries) || {};
    for (const e of Object.values(entries)) {
        if (!e || !e.STMB_deep) continue;
        if (e.STMB_deepChar && e.STMB_deepChar !== charName) continue;
        const num = Number(e.STMB_deepNum);
        if (Number.isFinite(num)) maxNum = Math.max(maxNum, num);
        if (e.STMB_deepKey) byKey.set(String(e.STMB_deepKey), { num: Number.isFinite(num) ? num : null, title: e.comment });
    }
    return { byKey, maxNum };
}

/**
 * Eviction -> cold store. PURE via injected deps:
 *   deps.resolveBookName(tpl) -> string
 *   deps.ensureBook(name)     -> Promise<lorebookData>
 *   deps.upsertByTitle(name, data, title, content, opts) -> Promise<any>
 *
 * Per-character sequential numbering (Fact 1, 2, 3…) is assigned on first write and kept
 * stable on re-eviction via STMB_deepKey (content hash) — same fact reuses its number+title.
 */
export async function writeDeepFacts({ tpl, charTarget, resultText, rosterRows, updateNum } = {}, deps) {
    if (!tpl?.settings?.deepSave?.enabled) return { written: 0, skipped: 'disabled' };
    if (!charTarget) return { written: 0, skipped: 'no-char' };
    const items = parseToDeepStorage(resultText).filter(it => isDeepSaveEligible(it.tag));
    if (!items.length) return { written: 0 };
    const bookName = deps.resolveBookName(tpl);
    if (!bookName) return { written: 0, skipped: 'no-book' };

    const charName = String(charTarget.name);
    // Per-knower gate depends only on charName — compute once; if ungateable, write nothing
    // (keeps Fact numbers contiguous, no wasted index).
    const cf = buildEntryCharacterFilter([charName.toLowerCase()], rosterRows);
    if (!cf || !Array.isArray(cf.names) || cf.names.length === 0) return { written: 0, skipped: 'no-gate' };

    const since = updateNum ?? parseUpdateNum(resultText);
    const data = await deps.ensureBook(bookName);
    const idx = indexDeepBook(data, charName);
    let counter = idx.maxNum;
    let written = 0;
    for (const item of items) {
        const deepKey = deepKeyOf(item);
        const existing = idx.byKey.get(deepKey);
        const factNum = existing && Number.isFinite(existing.num) ? existing.num : ++counter;
        const entry = buildColdFactEntry(item, charTarget, rosterRows, {
            updateNum: since, factNum, titleOverride: existing ? existing.title : null,
        });
        if (!entry) continue;
        await deps.upsertByTitle(bookName, data, entry.title, entry.content, {
            defaults: { vectorized: true },
            entryOverrides: { ...entry.metadata, key: entry.keys, characterFilter: entry.characterFilter },
        });
        // record so a duplicate item in the same run dedupes to the same number/title
        idx.byKey.set(deepKey, { num: factNum, title: entry.title });
        written++;
    }
    return { written, bookName };
}
