// Browser-Smoketest: lädt die App in Chromium und klickt sich durch die Kernfunktionen.
// Braucht Playwright + Chromium. Ist beides nicht vorhanden, wird der Test übersprungen.
// Ausführen: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript',
  '.png': 'image/png', '.mp4': 'video/mp4',
};

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* nicht lokal installiert */ }
  try {
    return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
  } catch { return null; }
}

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const fixed = '/opt/pw-browsers/chromium';
  return existsSync(fixed) ? fixed : undefined; // sonst Playwrights eigener Browser
}

const data = JSON.parse(await readFile(path.join(ROOT, 'data.json'), 'utf8'));

// Titel-Pfad [Fach, Ordner…, Eintrag] zum ersten Eintrag mit Abschnitten (Tiefensuche)
function pathToFirstEntry(nodes, trail = []) {
  for (const n of nodes) {
    const here = [...trail, n.title];
    if (n.detail?.sections?.length) return here;
    const found = pathToFirstEntry(n.children ?? [], here);
    if (found) return found;
  }
  return null;
}

const playwright = loadPlaywright();
const skip = playwright ? false : 'Playwright nicht gefunden (npm i -D playwright)';

let server, baseUrl, browser;

before(async () => {
  if (skip) return;
  server = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT)) throw new Error('outside root');
      await stat(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
  browser = await playwright.chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
});

after(async () => {
  await browser?.close();
  await new Promise((r) => (server ? server.close(r) : r()));
});

async function openApp(role = 'viewer') {
  const context = await browser.newContext({ viewport: { width: 400, height: 800 }, serviceWorkers: 'block' });
  await context.addInitScript((r) => {
    try { if (r) localStorage.setItem('lernapp_role_v1', r); } catch { /* ignore */ }
  }, role);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForSelector('#main .card, #main .row, #main .empty');
  return { context, page, errors };
}

test('App startet ohne JS-Fehler und zeigt die Fächer aus data.json', { skip }, async () => {
  const { context, page, errors } = await openApp();
  try {
    assert.equal(await page.title(), 'Lern-App');
    assert.ok(await page.locator('#loginOverlay.hidden').count(), 'Login-Overlay sichtbar trotz gespeicherter Rolle');
    assert.ok(await page.locator('#main .card').count() > 0, 'keine Fächer gerendert');
    assert.match(await page.locator('#main').innerText(), /Physiotherapie/);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Navigation: Fach → Eintrag öffnen → zurück', { skip }, async () => {
  const { context, page, errors } = await openApp();
  try {
    await page.locator('#main .card', { hasText: 'Physiotherapie' }).click();
    await page.waitForSelector('#main .row');
    assert.equal(await page.locator('#pageTitle').textContent(), 'Physiotherapie');
    assert.ok(await page.locator('#backBtn.visible').count(), 'Zurück-Button fehlt');

    // Pfad zum ersten Eintrag mit Inhalt aus data.json bestimmen und durchklicken
    const [, ...folders] = pathToFirstEntry(data.subjects) ?? assert.fail('kein Eintrag mit Inhalt in data.json');
    const entry = folders.pop();
    for (const title of folders) {
      await page.locator('#main .row', { hasText: title }).first().click();
      await page.waitForSelector('#main .row, #main .empty');
    }
    await page.locator('#main .row', { hasText: entry }).first().click();
    await page.waitForSelector('#main .detail h2');
    assert.ok(await page.locator('#main .detail section').count() > 0, 'Eintrag ohne Abschnitte');

    // Favorit und "gelernt" umschalten
    await page.click('#favToggleBtn');
    assert.ok(await page.locator('#favToggleBtn.active').count(), 'Favorit nicht aktiv');
    await page.click('#learnedToggleBtn');
    assert.ok(await page.locator('#learnedToggleBtn.active').count(), 'Gelernt nicht aktiv');

    // Favoriten-Tab zeigt den Eintrag
    while (await page.locator('#backBtn.visible').count()) await page.click('#backBtn');
    await page.click('#tabFavoritesBtn');
    assert.ok(await page.locator('#main .row, #main .row-wrap, #main .card').count() > 0, 'Favorit fehlt im Favoriten-Tab');

    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Tab "Nach Gebiet" und Suche funktionieren', { skip }, async () => {
  const { context, page, errors } = await openApp();
  try {
    await page.click('#tabRegionsBtn');
    await page.waitForSelector('#main .card');
    assert.ok(await page.locator('#main .card', { hasText: 'Becken' }).count(), 'Gebiet "Becken & ISG" fehlt');

    await page.fill('#searchInput', 'zzz-gibt-es-nicht');
    await page.waitForSelector('#main .empty');
    await page.fill('#searchInput', 'becken');
    await page.waitForSelector('#main .card');

    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Login: ohne Rolle erscheint der Login-Overlay, falsches Passwort wird abgelehnt', { skip }, async () => {
  const { context, page, errors } = await openApp(null);
  try {
    assert.equal(await page.locator('#loginOverlay.hidden').count(), 0, 'Login-Overlay sollte sichtbar sein');
    await page.fill('#loginPasswordInput', 'definitiv-falsch');
    await page.click('#loginSubmitBtn');
    assert.ok((await page.locator('#loginError').innerText()).length > 0, 'keine Fehlermeldung');
    assert.equal(await page.locator('#loginOverlay.hidden').count(), 0, 'Overlay trotz falschem Passwort weg');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Menü öffnet sich und Dunkelmodus lässt sich umschalten', { skip }, async () => {
  const { context, page, errors } = await openApp();
  try {
    await page.click('#menuBtn');
    await page.waitForSelector('#menuOverlay:not(.hidden)');
    await page.check('input[name="themeChoice"][value="dark"]');
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('dark')), 'Dunkelmodus nicht aktiv');
    await page.check('input[name="themeChoice"][value="light"]');
    assert.ok(await page.evaluate(() => !document.documentElement.classList.contains('dark')), 'Hellmodus nicht aktiv');
    await page.click('#menuCloseBtn');
    await page.waitForSelector('#menuOverlay.hidden', { state: 'attached' });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
