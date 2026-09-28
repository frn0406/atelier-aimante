#!/usr/bin/env node
/*
 * Banc d'essai headless des thèmes et modules.
 *
 *   node test/run.cjs                     tous les thèmes, 12 graines
 *   node test/run.cjs --theme=chateau     un seul thème
 *   node test/run.cjs --seeds=40          plus de graines
 *   node test/run.cjs --modules           modules seulement (+ 20 combinaisons aléatoires, --fuzz=N)
 *   node test/run.cjs --selftest          scène de contrôle du moteur
 *   node test/run.cjs --verbose           détail de chaque échec
 *
 * Échec si : pièce manquante après réduction de taille, stock dépassé,
 * forme incohérente (avertissement du Builder), erreur de validation
 * (flottement, superposition, croisement, sous le sol), construction vide,
 * module qui déborde de son emprise.
 */
'use strict';
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
require(path.join(root, 'js/pieces.js'));
require(path.join(root, 'js/builder.js'));
const themeDir = path.join(root, 'themes');
for (const f of fs.readdirSync(themeDir).filter((f) => f.endsWith('.js')).sort()) require(path.join(themeDir, f));
const MT = globalThis.MT;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  })
);
const SEEDS = Number(args.seeds) || 12;
const FUZZ = args.fuzz === undefined ? 20 : Number(args.fuzz) || 0;
const verbose = !!args.verbose;
let failures = 0;
const fail = (where, msg) => {
  failures++;
  if (verbose || failures <= 60) console.log(`  ✗ ${where} : ${msg}`);
};

function checkResult(where, r) {
  if (!r.pieceCount) fail(where, 'construction vide');
  if (r.shortTotal) fail(where, `pièces manquantes ${JSON.stringify(r.shortages)}`);
  for (const t of MT.PIECE_ORDER) {
    if (r.used[t] > r.available[t]) fail(where, `stock dépassé ${t} ${r.used[t]}/${r.available[t]}`);
  }
  for (const w of r.warnings) fail(where, w);
  for (const e of r.validation.errors) fail(where, e);
  const big = r.steps.filter((s) => s.ids.length > 12);
  if (big.length) fail(where, `étape de plus de 12 pièces : « ${big[0].label} » (${big[0].ids.length})`);
  if (r.size && r.size <= 3) {
    for (const t of MT.PIECE_ORDER) if (r.used[t] > MT.PACK[t]) fail(where, `taille ${r.size} au-delà d'un pack : ${t} ${r.used[t]}`);
  }
  return r;
}

if (args.selftest) {
  require(path.join(__dirname, 'selftest-scene.js'));
  const r = MT.generate('selftest', { size: 4, packs: 2, seed: 1 });
  checkResult('selftest', r);
  console.log(`selftest : ${r.pieceCount} pièces, ${r.steps.length} étapes, ${r.validation.components} blocs, ` +
    `${r.validation.mateCount} contacts, doublons évités ${r.deduped}`);
  console.log('  utilisées :', MT.PIECE_ORDER.map((t) => `${t}=${r.used[t]}`).join(' '));
  for (const w of r.validation.warnings) console.log('  ⚠', w);
  process.exit(failures ? 1 : 0);
}

// ------------------------------------------------------------------ modules
function checkModule(mod, params, label) {
  const prm = MT.normalizeParams(mod, params);
  const fp = mod.footprint(prm);
  let b = new MT.Builder({ packs: 2, seed: 7 });
  b.module(mod.id, 0, 0, prm);
  let r = b.finish();
  let where = `module ${mod.id} ${label}`;
  if (r.shortTotal) {
    // Trop gros pour 2 packs : le composeur le réduira ; on valide quand même sa géométrie avec un stock ×10.
    const big = {};
    for (const t of MT.PIECE_ORDER) big[t] = MT.PACK[t] * 10;
    b = new MT.Builder({ packs: 2, seed: 7, stock: big });
    b.module(mod.id, 0, 0, prm);
    r = b.finish();
    where += ' (stock ×10)';
    if (verbose) console.log(`  · ${where} : dépasse 2 packs`);
  }
  r.validation = MT.validate(r.placements);
  if (!r.pieceCount) fail(where, 'module vide');
  for (const w of r.warnings) fail(where, w);
  for (const e of r.validation.errors) fail(where, e);
  for (const p of r.placements) {
    for (const q of MT.worldOutline(p)) {
      if (q[0] < -0.05 || q[2] < -0.05 || q[0] > fp.w + 0.05 || q[2] > fp.d + 0.05) {
        fail(where, `pièce ${p.id} (${p.type}) hors emprise ${fp.w}×${fp.d} : (${q[0].toFixed(2)}, ${q[2].toFixed(2)})`);
        return;
      }
    }
  }
}

