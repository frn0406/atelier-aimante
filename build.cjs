#!/usr/bin/env node
/*
 * Assemble l'appli en un seul fichier HTML (scripts locaux intégrés).
 *
 *   node build.cjs
 *
 * Produit :
 *   dist/atelier-aimante.html  document complet, s'ouvre d'un double-clic (file://)
 *   dist/artifact.html         même contenu sans <!doctype>/<html>/<head>/<body>,
 *                              au format attendu par les artefacts claude.ai
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let inlined = 0;
const html = src.replace(/<script\s+src="(?!https?:)([^"]+)"\s*><\/script>/g, (_, rel) => {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) throw new Error('script introuvable : ' + rel);
  const code = fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
  inlined++;
  return `<script>/* ${rel} */\n${code}\n</script>`;
});

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'atelier-aimante.html'), html);

const head = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [])[1];
const bodyTag = (html.match(/<body([^>]*)>/i) || [])[1] || '';
const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1];
if (!head || body === undefined) throw new Error('index.html doit contenir <head> et <body>');
if (bodyTag.trim()) console.warn('attention : attributs de <body> ignorés dans la version artefact :', bodyTag.trim());
const headClean = head
  .replace(/<meta\s+charset[^>]*>\s*/i, '')
  .replace(/<meta\s+name="viewport"[^>]*>\s*/i, '');
// Le <title> doit figurer dans les 8 premiers Ko.
const title = (headClean.match(/<title>[\s\S]*?<\/title>/i) || [''])[0];
const artifact = `${title}\n${headClean.replace(title, '').trim()}\n${body.trim()}\n`;
fs.writeFileSync(path.join(dist, 'artifact.html'), artifact);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' Ko';
console.log(`${inlined} scripts intégrés`);
console.log(`dist/atelier-aimante.html  ${kb(html)}`);
console.log(`dist/artifact.html         ${kb(artifact)}`);
