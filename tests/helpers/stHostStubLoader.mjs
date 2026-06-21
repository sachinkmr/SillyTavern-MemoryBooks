// tests/helpers/stHostStubLoader.mjs
//
// Phase 3 integration-test support. The Task-3 wiring lives in arcanalysis.js / index.js,
// which statically import SillyTavern HOST modules (../../../extensions.js, ../../../../script.js,
// ../../../world-info.js, etc.). Those paths resolve OUTSIDE the extension repo and do not exist
// under `node --test`, so the real arcanalysis.js could not be imported by the existing suite
// (which is why Task 3 was previously untested -> review finding #5).
//
// This is a generic ESM loader hook (registered via node:module.register from the test file).
// It intercepts any specifier that escapes the repo root (i.e. the SillyTavern host modules) and
// synthesizes a stub module on the fly. To satisfy ESM's strict named-import linking WITHOUT
// hard-coding the (large, growing) set of host exports, the resolve hook parses the importing
// file's `import { ... } from '<specifier>'` statement, extracts the requested binding names, and
// emits `export const <name> = <stub>` for each, plus a default export. Stubs are inert no-op
// functions / empty objects: these tests exercise the PURE transforms in arcanalysis.js
// (witness-prompt threading, characterFilter stamping), not network/UI behavior.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = new URL('../../', import.meta.url).href; // .../SillyTavern-MemoryBooks/

// A host specifier is a relative path that, resolved against its parent, lands OUTSIDE the repo.
function isHostSpecifier(resolvedHref) {
    return resolvedHref.startsWith('file:') && !resolvedHref.startsWith(REPO_ROOT);
}

// Parse the binding names imported from `specifier` in `parentSource`.
// Handles: `import { a, b as c } from 'X'`, `import * as ns from 'X'`,
//          `import def from 'X'`, `import def, { a } from 'X'`.
function parseImportedNames(parentSource, specifier) {
    const names = new Set();
    let wantsDefault = false;
    let wantsNamespace = false;
    // Iterate EVERY import statement, matching its clause AND its specifier in one regex so the
    // (lazy) clause capture can never span across an earlier import (the bug that mis-attributed
    // utils.js's names to i18n.js). `[^;]*?` forbids crossing a statement terminator.
    const re = /import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(parentSource)) !== null) {
        if (m[2] !== specifier) continue;
        const clause = m[1].trim();
        // namespace: * as ns
        if (/\*\s+as\s+[A-Za-z_$][\w$]*/.test(clause)) wantsNamespace = true;
        // braces: { a, b as c }
        const braceMatch = clause.match(/\{([\s\S]*?)\}/);
        if (braceMatch) {
            for (const part of braceMatch[1].split(',')) {
                const seg = part.trim();
                if (!seg) continue;
                // The EXPORT name (left of `as`) is what the stub must provide.
                const exported = seg.split(/\s+as\s+/)[0].trim();
                if (exported && /^[A-Za-z_$][\w$]*$/.test(exported)) names.add(exported);
            }
        }
        // default import: a leading bareword before any `{` or `*`
        const beforeBrace = clause.split(/[{*]/)[0].trim().replace(/,$/, '').trim();
        if (beforeBrace && /^[A-Za-z_$][\w$]*$/.test(beforeBrace)) wantsDefault = true;
    }
    return { names: [...names], wantsDefault, wantsNamespace };
}

// Force-stubbed REPO modules: these reach into SillyTavern's live lorebook/UI layer, which has no
// node equivalent. We replace them with controllable capturing stubs. `upsertLorebookEntriesBatch`
// records every write into globalThis.__STMB_UPSERT_CALLS__ (synthesized stub modules run in the
// MAIN thread and share globalThis) so a test can assert exactly which entryOverrides were written
// (e.g. whether characterFilter was stamped). Keyed by the repo-relative module path.
const ADDLORE_STUB_SOURCE = `
// capturing stub for addlore.js (tests/helpers/stHostStubLoader.mjs)
export function applyLorebookEntrySettings(entry /*, settings, opts */) { return entry; }
export function normalizeLorebookEntrySettings(settings /*, defaults */) { return settings || {}; }
let __seq = 0;
export async function upsertLorebookEntriesBatch(lorebookName, lorebookData, entries /*, opts */) {
    globalThis.__STMB_UPSERT_CALLS__ = globalThis.__STMB_UPSERT_CALLS__ || [];
    const out = [];
    for (const e of (entries || [])) {
        const uid = 'stub-' + (++__seq);
        globalThis.__STMB_UPSERT_CALLS__.push({ lorebookName, entry: e, uid });
        out.push({ uid });
    }
    return out;
}
`;

// Host exports that hold SHARED MUTABLE STATE the test needs to configure (e.g. the two-plane
// flag lives at extension_settings.STMemoryBooks.moduleSettings.twoPlaneMemory). Because each
// distinct import name-set yields a distinct synthesized module instance, these are routed through
// a single globalThis slot so every consumer (arcanalysis.js, utils.js, ...) sees the same object
// and a test can flip the flag once. Inert callable stubs are used for everything else.
const SHARED_OBJECT_EXPORTS = {
    extension_settings: '__STMB_EXT_SETTINGS__',
};

function buildStubSource(names) {
    const lines = [
        '// synthesized host stub (tests/helpers/stHostStubLoader.mjs)',
        'const __obj = {};',
    ];
    for (const n of names) {
        if (Object.prototype.hasOwnProperty.call(SHARED_OBJECT_EXPORTS, n)) {
            const slot = SHARED_OBJECT_EXPORTS[n];
            lines.push(`globalThis.${slot} = globalThis.${slot} || {};`);
            lines.push(`export const ${n} = globalThis.${slot};`);
            continue;
        }
        // Provide a callable+indexable stub so either usage shape is inert.
        lines.push(`export const ${n} = (() => { const f = function ${/^[A-Za-z_$][\w$]*$/.test(n) ? n : 'x'}() {}; return f; })();`);
    }
    lines.push('export default __obj;');
    return lines.join('\n');
}

export async function resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith('.') || specifier.startsWith('/');
    // Compute the would-be target URL ourselves (the host file may not exist on disk, so the
    // default resolver would throw before we get a chance to classify it as a host specifier).
    let targetHref = null;
    if (isRelative && context.parentURL) {
        try {
            targetHref = new URL(specifier, context.parentURL).href;
        } catch {}
    }
    // Force-stub specific REPO modules that need controllable test doubles.
    if (isRelative && targetHref && targetHref.startsWith(REPO_ROOT) && targetHref.endsWith('/addlore.js')) {
        const dataUrl = 'data:text/javascript,' + encodeURIComponent(ADDLORE_STUB_SOURCE);
        return { url: dataUrl, shortCircuit: true, format: 'module' };
    }
    if (isRelative && targetHref && isHostSpecifier(targetHref)) {
        // Parse names from the importing file so the stub exports exactly what's linked.
        let names = [];
        try {
            if (context.parentURL && context.parentURL.startsWith('file:')) {
                const src = readFileSync(fileURLToPath(context.parentURL), 'utf8');
                names = parseImportedNames(src, specifier).names;
            }
        } catch {}
        const source = buildStubSource(names);
        const dataUrl = 'data:text/javascript,' + encodeURIComponent(source);
        return { url: dataUrl, shortCircuit: true, format: 'module' };
    }
    return nextResolve(specifier, context);
}
