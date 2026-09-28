# Atelier Aimanté — contrat technique

Générateur de constructions en tuiles magnétiques (pack de 136 pièces), par thème,
visualisées en 3D. Option « double pack » (272 pièces).

Code en anglais, commentaires et textes d'interface en français. Scripts
**classiques** (pas de modules ES) qui s'attachent à l'objet global `MT`, pour
fonctionner en `file://`, en artefact claude.ai et sous Node.

## Fichiers

| Fichier | Rôle | Auteur |
|---|---|---|
| `js/pieces.js` | Catalogue des pièces (`MT.PIECES`, contours, aimants, icônes SVG) | socle — ne pas modifier |
| `js/builder.js` | `MT.Builder`, `MT.validate`, registres, `MT.generate`, `MT.compose` | socle — ne pas modifier |
| `themes/a-habitat.js` | Thèmes `chateau`, `maison`, `ferme` + leurs modules | agent A |
| `themes/b-ville.js` | Thèmes `ville`, `train`, `pont` + leurs modules | agent B |
| `themes/c-aventure.js` | Thèmes `fusee`, `egypte`, `geometrie`, `camping` + leurs modules | agent C |
| `js/viewer.js` | Rendu Three.js (`MT.createViewer`) | agent viewer |
| `index.html`, `js/app.js` | Interface, IA « thème libre », nomenclature, étapes | agent interface |
| `test/run.cjs` | Banc d'essai headless des thèmes et modules | socle |
| `test/snap.cjs` | PNG 4 vues d'un thème ou module (Canvas 2D) | socle |
| `test/shot.cjs` | PNG d'une page HTML via Chrome headless (WebGL OK) | socle |

Three.js **r147 en UMD** (global `THREE`), chargé par `index.html` depuis jsDelivr :

```html
<script src="https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/environments/RoomEnvironment.js"></script>
```

Les trois scripts three sont chargés en `defer` (l'interface s'affiche sans les attendre ;
`app.js` crée la vue 3D quand `THREE` est prêt). Ordre des scripts locaux : `js/pieces.js` → `js/builder.js` → `themes/a-habitat.js`
→ `themes/b-ville.js` → `themes/c-aventure.js` → `js/viewer.js` → `js/app.js`.

## Pièces (unité : 1 = côté d'un carré, 2,95 in)

| Code | Pièce | Qté | Contour local |
|---|---|---|---|
| `SQ` | Carré plein | 40 | carré 1 × 1 |
| `WIN2` | Carré fenêtre double | 8 | carré 1 × 1, 2 ouvertures verticales |
| `FRAME` | Cadre carré | 8 | carré 1 × 1, grande ouverture |
| `ARCH` | Carré porte en arche | 8 | carré 1 × 1, arche depuis le bas |
| `WIN4` | Carré fenêtre 4 carreaux | 8 | carré 1 × 1, 4 ouvertures |
| `EQ` | Triangle équilatéral | 24 | côté 1, hauteur `MT.EQ_H` ≈ 0,866 |
| `RT` | Triangle rectangle | 14 | côtés 1, 1, √2 ; angle droit à l'origine |
| `TT` | Grand triangle isocèle | 8 | base 1, hauteur `MT.TT_H` ≈ 1,83 |
| `HR` | Demi-rectangle | 8 | 1 × `MT.HR_H` (≈ 0,66) |
| `CR` | Créneaux | 8 | 1 × 0,66 avec 2 encoches ; pas d'aimant en haut |
| `CAR` | Plateau à roues | 2 | plateau 2 × 1 (+ attelages), dessus à `MT.CAR.top` = 0,36 |

Toutes les pièces plates : bords aimantés sur tout le contour (sauf le haut des créneaux).

## Placement (sortie du moteur)

```js
{ id, type, kind, pos: [x,y,z], u: [..], v: [..], n: [..], step }
```

Point monde du contour local `(x, y)` = `pos + x·u + y·v` (`MT.worldPoint(p, x, y)`).
`u`, `v` orthonormés ; `n = u × v` (sens sans importance : pièces symétriques).
Contour local : `MT.PIECES[type].outline`, ouvertures : `.holes`, bords aimantés :
`MT.magnetEdges(type)`, nervures décoratives : `.ribs`, centroïde local : `.centroid`.

**Plateau à roues (`CAR`)** : `pos` = coin du **dessus** du plateau, `u` = longueur (2),
`v` = largeur (1), tous deux horizontaux. Le plateau (épaisseur `MT.CAR.plate`) est sous
ce plan ; roues de rayon `MT.CAR.wheelR` posées au sol ; attelages de `MT.CAR.hitch`
à chaque bout (crochet côté `x = 2`, anneau côté `x = 0`). Le haut du monde est
toujours +Y : ne pas se fier au signe de `n` pour le plateau.

