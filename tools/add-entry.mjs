// Fügt einen Eintrag mit Video in data.json ein (Format bleibt Byte für Byte erhalten).
// Aufruf: node tools/add-entry.mjs --parent manuelle-therapie --id mein-eintrag --title "Titel" \
//           --media videos/datei.mp4 --regions region-lws,region-becken-isg
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data.json');

const { values: a } = parseArgs({
  options: { parent: { type: 'string' }, id: { type: 'string' }, title: { type: 'string' }, media: { type: 'string' }, regions: { type: 'string', default: '' } },
});
for (const k of ['parent', 'id', 'title', 'media']) if (!a[k]) fail(`--${k} fehlt`);

const raw = readFileSync(DATA, 'utf8');
const data = JSON.parse(raw);
if (JSON.stringify(data, null, 2) !== raw) fail('data.json hat nicht das erwartete Format (2 Leerzeichen, kein Zeilenumbruch am Ende)');

const find = (nodes, id) => {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = find(n.children ?? [], id);
    if (hit) return hit;
  }
  return null;
};

if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.id)) fail('id: nur Kleinbuchstaben, Ziffern und Bindestriche');
if (find(data.subjects, a.id)) fail(`id "${a.id}" existiert schon`);
const parent = find(data.subjects, a.parent) ?? fail(`Elternknoten "${a.parent}" nicht gefunden`);
if (parent.detail) fail(`"${a.parent}" ist ein Eintrag mit Inhalt, kein Ordner`);
if (!existsSync(path.join(ROOT, a.media))) fail(`Datei fehlt: ${a.media}`);
const regions = a.regions ? a.regions.split(',') : [];
for (const r of regions) if (!data.regions.some((x) => x.id === r)) fail(`Gebiet "${r}" unbekannt`);

parent.children.push({
  id: a.id,
  title: a.title,
  image: '',
  children: [],
  detail: { media: [a.media], regions, sections: [] },
});
writeFileSync(DATA, JSON.stringify(data, null, 2));
console.log(`Eintrag "${a.title}" unter "${parent.title}" angelegt (${a.media}).`);

function fail(msg) {
  console.error(`Fehler: ${msg}`);
  process.exit(1);
}
