/** shell.js — PURE graded-perception shell helpers (Phase 2). No SillyTavern imports. */
import { buildEntryCharacterFilter } from './memoryEntry.js';

/** Read the directed-channel stamp from a segment's first stamped message (joins via cm.id). */
export function directedMetaForSegment(seg, chat) {
    for (const cm of (seg?.filteredScene?.messages || [])) {
        const ch = chat?.[cm.id]?.extra?.channel;
        if (ch && Array.isArray(ch.present_cast)) {
            return {
                present_cast: ch.present_cast.map(n => String(n).toLowerCase()),
                type: ch.type || 'room',
                from: String(ch.from || '').toLowerCase(),
                to: (ch.to || []).map(n => String(n).toLowerCase()),
                remote: (ch.remote || []).map(n => String(n).toLowerCase()),
            };
        }
    }
    return null;                                                      // not a directed segment
}

function displayName(token, rosterRows) {
    const r = (rosterRows || []).find(x => String(x.name).toLowerCase() === token);
    return r ? r.name : token;
}

/** Build the shell entry for bystanders, or null when there are none (E4). */
export function buildShellEntry(meta, contentAudience, rosterRows, opts = {}) {
    if (!meta) return null;
    const aud = (contentAudience || []).map(n => String(n).toLowerCase());
    const bystanders = meta.present_cast.filter(n => !aud.includes(n));
    if (!bystanders.length) return null;                             // E4/N10: no excluded observer
    const characterFilter = buildEntryCharacterFilter(bystanders, rosterRows);
    const fromName = displayName(meta.from, rosterRows);
    const toPresentNamed = meta.to.filter(t => !meta.remote.includes(t));     // present, non-remote targets
    let content;
    if (meta.type === 'whisper') {
        const tgt = meta.to.map(t => displayName(t, rosterRows)).join(' and ') || 'someone';
        content = `[Private exchange] ${fromName} whispered something to ${tgt}.`;
    } else { // 'text' / 'dm'
        if (toPresentNamed.length) {
            content = `[Private exchange] ${fromName} was texting ${toPresentNamed.map(t => displayName(t, rosterRows)).join(' and ')}.`;
        } else {
            content = `[Private exchange] ${fromName} was texting someone.`;   // U8: remote/absent target hidden
        }
    }
    return { content, suggestedKeys: [], characterFilter, shell: true, from: meta.from, to: meta.to };
}