## Résultat de `MT.generate(themeId, { size, packs, seed })` / `MT.compose(plan, { packs, seed })`

```js
{
  title, summary, themeId, seed, size, requestedSize, packs,
  placements: [...], steps: [{ label, ids: [...] }],     // étapes de montage, dans l'ordre
  used: { SQ: n, ... }, available: { SQ: n, ... }, remaining: {...},
  shortTotal, shortages,        // 0 / {} pour un résultat valide
  downsized,                    // taille réduite pour tenir dans le stock
  doubleFits,                   // (1 pack, réduite) : la taille demandée tiendrait avec 2 packs
  validation: { ok, errors: [], warnings: [], components, isolated, floating, overlaps, crossings, mateCount },
  report,                       // compose seulement : [{ module, label, status, x, z, rot, params, notes, missing }]
                                // status : ok | moved | reduced | adapted (notes) | skipped (missing = familles) | unknown
  pieceCount, notes, warnings
}
```

Tailles : 1 Petite (≈ 20–45 pièces), 2 Moyenne (≈ 50–90), 3 Grande (≈ 90–136), 4 Géante
(≈ 150–272). **Les tailles 1 à 3 sont toujours générées avec un seul pack** (`ctx.packs` = 1),
même si le double pack est choisi : le second pack ne sert qu'aux constructions qui en ont
besoin (taille 4, thème libre). `generate` réduit automatiquement la taille si le stock ne
suffit pas ; `doubleFits` signale qu'elle tiendrait en double pack.

## API du Builder (pour les thèmes et modules)

Repère : Y en haut, sol y = 0. Cellule `(x, z)` = `[x, x+1] × [z, z+1]`.
Côtés : `N` = −Z, `S` = +Z, `E` = +X, `W` = −X.

**Genres (kind)** et substitution automatique (même contour) :
`solid`/`wall`/`square`/`SQ` → SQ, WIN4, WIN2, FRAME · `window`/`WIN4` → WIN4, WIN2, FRAME, SQ ·
`window2`/`WIN2` → WIN2, WIN4, FRAME, SQ · `frame`/`FRAME` → FRAME, WIN4, WIN2, SQ ·
`arch`/`door`/`ARCH` → ARCH, FRAME, WIN2, WIN4, SQ (seul genre qui donne une arche) ·
`floor`/`roof` → SQ, FRAME, WIN4, WIN2 · `EQ`, `RT`, `TT`, `CAR` (sans substitut) ·
`half`/`HR` → HR, CR · `crenel`/`CR` → CR, HR. Suffixe `!` = type exact (`'ARCH!'`, `'CR!'`).
Le haut des créneaux n'a pas d'aimant : pour porter une pièce sur un demi-mur, demander `'HR!'`.

```js
b.step(label)                       // nouvelle étape de montage (bas → haut !)
b.wall(x, y, z, side, kind)         // carré vertical sur un côté de cellule, base à y
b.halfWall(x, y, z, side, kind)     // demi-rectangle vertical (défaut 'half')
b.crenel(x, y, z, side)             // créneaux ; y = haut du mur porteur
b.floor(x, y, z, kind)              // carré horizontal à la hauteur y (défaut 'floor')
b.floorRect(x0, y, z0, w, d, kind)
b.box(x, y, z, { N, S, E, W, floor, top })   // cube 1×1 ; murs 'solid' par défaut, false = pas de mur
b.room(x0, y, z0, w, d, kind | ({side, i, x, z, y}) => kind|false)  // murs du périmètre
b.crenelRim(x0, y, z0, w, d)        // créneaux sur tout un périmètre
b.halfRoom(x0, y, z0, w, d, kind)   // demi-murs sur un périmètre
b.pyramidRoof(x, y, z, 'EQ'|'TT')   // toit pyramidal 1×1 (EQ : 4 triangles ; TT : flèche haute)
b.bigPyramid(x, y, z, n, { floor }) // pyramide n×n, 4n² triangles EQ
b.gableRoof(x, y, z, len, width, 'x'|'z', kind)  // toit 2 pans ; width² EQ par pignon ; width×len carrés par pan
b.aFrame(x, y, z, len, 'x'|'z', { kind, gables }) // tente en A, largeur √2, pignons RT
b.car(x, z, 'x'|'z')                // plateau à roues ; dessus à MT.CAR.top
b.triGrid(A, B, Q, n, kind)         // grand triangle équilatéral pavé
b.quad(kind, A, B, D)               // rectangle : A bas-gauche, B bas-droit, D haut-gauche
b.tri(kind, A, B, C)                // triangle : base A→B, sommet C (RT : angle droit en A)
b.face([p0, p1, p2(, p3)], kind)    // face de polyèdre, type détecté par les longueurs
b.place(kind, pos, u, v)            // bas niveau
b.at({ x, y, z, rot, w, d }, fn)    // repère local (rot 0/90/180/270 ; w×d = emprise locale)
b.module(id, x, z, params, { rot, y, label })   // pose un module enregistré
b.available(kind)  b.canAfford({ kind: n })  b.tryBuild(fn) → bool   b.note(text)   b.count
// b.note('toit en pyramide faute de grands triangles') : signale une adaptation (remontée dans report.notes)
b.rng()  b.rng.int(a, b)  b.rng.pick(arr)  b.rng.chance(p)  b.rng.shuffle(arr)  b.rng.float(a, b)
```

