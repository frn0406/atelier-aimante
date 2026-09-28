#!/usr/bin/env node
/*
 * Capture PNG d'une construction (4 vues) via Chrome headless.
 *
 *   node test/snap.cjs <themeId|selftest> [taille=2] [packs=1] [graine=1] [--out=chemin.png]
 *   node test/snap.cjs --module=<moduleId> [--params={"levels":3}] [--out=chemin.png]
 *
 * Écrit par défaut dans test/out/<theme>-t<taille>-<packs>p-s<graine>.png
 * puis affiche le chemin : ouvrir ce PNG avec l'outil Read pour le regarder.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opts = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  })
);
const [themeId = 'selftest', size = '2', packs = '1', seed = '1'] = pos;
const name = opts.module
  ? `module-${opts.module}`
  : `${themeId}-t${size}-${packs}p-s${seed}`;
const out = path.resolve(opts.out || path.join(outDir, name + '.png'));

const url = (p) => 'file:///' + p.replace(/\\/g, '/');
const scripts = [
  path.join(root, 'js/pieces.js'),
  path.join(root, 'js/builder.js'),
  ...fs.readdirSync(path.join(root, 'themes')).filter((f) => f.endsWith('.js')).sort().map((f) => path.join(root, 'themes', f)),
  path.join(__dirname, 'selftest-scene.js'),
  path.join(__dirname, 'preview.js'),
];

const job = opts.module
  ? `const b = new MT.Builder({ packs: 2, seed: 7 });
     const params = ${JSON.stringify(opts.params ? JSON.parse(opts.params) : {})};
     b.module(${JSON.stringify(opts.module)}, 0, 0, params);
     const r = b.finish(); r.validation = MT.validate(r.placements);
     heading = 'Module ${opts.module} ' + JSON.stringify(MT.normalizeParams(MT.modules[${JSON.stringify(opts.module)}], params));`
  : `const r = MT.generate(${JSON.stringify(themeId)}, { size: ${Number(size)}, packs: ${Number(packs)}, seed: ${Number(seed)} });
     heading = r.title + ' — taille ' + r.size + (r.downsized ? ' (réduite de ' + r.requestedSize + ')' : '') + ' — ${packs} pack(s) — graine ${seed}';`;

const html = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<canvas id="c" width="1400" height="1060"></canvas>
${scripts.map((s) => `<script src="${url(s)}"></script>`).join('\n')}
<script>
let heading = '';
try {
  ${job}
  MT.renderPreview(document.getElementById('c'), r, heading);
} catch (e) {
  const ctx = document.getElementById('c').getContext('2d');
  ctx.font = '18px sans-serif'; ctx.fillStyle = '#c00';
  String(e && e.stack || e).split('\\n').forEach((l, i) => ctx.fillText(l, 10, 30 + i * 22));
}
</script>`;
const htmlPath = path.join(outDir, `_snap-${process.pid}.html`);
fs.writeFileSync(htmlPath, html);

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const chrome = candidates.find((c) => fs.existsSync(c));
if (!chrome) {
  console.error('Chrome introuvable (définir CHROME_PATH)');
  process.exit(2);
}
const profile = path.join(outDir, `_profile-${process.pid}`);
try {
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    `--user-data-dir=${profile}`, `--screenshot=${out}`, '--window-size=1400,1060', url(htmlPath),
  ], { stdio: 'pipe', timeout: 60000 });
} finally {
  fs.rmSync(htmlPath, { force: true });
  fs.rmSync(profile, { recursive: true, force: true });
}
console.log(out);
