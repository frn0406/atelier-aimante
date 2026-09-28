#!/usr/bin/env node
/* Contrôle des idées toutes prêtes (themes/z-idees.js) : tout doit être posé, sans erreur, en 1 et 2 packs. */
'use strict';
const path = require('path'), fs = require('fs');
const root = path.join(__dirname, '..');
require(root + '/js/pieces.js'); require(root + '/js/builder.js');
for (const f of fs.readdirSync(root + '/themes').filter((f) => f.endsWith('.js')).sort()) require(root + '/themes/' + f);
const MT = globalThis.MT;
let fails = 0;
for (const p of MT.PRESET_PLANS) {
  for (const packs of [1, 2]) {
    for (const seed of [1, 2, 3]) {
      const r = MT.compose(p.plans[packs], { packs, seed });
      const bad = r.report.filter((x) => !['ok', 'moved', 'adapted'].includes(x.status));
      const errs = [...r.validation.errors, ...r.warnings];
      if (bad.length || errs.length) fails++;
      if (seed === 1 || bad.length || errs.length) {
        console.log(`${bad.length || errs.length ? '✗' : '✓'} ${p.id.padEnd(13)} ${packs}p s${seed} ${String(r.pieceCount).padStart(3)} pièces` +
          (bad.length ? '  ' + bad.map((x) => `${x.label}:${x.status}${x.missing && x.missing.length ? '(' + x.missing.join(',') + ')' : ''}`).join(' ') : '') +
          (errs.length ? '  ' + errs.join(' | ') : '') +
          r.report.filter((x) => x.notes && x.notes.length).map((x) => `  [${x.label}: ${x.notes.join('; ')}]`).join(''));
      }
    }
  }
}
console.log(fails ? `${fails} échec(s)` : 'Idées toutes prêtes : tout est vert');
process.exit(fails ? 1 : 0);
