/**
 * Witness scoping for per-character side prompts (actor tracker).
 * PURE module — no SillyTavern imports; callers pass the live chat array.
 *
 * audience = lowercase perceiver names stamped by SillyTavern-StateTracker on
 * msg.extra.channel.audience (includes remote/texting participants). Contract
 * is FAIL-OPEN: a message with no stamp is witnessed by everyone — identical
 * semantics to Smart-Memory's witness.js, so all three extensions agree.
 */

/** Lowercased audience array for a message, or null when unstamped. */
export function audienceOf(message) {
    const aud = message?.extra?.channel?.audience;
    return Array.isArray(aud) ? aud.map(n => String(n).toLowerCase()) : null;
}

/** True when charName witnessed the message (fail-open on unstamped). */
export function messageWitnessedBy(message, charName) {
    const aud = audienceOf(message);
    if (!aud) return true;
    return aud.includes(String(charName || '').trim().toLowerCase());
}

/**
 * Presence gate: is charName present in chat[start..end]?
 * Present = named in any non-system message's audience stamp (covers remote/
 * texting participants), OR authored a non-system, non-user bubble in the
 * window (fallback that also works in chats without StateTracker stamps).
 */
export function isPresentInWindow(charName, chat, start, end) {
    const target = String(charName || '').trim().toLowerCase();
    if (!target || !Array.isArray(chat)) return false;
    const lo = Math.max(0, start | 0);
    const hi = Math.min(chat.length - 1, end | 0);
    for (let i = lo; i <= hi; i++) {
        const m = chat[i];
        if (!m || m.is_system) continue;
        const aud = audienceOf(m);
        if (aud && aud.includes(target)) return true;
        if (!m.is_user && String(m.name || '').trim().toLowerCase() === target) return true;
    }
    return false;
}

/**
 * Return a NEW compiledScene containing only messages charName witnessed.
 * compiledMessage.id is the chat index (set by compileScene) — used to join
 * back to the live message for its stamp. metadata.messageCount is updated;
 * metadata.witnessFiltered records how many messages were dropped.
 */
export function filterCompiledSceneForCharacter(compiledScene, chat, charName) {
    const all = compiledScene?.messages || [];
    const messages = all.filter(cm => messageWitnessedBy(chat?.[cm.id], charName));
    return {
        ...compiledScene,
        messages,
        metadata: {
            ...(compiledScene?.metadata || {}),
            messageCount: messages.length,
            witnessFiltered: all.length - messages.length,
        },
    };
}
