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

// Bösartige Inhalte (z.B. aus einem fremden Backup oder manipulierten data.json) dürfen kein JavaScript ausführen.
const XSS_PAYLOADS = [
  'x" onerror="window.__xss=1',
  'data:image/png;base64,AAAA" onerror="window.__xss=1',
  'javascript:window.__xss=1',
  '\u0001javascript:window.__xss=1',
  'data:text/html;base64,PHNjcmlwdD53aW5kb3cuX194c3M9MTwvc2NyaXB0Pg==',
  '"><img src=x onerror=window.__xss=1>',
];
const EVIL_DATA = {
  subjects: [{
    id: 'evil', title: 'Evil <img src=x onerror=window.__xss=1>', image: 'x" onerror="window.__xss=1', detail: null,
    children: [{
      id: 'evil-entry', title: 'Eintrag <b onmouseover=window.__xss=1>', image: '', children: [],
      detail: {
        media: XSS_PAYLOADS, regions: ['r1'],
        sections: [{ heading: '<img src=x onerror=window.__xss=1>', text: '<script>window.__xss=1</script>', bullets: ['<svg onload=window.__xss=1>'] }],
      },
    }],
  }],
  regions: [{ id: 'r1', title: 'Gebiet <img src=x onerror=window.__xss=1>', image: 'x" onerror="window.__xss=1' }],
};

test('XSS: manipulierte Daten führen keinen Code aus und erzeugen keine Event-Handler', { skip }, async () => {
  const { context, page, errors } = await openApp();
  try {
    await page.route('**/data.json*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(EVIL_DATA) }));
    await page.reload();
    await page.waitForSelector('#main .card');

    const injected = () => page.evaluate(() => ({
      fired: window.__xss ?? null,
      handlers: [...document.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).map((el) => el.outerHTML.slice(0, 80)),
      scripts: document.querySelectorAll('#main script').length,
    }));

    // Kachelansicht (Fach-Bild, Titel), dann Eintrag mit Payload-Medien und -Abschnitten, dann Gebiete
    await page.locator('#main .card').first().click();
    await page.locator('#main .row').first().click();
    await page.waitForSelector('#main .detail h2');
    await page.waitForTimeout(300);
    let r = await injected();
    assert.deepEqual(r, { fired: null, handlers: [], scripts: 0 }, 'Detailansicht: Code ausgeführt oder Handler injiziert');
    assert.ok(await page.locator('#main .detail .media', { hasText: 'Ungültiges Medium' }).count() >= 4, 'unsichere Medien wurden nicht abgelehnt');
    assert.match(await page.locator('#main .detail').innerText(), /<img src=x onerror=window\.__xss=1>/, 'Text muss als Text sichtbar bleiben');

    while (await page.locator('#backBtn.visible').count()) await page.click('#backBtn');
    await page.click('#tabRegionsBtn');
    await page.waitForSelector('#main .card');
    await page.waitForTimeout(300);
    r = await injected();
    assert.deepEqual(r, { fired: null, handlers: [], scripts: 0 }, 'Gebietsansicht: Code ausgeführt oder Handler injiziert');
    assert.deepEqual(errors.filter((e) => !/Failed to load resource|net::ERR|request failed|HTTP 4/.test(e)), [], 'unerwartete Fehler');
  } finally { await context.close(); }
});

test('XSS: Link-Feld im Admin-Dialog lehnt gefährliche Eingaben ab und akzeptiert https-Links', { skip }, async () => {
  const { context, page } = await openApp('admin');
  try {
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    await page.click('#editToggleBtn');
    await page.locator('#main .card', { hasText: 'Physiotherapie' }).click();
    await page.click('#fabAdd');
    await page.waitForSelector('#modalBox #useUrlBtn', { state: 'attached' });
    await page.check('input[name="modalType"][value="entry"]');

    for (const bad of ['x" onerror="window.__xss=1', 'javascript:window.__xss=1', 'data:text/html;base64,AAAA']) {
      await page.fill('#mediaUrlInput', bad);
      await page.click('#useUrlBtn');
    }
    assert.equal(dialogs.length, 3, 'gefährliche Links wurden nicht abgelehnt');
    assert.equal(await page.locator('#mediaListWrap .media-item-edit').count(), 0, 'gefährlicher Link wurde übernommen');

    await page.fill('#mediaUrlInput', 'https://example.org/bild.png');
    await page.click('#useUrlBtn');
    assert.equal(await page.locator('#mediaListWrap .media-item-edit').count(), 1, 'https-Link wurde nicht übernommen');
    assert.equal(dialogs.length, 3);
    assert.equal(await page.evaluate(() => window.__xss ?? null), null);
  } finally { await context.close(); }
});

test('Medien-Allowlist akzeptiert alle vorhandenen Medien aus data.json', { skip }, async () => {
  const { context, page } = await openApp();
  try {
    const all = [];
    (function collect(nodes) {
      for (const n of nodes) {
        const m = n.detail?.media;
        for (const x of Array.isArray(m) ? m : m ? [m] : []) all.push(x);
        if (n.image) all.push(n.image);
        collect(n.children ?? []);
      }
    })(data.subjects);
    for (const r of data.regions) if (r.image) all.push(r.image);
    const rejected = await page.evaluate((list) => list.filter((x) => !isSafeMediaSrc(x) && !getYouTubeEmbedId(x)).map((x) => x.slice(0, 60)), all);
    assert.deepEqual(rejected, []);
  } finally { await context.close(); }
});

test('Backup-Import lehnt ungültige Dateien ab und ändert nichts', { skip }, async () => {
  const { context, page } = await openApp('admin');
  try {
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    const before = await page.evaluate(() => JSON.stringify(appData));
    for (const body of ['{"subjects":"<img src=x onerror=1>"}', '{"subjects":[],"regions":{}}', 'kein json']) {
      await page.evaluate(() => { window.__pickerDone = false; });
      const chooser = page.waitForEvent('filechooser');
      await page.evaluate(() => importBackup());
      (await chooser).setFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(body) });
      await page.waitForEvent('dialog');
    }
    assert.equal(dialogs.length, 3);
    assert.ok(dialogs.every((m) => m.startsWith('Backup konnte nicht gelesen werden')), `unerwartete Dialoge: ${dialogs}`);
    assert.equal(await page.evaluate(() => JSON.stringify(appData)), before, 'appData wurde trotz ungültigem Backup verändert');
  } finally { await context.close(); }
});

