/*
 * NimNote test suite — runs the REAL Nim-generated bundle (js/nncore.js)
 * in Node via indirect eval (the bundle exposes globals; require() would hide them).
 * Covers: known-answer search vectors, accent folding, ranking, snippets,
 * store round-trips, corrupt/missing input handling, i18n parity, PWA sanity.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- load the real engine -------------------------------------------------
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', 'nncore.js'), 'utf8'));
assert.strictEqual(typeof nn_api, 'function', 'nn_api global missing from nncore.js');

const J = (o) => JSON.stringify(o);
const call = (action, payload) => JSON.parse(nn_api(action, typeof payload === 'string' ? payload : J(payload)));

const S = [
  { id: 'a', title: 'Café com leite', body: 'receita da vovó, duas xícaras de leite', tags: 'cozinha,casa', created: 1, updated: 100 },
  { id: 'b', title: 'Reunião do projeto', body: 'pauta: deploy zig e revisão do budget', tags: 'trabalho', created: 2, updated: 300 },
  { id: 'c', title: 'Senha do cofre', body: 'LEMBRETE: nunca anotar senhas em apps de notas', tags: '', created: 3, updated: 200 }
];

// ---- version / API shape --------------------------------------------------
test('engine version is exposed and positive', () => {
  assert.strictEqual(typeof nn_version, 'function');
  assert.ok(nn_version() >= 1);
});

test('unknown action returns structured error (no crash)', () => {
  const r = call('wat', {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'unknown-action');
});

// ---- search ---------------------------------------------------------------
test('accent-insensitive: "cafe" finds "Café" (pt-BR folding)', () => {
  const r = call('search', { state: S, q: 'cafe' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.total >= 1);
  assert.strictEqual(r.results[0].id, 'a');
  assert.strictEqual(r.results[0].inTitle, true);
});

test('exact phrase in title outranks body-only hit', () => {
  const st = [
    { id: 'x', title: 'Random thoughts', body: 'mentions zigbee once', tags: '', created: 1, updated: 999 },
    { id: 'y', title: 'Zig notes', body: 'nothing relevant here at all', tags: '', created: 1, updated: 5 }
  ];
  const r = call('search', { state: st, q: 'zig' });
  assert.strictEqual(r.results[0].id, 'y');
  assert.strictEqual(r.results[0].inTitle, true);
});

test('word-prefix hits keep results while typing ("dep" -> deploy)', () => {
  const r = call('search', { state: S, q: 'dep' });
  assert.ok(r.total >= 1);
  const ids = r.results.map((x) => x.id);
  assert.ok(ids.includes('b'));
});

test('multi-word query ANDs across fields ("reuniao budget")', () => {
  const r = call('search', { state: S, q: 'reuniao budget' });
  assert.ok(r.total >= 1);
  assert.strictEqual(r.results[0].id, 'b');
});

test('tags are searchable ("cozinha")', () => {
  const r = call('search', { state: S, q: 'cozinha' });
  assert.strictEqual(r.results[0].id, 'a');
});

test('empty query = recency listing (all notes, newest first)', () => {
  const r = call('search', { state: S, q: '' });
  assert.strictEqual(r.total, 3);
  const ups = r.results.map((x) => x.updated);
  assert.deepStrictEqual(ups, [...ups].sort((a, b) => b - a));
});

test('no-match query returns empty result set', () => {
  const r = call('search', { state: S, q: 'zzzznotfound' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.total, 0);
});

test('snippet anchors around the match and keeps raw accents', () => {
  const r = call('search', { state: S, q: 'xícaras' });
  const sn = r.results[0].snippet;
  assert.ok(typeof sn === 'string' && sn.length > 0);
  // normalized query folded the accent but snippet must show RAW text
  assert.ok(sn.includes('xícaras'), `snippet lost raw text: ${sn}`);
});

// ---- upsert ---------------------------------------------------------------
test('upsert creates note with generated id and preserves existing state', () => {
  const before = S.length;
  const r = call('upsert', { note: { title: 'Nova nota', body: 'texto' }, now: 1724550000000, state: S });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.state.length, before + 1);
  const created = r.state[r.state.length - 1];
  assert.strictEqual(created.id, r.id);
  assert.match(created.id, /^[a-z0-9]{6,10}$/);
});

test('upsert edits in place keeping identity (same id)', () => {
  const st = [{ id: 'k1', title: 'Old', body: 'old body', tags: '', created: 5, updated: 5 }];
  const r = call('upsert', { note: { id: 'k1', title: 'New', body: 'new body' }, now: 777, state: st });
  assert.strictEqual(r.state.length, 1);
  assert.strictEqual(r.state[0].title, 'New');
  assert.strictEqual(r.state[0].created, 5, 'created must not change on edit');
  assert.strictEqual(r.state[0].updated, 777);
});

test('two upserts in the same ms get DIFFERENT ids (salted ids)', () => {
  let st = [];
  const a = call('upsert', { note: { title: 'one' }, now: 42, state: st });
  const b = call('upsert', { note: { title: 'two' }, now: 42, state: a.state });
  assert.notStrictEqual(a.id, b.id);
});

test('upsert rejects fully empty notes with localized-safe error key', () => {
  const r = call('upsert', { note: { title: '', body: '' } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'empty-note');
});

test('upsert accepts tags as array too', () => {
  const r = call('upsert', { note: { title: 't', tags: ['work', 'urgent'] }, now: 9 });
  const created = r.state.find((n) => n.id === r.id);
  assert.strictEqual(created.tags, 'work,urgent');
});

// ---- delete ---------------------------------------------------------------
test('delete removes by id and reports what happened', () => {
  const r = call('delete', { id: 'b', state: S });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.state.length, 2);
  assert.ok(!r.state.some((n) => n.id === 'b'));
});

test('delete of unknown id reports ok=false and keeps state intact', () => {
  const r = call('delete', { id: 'ghost', state: S });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.state.length, S.length);
});

// ---- robustness -----------------------------------------------------------
test('corrupt payload JSON -> structured bad-json error, no throw', () => {
  const r = call('search', '{bad json');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'bad-json');
});

test('corrupt state inside valid payload -> treated as empty store', () => {
  const r = call('search', { state: '{oops', q: 'cafe' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.total, 0);
});

test('missing fields everywhere -> graceful errors, never a crash', () => {
  assert.strictEqual(call('upsert', '{}').error, 'missing-note');
  assert.strictEqual(call('delete', {}).ok, false);
  assert.strictEqual(call('search', {}).total, 0);
});

test('validate flags oversized bodies', () => {
  assert.strictEqual(call('validate', { body: 'x'.repeat(19999) }).ok, true);
  assert.strictEqual(call('validate', { body: 'x'.repeat(20001) }).ok, false);
});

test('state round-trip: upsert output feeds back into search', () => {
  const u = call('upsert', { note: { title: 'Roundtrip café', body: 'buscavel', tags: 'teste' }, now: 555, state: [] });
  const s = call('search', { state: u.state, q: 'roundtrip' });
  assert.strictEqual(s.total, 1);
  assert.strictEqual(s.results[0].title, 'Roundtrip café');
});

// ---- assets / i18n / PWA ---------------------------------------------------
test('locales en vs pt-BR have identical key sets', () => {
  const all = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'i18n.json'), 'utf8'));
  const en = Object.keys(all.en).sort();
  const pt = Object.keys(all['pt-BR']).sort();
  assert.notStrictEqual(en.length, 0);
  assert.deepStrictEqual(en, pt);
});

test('index.html references every core asset and they exist', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const asset of ['js/nncore.js', 'js/app.js', 'js/i18n.js', 'css/style.css', 'manifest.json']) {
    assert.ok(html.includes(asset), `index.html missing ${asset}`);
    assert.ok(fs.existsSync(path.join(__dirname, '..', asset)), `${asset} missing on disk`);
  }
  // locales are fetched by i18n.js at runtime
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'js', 'i18n.js'), 'utf8');
  assert.ok(i18n.includes('locales/i18n.json'));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'locales', 'i18n.json')));
});

test('service worker has valid cache placeholder + registration hook exists', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.ok(sw.includes('__NN_CACHE_VERSION__'));
  assert.ok(!sw.includes("''"), 'double-quoted empty string regression');
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.ok(app.includes('serviceWorker.register'));
});
