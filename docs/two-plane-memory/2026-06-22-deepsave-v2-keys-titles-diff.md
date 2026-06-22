# Diff-doc — Deep-save v2: salient-noun keys + readable per-char titles

**Status:** APPLIED 2026-06-22 to the live store
`data/default-user/user/files/stmb-side-prompts.json` (`epistemic-tracker`), verified by
structural diff (only `prompt` + `responseFormat` changed).
Backup: `stmb-side-prompts.json.bak-20260622-deepsave-v2`.
The 23 existing `🏠 TWW2 - Deep Facts` entries were migrated to the new keys/title scheme
via `/tmp/migrate_deepfacts.py --apply` (book backed up alongside).
**Pending (user):** hard-reload ST to pick up the new bundle + prompt + migrated book.

**Why.** Shipped deep-save set each cold entry's `key` to the single `about` name
(`plane2.js: keys: [item.about]`), diverging from spec §5 ("keys = salient names/nouns").
Investigation of the live `🏠 TWW2 - Deep Facts` book confirmed every entry was keyed to
just `Shilpa`/`Sachin`. Because ST keyword-scans vectorized entries too (verified against
`world-info.js` `checkWorldInfo`: the scan loop has **no** `entry.vectorized` guard — a
vectorized entry is activated by vector-similarity **OR** keyword match), a bare
ever-present character name keyword-fires the whole bucket every turn. Fix: the tracker
emits 2-4 salient keywords per evicted fact; `plane2.js` uses them as the entry `key`.

Companion code change (no prompt impact): titles become `"<char>: Fact <N>: <summary>"`
with per-character sequential `N`, dedup/stability carried by `STMB_deepKey`
(content hash) + `STMB_deepNum` in metadata (see `plane2.js`, `tests/plane2.test.js`).

## Edit 1 — responseFormat: add the keys column to the To Deep Storage line

- BEFORE:
  `- knows|believes|suspects | [about whom] | [fact, paraphrased] | resolved|distant`
- AFTER:
  `- knows|believes|suspects | [about whom] | [fact, paraphrased] | resolved|distant | [2-4 salient keywords: concrete nouns + others' names, comma-separated]`

## Edit 2 — prompt: instruct emitting the keys column

- BEFORE (substring, unique):
  ``MOVE it to `## To Deep Storage` — it leaves the hot sections (do NOT also list it above).``
- AFTER:
  ``MOVE it to `## To Deep Storage` — it leaves the hot sections (do NOT also list it above); on that line append a final pipe column of 2-4 salient keywords (concrete nouns and other people's names from the fact — NOT the knower's own name) so the archived fact is retrievable by topic, not just by name.``

No other fields change (structural diff asserts only `prompt` + `responseFormat`).
