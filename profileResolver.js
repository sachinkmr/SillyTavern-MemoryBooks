/**
 * Safe profile resolution for STMemoryBooks.
 * PURE module — no SillyTavern imports; Node-testable.
 *
 * Stored profile indices (settings.defaultProfile, side-prompt
 * overrideProfileIndex, popup select values) can go stale: missing key
 * (undefined), NaN from parseInt, or out-of-range after profiles were
 * deleted/reset. Indexing profiles[] with such a value yields undefined and
 * unguarded dereferences (e.g. `.useDynamicSTSettings`) crash the UI.
 */

/**
 * Resolve a profile by index, falling back safely when the index is stale.
 * Fallback order: exact index → builtin "Current SillyTavern Settings"
 * profile → first profile → null (only when no profiles exist at all).
 *
 * @param {{profiles?: Array<object>}|null|undefined} settings STMemoryBooks settings object
 * @param {number|undefined|null} index Stored profile index (may be undefined/NaN/out-of-range)
 * @returns {object|null} A profile object, or null when settings has no profiles
 */
export function getProfileSafe(settings, index) {
    const profiles = Array.isArray(settings?.profiles) ? settings.profiles : [];
    return profiles[index]
        ?? profiles.find(p => p?.isBuiltinCurrentST)
        ?? profiles[0]
        ?? null;
}
