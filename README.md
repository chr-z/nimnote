# NimNote

**Instant-search local notes — the whole search engine is [Nim](https://nim-lang.org) compiled to JavaScript.**

[![CI](https://github.com/chr-z/nimnote/actions/workflows/ci.yml/badge.svg)](https://github.com/chr-z/nimnote/actions/workflows/ci.yml)
![Deploy](https://github.com/chr-z/nimnote/actions/workflows/pages.yml/badge.svg)

🔗 **Live demo: <https://chr-z.github.io/nimnote/>**

Write notes, tag them, and search as you type — accent-insensitive, ranked (title beats body), with match snippets. Everything is stored locally in your browser and the app works fully offline. No account, no server, no tracking.

## Why Nim?

Every language in this portfolio series earns its place by solving a real problem. Nim's pitch here:

- **Python-looking syntax, C-level output.** The engine (`engine/nncore.nim`, ~330 lines) compiles to a single dependency-free `.js` file via the built-in JS backend (`nim js`) — no Node toolchain, no bundler, no runtime shipped to users.
- **Type safety where it matters.** The JSON API boundary is wrapped in nil-safe accessors (`jkey`/`jstr`/`jint`), because the #1 source of client-side crashes is malformed input. Corrupt localStorage or a hand-edited payload degrades to structured errors instead of a white screen.
- **Compile-time folding of hot paths.** Accent-folding search over every keystroke runs against statically-typed strings and seqs; the compiler catches typos in field names at build time instead of at 2am in production.
- **A real statement piece.** "The search index for this notes app is written in a systems language" — and it's true: the same `nncore.nim` also compiles to native C binaries (`nim c`), so the engine can be reused server-side or in CLI tools unchanged.

## Features

- ⚡ Instant search-as-you-type with scoring: exact phrase > title hit > body/tag hit
- 🌎 Accent-insensitive matching (`cafe` finds `Café`) tuned for pt-BR
- 📝 Create / edit / delete notes with tags, timestamps and collision-safe ids
- 🧵 Match snippets anchored around the query
- 🌐 EN / pt-BR UI, switchable without reload
- 📴 Offline-first PWA (service worker precaches the whole app incl. the Nim bundle)
- 🔒 Zero network calls after load — your notes never leave the device

## Architecture

```
engine/nncore.nim   ← ALL logic: normalization, scoring, snippets, store ops (Nim)
      │ nim js -d:release
      ▼
js/nncore.js        ← generated bundle exposing nn_api(action, payloadJson) → json
js/app.js           ← DOM glue only (events, rendering, i18n wiring)
js/i18n.js          ← EN / pt-BR dictionary loader
sw.js               ← offline cache, version-stamped per deploy SHA by CI
```

The UI talks to the engine through **one JSON-in/JSON-out entry point**
(`nn_api('search'|'upsert'|'delete'|'validate', payload)`), so the engine stays
testable without a browser and portable to any host.

## Tests

25 tests run against the **real generated bundle** (not a reimplementation):

- known-answer vectors (accent folding, phrase-vs-word ranking, recency listing)
- store round-trips (upsert → state → search), id uniqueness under same-ms creation
- robustness: corrupt JSON, missing fields, oversized bodies — all graceful
- asset/i18n parity guards (EN ⇄ PT-BR key sets, PWA registration hooks)

```bash
node --test tests/*.test.mjs   # or: npm test
```

## Local development

Rebuilding the engine requires [Nim](https://nim-lang.org/install.html):

```bash
npm run build:engine   # nim js -d:release --out:js/nncore.js engine/nncore.nim
npm test               # suite against the fresh bundle
python3 -m http.server # or any static server → http://localhost:8000
```

The committed `js/nncore.js` keeps CI able to test/deploy even before Nim is installed.

## License

MIT — see [LICENSE](LICENSE).
