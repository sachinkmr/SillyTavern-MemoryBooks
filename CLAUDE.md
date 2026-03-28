# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SillyTavern-MemoryBooks is a SillyTavern extension that generates AI-driven chat memories and trackers, storing them as lorebook (world-info) entries. It lives under SillyTavern's `data/<user>/extensions/` directory and imports SillyTavern APIs via relative paths (`../../../../script.js`, `../../../extensions.js`, etc.).

## Build

```bash
bun run build          # Bundle index.js + style.css → index.build.js + style.build.css
```

- **Bun** is the package manager and bundler (configured in `build.ts`)
- Output: `index.build.js`, `index.build.js.map`, `style.build.css` (minified ESM, external sourcemap)
- Parent-directory imports (`../`) are externalized so SillyTavern code is not bundled
- **Pre-commit hook** (`hooks/pre-commit`) runs the build and stages artifacts automatically; commit fails if build fails or artifacts are missing
- `manifest.json` references the built files, not the source files
- There are no tests or linting configured

## Architecture

### Module Map

The extension is organized into focused modules that `index.js` (main controller, ~7300 lines) orchestrates:

| Module | Role |
|--------|------|
| `stmemory.js` | LLM communication — `sendRawCompletionRequest()` supporting OpenAI, Claude, Gemini, custom endpoints |
| `chatcompile.js` | Scene extraction — compiles message ranges into structured text |
| `addlore.js` | Lorebook writes — `upsertLorebookEntryByTitle()`, title formatting, auto-hide |
| `sceneManager.js` | Scene markers in chat metadata, button state management |
| `sidePrompts.js` | Side prompt execution — evaluates triggers, runs LLM, writes entries |
| `sidePromptsManager.js` | Side prompt template CRUD — file-based storage (`stmb-side-prompts.json`) |
| `sidePromptMacros.js` | Macro parsing/resolution for side prompt templates |
| `arcanalysis.js` | Multi-tier summarization (Memory→Arc→Chapter→Book→Legend→Series→Epic) |
| `summaryTiers.js` | Tier definitions and utilities |
| `summaryPromptManager.js` | Summary prompt file management (`stmb-summary-prompts.json`) |
| `arcAnalysisPromptManager.js` | Arc prompt file management (`stmb-arc-prompts.json`) |
| `autosummary.js` | Auto-summary triggering on message count intervals |
| `profileManager.js` | Multi-profile API connection management and UI |
| `confirmationPopup.js` | Memory preview/approval popups |
| `utils.js` | Shared utilities, error types, selectors, constants |
| `constants.js` | Magic numbers and configuration defaults |

### Memory Generation Flow

```
Scene marked (start/end messages)
  → chatcompile.js compiles messages
  → stmemory.js sends to LLM
  → confirmationPopup.js shows preview (optional)
  → addlore.js writes lorebook entry
  → sidePrompts.js runs onAfterMemory templates
  → arcanalysis.js consolidates if tier thresholds met
  → autosummary.js resets interval baseline
```

### Side Prompts (Trackers)

Templates with three trigger types:
- **onInterval**: fires after N visible messages
- **onAfterMemory**: fires after memory generation
- **commands**: manual via `/sideprompt "Name" [macros] [range]`

Templates are stored in `stmb-side-prompts.json` (file-based, not extension_settings). Per-chat disables are in scene manager metadata. Runtime macros (`{{npcname}}`, etc.) must be provided manually for command triggers; auto-triggers skip templates with unresolved macros.

### Settings Storage

- Extension settings: `extension_settings.STMemoryBooks` (synced via ST's `saveSettingsDebounced()`)
- Per-chat state: `chat_metadata` via `sceneManager.js` (`getSceneMarkers()`)
- Template files: `stmb-side-prompts.json`, `stmb-summary-prompts.json`, `stmb-arc-prompts.json` in ST user files

### SillyTavern Integration

Key ST APIs used:
- `eventSource.on(event_types.MESSAGE_RECEIVED | CHAT_CHANGED | ...)` for lifecycle hooks
- `extension_settings` / `saveSettingsDebounced()` for persistence
- `chat_metadata[METADATA_KEY]` for lorebook binding
- `loadWorldInfo()` / `saveWorldInfo()` / `reloadEditor()` for lorebook operations
- `SlashCommandParser.addCommandObject()` for slash commands
- `Popup` / `POPUP_TYPE` for modals
- `executeSlashCommands()` for hide/unhide operations

### Abort/Cancellation

Uses an epoch-based stop system: `createStmbInFlightTask()` creates an abort signal, `throwIfStmbStopped(runEpoch)` checks it. Custom error types: `StmbCancelledError`, `TokenWarningError`, `AIResponseError`.

## Working with Upstream

This is a fork. When pulling from upstream, merge conflicts are common due to the large `index.js` and committed build artifacts.

- **Rebase over merge**: `git pull --rebase upstream main` keeps fork commits on top with cleaner history
- **Build artifacts use `merge=ours`**: `.gitattributes` marks `index.build.js`, `index.build.js.map`, and `style.build.css` so they always keep ours during merge. Run `bun run build` after any merge/rebase to regenerate them.
- **Minimize index.js changes**: Keep new features in separate module files with a single import + init call in `index.js`. Fewer lines touched = fewer conflicts.
- **After rebase/merge**: Always `bun run build` to regenerate artifacts, then verify the extension loads in SillyTavern.

## Conventions

- **i18n**: `translate(fallback, 'STMemoryBooks_KeyName')` for all user-facing strings. HTML uses `data-i18n` attributes. Locale JSONs loaded dynamically by `locales.js`.
- **Logging**: Always prefix with `MODULE_NAME` — e.g., `console.error(\`${MODULE_NAME}: ...\`, err)`
- **Toasts**: `toastr.error(translate(...), 'STMemoryBooks')` for user-facing errors
- **Settings changes**: Always call `saveSettingsDebounced()` after mutation
- **LLM responses**: Parsed with `dirty-json` to handle imperfect JSON from AI
- **Slash commands**: Registered in `registerSlashCommands()` in index.js using `SlashCommand` / `SlashCommandArgument` classes
