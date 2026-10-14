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

## Neue Inhalte hinzufügen (Videos, Einträge)

Gibt der Nutzer neue Videos oder Infos, alles selbstständig erledigen. Nur das Mergen braucht seine Freigabe ("merge").

1. **Übergabe:** Kleine Dateien kommen direkt im Chat. Große Videos (über ca. 25 MB) lädt der Nutzer als Anhang eines GitHub-Release hoch (`https://github.com/YoungShindy/how2physiofit/releases/new`, Tag `video-upload`, "Publish release"). Google Drive, Dropbox, OneDrive und WeTransfer sind aus der Cloud-Umgebung nicht erreichbar. Der Release-Download ist noch nicht erprobt: Scheitert er, den Nutzer bitten, das Video mit HandBrake (RF 20) unter 25 MB zu bringen und in `videos/` hochzuladen.
2. **ffmpeg:** Ist nicht vorinstalliert. `python3 -m venv <scratchpad>/venv && <scratchpad>/venv/bin/pip install imageio-ffmpeg` liefert ffmpeg 7 mit libx264 und aac (`python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"`).
3. **Quelle prüfen** (`ffmpeg -i`): Auflösung, Codec, Drehung und HDR. Bei HDR (bt2020, HLG oder PQ, z.B. iPhone) mit Tone-Mapping nach SDR/bt709 umwandeln, sonst wirkt das Bild blass.
4. **Umwandeln:** Auflösung beibehalten (höchstens 1080p), qualitätsgesteuert: `-c:v libx264 -preset slow -crf 20 -profile:v high -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart`. CRF nie über 23. Qualität belegen: Vorher/Nachher-Frame ansehen und SSIM messen (`-lavfi ssim`, Richtwert 0,98 oder höher), dem Nutzer beides zeigen.
5. **Datei:** Kleinbuchstaben mit Bindestrichen, `.mp4`, in `videos/` (z.B. `differenzialdiagnostik-lws-isg-muskel-nerv.mp4`).
6. **`data.json`** per Skript ändern (`JSON.stringify(d, null, 2)` ohne abschließenden Zeilenumbruch; die Datei bleibt dann Byte für Byte gleich formatiert, der Diff klein). Neuer Knoten: `{ id, title, image: "", children: [], detail: { media: ["videos/….mp4"], regions: ["region-…"], sections: [{ heading, bullets }] } }`. Die `id` ist klein geschrieben mit Bindestrichen und im ganzen Baum eindeutig. Gebiets-IDs stehen in `data.regions`. Keine medizinischen Inhalte erfinden: ohne Texte bleibt `sections: []`.
7. **Prüfen und liefern:** `npm test` muss grün sein. Dann von aktuellem `main` einen Branch anlegen (ist der Branch schon gemergt: `git checkout -B <branch> origin/main`), committen, pushen und einen Pull Request erstellen. Nicht selbst mergen.
8. **Hinweis an den Nutzer:** `data.json` nicht mehr selbst hochladen oder ersetzen, das überschreibt Änderungen. Änderungswünsche an Claude schicken. Vor eigener Bearbeitung in der App nach einem Merge die Seite neu laden.
