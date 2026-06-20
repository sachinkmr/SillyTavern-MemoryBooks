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

/**
 * True when charName witnessed the message (fail-open on unstamped).
 * charName must be the stamp-token form (lowercased perceiver name as stamped by StateTracker); callers resolve {{user}}/persona to that token first.
 */
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
 * charName must be the stamp-token form (lowercased perceiver name as stamped by StateTracker); callers resolve {{user}}/persona to that token first.
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

/** Unreal-scene reality tags that memory must NOT ingest (mirrors StateTracker). */
const UNREAL_REALITIES = new Set(['dream', 'flashback', 'story']);

/** Lowercased reality tag for a message ('dream'|'flashback'|'story'|...), or null. */
export function realityOf(message) {
    const r = message?.extra?.channel?.reality;
    return r ? String(r).toLowerCase() : null;
}

/** True when the message is an unreal scene memory must skip. */
export function isUnreal(message) {
    const r = realityOf(message);
    return r !== null && UNREAL_REALITIES.has(r);
}

/** Return a new array with unreal-tagged messages removed. */
export function dropUnrealMessages(messages) {
    return (Array.isArray(messages) ? messages : []).filter(m => !isUnreal(m));
}

/**
 * Return a NEW compiledScene with unreal-tagged messages removed.
 * Joins each compiledMessage to the live chat via cm.id (compiled clones drop extra.channel).
 */
export function dropUnrealFromCompiledScene(compiledScene, chat) {
    const all = compiledScene?.messages || [];
    const messages = all.filter(cm => !isUnreal(chat?.[cm.id]));
    return {
        ...compiledScene,
        messages,
        metadata: {
            ...(compiledScene?.metadata || {}),
            messageCount: messages.length,
            unrealFiltered: all.length - messages.length,
        },
    };
}

/**
 * Return a NEW compiledScene keeping only messages witnessed by EVERY name in audience
 * (fail-open per token via messageWitnessedBy). Empty audience keeps all messages.
 * audience entries are stamp-token form (lowercased); join is via cm.id -> chat.
 */
export function filterCompiledSceneForAudience(compiledScene, chat, audience) {
    const aud = Array.isArray(audience) ? audience : [];
    const all = compiledScene?.messages || [];
    const messages = all.filter(cm => aud.every(a => messageWitnessedBy(chat?.[cm.id], a)));
    return {
        ...compiledScene,
        messages,
        metadata: {
            ...(compiledScene?.metadata || {}),
            messageCount: messages.length,
            audienceFiltered: all.length - messages.length,
        },
    };
}
