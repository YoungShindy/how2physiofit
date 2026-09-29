// Statische Prüfungen ohne Browser: Daten, Verweise auf Dateien, Manifest, Service Worker, JS-Syntax.
// Ausführen: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => existsSync(path.join(ROOT, f));
const isExternal = (s) => /^(https?:|data:)/i.test(s);

const data = JSON.parse(read('data.json'));

function walk(nodes, fn, trail = []) {
  for (const node of nodes) {
    fn(node, trail);
    walk(node.children || [], fn, [...trail, node.id]);
  }
}

test('data.json: Grundstruktur (subjects, regions)', () => {
  assert.ok(Array.isArray(data.subjects) && data.subjects.length > 0, 'subjects fehlt oder leer');
  assert.ok(Array.isArray(data.regions) && data.regions.length > 0, 'regions fehlt oder leer');
  for (const r of data.regions) {
    assert.equal(typeof r.id, 'string', 'Gebiet ohne id');
    assert.equal(typeof r.title, 'string', `Gebiet ${r.id} ohne title`);
  }
});

test('data.json: Knoten haben id/title/children, IDs sind eindeutig', () => {
  const seen = new Set();
  walk(data.subjects, (n, trail) => {
    const where = [...trail, n.id].join(' > ');
    assert.equal(typeof n.id, 'string', `Knoten ohne id unter ${trail.join(' > ')}`);
    assert.ok(n.id.length > 0, `leere id unter ${trail.join(' > ')}`);
    assert.equal(typeof n.title, 'string', `Knoten ohne title: ${where}`);
    assert.ok(Array.isArray(n.children), `children ist kein Array: ${where}`);
    assert.ok(!seen.has(n.id), `doppelte id: ${n.id}`);
    seen.add(n.id);
  });
});

test('data.json: Einträge mit Inhalt haben gültige media/sections/regions', () => {
  const regionIds = new Set(data.regions.map((r) => r.id));
  walk(data.subjects, (n) => {
    if (!n.detail) return;
    const d = n.detail;
    const media = typeof d.media === 'string' ? [d.media] : d.media ?? [];
    assert.ok(Array.isArray(media), `${n.id}: media muss String oder Array sein`);
    for (const m of media) assert.equal(typeof m, 'string', `${n.id}: media-Eintrag ist kein String`);

    for (const s of d.sections ?? []) {
      assert.equal(typeof s.heading, 'string', `${n.id}: Abschnitt ohne heading`);
      assert.ok(s.text || s.bullets, `${n.id}: "${s.heading}" hat weder text noch bullets`);
      for (const b of s.bullets ?? []) assert.equal(typeof b, 'string', `${n.id}: bullet ist kein String`);
    }
    for (const r of d.regions ?? []) {
      assert.ok(regionIds.has(r), `${n.id}: unbekanntes Gebiet "${r}"`);
    }
  });
});

test('data.json: alle lokalen Videos/Bilder existieren', () => {
  const missing = [];
  walk(data.subjects, (n) => {
    const media = n.detail ? (typeof n.detail.media === 'string' ? [n.detail.media] : n.detail.media ?? []) : [];
    for (const m of media) if (!isExternal(m) && !exists(m)) missing.push(`${n.id}: ${m}`);
    if (n.image && !isExternal(n.image) && !exists(n.image)) missing.push(`${n.id}: ${n.image}`);
  });
  for (const r of data.regions) {
    if (r.image && !isExternal(r.image) && !exists(r.image)) missing.push(`Gebiet ${r.id}: ${r.image}`);
  }
  assert.deepEqual(missing, [], `Fehlende Dateien:\n${missing.join('\n')}`);
});

test('manifest.json: gültig, start_url und Icons existieren', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.ok(m.name && m.short_name, 'name/short_name fehlt');
  assert.ok(exists(m.start_url.replace(/^\.\//, '')), `start_url fehlt: ${m.start_url}`);
  assert.ok(m.icons?.length, 'keine Icons');
  for (const icon of m.icons) assert.ok(exists(icon.src), `Icon fehlt: ${icon.src}`);
});

test('sw.js: Syntax ok, alle CORE_ASSETS existieren', () => {
  execFileSync(process.execPath, ['--check', path.join(ROOT, 'sw.js')]);
  const src = read('sw.js');
  const block = src.match(/CORE_ASSETS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(block, 'CORE_ASSETS nicht gefunden');
  const assets = [...block[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.ok(assets.length > 0);
  for (const a of assets) {
    const file = a === './' ? 'index.html' : a.replace(/^\.\//, '');
    assert.ok(exists(file), `CORE_ASSET fehlt: ${a}`);
  }
});

for (const page of ['index.html', 'physio-app.html']) {
  test(`${page}: Inline-JavaScript hat keine Syntaxfehler`, () => {
    const html = read(page);
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((x) => x[1]);
    assert.ok(scripts.length > 0, 'kein Inline-Script gefunden');
    scripts.forEach((code, i) => {
      assert.doesNotThrow(() => new vm.Script(code, { filename: `${page}#script${i}` }));
    });
  });
}

test('index.html: verlinkt Manifest, Icons und registriert den Service Worker', () => {
  const html = read('index.html');
  assert.match(html, /rel=["']manifest["']/, 'Manifest nicht verlinkt');
  assert.match(html, /serviceWorker\.register\(['"]sw\.js['"]\)/, 'Service Worker nicht registriert');
  for (const [, href] of html.matchAll(/<link[^>]+href=["']([^"']+)["']/g)) {
    if (!isExternal(href)) assert.ok(exists(href), `verlinkte Datei fehlt: ${href}`);
  }
});
