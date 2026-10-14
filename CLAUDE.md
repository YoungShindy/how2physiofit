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

1. **Übergabe:** Kleine Dateien kommen direkt im Chat. Große Videos (über ca. 25 MB) lädt der Nutzer als Anhang eines GitHub-Release hoch (`https://github.com/YoungShindy/how2physiofit/releases/new`, Tag `video-upload`, "Publish release"). Google Drive, Dropbox, OneDrive und WeTransfer sind aus der Cloud-Umgebung nicht erreichbar. Release-Datei und Prüfsumme (`digest`) per `get_release_by_tag` holen, dann in einen eigenen leeren Ordner im Scratchpad laden: `curl -sS -L --fail -o <datei> https://github.com/YoungShindy/how2physiofit/releases/download/<tag>/<datei>` und `sha256sum` vergleichen (erprobt, ca. 3 s für 130 MB). Scheitert der Download, den Nutzer bitten, das Video mit HandBrake (RF 20) unter 25 MB zu bringen und in `videos/` hochzuladen. Nach dem Einspeisen kann der Nutzer das Release löschen.
2. **ffmpeg:** Ist nicht vorinstalliert. `python3 -m venv <scratchpad>/venv && <scratchpad>/venv/bin/pip install imageio-ffmpeg` liefert ffmpeg 7 mit libx264 und aac (`python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"`).
3. **Quelle prüfen** (`ffmpeg -i`): Auflösung, Codec, Drehung und HDR. Bei HDR (bt2020, HLG oder PQ) mit Tone-Mapping nach SDR/bt709 umwandeln, sonst wirkt das Bild blass. iPhone/iPad-Videos sind oft SDR, 1920x1080 mit Drehung (`displaymatrix`); ffmpeg dreht beim Umwandeln automatisch. Nur Video und Audio übernehmen und Metadaten entfernen: `-map 0:v:0 -map 0:a:0 -map_metadata -1 -map_chapters -1` (das Repo ist öffentlich; Aufnahmezeit und Standort gehören nicht hinein).
4. **Umwandeln:** Auflösung beibehalten (höchstens 1080p), qualitätsgesteuert: `-c:v libx264 -preset slow -crf 20 -profile:v high -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart`. Standard ist CRF 22, nie über 23. Bei einem neuen Videotyp CRF 20/23/26 an einem 15-s-Ausschnitt testen und mit VMAF messen (`-lavfi "[1:v]setpts=PTS-STARTPTS[d];[0:v]fps=30,setpts=PTS-STARTPTS[r];[d][r]libvmaf=n_threads=4:n_subsample=5"`, im imageio-ffmpeg-Build enthalten; ca. 6 Punkte entsprechen einem gerade sichtbaren Unterschied, Ziel 92 oder höher). **Wichtig:** iPhone-Videos haben unregelmäßige Bildabstände (VFR, z.B. 29,98 fps). Ohne `fps=30` an der Referenz wird um ein Bild versetzt verglichen und VMAF bricht scheinbar ein (46 statt 95). Widersprüchliche Zahlen immer an kurzen Ausschnitten und Standbildern gegenprüfen. Das ganze Video am Ende ebenfalls messen und dem Nutzer Vorher/Nachher-Frames und Zahlen zeigen. 1080p mit `-preset slow` läuft nur mit etwa 0,2-facher Echtzeit (4 Kerne): im Hintergrund starten. Nicht `pkill -f` mit Text aus dem eigenen Befehl benutzen, das beendet die Shell.
5. **Datei:** Kleinbuchstaben mit Bindestrichen, `.mp4`, in `videos/` (z.B. `differenzialdiagnostik-lws-isg-muskel-nerv.mp4`).
6. **`data.json`** mit `node tools/add-entry.mjs --parent <ordner-id> --id <neue-id> --title "…" --media videos/<datei>.mp4 --regions region-a,region-b` ändern. Das Skript prüft Eindeutigkeit, Elternknoten, Datei und Gebiete und erhält das Format Byte für Byte (`JSON.stringify(d, null, 2)` ohne abschließenden Zeilenumbruch). Texte kommen als `sections` nachträglich. Aufbau eines Knotens: `{ id, title, image: "", children: [], detail: { media: ["videos/….mp4"], regions: ["region-…"], sections: [{ heading, bullets }] } }`. Die `id` ist klein geschrieben mit Bindestrichen und im ganzen Baum eindeutig. Gebiets-IDs stehen in `data.regions`. Keine medizinischen Inhalte erfinden: ohne Texte bleibt `sections: []`.
7. **Prüfen und liefern:** `npm test` muss grün sein. Dann von aktuellem `main` einen Branch anlegen (ist der Branch schon gemergt: `git checkout -B <branch> origin/main`), committen, pushen und einen Pull Request erstellen. Nicht selbst mergen.
8. **Hinweis an den Nutzer:** `data.json` nicht mehr selbst hochladen oder ersetzen, das überschreibt Änderungen. Änderungswünsche an Claude schicken. Vor eigener Bearbeitung in der App nach einem Merge die Seite neu laden.
