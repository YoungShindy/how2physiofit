# how2physiofit

Statische PWA (HLX Lern-App): `index.html` (App), `data.json` (Inhalte), `videos/`, `sw.js`, `manifest.json`.

## Workflow: erst testen, dann committen

Vor jedem Commit `npm test` ausführen. Nur committen, wenn alle Tests grün sind.
Schlägt ein Test fehl, erst den Fehler beheben (oder dem Nutzer melden), nicht committen.

- `tests/static.test.mjs`: prüft `data.json` (Struktur, eindeutige IDs, Verweise auf Videos/Gebiete), Manifest, Service Worker und JS-Syntax.
- `tests/smoke.test.mjs`: startet die App in Chromium (Playwright) und prüft Start, Navigation, Suche, Login und Menü auf JS-Fehler.
  Wird übersprungen, wenn Playwright fehlt; Chromium-Pfad notfalls über `CHROMIUM_PATH` setzen.