if (!args.theme || args.modules) {
  console.log(`Modules : ${MT.moduleList.length}`);
  for (const mod of MT.moduleList) {
    const before = failures;
    checkModule(mod, {}, 'défaut');
    const mins = {}, maxs = {};
    for (const [k, s] of Object.entries(mod.params)) {
      if (s.type === 'int' || s.type === 'number') {
        mins[k] = s.min;
        maxs[k] = s.max;
      } else if (s.type === 'enum') {
        mins[k] = s.values[0];
        maxs[k] = s.values[s.values.length - 1];
      } else if (s.type === 'bool') {
        mins[k] = false;
        maxs[k] = true;
      }
    }
    checkModule(mod, mins, 'min');
    checkModule(mod, maxs, 'max');
    for (const [k, s] of Object.entries(mod.params)) {
      if (s.type === 'enum') for (const v of s.values) checkModule(mod, { [k]: v }, `${k}=${v}`);
      if (s.type === 'bool') for (const v of [false, true]) checkModule(mod, { [k]: v }, `${k}=${v}`);
    }
    // Combinaisons aléatoires de paramètres (déterministes).
    const rng = MT.makeRng(mod.id.length * 7919 + 17);
    for (let k = 0; k < FUZZ; k++) {
      const prm = {};
      for (const [key, s] of Object.entries(mod.params)) {
        if (s.type === 'int') prm[key] = rng.int(s.min, s.max);
        else if (s.type === 'number') prm[key] = rng.float(s.min, s.max);
        else if (s.type === 'enum') prm[key] = rng.pick(s.values);
        else if (s.type === 'bool') prm[key] = rng.chance(0.5);
        else if (Array.isArray(s.values)) prm[key] = rng.pick(s.values);
      }
      checkModule(mod, prm, 'combinaison ' + JSON.stringify(prm));
    }
    console.log(`  ${failures === before ? '✓' : '✗'} ${mod.id.padEnd(18)} ${mod.label}`);
  }
  if (args.modules) process.exit(failures ? 1 : 0);
}

// ------------------------------------------------------------------- thèmes
const themes = args.theme ? [MT.themes[args.theme]].filter(Boolean) : MT.themeList.filter((t) => t.id !== 'selftest');
if (args.theme && !themes.length) {
  console.error('thème inconnu : ' + args.theme + ' ; disponibles : ' + MT.themeList.map((t) => t.id).join(', '));
  process.exit(2);
}
console.log(`Thèmes : ${themes.length}, graines : ${SEEDS}`);
const t0 = Date.now();
for (const theme of themes) {
  const before = failures;
  const rows = [];
  for (const packs of [1, 2]) {
    for (let size = 1; size <= 4; size++) {
      let min = Infinity, max = 0, down = 0, dbl = 0, comps = 0, warn = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const where = `${theme.id} taille ${size} ${packs}p graine ${seed}`;
        let r;
        try {
          r = MT.generate(theme.id, { size, packs, seed });
        } catch (e) {
          fail(where, 'exception : ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
          continue;
        }
        checkResult(where, r);
        min = Math.min(min, r.pieceCount);
        max = Math.max(max, r.pieceCount);
        if (r.downsized) down++;
        if (r.doubleFits) dbl++;
        comps = Math.max(comps, r.validation.components);
        warn += r.validation.warnings.length ? 1 : 0;
      }
      rows.push(`${packs}p T${size} : ${String(min).padStart(3)}–${String(max).padEnd(3)} pièces` +
        `${down ? `, réduite ${down}/${SEEDS}` : ''}${dbl ? `, double pack OK ${dbl}` : ''}` +
        `${comps > 1 ? `, ${comps} blocs max` : ''}${warn ? `, ⚠ isolées ${warn}` : ''}`);
    }
  }
  console.log(`${failures === before ? '✓' : '✗'} ${theme.id} — ${theme.name}`);
  for (const row of rows) console.log('    ' + row);
}
console.log(`\n${failures ? `${failures} échec(s)` : 'Tout est vert'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