test('Alle Einträge aus data.json rendern ohne CSP-Verletzung und ohne abgelehnte Medien', { skip }, async () => {
  const { context, page, errors } = await openApp();
  try {
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective}: ${e.blockedURI.slice(0, 60)}`));
    });
    await page.reload();
    await page.waitForSelector('#main .card');

    const result = await page.evaluate(async () => {
      const visited = [], rejected = [];
      const pause = () => new Promise((r) => setTimeout(r, 40));
      async function walk(nodes, trail) {
        for (const n of nodes) {
          state.mode = 'subjects';
          state.path = [...trail, n];
          render();
          if (n.detail) {
            visited.push(n.id);
            if (document.querySelector('#main .media')?.textContent.includes('Ungültiges Medium')
                || [...document.querySelectorAll('#main .media span')].some((s) => s.textContent.includes('Ungültiges Medium'))) rejected.push(n.id);
            await pause();
          }
          await walk(n.children || [], [...trail, n]);
        }
      }
      await walk(appData.subjects, []);
      state.path = []; state.mode = 'regions'; render();
      await pause();
      return { visited, rejected, csp: window.__csp };
    });

    assert.ok(result.visited.length >= 10, `nur ${result.visited.length} Einträge besucht`);
    assert.deepEqual(result.rejected, [], 'Einträge mit abgelehntem Medium');
    assert.deepEqual(result.csp, [], 'CSP-Verletzungen');
    // Netzwerkfehler (z.B. YouTube im Sandbox-Netz) sind hier irrelevant, JS-/CSP-Fehler nicht
    assert.deepEqual(errors.filter((e) => /pageerror|Content Security Policy|Refused to/i.test(e)), []);
  } finally { await context.close(); }
});