- Une pièce posée deux fois au même endroit n'est comptée qu'une fois (murs mitoyens OK).
- `tryBuild(fn)` annule tout ce que `fn` a posé si une pièce a manqué : l'outil pour les
  parties optionnelles (« ajoute une tour tant que le stock le permet »).
- `place`/`wall`… renvoient `null` quand le stock est vide : le thème doit alors réduire
  (ou `generate` réduira la taille). Un résultat final ne doit **jamais** avoir de manque.
- Toute la génération passe par `b.rng` (déterministe par graine). Pas de `Math.random`.

## Thèmes et modules

```js
MT.registerTheme({
  id: 'chateau', name: 'Château fort', emoji: '🏰',
  tagline: 'Tours, remparts crénelés et pont-levis',
  keywords: ['chateau', 'chevalier', 'princesse', 'roi', 'medieval', 'donjon', 'dragon', ...], // sans accents, minuscules
  generate(b, { size, packs, rng, seed }) { ...; return { title, summary }; },
});

MT.registerModule({
  id: 'tour', label: 'Tour', description: 'Tour carrée 1×1 à étages, toit en flèche, pyramide ou créneaux',
  params: {
    levels: { type: 'int', min: 1, max: 6, default: 3, label: 'Étages' },
    roof: { type: 'enum', values: ['fleche', 'pyramide', 'creneaux', 'plat'], default: 'fleche', label: 'Toit' },
  },
  footprint: (p) => ({ w: 1, d: 1 }),   // emprise au sol en cellules (entiers, arrondis au-dessus)
  build(b, p, { rng }) { ... },          // construit dans [0, w] × [0, d], sol à y = 0
});
```

Les modules servent au **thème libre** : Claude reçoit leur catalogue (id, label,
description, paramètres, emprise) et renvoie un plan
`{ title, summary, items: [{ module, x, z, rot, params, label }] }` exécuté par `MT.compose`.
Un module doit donc être autonome, rester dans son emprise, et avoir une description
claire en français. Les thèmes peuvent réutiliser leurs propres modules via `b.module`.

Utilitaires : `MT.FAMILY` (type → famille : carre, EQ, RT, TT, demi, CAR), `MT.FAMILY_LABEL`,
`MT.familyCount(compteParType)`, `MT.moduleDemand(id, params)` (pièces par famille, à blanc),
`MT.fold(texte)` (minuscules sans accents), `MT.normalizeParams(mod, params)` (tolérant).

`MT.compose` : pré-passe de budget par famille (réduit d'un cran le plus gros consommateur,
le premier item pesant pour moitié), puis pose dans l'ordre du plan avec recherche de la
place libre la plus proche (1 case d'écart entre modules) et réduction par candidats
(entier − 1, booléen → false, autre valeur d'enum).

## Qualité exigée (vérifiée par `node test/run.cjs`)

- 0 manque, stock jamais dépassé, en 1 et 2 packs, tailles 1 à 4, 12+ graines.
- Modules : paramètres par défaut, min, max, chaque valeur d'enum/booléen et 20 combinaisons
  aléatoires (`--fuzz=N`) valides et dans leur emprise.
- 0 avertissement de forme, 0 erreur de validation : rien ne flotte (chaque bloc touche le
  sol), aucune superposition, aucun croisement, rien sous le sol.
- Chaque pièce tient par au moins un bord aimanté à une autre (sauf pièce posée seule au sol).
- Plausibilité physique : on construit comme un enfant réel — murs sur les bords des murs,
  toits sur le haut des murs, pas de pièce en porte-à-faux improbable.
- Les étapes vont du bas vers le haut, 3 à 12 pièces par étape idéalement.
- Des variantes réellement différentes selon la graine, et reconnaissables selon le thème.
