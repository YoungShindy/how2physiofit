# how2physiofit

Statische PWA (HLX Lern-App): `index.html` (App), `data.json` (Inhalte), `videos/`, `sw.js`, `manifest.json`.

## Workflow: erst testen, dann committen

Vor jedem Commit `npm test` ausführen. Nur committen, wenn alle Tests grün sind.
Schlägt ein Test fehl, erst den Fehler beheben (oder dem Nutzer melden), nicht committen.

- `tests/static.test.mjs`: prüft `data.json` (Struktur, eindeutige IDs, Verweise auf Videos/Gebiete), Manifest, Service Worker und JS-Syntax.
- `tests/smoke.test.mjs`: startet die App in Chromium (Playwright) und prüft Start, Navigation, Suche, Login und Menü auf JS-Fehler.
  Wird übersprungen, wenn Playwright fehlt; Chromium-Pfad notfalls über `CHROMIUM_PATH` setzen.

## Sicherheit

- Reine Frontend-App: kein Server, keine Datenbank, keine API-Keys. Nie Geheimnisse in den Code oder ins Repo legen (`tests/static.test.mjs` scannt danach).
- Der Login (`ADMIN_PASSWORD`/`VIEWER_PASSWORD` in `index.html`) ist nur eine Oberflächen-Sperre, kein Schutz: Passwörter stehen im Quelltext, `data.json` und `videos/` sind öffentlich abrufbar. Echte Zugriffskontrolle braucht Server-Authentifizierung.
- Nutzerdaten (Titel, Texte, Medien-Links) nie ungeprüft in `innerHTML` schreiben: Text mit `escapeHtml`, URLs mit `isSafeMediaSrc` prüfen und mit `escapeAttr` ausgeben.
- Die Content-Security-Policy steht als `<meta>` im `<head>` von `index.html`. Neue externe Hosts (Bilder, Videos, Skripte) müssen dort ausdrücklich erlaubt werden.
