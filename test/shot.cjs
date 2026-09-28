#!/usr/bin/env node
/*
 * Capture PNG d'une page HTML quelconque (WebGL compris, via SwiftShader).
 *
 *   node test/shot.cjs <page.html | url> [--out=chemin.png] [--size=1400x900] [--wait=6000]
 *
 * --wait : budget de temps virtuel (ms) laissé aux scripts, chargements CDN
 * et animations avant la capture. Le hash de l'URL est conservé
 * (ex. index.html#chateau-3-1-42).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opts = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  })
);
if (!pos[0]) {
  console.error('usage : node test/shot.cjs <page.html|url> [--out=…] [--size=1400x900] [--wait=6000]');
  process.exit(2);
}
let target = pos[0];
if (!/^[a-z]+:\/\//i.test(target)) {
  const [file, hash] = target.split('#');
  target = 'file:///' + path.resolve(file).replace(/\\/g, '/') + (hash ? '#' + hash : '');
}
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
const out = path.resolve(opts.out || path.join(outDir, 'shot.png'));
const [w, h] = String(opts.size || '1400x900').split('x').map(Number);

const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find((c) => fs.existsSync(c));
if (!chrome) {
  console.error('Chrome introuvable (définir CHROME_PATH)');
  process.exit(2);
}
const profile = path.join(outDir, `_profile-${process.pid}`);
try {
  execFileSync(chrome, [
    '--headless=new', '--hide-scrollbars', '--allow-file-access-from-files',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    `--virtual-time-budget=${Number(opts.wait) || 6000}`,
    `--user-data-dir=${profile}`, `--screenshot=${out}`, `--window-size=${w},${h}`, target,
  ], { stdio: 'pipe', timeout: 120000 });
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}
console.log(out);
