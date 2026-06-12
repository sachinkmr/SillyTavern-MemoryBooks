/**
 * Per-character interval gate for onInterval side prompts.
 * PURE module — no SillyTavern imports; callers pass the live chat array,
 * the resolved lorebook data, and title-derivation deps. This mirrors the
 * checkpoint identity the WRITER uses (getPerCharacterTitle / checkpointSuffix
 * in sidePrompts.js) so the gate READ is symmetric with the per-character WRITE.
 */

/** Metadata checkpoint key for a (template, character) pair — matches the writer. */
export function perCharacterCheckpointKey(templateKey, charName) {
    return `STMB_sp_${templateKey}_${charName}_lastMsgId`;
}

/** Per-character lastRunAt metadata key — matches the writer. */
export function perCharacterRunAtKey(templateKey, charName) {
    return `STMB_sp_${templateKey}_${charName}_lastRunAt`;
}

/**
 * Lorebook lookup titles for a character's own tracker entry, in priority order.
 * deps.unifiedTitle(tpl) and deps.perCharTitle(base, charName) are injected so
 * this stays pure and uses the SAME derivation the writer/title helpers use.
 */
export function perCharacterLookupTitles(tpl, charName, deps) {
    // Pass charName so an entryTitleOverride containing {{char}}/{{charname}}
    // resolves to the SAME base the writer used (buildPerCharacterMacros).
    const base = deps.unifiedTitle(tpl, charName);
    return [deps.perCharTitle(base, charName)];
}

/** Template-level lookup titles (non-perCharacter path), un-suffixed. */
export function templateLookupTitles(tpl, deps) {
    return [deps.unifiedTitle(tpl, null)];
}

function findEntryByTitles(lore, titles) {
    const entries = lore?.entries ? Object.values(lore.entries) : [];
    for (const title of titles) {
        for (const entry of entries) {
            if ((entry.comment || '') === title) return entry;
        }
    }
    return null;
}

/**
 * Resolve the checkpoint (lastMsgId + lastRunAt) for a given character against
 * the lorebook. For a per-character run (charName set) this reads the SUFFIXED
 * title and the per-character checkpoint key; for charName null it reads the
 * un-suffixed template-level title/keys. Falls back to deps.baseline when no
 * checkpoint exists (mirrors getHighestProcessedMessageBaseline()).
 */
export function resolveCharacterCheckpoint(lore, tpl, charName, deps) {
    const titles = charName
        ? perCharacterLookupTitles(tpl, charName, deps)
        : templateLookupTitles(tpl, deps);
    const entry = findEntryByTitles(lore, titles);

    const msgIdKey = charName
        ? perCharacterCheckpointKey(tpl.key, charName)
        : `STMB_sp_${tpl.key}_lastMsgId`;
    const runAtKey = charName
        ? perCharacterRunAtKey(tpl.key, charName)
        : `STMB_sp_${tpl.key}_lastRunAt`;

    const baseline = Number.isFinite(deps?.baseline) ? deps.baseline : -1;

    let lastMsgId = baseline;
    let lastRunAt = null;
    if (entry) {
        const stored = Number(
            entry[msgIdKey] ?? entry.STMB_tracker_lastMsgId,
        );
        if (Number.isFinite(stored)) lastMsgId = stored;
        const rawRunAt = entry[runAtKey] ?? entry.STMB_tracker_lastRunAt;
        if (rawRunAt) {
            const parsed = Date.parse(rawRunAt);
            if (Number.isFinite(parsed)) lastRunAt = parsed;
        }
    }
    return { entry, lastMsgId, lastRunAt };
}

/** Count non-system messages in chat at indices (exclusiveStart, inclusiveEnd]. */
export function countVisibleMessagesSince(chat, exclusiveStart, inclusiveEnd) {
    let count = 0;
    const start = Math.max(-1, Number.isFinite(exclusiveStart) ? exclusiveStart : -1);
    const end = Math.max(-1, inclusiveEnd);
    for (let i = start + 1; i <= end && i < chat.length; i++) {
        const m = chat[i];
        if (m && !m.is_system) count++;
    }
    return count;
}

export const DEBOUNCE_MS = 10_000;

/**
 * Decide whether the interval should fire for this character on this tick.
 * Symmetric with the per-character WRITE: reads THAT character's checkpoint,
 * measures visibleSince since its own last run, debounces per character, and
 * fires only when visibleSince >= threshold.
 */
export function shouldFireForCharacter({ lore, tpl, charName, chat, currentLast, now, deps }) {
    const { lastMsgId, lastRunAt } = resolveCharacterCheckpoint(lore, tpl, charName, deps);

    // Per-character debounce.
    if (lastRunAt && now - lastRunAt < DEBOUNCE_MS) return false;

    const threshold = Math.max(1, Number(tpl?.triggers?.onInterval?.visibleMessages ?? 50));
    // Stale checkpoint from a longer chat ⇒ treat as no checkpoint.
    const effectiveLastMsgId = lastMsgId > currentLast ? -1 : lastMsgId;
    const visibleSince = countVisibleMessagesSince(chat, effectiveLastMsgId, currentLast);
    return visibleSince >= threshold;
}
