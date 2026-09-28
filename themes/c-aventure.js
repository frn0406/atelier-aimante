/*
 * Atelier Aimanté — thèmes « aventure » (agent C).
 *
 * Thèmes : fusee (Fusée & espace), egypte (Égypte), geometrie (Formes
 * géométriques), camping (Camping & forêt).
 *
 * Modules réutilisables (thème libre) :
 *   espace   : fusee, pas-de-tir, rover, base-lunaire
 *   Égypte   : pyramide, obelisque, ziggourat, temple, c-sphinx, palmier
 *   formes   : solide, c-galerie
 *   camping  : tente, feu-de-camp, sapin, cabane, tour-de-guet,
 *              table-pique-nique, c-camping-car, c-campement
 *   fête     : chapiteau, manege
 *
 * Toute la géométrie passe par l'API Builder (js/builder.js). Les solides
 * géométriques sont calculés exactement (arête = 1) : enveloppe convexe des
 * sommets, rotation pour poser une face à plat au sol, puis une pièce par
 * face (faces de côté 2 pavées en 4 pièces). Les assemblages de cubes
 * (polycubes) posent les faces extérieures de chaque cube.
 *
 * Principes : on planifie le stock avant de construire (éléments signature
 * d'abord, parties optionnelles ensuite dans tryBuild), on demande un type
 * exact ('SQ!', 'HR!'…) là où une substitution serait laide, et chaque
 * repli faute de pièces est signalé par b.note(…).
 *
 * Script classique : s'attache à window.MT / globalThis.MT.
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  if (!MT || !MT.registerTheme || !MT.registerModule) return;

  const EQ_H = MT.EQ_H, TT_H = MT.TT_H, HR_H = MT.HR_H, CAR = MT.CAR;
  const S2 = Math.SQRT2, R2 = Math.SQRT1_2;
  const { add, sub, scale, madd, dot, cross, len, norm } = MT.vec;

  // Fourchettes de pièces visées par taille (1 à 4).
  const TARGET = { 1: [20, 44], 2: [50, 88], 3: [90, 134], 4: [150, 266] };

  // ================================================================ outils
  const count = (b) => b.placements.length;

  /** Enregistre un module, sauf si un autre fichier a déjà pris cet identifiant. */
  function registerModule(def) {
    return MT.modules[def.id] ? MT.modules[def.id] : MT.registerModule(def);
  }

  /*
   * Garde des mots-clés (rapprochement par mots d'app.js : minuscules sans
   * accents, -s/-x finals retirés). Refuse les mots vides, les mots de moins
   * de 3 lettres et deux formes du même mot.
   */
  const STOPWORDS = new Set([
    'de', 'des', 'du', 'la', 'le', 'les', 'un', 'une', 'et', 'en', 'au', 'aux', 'sur', 'dans', 'avec', 'pour',
    'par', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'qui', 'que', 'est', 'il', 'elle',
  ]);
  const kwNorm = (s) =>
    String(s).toLowerCase().replace(/œ/g, 'oe').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const kwStem = (w) => (w.length > 3 ? w.replace(/[sx]$/, '') : w);
  function keywords(list) {
    const seen = new Map();
    for (const k of list) {
      const n = kwNorm(k);
      const words = n.split(' ');
      if (words.every((w) => STOPWORDS.has(w))) throw new Error(`mot-clé vide : « ${k} »`);
      if (words.length === 1) {
        if (n.length < 3) throw new Error(`mot-clé trop court : « ${k} »`);
        const s = kwStem(n);
        if (seen.has(s)) throw new Error(`mot-clé en double : « ${k} » et « ${seen.get(s)} »`);
        seen.set(s, k);
      }
    }
    return list;
  }

  /**
   * Essaie fn comme partie optionnelle : annule tout si une pièce manque ou
   * si la construction dépasse `max` pièces. Renvoie true si c'est posé.
   */
  const OVER = { over: true };
  function tryWithin(b, max, fn) {
    try {
      return b.tryBuild(() => {
        fn();
        if (max != null && count(b) > max) throw OVER;
      });
    } catch (e) {
      if (e === OVER) return false;
      throw e;
    }
  }

  /** Répartit des actions (une pièce ou un petit groupe chacune) en étapes d'au plus `max` actions. */
  function steps(b, label, jobs, max) {
    if (!jobs.length) return;
    const m = max || 10;
    const n = Math.ceil(jobs.length / m);
    const per = Math.ceil(jobs.length / n);
    for (let k = 0; k < n; k++) {
      b.step(n > 1 ? `${label} (${k + 1}/${n})` : label);
      for (const f of jobs.slice(k * per, (k + 1) * per)) f();
    }
  }

  /** Murs du périmètre d'un rectangle (même parcours que b.room), sous forme d'actions. */
  function roomJobs(b, x0, y, z0, w, d, kind) {
    const jobs = [];
    const k = (side, i, x, z) => (typeof kind === 'function' ? kind({ side, i, x, z, y }) : kind || 'solid');
    const go = (side, i, x, z) => {
      const kk = k(side, i, x, z);
      if (kk) jobs.push(() => b.wall(x, y, z, side, kk));
    };
    for (let i = 0; i < w; i++) go('N', i, x0 + i, z0);
    for (let j = 0; j < d; j++) go('E', j, x0 + w - 1, z0 + j);
    for (let i = w - 1; i >= 0; i--) go('S', i, x0 + i, z0 + d - 1);
    for (let j = d - 1; j >= 0; j--) go('W', j, x0, z0 + j);
    return jobs;
  }

  /** Carrés horizontaux d'un rectangle, sous forme d'actions. */
  function floorJobs(b, x0, y, z0, w, d, kind, skip) {
    const jobs = [];
    for (let j = 0; j < d; j++) {
      for (let i = 0; i < w; i++) {
        if (skip && skip(i, j)) continue;
        jobs.push(() => b.floor(x0 + i, y, z0 + j, typeof kind === 'function' ? kind(i, j) : kind || 'floor'));
      }
    }
    return jobs;
  }

  /** Rangée j (0 = en bas) d'un grand triangle équilatéral A-B-Q de côté n pavé en triangles 'EQ'. */
  function triRowJobs(b, A, B, Q, n, j) {
    const e1 = scale(sub(B, A), 1 / n), e2 = scale(sub(Q, A), 1 / n);
    const P = (i, jj) => madd(madd(A, e1, i), e2, jj);
    const jobs = [];
    for (let i = 0; i + j <= n - 1; i++) {
      jobs.push(() => b.tri('EQ', P(i, j), P(i + 1, j), P(i, j + 1)));
      if (i + j <= n - 2) jobs.push(() => b.tri('EQ', P(i, j + 1), P(i + 1, j + 1), P(i + 1, j)));
    }
    return jobs;
  }

  /** Rangée j (0 = en bas) d'une pyramide n × n à faces équilatérales pavées (identique à b.bigPyramid). */
  function pyramidRowJobs(b, x, y, z, n, j) {
    const Q = [x + n / 2, y + n / S2, z + n / 2];
    const c = [[x, y, z], [x, y, z + n], [x + n, y, z + n], [x + n, y, z]];
    const jobs = [];
    for (let f = 0; f < 4; f++) jobs.push(...triRowJobs(b, c[f], c[(f + 1) % 4], Q, n, j));
    return jobs;
  }

  /**
   * Grande flèche 2 × 2 : chaque face est un grand triangle isocèle agrandi deux
   * fois, pavé de 4 grands triangles (3 en bas dont un renversé, 1 en haut).
   * 16 grands triangles, 3,5 de haut. Renvoie les actions des deux rangées.
   */
  function bigSpireRows(b, x0, y, z0) {
    const h = Math.sqrt(4 * TT_H * TT_H - 1);
    const Q = [x0 + 1, y + h, z0 + 1];
    const c = [[x0, y, z0], [x0, y, z0 + 2], [x0 + 2, y, z0 + 2], [x0 + 2, y, z0]];
    const rows = [[], []];
    for (let j = 0; j < 2; j++) {
      for (let f = 0; f < 4; f++) {
        const A = c[f], B = c[(f + 1) % 4];
        const e1 = scale(sub(B, A), 0.5), e2 = scale(sub(Q, A), 0.5);
        const P = (i, jj) => madd(madd(A, e1, i), e2, jj);
        for (let i = 0; i + j <= 1; i++) {
          rows[j].push(() => b.tri('TT', P(i, j), P(i + 1, j), P(i, j + 1)));
          if (i + j <= 0) rows[j].push(() => b.tri('TT', P(i, j + 1), P(i + 1, j + 1), P(i + 1, j)));
        }
      }
    }
    return rows;
  }

  /**
   * Toit pointu 1 × 1 avec repli : flèche (4 grands triangles) → pyramide
   * (4 triangles équilatéraux) → toit plat (1 carré), sauf noFlat. want : 'TT' | 'EQ' | 'plat'.
   * Renvoie le genre réellement disponible et signale le repli par b.note.
   */
  function pickSpire(b, want, what, noFlat) {
    let k = want;
    if (k === 'TT' && b.available('TT') < 4) k = 'EQ';
    // noFlat : une cime plate n'a pas de sens (sapin) ; la pyramide manquera et le module sera écarté.
    if (k === 'EQ' && b.available('EQ') < 4 && !noFlat) k = 'plat';
    if (k !== want && what) {
      b.note(k === 'EQ'
        ? `${what} : pyramide au lieu d’une flèche, faute de grands triangles`
        : `${what} : toit plat, faute de triangles`);
    }
    return k;
  }
  function placeSpire(b, x, y, z, k) {
    if (k === 'plat') b.floor(x, y, z, 'roof');
    else b.pyramidRoof(x, y, z, k);
  }
  /** Choisit puis pose un toit pointu 1 × 1 (voir pickSpire). */
  function spire(b, x, y, z, want, what) {
    const k = pickSpire(b, want, what);
    placeSpire(b, x, y, z, k);
    return k;
  }

  /** Aileron / branche : triangle rectangle vertical dont l'angle droit est en (x, y, z), pointant vers (dx, dz). */
  function fin(b, x, z, dx, dz, y) {
    const y0 = y || 0;
    const l = Math.hypot(dx, dz);
    return b.tri('RT', [x, y0, z], [x + dx / l, y0, z + dz / l], [x, y0 + 1, z]);
  }
  /** Palme pendante : triangle rectangle accroché en haut d'une arête verticale (angle droit en haut). */
  function frond(b, x, z, dx, dz, y) {
    const l = Math.hypot(dx, dz);
    return b.tri('RT', [x, y, z], [x + dx / l, y, z + dz / l], [x, y - 1, z]);
  }
  // Coins d'une cellule avec la direction diagonale vers l'extérieur.
  const cornersOut = (x, z, w) => [[x, z, -1, -1], [x + w, z, 1, -1], [x + w, z + w, 1, 1], [x, z + w, -1, 1]];

  // Bruit déterministe (dérivé de la graine) pour départager les emplacements.
  function hashNoise(x, z, salt) {
    const s = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
    return s - Math.floor(s);
  }

  /**
   * Plan d'implantation sur la grille : cherche l'emplacement libre le plus
   * proche d'un point visé en gardant `gap` cellules vides entre deux
   * éléments, puis pose le module (optionnel : annulé s'il ne tient pas).
   */
  class Layout {
    constructor(b, opts) {
      this.b = b;
      this.occ = new Set();
      this.o = Object.assign({ minX: 0, minZ: 0, maxX: Infinity, maxZ: Infinity }, opts || {});
      this.salt = b.rng.int(1, 9999);
    }
    free(x, z, w, d, gap) {
      const o = this.o;
      if (x < o.minX || z < o.minZ || x + w > o.maxX || z + d > o.maxZ) return false;
      for (let i = -gap; i < w + gap; i++) {
        for (let j = -gap; j < d + gap; j++) if (this.occ.has(`${x + i},${z + j}`)) return false;
      }
      return true;
    }
    mark(x, z, w, d) {
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) this.occ.add(`${x + i},${z + j}`);
    }
    spot(w, d, tx, tz, gap, jitter) {
      const R = 16;
      const x0 = Math.round(tx - w / 2), z0 = Math.round(tz - d / 2);
      let best = null;
      for (let x = x0 - R; x <= x0 + R; x++) {
        for (let z = z0 - R; z <= z0 + R; z++) {
          if (!this.free(x, z, w, d, gap)) continue;
          const s = Math.hypot(x + w / 2 - tx, z + d / 2 - tz) + (jitter || 0) * hashNoise(x, z, this.salt);
          if (!best || s < best.s - 1e-9) best = { x, z, s };
        }
      }
      return best;
    }
    /**
     * Pose le module `id`. po : { at: [x, z] | tx, tz, rot, label, optional, max, gap, jitter }.
     * Renvoie { x, z, w, d, cx, cz, info } (info = valeur rendue par le module) ou null.
     */
    put(id, params, po) {
      const b = this.b;
      const rot = po.rot || 0;
      const fp = MT.footprintOf(id, params, rot);
      const w = Math.ceil(fp.w - 1e-9), d = Math.ceil(fp.d - 1e-9);
      const gap = po.gap == null ? 1 : po.gap;
      let s;
      if (po.at) {
        s = { x: po.at[0], z: po.at[1] };
        if (!this.free(s.x, s.z, w, d, gap)) s = this.spot(w, d, s.x + w / 2, s.z + d / 2, gap, 0);
      } else {
        s = this.spot(w, d, po.tx, po.tz, gap, po.jitter == null ? 1.2 : po.jitter);
      }
      if (!s) return null;
      let info;
      const run = () => {
        info = b.module(id, s.x, s.z, params, { rot, label: po.label });
      };
      if (po.optional) {
        if (!tryWithin(b, po.max, run)) return null;
      } else {
        run();
      }
      this.mark(s.x, s.z, w, d);
      return { x: s.x, z: s.z, w, d, cx: s.x + w / 2, cz: s.z + d / 2, info: info || {} };
    }
  }

  /** Rotation (0/90/180/270) pour qu'un module dont la façade regarde −X (local) regarde vers (dx, dz). */
  function rotFacingFromMinusX(dx, dz) {
    if (Math.abs(dx) >= Math.abs(dz)) return dx > 0 ? 180 : 0;
    return dz > 0 ? 90 : 270;
  }
  /** Rotation pour qu'un module dont la façade regarde +Z (local) regarde vers (dx, dz). */
  function rotFacingFromPlusZ(dx, dz) {
    if (Math.abs(dz) >= Math.abs(dx)) return dz > 0 ? 0 : 180;
    return dx > 0 ? 90 : 270;
  }

  // « a, b et c »
  const listFr = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} et ${a[a.length - 1]}` : a[0] || '');
  // « une tente » / « 3 tentes » : `one` contient l'article du singulier.
  const plural = (n, one, many) => (n > 1 ? `${n} ${many}` : one);

  // ============================================================ ESPACE
  // Livrées de fusée : a / b = anneaux alternés, hub = anneau des hublots sous la coiffe.
  const LIVERIES = [
    { a: 'solid', b: 'solid', hub: 'window' },
    { a: 'solid', b: 'frame', hub: 'window' },
    { a: 'window2', b: 'solid', hub: 'window' },
    { a: 'solid', b: 'window', hub: 'frame' },
    { a: 'frame', b: 'solid', hub: 'window2' },
  ];
  // Sur le pas de tir, la tour en treillis prend les cadres et les fenêtres 4 carreaux.
  const LIVERIES_PAD = [
    { a: 'solid', b: 'solid', hub: 'window2' },
    { a: 'solid', b: 'window2', hub: 'window2' },
    { a: 'window2', b: 'solid', hub: 'solid' },
  ];
  function rocketKind(liv, l, L, side, w) {
    if (l === 0) return 'solid';
    if (l === L - 1) return w === 2 || side === 'S' || side === 'N' ? liv.hub : 'solid';
    return l % 2 ? liv.a : liv.b;
  }

  /**
   * Fusée dont le corps w × w commence en (x0, z0), sol à y = 0.
   * o : { width 1|2, levels, cone 'fleche'|'pyramide', fins, boosters, boosterLevels, capsule, pad, prefix }
   * Propulseurs : colonnes 1 × 1 collées aux faces du corps (mur commun sur toute
   * leur hauteur) — faces N et S (2 propulseurs, ou 4 pour un corps 2 × 2), ou les
   * 4 faces pour une fusée seule quand les grands triangles suffisent à 4 pointes.
   * Pointes en flèche si le stock de grands triangles le permet, sinon pyramide.
   * Ailerons : triangles rectangles verticaux, dans le prolongement des propulseurs
   * ou en diagonale aux coins du corps.
   * Renvoie { top, boosters, tip, cone } (ce qui a vraiment été posé).
   */
  function buildRocket(b, x0, z0, o) {
    const rng = b.rng;
    const w = o.width === 2 ? 2 : 1;
    const L = o.levels;
    const liv = rng.pick(o.pad ? LIVERIES_PAD : LIVERIES);
    const pre = o.prefix || '';
    // Coiffe : flèche → pyramide → toit plat, selon le stock.
    const coneNeed = w === 2 ? 16 : 4;
    const want = o.cone === 'pyramide' ? 'EQ' : 'TT';
    let cone = want;
    if (cone === 'TT' && !b.canAfford({ TT: coneNeed })) cone = 'EQ';
    if (cone === 'EQ' && !b.canAfford({ EQ: coneNeed })) cone = 'plat';
    if (cone !== want) b.note(cone === 'EQ' ? 'Fusée : coiffe en pyramide, faute de grands triangles' : 'Fusée : coiffe plate, faute de triangles');
    const coneTT = cone === 'TT' ? coneNeed : 0, coneEQ = cone === 'EQ' ? coneNeed : 0;
    // Propulseurs collés aux faces.
    let faces = [];
    if (o.boosters) faces = w === 1 && !o.pad && b.canAfford({ TT: 16 + coneTT }) ? ['N', 'E', 'S', 'W'] : ['N', 'S'];
    const bcells = [];
    for (const f of faces) {
      for (let i = 0; i < w; i++) {
        if (f === 'N') bcells.push([x0 + i, z0 - 1]);
        if (f === 'S') bcells.push([x0 + i, z0 + w]);
        if (f === 'W') bcells.push([x0 - 1, z0 + i]);
        if (f === 'E') bcells.push([x0 + w, z0 + i]);
      }
    }
    const nb = bcells.length;
    let tip = null;
    if (nb) {
      tip = b.canAfford({ TT: 4 * nb + coneTT }) ? 'TT' : b.canAfford({ EQ: 4 * nb + coneEQ }) ? 'EQ' : 'plat';
      if (tip !== 'TT') b.note(`Propulseurs : pointes ${tip === 'EQ' ? 'en pyramide' : 'plates'}, faute de grands triangles`);
    }
    const Lb = nb ? Math.max(1, Math.min(3, o.boosterLevels || L - 2, L - 1)) : 0;
    // Ailerons : dans le prolongement des propulseurs N et S, sinon en diagonale aux coins du corps.
    const fins = faces.length === 2
      ? [[x0, z0 - 1, -1, 0], [x0 + w, z0 - 1, 1, 0], [x0 + w, z0 + w + 1, 1, 0], [x0, z0 + w + 1, -1, 0]]
      : cornersOut(x0, z0, w);
    for (let l = 0; l < L; l++) {
      steps(b, `${pre}Corps — niveau ${l + 1}`, roomJobs(b, x0, l, z0, w, w, ({ side }) => rocketKind(liv, l, L, side, w)), 8);
      if (l < Lb) {
        const jobs = [];
        for (const [bx, bz] of bcells) jobs.push(...roomJobs(b, bx, l, bz, 1, 1, 'solid'));
        steps(b, `${pre}Propulseurs — niveau ${l + 1}`, jobs, 8);
      }
      if (l === 0 && o.fins !== false) {
        b.step(`${pre}Ailerons`);
        for (const [cx, cz, dx, dz] of fins) fin(b, cx, cz, dx, dz);
      }
      if (nb && l === Lb - 1) {
        const jobs = bcells.map(([bx, bz]) => () => placeSpire(b, bx, Lb, bz, tip));
        steps(b, `${pre}Pointes des propulseurs`, jobs, 2);
      }
    }
    let top = L;
    if (o.capsule && w === 1 && b.available('HR!') >= 4) {
      steps(b, `${pre}Capsule`, roomJobs(b, x0, L, z0, 1, 1, 'HR!'));
      top += HR_H;
    }
    if (w === 1) {
      b.step(`${pre}Coiffe`);
      placeSpire(b, x0, top, z0, cone);
    } else if (cone === 'TT') {
      const rows = bigSpireRows(b, x0, top, z0);
      steps(b, `${pre}Coiffe — grande flèche`, rows[0], 12);
      steps(b, `${pre}Coiffe — pointe`, rows[1], 12);
    } else if (cone === 'EQ') {
      for (let j = 0; j < 2; j++) steps(b, `${pre}Coiffe — rangée ${j + 1}`, pyramidRowJobs(b, x0, top, z0, 2, j), 12);
    } else {
      steps(b, `${pre}Coiffe`, floorJobs(b, x0, top, z0, 2, 2, 'roof'));
    }
    return { top, boosters: nb, tip, cone };
  }

  /**
   * Tour de lancement 1 × 1 en treillis (tx, tz), T niveaux, avec passerelles :
   * carrés horizontaux posés sur la cellule (armX, armZ) entre la tour et la
   * fusée, aux hauteurs de `arms`. Chaque niveau est d'un seul type de carré
   * ajouré (cadres, sinon fenêtres), garde-corps en demi-rectangles.
   */
  function buildGantry(b, tx, tz, T, o) {
    for (let l = 0; l < T; l++) {
      const arm = o.arms.includes(l + 1);
      const kind = ['FRAME!', 'WIN4!', 'WIN2!'].find((k) => b.available(k) >= 4) || 'solid';
      const jobs = roomJobs(b, tx, l, tz, 1, 1, kind);
      if (arm) jobs.push(() => b.floor(o.armX, l + 1, o.armZ, 'floor'));
      steps(b, arm ? `Tour de lancement — niveau ${l + 1} et passerelle` : `Tour de lancement — niveau ${l + 1}`, jobs, 8);
    }
    if (b.available('HR!') >= 4) steps(b, 'Tour de lancement — garde-corps', roomJobs(b, tx, T, tz, 1, 1, 'HR!'));
    else {
      b.step('Tour de lancement — plateforme');
      b.floor(tx, T, tz, 'roof');
    }
  }

  /** Pas de tir complet (plateforme, fusée, tour, passerelles), fusée au coin (1, 1) de l'emprise. */
  function buildLaunchPad(b, p) {
    const w = p.largeur;
    const x0 = 1, z0 = 1;
    if (p.plateforme) steps(b, 'Plateforme de lancement', floorJobs(b, x0 - 1, 0, z0 - 1, w + 2, w + 2, 'floor'), 9);
    const r = buildRocket(b, x0, z0, {
      width: w, levels: p.niveaux, cone: p.coiffe, fins: true, boosters: p.propulseurs, pad: true,
      boosterLevels: Math.floor(p.niveaux / 2), capsule: p.capsule, prefix: 'Fusée — ',
    });
    const T = Math.min(p.tour, 6);
    const hmax = Math.min(T, p.niveaux);
    const arms = [];
    for (let k = 0; k < p.passerelles && hmax - 2 * k >= 1; k++) arms.push(hmax - 2 * k);
    buildGantry(b, x0 + w + 1, z0, T, { arms, armX: x0 + w, armZ: z0 });
    return Object.assign(r, { arms: arms.length });
  }

  /** Rover : plateau à roues le long de X en (x, z), cabine à l'arrière, benne en demi-rectangles à l'avant. */
  function buildRover(b, x, z, p) {
    const y = CAR.top;
    // Benne en demi-rectangles seulement (des créneaux lui donneraient un air de château).
    const benne = p.benne && b.available('HR!') >= 3;
    if (p.benne && !benne) b.note('Rover : sans benne, faute de demi-rectangles');
    b.step(benne ? 'Châssis, cabine, benne et toit' : 'Châssis, cabine et toit');
    b.car(x, z, 'x');
    b.box(x, y, z, { W: 'solid', N: 'window2', S: 'window2', E: 'window' });
    if (benne) for (const side of ['N', 'E', 'S']) b.halfWall(x + 1, y, z, side, 'HR!');
    if (p.toit === 'bulle') spire(b, x, y + 1, z, 'EQ', 'Rover');
    else {
      b.floor(x, y + 1, z, 'roof');
      if (p.toit === 'antenne') b.tri('RT', [x, y + 1, z], [x, y + 1, z + 1], [x, y + 2, z]);
    }
  }

  /** Base lunaire : n modules 1 × 1 à toit pyramidal le long de X, reliés par des couloirs ; antenne en option (rangée z + 2). */
  function buildLunarBase(b, x, z, n, antenna) {
    const rng = b.rng;
    for (let k = 0; k < n; k++) {
      const cx = x + 2 * k;
      b.step(k ? `Module ${k + 1} et couloir` : 'Module 1');
      b.box(cx, 0, z, {
        N: rng.pick(['solid', 'window2', 'solid']), S: 'window',
        W: k > 0 ? 'arch' : 'window', E: k < n - 1 ? 'arch' : 'window',
      });
      if (k > 0) {
        b.wall(cx - 1, 0, z, 'N', 'solid');
        b.wall(cx - 1, 0, z, 'S', 'window2');
        b.floor(cx - 1, 1, z, 'roof');
      }
      spire(b, cx, 1, z, 'EQ', `Module ${k + 1}`);
    }
    let mast = 0;
    if (antenna) {
      // Mât en cadres seulement : jamais une tour pleine.
      mast = b.available('FRAME!') >= 8 ? 2 : b.available('FRAME!') >= 4 ? 1 : 0;
      if (!mast) b.note('Base lunaire : pas d’antenne, faute de cadres');
      else {
        const jobs = [];
        for (let l = 0; l < mast; l++) jobs.push(...roomJobs(b, x, l, z + 2, 1, 1, 'FRAME!'));
        steps(b, 'Antenne — mât', jobs);
        b.step('Antenne — pointe');
        spire(b, x, mast, z + 2, 'TT', 'Antenne');
      }
    }
    return { modules: n, antenna: mast > 0 };
  }

  // ------------------------------------------------------------ modules espace
  registerModule({
    id: 'fusee',
    label: 'Fusée',
    description:
      'Fusée : corps de carrés 1 × 1 ou 2 × 2 à hublots, coiffe en flèche (4 grands triangles, 16 en 2 × 2) ou pyramide, ' +
      '4 ailerons (triangles rectangles), propulseurs collés aux faces en option. Emprise largeur + 2.',
    params: {
      largeur: { type: 'int', min: 1, max: 2, default: 1, label: 'Diamètre (1 ou 2 carrés)' },
      niveaux: { type: 'int', min: 2, max: 6, default: 4, label: 'Niveaux du corps' },
      coiffe: { type: 'enum', values: ['fleche', 'pyramide'], default: 'fleche', label: 'Coiffe' },
      propulseurs: { type: 'bool', default: false, label: 'Propulseurs d’appoint' },
      ailerons: { type: 'bool', default: true, label: 'Ailerons' },
    },
    footprint: (p) => ({ w: p.largeur + 2, d: p.largeur + 2 }),
    build(b, p) {
      return buildRocket(b, 1, 1, {
        width: p.largeur, levels: p.niveaux, cone: p.coiffe, fins: p.ailerons, boosters: p.propulseurs,
        boosterLevels: Math.floor(p.niveaux / 2),
      });
    },
  });

  registerModule({
    id: 'pas-de-tir',
    label: 'Pas de tir',
    description:
      'Scène spatiale : fusée (1 × 1 ou 2 × 2, ailerons, propulseurs N et S en option) sur plateforme de carrés, ' +
      'tour de lancement en treillis de cadres à l’est, passerelles vers la fusée, garde-corps en demi-rectangles.',
    params: {
      largeur: { type: 'int', min: 1, max: 2, default: 1, label: 'Diamètre de la fusée' },
      niveaux: { type: 'int', min: 3, max: 6, default: 5, label: 'Niveaux de la fusée' },
      tour: { type: 'int', min: 2, max: 6, default: 4, label: 'Niveaux de la tour' },
      passerelles: { type: 'int', min: 1, max: 3, default: 2, label: 'Passerelles' },
      coiffe: { type: 'enum', values: ['fleche', 'pyramide'], default: 'fleche', label: 'Coiffe' },
      plateforme: { type: 'bool', default: true, label: 'Plateforme au sol' },
      propulseurs: { type: 'bool', default: false, label: 'Propulseurs d’appoint' },
      capsule: { type: 'bool', default: false, label: 'Capsule (anneau de demi-rectangles)' },
    },
    footprint: (p) => ({ w: p.largeur + 3, d: p.largeur + 2 }),
    build(b, p) {
      return buildLaunchPad(b, p);
    },
  });

  registerModule({
    id: 'rover',
    label: 'Rover lunaire',
    description:
      'Petit véhicule : plateau à roues (1 pièce, 2 par pack), cabine 1 × 1 vitrée à l’arrière avec dôme, toit plat ou antenne, ' +
      'benne en demi-rectangles à l’avant. Orienté le long de X, avant vers +X.',
    params: {
      toit: { type: 'enum', values: ['bulle', 'plat', 'antenne'], default: 'bulle', label: 'Toit de la cabine' },
      benne: { type: 'bool', default: true, label: 'Benne à l’avant' },
    },
    footprint: () => ({ w: 3, d: 1 }),
    build(b, p) {
      buildRover(b, 0.5, 0, p);
    },
  });

  registerModule({
    id: 'base-lunaire',
    label: 'Base lunaire',
    description:
      'Rangée de modules d’habitation 1 × 1 à toit pyramidal (triangles équilatéraux), hublots, reliés par des couloirs ' +
      'couverts avec portes en arche ; antenne-mât en cadres en option (derrière, rangée z + 2).',
    params: {
      modules: { type: 'int', min: 1, max: 5, default: 3, label: 'Modules' },
      antenne: { type: 'bool', default: true, label: 'Antenne' },
    },
    footprint: (p) => ({ w: 2 * p.modules - 1, d: p.antenne ? 3 : 1 }),
    build(b, p) {
      return buildLunarBase(b, 0, 0, p.modules, p.antenne);
    },
  });

  // ============================================================ ÉGYPTE
  /** Grande pyramide n × n (4n² triangles), rangée par rangée ; base de carrés en option. */
  function buildPyramid(b, x, z, n, base) {
    if (base) steps(b, 'Base', floorJobs(b, x, 0, z, n, n, 'floor'), 9);
    for (let j = 0; j < n; j++) steps(b, n > 1 ? `Rangée ${j + 1}` : 'Faces', pyramidRowJobs(b, x, 0, z, n, j), 12);
  }

  /**
   * Obélisque : socle en demi-rectangles (option), fût 1 × 1 de carrés pleins avec
   * un seul panneau gravé (fenêtre double) en façade, pointe en pyramidion ou en flèche.
   */
  function buildObelisk(b, x, z, levels, tip, socle) {
    let y0 = 0;
    if (socle) {
      if (b.available('HR!') >= 4) {
        steps(b, 'Socle', roomJobs(b, x, 0, z, 1, 1, 'HR!'));
        y0 = HR_H;
      } else b.note('Obélisque : sans socle, faute de demi-rectangles');
    }
    const carved = Math.min(1, levels - 1);
    for (let l = 0; l < levels; l++) {
      const jobs = roomJobs(b, x, y0 + l, z, 1, 1, ({ side }) => (l === carved && side === 'S' && b.available('WIN2!') > 0 ? 'WIN2!' : 'SQ!'));
      steps(b, levels > 1 ? `Fût — niveau ${l + 1}` : 'Fût', jobs);
    }
    const k = pickSpire(b, tip === 'fleche' ? 'TT' : 'EQ', 'Obélisque');
    b.step(k === 'TT' ? 'Flèche' : k === 'EQ' ? 'Pyramidion' : 'Sommet');
    placeSpire(b, x, y0 + levels, z, k);
    return { tip: k };
  }

  /**
   * Ziggourat (pyramide à degrés) : e étages de (2e−1)² à 1 cellule.
   * Les enceintes des étages supérieurs descendent jusqu'au sol (murs porteurs
   * cachés, en carrés ajourés) : chaque dalle de terrasse repose sur deux murs
   * et chaque étage est posé sur des murs, jamais en porte-à-faux.
   */
  function buildZiggurat(b, x, z, e, top) {
    for (let s = 0; s < e; s++) {
      const m = 2 * (e - s) - 1, ox = x + s, oz = z + s, y = s;
      const mid = (m - 1) / 2;
      const walls = roomJobs(b, ox, y, oz, m, m, ({ side, i }) => {
        if (side === 'S' && i === mid) return s === e - 1 || s === 0 ? 'arch' : 'frame';
        return 'solid';
      });
      const inner = [];
      for (let t = s + 1; t < e; t++) {
        const mt = 2 * (e - t) - 1;
        inner.push(...roomJobs(b, x + t, y, z + t, mt, mt, 'window'));
      }
      if (m > 1) {
        steps(b, `Étage ${s + 1} — murs`, walls, 10);
        steps(b, `Étage ${s + 1} — murs porteurs intérieurs`, inner, 10);
        steps(b, `Étage ${s + 1} — terrasse`, floorJobs(b, ox, y + 1, oz, m, m, 'floor', (i, j) => i > 0 && j > 0 && i < m - 1 && j < m - 1), 10);
      } else {
        steps(b, 'Sanctuaire', walls, 10);
        b.step('Sanctuaire — toit');
        if (top === 'plat') b.floor(ox, y + 1, oz, 'roof');
        else if (top === 'creneaux') b.crenelRim(ox, y + 1, oz, 1, 1);
        else spire(b, ox, y + 1, oz, 'EQ', 'Ziggourat');
      }
    }
  }

  /**
   * Temple : façade d'arcades (+Z), côtés en cadres (colonnade), fond et cloison porteuse intérieure
   * dès 3 × 2 (chaque dalle du toit repose sur deux murs), toit plat de carrés
   * pleins, pylônes en option aux angles de la façade.
   */
  function buildTemple(b, x, z, w, d, pylons) {
    const walls = roomJobs(b, x, 0, z, w, d, ({ side }) => (side === 'S' ? 'arch' : side === 'N' ? 'solid' : 'frame'));
    if (d >= 2 && w >= 3) {
      const door = w % 2 ? (w - 1) / 2 : -1;
      for (let i = 1; i < w - 1; i++) walls.push(() => b.wall(x + i, 0, z, 'S', i === door ? 'arch' : 'solid'));
    }
    let rk = 'SQ!';
    if (b.available('SQ!') < w * d) {
      rk = 'roof';
      b.note('Temple : toit en partie ajouré, faute de carrés pleins');
    }
    const roof = floorJobs(b, x, 1, z, w, d, rk);
    if (walls.length + roof.length <= 12) steps(b, 'Arcades et toit', [...walls, ...roof], 12);
    else {
      steps(b, 'Arcades et murs', walls, 10);
      steps(b, 'Toit', roof, 10);
    }
    if (pylons && w >= 2) {
      const jobs = [];
      for (const px of [x, x + w - 1]) {
        jobs.push(...roomJobs(b, px, 1, z + d - 1, 1, 1, ({ side }) => (side === 'S' ? 'window2' : 'solid')));
        jobs.push(() => b.floor(px, 2, z + d - 1, 'roof'));
      }
      steps(b, 'Pylônes', jobs, 10);
    }
    return { pylons: !!(pylons && w >= 2) };
  }

  /**
   * Sphinx couché, regard vers −X : pattes avant en triangles rectangles, tête
   * cubique (visage en fenêtre) plus haute que le corps, corps bas en
   * demi-rectangles couvert d'un dos de carrés, coiffe (némès) pointue.
   * Emprise (len + 2) × 1 : pattes, tête, puis len cellules de corps.
   */
  function buildSphinx(b, x, z, len, coiffe) {
    const hx = x + 1, bx = x + 2;
    const low = b.available('HR!') >= 2 * len + 1;
    if (!low) b.note('Sphinx : corps en carrés, faute de demi-rectangles');
    b.step('Tête et pattes');
    b.box(hx, 0, z, { W: 'window', N: 'solid', S: 'solid', E: 'solid' });
    fin(b, hx, z, -1, 0);
    fin(b, hx, z + 1, -1, 0);
    const bk = low ? 'HR!' : 'solid', bh = low ? HR_H : 1;
    b.step('Corps et dos');
    for (let i = 0; i < len; i++) {
      b.wall(bx + i, 0, z, 'N', bk);
      b.wall(bx + i, 0, z, 'S', bk);
    }
    b.wall(bx + len - 1, 0, z, 'E', bk);
    for (let i = 0; i < len; i++) b.floor(bx + i, bh, z, 'roof');
    b.step('Coiffe');
    const k = spire(b, hx, 1, z, coiffe === 'fleche' ? 'TT' : coiffe === 'plate' ? 'plat' : 'EQ', 'Sphinx');
    return { coiffe: k, low };
  }

  /** Palmier : tronc 1 × 1 au centre d'une emprise 3 × 3, palmes pendantes en triangles rectangles, toit plat. */
  function buildPalm(b, x, z, levels, bushy) {
    const cx = x + 1, cz = z + 1;
    // Chaque niveau du tronc d'un seul type de carré quand le stock le permet.
    const left = {};
    for (const t of ['SQ', 'WIN2', 'FRAME', 'WIN4']) left[t] = b.available(t + '!');
    const jobs = [];
    for (let l = 0; l < levels; l++) {
      const t = ['SQ', 'WIN2', 'FRAME', 'WIN4'].find((u) => left[u] >= 4 * (levels - l)) || ['SQ', 'WIN2', 'FRAME', 'WIN4'].find((u) => left[u] >= 4);
      if (t) left[t] -= 4;
      jobs.push(...roomJobs(b, cx, l, cz, 1, 1, t ? t + '!' : 'solid'));
    }
    steps(b, 'Tronc', jobs, 8);
    b.step('Palmes');
    b.floor(cx, levels, cz, 'roof');
    for (const [px, pz, dx, dz] of cornersOut(cx, cz, 1)) {
      if (bushy) {
        frond(b, px, pz, dx, 0, levels);
        frond(b, px, pz, 0, dz, levels);
      } else frond(b, px, pz, dx, dz, levels);
    }
  }

  registerModule({
    id: 'pyramide',
    label: 'Pyramide',
    description:
      'Grande pyramide à base carrée n × n dont chaque face est un grand triangle pavé de triangles équilatéraux ' +
      '(n = 1 : 4 triangles, n = 2 : 16, n = 3 : 36 — double pack). Base de carrés en option.',
    params: {
      n: { type: 'int', min: 1, max: 3, default: 2, label: 'Côté (en carrés)' },
      base: { type: 'bool', default: false, label: 'Base de carrés' },
    },
    footprint: (p) => ({ w: p.n, d: p.n }),
    build(b, p) {
      buildPyramid(b, 0, 0, p.n, p.base);
    },
  });

  registerModule({
    id: 'obelisque',
    label: 'Obélisque',
    description:
      'Obélisque : fût 1 × 1 de carrés pleins (un panneau gravé en façade), pointe en pyramidion (4 triangles équilatéraux) ' +
      'ou en flèche (4 grands triangles), socle en demi-rectangles en option. Repli : pyramide, puis sommet plat.',
    params: {
      niveaux: { type: 'int', min: 1, max: 4, default: 2, label: 'Hauteur du fût' },
      pointe: { type: 'enum', values: ['pyramidion', 'fleche'], default: 'pyramidion', label: 'Pointe' },
      socle: { type: 'bool', default: false, label: 'Socle' },
    },
    footprint: () => ({ w: 1, d: 1 }),
    build(b, p) {
      return buildObelisk(b, 0, 0, p.niveaux, p.pointe, p.socle);
    },
  });

  registerModule({
    id: 'ziggourat',
    label: 'Ziggourat',
    description:
      'Pyramide à degrés : étages de murs couverts d’une terrasse de carrés, sur murs porteurs intérieurs, ' +
      'de 3 × 3 (2 étages, 28 carrés) ou 5 × 5 (3 étages, 80 carrés, double pack) jusqu’au sanctuaire à porte en arche.',
    params: {
      etages: { type: 'int', min: 2, max: 3, default: 2, label: 'Étages' },
      sommet: { type: 'enum', values: ['pyramide', 'plat', 'creneaux'], default: 'pyramide', label: 'Toit du sanctuaire' },
    },
    footprint: (p) => ({ w: 2 * p.etages - 1, d: 2 * p.etages - 1 }),
    build(b, p) {
      buildZiggurat(b, 0, 0, p.etages, p.sommet);
    },
  });

  registerModule({
    id: 'temple',
    label: 'Temple',
    description:
      'Temple à arcades : façade d’arches (côté +Z), côtés en cadres, cloison intérieure porteuse, toit plat de carrés pleins, ' +
      'deux pylônes aux angles de la façade en option.',
    params: {
      largeur: { type: 'int', min: 2, max: 4, default: 3, label: 'Largeur de façade' },
      profondeur: { type: 'int', min: 1, max: 2, default: 2, label: 'Profondeur' },
      pylones: { type: 'bool', default: true, label: 'Pylônes' },
    },
    footprint: (p) => ({ w: p.largeur, d: p.profondeur }),
    build(b, p) {
      return buildTemple(b, 0, 0, p.largeur, p.profondeur, p.pylones);
    },
  });

  registerModule({
    id: 'c-sphinx',
    label: 'Sphinx',
    description:
      'Sphinx couché, regard vers −X : pattes en triangles rectangles, tête-cube (visage en fenêtre) et coiffe pointue, ' +
      'corps bas en demi-rectangles (2 × longueur + 1). Emprise (longueur + 2) × 1. Se détourne en dragon ou lion.',
    params: {
      longueur: { type: 'int', min: 2, max: 3, default: 2, label: 'Longueur du corps' },
      coiffe: { type: 'enum', values: ['pyramide', 'fleche', 'plate'], default: 'pyramide', label: 'Coiffe' },
    },
    footprint: (p) => ({ w: p.longueur + 2, d: 1 }),
    build(b, p) {
      return buildSphinx(b, 0, 0, p.longueur, p.coiffe);
    },
  });

  registerModule({
    id: 'palmier',
    label: 'Palmier',
    description:
      'Palmier d’oasis : tronc 1 × 1 de carrés (2 ou 3 niveaux) au centre d’une emprise 3 × 3, palmes pendantes en triangles ' +
      'rectangles (4, ou 8 si touffu). Aussi pour une plage ou une île.',
    params: {
      hauteur: { type: 'int', min: 2, max: 3, default: 2, label: 'Hauteur du tronc' },
      touffu: { type: 'bool', default: false, label: 'Palmes touffues (8)' },
    },
    footprint: () => ({ w: 3, d: 3 }),
    build(b, p) {
      buildPalm(b, 0, 0, p.hauteur, p.touffu);
    },
  });

  // ============================================================ SOLIDES
  const PHI = (1 + Math.sqrt(5)) / 2;
  function ringPts(n, r, y, a0) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const a = ((a0 + (360 * k) / n) * Math.PI) / 180;
      out.push([r * Math.cos(a), y, r * Math.sin(a)]);
    }
    return out;
  }
  const cuboid = (a, h, c) => [
    [0, 0, 0], [a, 0, 0], [a, 0, c], [0, 0, c], [0, h, 0], [a, h, 0], [a, h, c], [0, h, c],
  ];
  const TETRA = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map((v) => scale(v, 1 / (2 * S2)));
  const OCTA = [[R2, 0, 0], [-R2, 0, 0], [0, R2, 0], [0, -R2, 0], [0, 0, R2], [0, 0, -R2]];
  const ICOSA = [];
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      ICOSA.push([0, s1 / 2, (s2 * PHI) / 2], [s1 / 2, (s2 * PHI) / 2, 0], [(s1 * PHI) / 2, 0, s2 / 2]);
    }
  }
  const SQ_PYR = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0.5, R2, 0.5]];
  const ANTI_H = Math.sqrt(1 - Math.pow(2 * R2 * Math.sin(Math.PI / 8), 2));
  const R5 = 1 / (2 * Math.sin(Math.PI / 5));
  const H5 = Math.sqrt(1 - R5 * R5);

  /*
   * Catalogue des solides convexes : sommets (arête 1, ou 2 pour les « grands »),
   * bottom 'y' = garder l'orientation donnée (face du bas en y = 0),
   * 'auto' = poser sur la plus grande face stable ; open = sans face du bas.
   */
  const SOLIDS = {
    cube: { name: 'Cube', verts: cuboid(1, 1, 1), bottom: 'y' },
    tetraedre: { name: 'Tétraèdre', verts: TETRA, bottom: 'auto' },
    pyramide: { name: 'Pyramide à base carrée', verts: SQ_PYR, bottom: 'y' },
    octaedre: { name: 'Octaèdre', verts: OCTA, bottom: 'auto' },
    icosaedre: { name: 'Icosaèdre', verts: ICOSA, bottom: 'auto' },
    prisme: {
      name: 'Prisme triangulaire couché',
      verts: [[0, 0, 0], [0, 0, 1], [0, EQ_H, 0.5], [1, 0, 0], [1, 0, 1], [1, EQ_H, 0.5]],
      bottom: 'y',
    },
    'prisme-debout': {
      name: 'Prisme triangulaire debout',
      verts: [[0, 0, 0], [1, 0, 0], [0.5, 0, EQ_H], [0, 1, 0], [1, 1, 0], [0.5, 1, EQ_H]],
      bottom: 'y',
    },
    // Même géométrie que la tente : deux carrés à 45° et deux pignons en triangles rectangles.
    'prisme-droit': {
      name: 'Prisme à triangles rectangles',
      verts: [[0, 0, 0], [1, 0, 0], [1, 0, S2], [0, 0, S2], [0, R2, R2], [1, R2, R2]],
      bottom: 'y',
      open: true,
    },
    'prisme-hexagonal': { name: 'Prisme hexagonal', verts: [...ringPts(6, 1, 0, 0), ...ringPts(6, 1, 1, 0)], bottom: 'y' },
    antiprisme: { name: 'Antiprisme carré', verts: [...ringPts(4, R2, 0, 45), ...ringPts(4, R2, ANTI_H, 0)], bottom: 'y' },
    fleche: { name: 'Flèche', verts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0.5, Math.sqrt(TT_H * TT_H - 0.25), 0.5]], bottom: 'y' },
    bipyramide: {
      name: 'Bipyramide triangulaire',
      verts: [...ringPts(3, 1 / Math.sqrt(3), 0, 90), [0, Math.sqrt(2 / 3), 0], [0, -Math.sqrt(2 / 3), 0]],
      bottom: 'auto',
    },
    'bipyramide-pentagonale': {
      name: 'Bipyramide pentagonale',
      verts: [...ringPts(5, R5, 0, 90), [0, H5, 0], [0, -H5, 0]],
      bottom: 'auto',
    },
    diamant: {
      name: 'Diamant',
      verts: [...ringPts(4, R2, 0, 45), ...ringPts(4, R2, ANTI_H, 0), [0, -R2, 0], [0, ANTI_H + R2, 0]],
      bottom: 'auto',
    },
    // Deux flèches base contre base (8 grands triangles), couché sur une face.
    cristal: {
      name: 'Cristal',
      verts: [...ringPts(4, R2, 0, 45), [0, Math.sqrt(TT_H * TT_H - 0.25), 0], [0, -Math.sqrt(TT_H * TT_H - 0.25), 0]],
      bottom: 'auto',
    },
    maison: { name: 'Maisonnette (cube et pyramide)', verts: [...cuboid(1, 1, 1), [0.5, 1 + R2, 0.5]], bottom: 'y' },
    coupole: {
      name: 'Coupole triangulaire',
      verts: [...ringPts(6, 1, 0, 0), ...ringPts(3, 1 / Math.sqrt(3), Math.sqrt(2 / 3), 30)],
      bottom: 'y',
    },
    pave: { name: 'Pavé 2 × 1 × 1', verts: cuboid(2, 1, 1), bottom: 'y' },
    'pave-plat': { name: 'Pavé plat', verts: cuboid(1, HR_H, 1), bottom: 'y' },
    'grand-pave': { name: 'Dalle 2 × 2 × 1', verts: cuboid(2, 1, 2), bottom: 'y' },
    tour: { name: 'Colonne 1 × 1 × 2', verts: cuboid(1, 2, 1), bottom: 'y' },
    'grand-cube': { name: 'Grand cube', verts: cuboid(2, 2, 2), bottom: 'y', big: true },
    'grand-tetraedre': { name: 'Grand tétraèdre', verts: TETRA.map((v) => scale(v, 2)), bottom: 'auto', big: true },
    'grande-pyramide': { name: 'Grande pyramide', verts: SQ_PYR.map((v) => scale(v, 2)), bottom: 'y', big: true },
    'grand-octaedre': { name: 'Grand octaèdre', verts: OCTA.map((v) => scale(v, 2)), bottom: 'auto', big: true },
  };

  /*
   * Assemblages de cubes (cellules [x, niveau, z]) : seules les faces
   * extérieures sont posées. Les cubes en surplomb tiennent par leurs arêtes.
   */
  const POLYCUBES = {
    'cubes-l': { name: 'L de cubes', cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] },
    'cubes-t': { name: 'T de cubes', cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 1, 0]] },
    escalier: { name: 'Escalier de cubes', cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 1, 0], [2, 1, 0], [2, 2, 0]] },
    'arche-cubes': { name: 'Arche de cubes', cells: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0], [2, 0, 0]] },
    croix: { name: 'Croix de cubes', cells: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [2, 1, 1], [1, 1, 0], [1, 1, 2], [1, 2, 1]] },
  };
  const SOLID_IDS = [...Object.keys(SOLIDS), ...Object.keys(POLYCUBES)];

  /** Faces de l'enveloppe convexe : [{ idx: [...] (ordre du contour), normal (sortante) }]. */
  function hullFaces(V) {
    const n = V.length;
    const c = scale(V.reduce((s, v) => add(s, v), [0, 0, 0]), 1 / n);
    const faces = [];
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let k = j + 1; k < n; k++) {
          const nr = cross(sub(V[j], V[i]), sub(V[k], V[i]));
          if (len(nr) < 1e-6) continue;
          const nn = norm(nr);
          let pos = 0, neg = 0;
          const on = [];
          for (let m = 0; m < n; m++) {
            const dd = dot(nn, sub(V[m], V[i]));
            if (dd > 1e-6) pos++;
            else if (dd < -1e-6) neg++;
            else on.push(m);
          }
          if (pos && neg) continue;
          const key = on.join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          const out = dot(nn, sub(V[i], c)) < 0 ? scale(nn, -1) : nn;
          const fc = scale(on.reduce((s, m) => add(s, V[m]), [0, 0, 0]), 1 / on.length);
          const e1 = norm(sub(V[on[0]], fc)), e2 = cross(out, e1);
          on.sort((a, bb) => {
            const pa = sub(V[a], fc), pb = sub(V[bb], fc);
            return Math.atan2(dot(pa, e2), dot(pa, e1)) - Math.atan2(dot(pb, e2), dot(pb, e1));
          });
          faces.push({ idx: on, normal: out });
        }
      }
    }
    return faces;
  }

  function polyArea(pts) {
    let s = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) s = add(s, cross(pts[i], pts[(i + 1) % pts.length]));
    return len(s) / 2;
  }

  // Rotation (Rodrigues) qui amène le vecteur unitaire a sur b.
  function rotationTo(a, bv) {
    const c = dot(a, bv);
    if (c > 1 - 1e-12) return (v) => v.slice();
    if (c < -1 + 1e-12) return (v) => [v[0], -v[1], -v[2]]; // demi-tour autour de X
    const k = norm(cross(a, bv));
    const s = Math.sqrt(1 - c * c);
    return (v) => {
      const kv = cross(k, v);
      const kd = dot(k, v);
      return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * kd * (1 - c));
    };
  }

  function pointInPoly2(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  const GEOM_CACHE = {};
  /**
   * Géométrie orientée d'un solide convexe : sommets posés (face du bas à y = 0),
   * faces, emprise { w, d } (cellules entières) et projection centrée dedans.
   */
  function convexGeom(id) {
    const S = SOLIDS[id];
    let V = S.verts.map((v) => v.slice());
    const faces = hullFaces(V);
    const pts = (f, VV) => f.idx.map((m) => VV[m]);
    // centre de gravité de la coque (faces pondérées par leur aire)
    let G = [0, 0, 0], A = 0;
    for (const f of faces) {
      const P = pts(f, V);
      const a = polyArea(P);
      G = madd(G, scale(P.reduce((s, v) => add(s, v), [0, 0, 0]), 1 / P.length), a);
      A += a;
    }
    G = scale(G, 1 / A);
    let bottom = null;
    if (S.bottom === 'y') {
      bottom = faces.find((f) => f.normal[1] < -0.999);
    } else {
      const order = faces.slice().sort((f, g) => polyArea(pts(g, V)) - polyArea(pts(f, V)));
      for (const f of order) {
        const rot = rotationTo(f.normal, [0, -1, 0]);
        const RV = V.map(rot);
        const P = pts(f, RV).map((q) => [q[0], q[2]]);
        const g = rot(G);
        if (pointInPoly2([g[0], g[2]], P)) {
          bottom = f;
          break;
        }
      }
      bottom = bottom || order[0];
    }
    const rot = rotationTo(bottom.normal, [0, -1, 0]);
    V = V.map(rot);
    // lacet : l'orientation autour de Y qui minimise l'emprise en cellules
    const cand = new Set([0]);
    for (const f of faces) {
      const P = pts(f, V);
      for (let i = 0; i < P.length; i++) {
        const d = sub(P[(i + 1) % P.length], P[i]);
        if (Math.hypot(d[0], d[2]) > 0.3) cand.add(Math.round((-Math.atan2(d[2], d[0]) * 180) / Math.PI * 1e6) / 1e6);
      }
    }
    let best = null;
    for (const deg of [...cand].sort((a, bb) => a - bb)) {
      const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const v of V) {
        const x = v[0] * c - v[2] * s, z = v[0] * s + v[2] * c;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
      const W = Math.ceil(x1 - x0 - 1e-6), D = Math.ceil(z1 - z0 - 1e-6);
      const score = W * D * 100 + Math.max(W, D) * 10 + (x1 - x0) * (z1 - z0);
      if (!best || score < best.score - 1e-9) best = { score, t, x0, x1, z0, z1, W, D };
    }
    const c = Math.cos(best.t), s = Math.sin(best.t);
    let ymin = Infinity;
    V = V.map((v) => [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c]);
    for (const v of V) ymin = Math.min(ymin, v[1]);
    const ox = (best.W - (best.x1 - best.x0)) / 2 - best.x0, oz = (best.D - (best.z1 - best.z0)) / 2 - best.z0;
    V = V.map((v) => [v[0] + ox, v[1] - ymin, v[2] + oz]).map((v) => v.map((x) => (Math.abs(x - Math.round(x)) < 1e-9 ? Math.round(x) : x)));
    let height = 0;
    for (const v of V) height = Math.max(height, v[1]);
    return { id, name: S.name, V, faces, bottom, open: !!S.open, w: best.W, d: best.D, height };
  }

  /** Géométrie d'un assemblage de cubes : faces extérieures { floor | wall }. */
  function polyGeom(id) {
    const S = POLYCUBES[id];
    const has = new Set(S.cells.map((c) => c.join(',')));
    const at = (x, l, z) => has.has(`${x},${l},${z}`);
    const parts = [];
    let w = 0, d = 0, height = 0;
    for (const [x, l, z] of S.cells) {
      w = Math.max(w, x + 1);
      d = Math.max(d, z + 1);
      height = Math.max(height, l + 1);
      if (!at(x, l - 1, z)) parts.push({ t: 'floor', x, y: l, z, role: l === 0 ? 'bottom' : 'ceil' });
      if (!at(x, l + 1, z)) parts.push({ t: 'floor', x, y: l + 1, z, role: 'top' });
      if (!at(x, l, z - 1)) parts.push({ t: 'wall', x, y: l, z, side: 'N' });
      if (!at(x, l, z + 1)) parts.push({ t: 'wall', x, y: l, z, side: 'S' });
      if (!at(x - 1, l, z)) parts.push({ t: 'wall', x, y: l, z, side: 'W' });
      if (!at(x + 1, l, z)) parts.push({ t: 'wall', x, y: l, z, side: 'E' });
    }
    return { id, name: S.name, poly: true, parts, w, d, height };
  }

  /** Géométrie (mise en cache) d'un solide ou d'un assemblage de cubes. */
  function solidGeom(id) {
    if (!GEOM_CACHE[id]) GEOM_CACHE[id] = POLYCUBES[id] ? polyGeom(id) : convexGeom(id);
    return GEOM_CACHE[id];
  }

  /**
   * Pièces d'une face convexe (triangle / carré / hexagone), pavée si l'arête vaut 2 :
   * [{ pts, run }] où pts = sommets de la pièce (pour trier par hauteur).
   */
  function facePieces(b, P, sqKind) {
    const out = [];
    const near = (a, x) => Math.abs(a - x) < 0.03;
    if (P.length === 3) {
      const L = len(sub(P[1], P[0]));
      const n = Math.round(L);
      const eq = [len(sub(P[2], P[1])), len(sub(P[0], P[2]))].every((l) => near(l, L));
      if (eq && n >= 2 && near(L, n)) {
        const e1 = scale(sub(P[1], P[0]), 1 / n), e2 = scale(sub(P[2], P[0]), 1 / n);
        const Q = (i, jj) => madd(madd(P[0], e1, i), e2, jj);
        for (let j = 0; j < n; j++) {
          for (let i = 0; i + j <= n - 1; i++) {
            const t1 = [Q(i, j), Q(i + 1, j), Q(i, j + 1)];
            out.push({ pts: t1, run: () => b.tri('EQ', ...t1) });
            if (i + j <= n - 2) {
              const t2 = [Q(i, j + 1), Q(i + 1, j + 1), Q(i + 1, j)];
              out.push({ pts: t2, run: () => b.tri('EQ', ...t2) });
            }
          }
        }
      } else {
        out.push({ pts: P, run: () => b.face(P, 'EQ') });
      }
    } else if (P.length === 4) {
      const a = len(sub(P[1], P[0])), c = len(sub(P[3], P[0]));
      if (near(a, 1) && near(c, HR_H)) out.push({ pts: P, run: () => b.quad('HR!', P[0], P[1], P[3]) });
      else if (near(a, HR_H) && near(c, 1)) out.push({ pts: P, run: () => b.quad('HR!', P[0], P[3], P[1]) });
      else {
        const na = Math.round(a), nc = Math.round(c);
        const e1 = scale(sub(P[1], P[0]), 1 / na), e2 = scale(sub(P[3], P[0]), 1 / nc);
        for (let j = 0; j < nc; j++) {
          for (let i = 0; i < na; i++) {
            const A = madd(madd(P[0], e1, i), e2, j);
            out.push({ pts: [A, add(A, e1), add(add(A, e1), e2), add(A, e2)], run: () => b.quad(sqKind, A, add(A, e1), add(A, e2)) });
          }
        }
      }
    } else {
      // hexagone régulier de côté 1 : éventail de 6 triangles équilatéraux
      const C = scale(P.reduce((s, v) => add(s, v), [0, 0, 0]), 1 / P.length);
      for (let i = 0; i < P.length; i++) {
        const t = [P[i], P[(i + 1) % P.length], C];
        out.push({ pts: t, run: () => b.tri('EQ', ...t) });
      }
    }
    return out;
  }

  const MOTIFS = { plein: 'solid', fenetres: 'window', cadres: 'frame', rayures: 'window2' };

  /**
   * Répartit les pièces d'un solide en étapes, toutes faces confondues, du bas
   * vers le haut : « Fond », « Côtés — rangée k », « Dessus ». Une rangée n'est
   * posée qu'une fois la précédente en place (aucune face entière montée d'un coup).
   */
  function solidSteps(b, pieces, height) {
    const info = pieces.map((p) => {
      const ys = p.pts.map((q) => q[1]);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      return Object.assign(p, { y0, yc: ys.reduce((s, y) => s + y, 0) / ys.length, flat: y1 - y0 < 0.02 });
    });
    info.sort((a, c) => a.y0 - c.y0 || a.yc - c.yc);
    const groups = [];
    const bottom = info.filter((p) => p.flat && p.y0 < 0.02);
    const top = info.filter((p) => p.flat && p.y0 > height - 0.02 && p.y0 > 0.02);
    const mid = info.filter((p) => !bottom.includes(p) && !top.includes(p));
    if (bottom.length) groups.push({ label: 'Fond', items: bottom });
    const levels = [];
    for (const p of mid) {
      const last = levels[levels.length - 1];
      if (last && p.y0 - last.y < 0.05) last.items.push(p);
      else levels.push({ y: p.y0, items: [p] });
    }
    levels.forEach((lv, i) => groups.push({ label: levels.length > 1 ? `Côtés — rangée ${i + 1}` : 'Côtés', items: lv.items }));
    if (top.length) groups.push({ label: 'Dessus', items: top });
    // Fusionne les petits groupes (moins de 3 pièces) avec leur voisin.
    const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (g.items.length >= 3 || groups.length === 1) continue;
      if (i + 1 < groups.length) {
        groups[i + 1] = { label: `${g.label} et ${lower(groups[i + 1].label)}`, items: [...g.items, ...groups[i + 1].items] };
        groups.splice(i, 1);
        i--;
      } else if (i > 0) {
        groups[i - 1] = { label: `${groups[i - 1].label} et ${lower(g.label)}`, items: [...groups[i - 1].items, ...g.items] };
        groups.splice(i, 1);
      }
    }
    for (const g of groups) steps(b, g.label, g.items.map((p) => p.run), 10);
  }

  /** Pose un solide dans son emprise, coin (x, z). motif : plein | fenetres | cadres | rayures | melange. */
  function buildSolid(b, id, x, z, motif) {
    const g = solidGeom(id);
    const rng = b.rng;
    const kindOf = () => (motif === 'melange' ? rng.pick(['solid', 'window', 'frame', 'window2']) : MOTIFS[motif] || 'solid');
    const pieces = [];
    if (g.poly) {
      for (const p of g.parts) {
        const X = x + p.x, Z = z + p.z;
        if (p.t === 'floor') {
          const k = p.role === 'bottom' ? 'solid' : 'floor';
          const pts = [[X, p.y, Z], [X + 1, p.y, Z], [X + 1, p.y, Z + 1], [X, p.y, Z + 1]];
          pieces.push({ pts, run: () => b.floor(X, p.y, Z, k) });
        } else {
          const k = kindOf();
          pieces.push({ pts: [[X, p.y, Z], [X, p.y + 1, Z]], run: () => b.wall(X, p.y, Z, p.side, k) });
        }
      }
    } else {
      const at = (v) => [v[0] + x, v[1], v[2] + z];
      for (const f of g.faces) {
        if (f === g.bottom && g.open) continue;
        const P = f.idx.map((m) => at(g.V[m]));
        pieces.push(...facePieces(b, P, f === g.bottom ? 'solid' : kindOf()));
      }
    }
    solidSteps(b, pieces, g.height);
  }

  /** Nombre de pièces d'un solide, par genre (pour budgéter avec b.canAfford). */
  function solidCost(id) {
    const g = solidGeom(id);
    const c = {};
    const inc = (k, n) => (c[k] = (c[k] || 0) + n);
    if (g.poly) {
      inc('solid', g.parts.length);
      return c;
    }
    const near = (a, x) => Math.abs(a - x) < 0.05;
    for (const f of g.faces) {
      if (f === g.bottom && g.open) continue;
      const P = f.idx.map((m) => g.V[m]);
      if (P.length === 3) {
        const s = [len(sub(P[1], P[0])), len(sub(P[2], P[1])), len(sub(P[0], P[2]))].sort((a, bb) => a - bb);
        if (near(s[0], s[2])) inc('EQ', Math.round(s[0]) ** 2);
        else if (near(s[2], S2)) inc('RT', 1);
        else inc('TT', 1);
      } else if (P.length === 4) {
        const a = len(sub(P[1], P[0])), d = len(sub(P[3], P[0]));
        if (Math.abs(Math.min(a, d) - HR_H) < 0.03) inc('HR!', 1);
        else inc('solid', Math.round(a) * Math.round(d));
      } else inc('EQ', 6);
    }
    return c;
  }
  const costTotal = (c) => Object.values(c).reduce((s, x) => s + x, 0);

  registerModule({
    id: 'solide',
    label: 'Solide géométrique',
    description:
      'Polyèdre exact posé sur une face (arête 1, ou 2 pour les « grands ») : cube, tétraèdre, octaèdre, icosaèdre, prismes, ' +
      'bipyramides, diamant, cristal, coupole, pavés, flèche… ou assemblage de cubes (L, T, escalier, arche, croix).',
    params: {
      forme: { type: 'enum', values: SOLID_IDS, default: 'octaedre', label: 'Forme', fixed: true },
      motif: { type: 'enum', values: ['melange', 'plein', 'fenetres', 'cadres', 'rayures'], default: 'melange', label: 'Carrés utilisés' },
    },
    footprint: (p) => {
      const g = solidGeom(p.forme);
      return { w: g.w, d: g.d };
    },
    build(b, p) {
      buildSolid(b, p.forme, 0, 0, p.motif);
    },
  });

  const SMALL_SOLIDS = SOLID_IDS.filter((id) => !(SOLIDS[id] && SOLIDS[id].big) && solidGeom(id).w <= 2 && solidGeom(id).d <= 2);

  registerModule({
    id: 'c-galerie',
    label: 'Galerie de solides',
    description:
      'Exposition de petits solides géométriques tous différents (choisis selon le stock), chacun dans une case de 2 × 2 ' +
      'séparée par un espace, en une ou deux rangées le long de X.',
    params: {
      nombre: { type: 'int', min: 2, max: 8, default: 5, label: 'Nombre de solides' },
      rangees: { type: 'int', min: 1, max: 2, default: 1, label: 'Rangées' },
    },
    footprint: (p) => {
      const per = Math.ceil(p.nombre / p.rangees);
      return { w: 3 * per - 1, d: 3 * p.rangees - 1 };
    },
    build(b, p) {
      const per = Math.ceil(p.nombre / p.rangees);
      const pool = b.rng.shuffle(SMALL_SOLIDS);
      let k = 0;
      for (const id of pool) {
        if (k >= p.nombre) break;
        const g = solidGeom(id);
        const sx = 3 * (k % per), sz = 3 * Math.floor(k / per);
        if (!b.canAfford(solidCost(id))) continue;
        const ok = b.tryBuild(() => b.module('solide', sx + (2 - g.w) / 2, sz + (2 - g.d) / 2, { forme: id, motif: 'melange' }, { label: g.name }));
        if (ok) k++;
      }
      if (k < p.nombre) b.note(`Galerie : ${k} solides sur ${p.nombre}, faute de pièces`);
    },
  });

  // ============================================================ CAMPING
  /** Premier type exact dont il reste au moins n pièces (sinon le genre de repli). */
  const firstExact = (b, types, n, fallback) => {
    const t = types.find((k) => b.available(k + '!') >= n);
    return t ? t + '!' : fallback;
  };

  /**
   * Tente canadienne le long de X : deux pans de carrés à 45°, pignons en
   * triangles rectangles. Emprise L × 2. Toile d'une seule couleur quand le stock
   * le permet (kind 'auto').
   */
  function buildTent(b, x, z, L, kind, open) {
    const z0 = z + (2 - S2) / 2;
    const m = (a, y, c) => [x + a, y, z0 + c];
    const k = kind === 'auto' ? firstExact(b, ['SQ', 'WIN2', 'WIN4', 'FRAME'], 2 * L, 'roof') : kind;
    b.step('Toile et pignons');
    for (let i = 0; i < L; i++) {
      b.quad(k, m(i, 0, 0), m(i + 1, 0, 0), m(i, R2, R2));
      b.quad(k, m(i, 0, S2), m(i + 1, 0, S2), m(i, R2, S2 - R2));
    }
    for (const a of open ? [L] : [0, L]) b.tri('RT', m(a, R2, R2), m(a, 0, 0), m(a, 0, S2));
  }

  /**
   * Sapin sur la colonne (cx, cz) :
   *  - tronc : 0 = anneau bas de demi-rectangles, 1 ou 2 = niveaux de carrés nus ;
   *  - étages : niveaux de carrés garnis de branches en triangles rectangles
   *    (8 branches dans le plan des murs pour l'étage du bas s'il y en a plusieurs,
   *    4 en diagonale pour les autres) : la silhouette s'affine vers le haut ;
   *  - cime : flèche (4 grands triangles), sinon pyramide, sinon plate.
   * Un sapin sans étage ni flèche n'est jamais un cube coiffé (maisonnette) :
   * le tronc devient bas, ou le sapin reçoit un étage de branches.
   */
  function buildFir(b, cx, cz, o) {
    const what = o.what || 'Sapin';
    let trunk = o.trunk, tiers = o.tiers || 0;
    const crown = pickSpire(b, o.crown === 'pyramide' ? 'EQ' : 'TT', what, true);
    if (trunk === 0 && b.available('HR!') < 4) {
      trunk = 1;
      b.note(`${what} : tronc en carrés, faute de demi-rectangles`);
    }
    // Étages de branches selon les triangles rectangles : 4 pour un étage, 8 + 4 par étage au-delà.
    const rtFor = (t) => (t <= 0 ? 0 : t === 1 ? 4 : 8 + 4 * (t - 1));
    const asked = tiers;
    while (tiers > 0 && b.available('RT') < rtFor(tiers)) tiers--;
    if (tiers < asked) b.note(`${what} : ${tiers} étage${tiers > 1 ? 's' : ''} de branches sur ${asked}, faute de triangles rectangles`);
    let y = 0;
    if (trunk === 0) {
      steps(b, 'Tronc', roomJobs(b, cx, 0, cz, 1, 1, 'HR!'));
      y = HR_H;
    } else {
      const jobs = [];
      for (let l = 0; l < trunk; l++) jobs.push(...roomJobs(b, cx, l, cz, 1, 1, 'solid'));
      steps(b, 'Tronc', jobs, 8);
      y = trunk;
    }
    // Étage du bas : jupe de 12 branches (plan des murs et diagonales) si le stock le permet, sinon 8.
    const skirt = tiers > 1 && b.available('RT') >= 12 + 4 * (tiers - 1);
    for (let t = 0; t < tiers; t++) {
      const jobs = roomJobs(b, cx, y, cz, 1, 1, firstExact(b, ['SQ'], 4, 'solid'));
      const wide = t === 0 && tiers > 1;
      for (const [px, pz, dx, dz] of cornersOut(cx, cz, 1)) {
        const yy = y;
        if (wide) {
          jobs.push(() => fin(b, px, pz, dx, 0, yy));
          jobs.push(() => fin(b, px, pz, 0, dz, yy));
        }
        if (!wide || skirt) jobs.push(() => fin(b, px, pz, dx, dz, yy));
      }
      steps(b, tiers > 1 ? `Branches — étage ${t + 1}` : 'Branches', jobs, 12);
      y += 1;
    }
    b.step(crown === 'TT' ? 'Cime en flèche' : 'Cime');
    placeSpire(b, cx, y, cz, crown);
    return { crown, trunk, tiers };
  }

  /** Grand sapin 2 × 2 : tronc bas (demi-rectangles) ou d'un niveau, grande flèche de 16 grands triangles, sinon pyramide. */
  function buildBigTree(b, x, z, trunk) {
    let y;
    if (trunk === 0 && b.available('HR!') >= 8) {
      steps(b, 'Tronc', roomJobs(b, x, 0, z, 2, 2, 'HR!'));
      y = HR_H;
    } else {
      if (trunk === 0) b.note('Grand sapin : tronc en carrés, faute de demi-rectangles');
      const jobs = [];
      for (let l = 0; l < Math.max(1, trunk); l++) jobs.push(...roomJobs(b, x, l, z, 2, 2, 'solid'));
      steps(b, 'Tronc', jobs, 8);
      y = Math.max(1, trunk);
    }
    if (b.canAfford({ TT: 16 })) {
      const rows = bigSpireRows(b, x, y, z);
      steps(b, 'Cime — grande flèche', rows[0], 12);
      steps(b, 'Cime — pointe', rows[1], 12);
      return { crown: 'TT' };
    }
    b.note('Grand sapin : cime en pyramide, faute de grands triangles (16 pour la flèche)');
    for (let j = 0; j < 2; j++) steps(b, `Cime — rangée ${j + 1}`, pyramidRowJobs(b, x, y, z, 2, j), 12);
    return { crown: 'EQ' };
  }

  /**
   * Feu de camp 1 × 1 : flammes (créneaux), tipi de bûches (tétraèdre) ou foyer
   * de pierres (demi-rectangles) surmonté de flammes (créneaux).
   */
  function buildFire(b, x, z, style) {
    let s = style;
    if (s === 'pierres' && !(b.available('HR!') >= 4 && b.available('CR!') >= 4)) s = 'flammes';
    if (s === 'flammes' && b.available('CR!') < 4) s = 'buches';
    if (s !== style) b.note(`Feu de camp : ${s === 'flammes' ? 'flammes seules' : 'tipi de bûches'}, faute de pièces`);
    if (s === 'flammes') {
      b.step('Flammes');
      b.room(x, 0, z, 1, 1, 'CR!');
    } else if (s === 'pierres') {
      b.step('Foyer de pierres');
      b.room(x, 0, z, 1, 1, 'HR!');
      b.step('Flammes');
      b.room(x, HR_H, z, 1, 1, 'CR!');
    } else {
      const g = solidGeom('tetraedre');
      b.step('Tipi de bûches');
      for (const f of g.faces) b.face(f.idx.map((m) => [g.V[m][0] + x, g.V[m][1], g.V[m][2] + z]), 'EQ');
    }
    return { style: s };
  }

  /** Toit à deux pans (faîtage le long de X), mêmes pièces que b.gableRoof, sous forme d'actions. */
  function gableJobs(b, x, y, z, L, w, kind) {
    const m = (a, yy, c) => [x + a, yy, z + c];
    const jobs = [];
    for (let r = 0; r < w; r++) {
      for (const a of [0, L]) jobs.push(...triRowJobs(b, m(a, y, 0), m(a, y, w), m(a, y + w * EQ_H, w / 2), w, r));
      const y0 = y + r * EQ_H, y1 = y + (r + 1) * EQ_H;
      for (let k = 0; k < L; k++) {
        jobs.push(() => b.quad(kind, m(k, y0, r * 0.5), m(k + 1, y0, r * 0.5), m(k, y1, (r + 1) * 0.5)));
        jobs.push(() => b.quad(kind, m(k, y0, w - r * 0.5), m(k + 1, y0, w - r * 0.5), m(k, y1, w - (r + 1) * 0.5)));
      }
    }
    return jobs;
  }

  /** Pièces d'une cabane w × d (murs, toit, terrasse) : sert à la réserver avant de construire. */
  const cabinCost = (w, d, floors, terrace) => ({
    'SQ!': 2 * w * d,
    solid: 2 * (w + d) * floors + (terrace ? w : 0),
    EQ: 2 * d * d,
  });

  /** Cabane en rondins w × d (porte en façade +Z), 1 ou 2 niveaux, toit à deux pans de carrés pleins, terrasse en option. */
  function buildCabin(b, x, z, w, d, floors, terrace) {
    const door = Math.floor((w - 1) / 2);
    for (let l = 0; l < floors; l++) {
      const jobs = [];
      if (l === 0 && terrace) jobs.push(...floorJobs(b, x, 0, z + d, w, 1, 'floor'));
      jobs.push(...roomJobs(b, x, l, z, w, d, ({ side, i }) => {
        if (side === 'S') return l === 0 && i === door ? 'arch' : 'window2';
        if (side === 'N') return 'solid';
        return l === floors - 1 && i === 0 ? 'window' : 'solid';
      }));
      const lbl = (l === 0 && terrace ? 'Terrasse et murs' : 'Murs') + (floors > 1 ? ` — niveau ${l + 1}` : '');
      steps(b, lbl, jobs, 10);
    }
    let rk = 'SQ!';
    if (b.available('SQ!') < 2 * w * d) {
      rk = 'roof';
      b.note('Cabane : toit en partie ajouré, faute de carrés pleins');
    }
    steps(b, 'Toit à deux pans', gableJobs(b, x, floors, z, w, d, rk), 10);
  }

  /** Tour de guet 1 × 1 ou 2 × 2 : porte en arche en bas, poste d'observation en cadres en haut, toit pointu. */
  function buildWatchtower(b, x, z, levels, width, roof) {
    for (let l = 0; l < levels; l++) {
      const top = l === levels - 1;
      steps(b, top ? 'Poste d’observation' : `Niveau ${l + 1}`, roomJobs(b, x, l, z, width, width, ({ side, i }) => {
        if (top) return 'frame';
        if (l === 0 && side === 'S' && i === 0) return 'arch';
        return l % 2 ? 'window2' : 'solid';
      }), 8);
    }
    if (width === 2) {
      steps(b, 'Toit à deux pans', gableJobs(b, x, levels, z, 2, 2, 'roof'), 10);
    } else {
      b.step('Toit');
      spire(b, x, levels, z, roof === 'fleche' ? 'TT' : 'EQ', 'Tour de guet');
    }
  }

  /** Table de pique-nique le long de X : plateau sur tréteaux (z + 1), bancs bas en demi-rectangles (z et z + 2). */
  function buildTable(b, x, z, L, benches) {
    // Tréteaux aux deux bouts ; pour 3 carrés, un de plus de chaque côté du milieu.
    const mid = L >= 3 ? [0, L - 2] : [];
    b.step('Table');
    b.wall(x, 0, z + 1, 'W', 'solid');
    b.wall(x + L - 1, 0, z + 1, 'E', 'solid');
    for (const i of mid) b.wall(x + i, 0, z + 1, 'E', 'solid');
    for (let i = 0; i < L; i++) b.floor(x + i, 1, z + 1, 'floor');
    if (benches) {
      if (b.available('HR!') < 2 * (2 + mid.length)) {
        b.note('Table : sans bancs, faute de demi-rectangles');
        return;
      }
      b.step('Bancs');
      for (const bz of [z, z + 2]) {
        b.halfWall(x, 0, bz, 'W', 'HR!');
        b.halfWall(x + L - 1, 0, bz, 'E', 'HR!');
        for (const i of mid) b.halfWall(x + i, 0, bz, 'E', 'HR!');
        for (let i = 0; i < L; i++) b.floor(x + i, HR_H, bz, 'floor');
      }
    }
  }

  /** Camping-car : plateau à roues + cellule 2 × 1 vitrée (pare-brise à l'avant +X, porte en arche), toit plat. */
  function buildCamper(b, x, z) {
    const y = CAR.top;
    b.step('Châssis, carrosserie et toit');
    b.car(x, z, 'x');
    b.room(x, y, z, 2, 1, ({ side, i }) => {
      if (side === 'E') return 'window';
      if (side === 'W') return 'solid';
      if (side === 'S') return i === 0 ? 'arch' : 'window2';
      return 'window2';
    });
    b.floorRect(x, y + 1, z, 2, 1, 'roof');
  }

  registerModule({
    id: 'tente',
    label: 'Tente',
    description:
      'Tente : canadienne (deux pans de carrés inclinés à 45°, pignons en triangles rectangles, longueur 1 à 3, entrée côté −X) ' +
      'ou tipi (4 grands triangles en pyramide ; repli en pyramide de triangles équilatéraux).',
    params: {
      forme: { type: 'enum', values: ['canadienne', 'tipi'], default: 'canadienne', label: 'Forme' },
      longueur: { type: 'int', min: 1, max: 3, default: 2, label: 'Longueur (canadienne)' },
      ouverte: { type: 'bool', default: false, label: 'Entrée ouverte' },
    },
    footprint: (p) => (p.forme === 'tipi' ? { w: 1, d: 1 } : { w: p.longueur, d: 2 }),
    build(b, p) {
      if (p.forme === 'tipi') {
        b.step('Tipi');
        placeSpire(b, 0, 0, 0, pickSpire(b, 'TT', 'Tipi', true));
      } else {
        buildTent(b, 0, 0, p.longueur, 'auto', p.ouverte);
      }
    },
  });

  registerModule({
    id: 'feu-de-camp',
    label: 'Feu de camp',
    description: 'Feu de camp 1 × 1 : flammes en créneaux, tipi de bûches (tétraèdre de triangles) ou foyer de pierres (demi-rectangles) surmonté de flammes en créneaux.',
    params: {
      style: { type: 'enum', values: ['flammes', 'buches', 'pierres'], default: 'flammes', label: 'Style' },
    },
    footprint: () => ({ w: 1, d: 1 }),
    build(b, p) {
      return buildFire(b, 0, 0, p.style);
    },
  });

  registerModule({
    id: 'sapin',
    label: 'Sapin',
    description:
      'Sapin : simple 1 × 1 (tronc 0 + cime flèche = élancé), noel 3 × 3 étagé à branches en triangles rectangles et pointe ' +
      '(sapin de Noël, 4 à 16 triangles rectangles), grand 2 × 2 (flèche de 16 grands triangles), buisson (pyramide au sol).',
    params: {
      forme: { type: 'enum', values: ['simple', 'noel', 'grand', 'buisson'], default: 'simple', label: 'Forme', fixed: true },
      tronc: { type: 'int', min: 0, max: 2, default: 0, label: 'Tronc (0 = bas, 1 ou 2 niveaux de carrés)' },
      etages: { type: 'int', min: 1, max: 4, default: 3, label: 'Étages de branches (noel)' },
      cime: { type: 'enum', values: ['fleche', 'pyramide'], default: 'fleche', label: 'Cime' },
    },
    footprint: (p) => (p.forme === 'noel' ? { w: 3, d: 3 } : p.forme === 'grand' ? { w: 2, d: 2 } : { w: 1, d: 1 }),
    build(b, p) {
      if (p.forme === 'buisson') {
        b.step('Feuillage');
        placeSpire(b, 0, 0, 0, pickSpire(b, 'EQ', 'Buisson', true));
        return { crown: 'EQ' };
      }
      if (p.forme === 'grand') return buildBigTree(b, 0, 0, p.tronc);
      if (p.forme === 'noel') return buildFir(b, 1, 1, { trunk: p.tronc, tiers: p.etages, crown: p.cime, what: 'Sapin de Noël' });
      // Simple : jamais un cube coiffé d'une pyramide ; faute de flèche, le tronc devient bas.
      const trunk = p.cime === 'pyramide' || b.available('TT') < 4 ? 0 : p.tronc;
      return buildFir(b, 0, 0, { trunk, tiers: 0, crown: p.cime, what: 'Sapin' });
    },
  });

  registerModule({
    id: 'cabane',
    label: 'Cabane',
    description:
      'Cabane en rondins : murs de carrés, porte en arche et fenêtres en façade (+Z), 1 ou 2 niveaux, toit à deux pans ' +
      'de carrés pleins (pignons en triangles), terrasse de carrés devant la porte en option.',
    params: {
      largeur: { type: 'int', min: 1, max: 3, default: 2, label: 'Largeur' },
      profondeur: { type: 'int', min: 1, max: 2, default: 1, label: 'Profondeur' },
      niveaux: { type: 'int', min: 1, max: 2, default: 1, label: 'Niveaux' },
      terrasse: { type: 'bool', default: false, label: 'Terrasse' },
    },
    footprint: (p) => ({ w: p.largeur, d: p.profondeur + (p.terrasse ? 1 : 0) }),
    build(b, p) {
      buildCabin(b, 0, 0, p.largeur, p.profondeur, p.niveaux, p.terrasse);
    },
  });

  registerModule({
    id: 'tour-de-guet',
    label: 'Tour de guet',
    description: 'Tour de guet haute (1 × 1 ou 2 × 2) : porte en arche, niveaux de carrés et fenêtres, poste d’observation en cadres, toit pointu (flèche ou pyramide).',
    params: {
      niveaux: { type: 'int', min: 2, max: 5, default: 3, label: 'Niveaux' },
      largeur: { type: 'int', min: 1, max: 2, default: 1, label: 'Largeur' },
      toit: { type: 'enum', values: ['pyramide', 'fleche'], default: 'pyramide', label: 'Toit (tour 1 × 1)' },
    },
    footprint: (p) => ({ w: p.largeur, d: p.largeur }),
    build(b, p) {
      buildWatchtower(b, 0, 0, p.niveaux, p.largeur, p.toit);
    },
  });

  registerModule({
    id: 'table-pique-nique',
    label: 'Table de pique-nique',
    description: 'Table sur tréteaux (plateau de carrés à hauteur 1) le long de X, avec deux bancs bas en demi-rectangles de chaque côté (emprise longueur × 3).',
    params: {
      longueur: { type: 'int', min: 1, max: 3, default: 2, label: 'Longueur' },
      bancs: { type: 'bool', default: true, label: 'Bancs' },
    },
    footprint: (p) => ({ w: p.longueur, d: 3 }),
    build(b, p) {
      buildTable(b, 0, 0, p.longueur, p.bancs);
    },
  });

  registerModule({
    id: 'c-camping-car',
    label: 'Camping-car',
    description: 'Camping-car (ou roulotte) : plateau à roues avec cellule 2 × 1 vitrée, pare-brise vers +X, porte en arche côté +Z, toit plat.',
    params: {},
    footprint: () => ({ w: 3, d: 1 }),
    build(b) {
      buildCamper(b, 0.5, 0);
    },
  });

  /** Côté du carré d'implantation du campement selon son contenu. */
  const campSize = (p) => (p.sapins > 0 ? 11 : p.tentes > 3 || p.table ? 9 : 7);

  registerModule({
    id: 'c-campement',
    label: 'Campement',
    description:
      'Campement : feu de camp au centre, tentes tournées vers le feu, table de pique-nique et sapins autour en option. ' +
      'Emprise 7 × 7 (3 tentes au plus, sans table ni sapin), 9 × 9 (sans sapin) ou 11 × 11.',
    params: {
      tentes: { type: 'int', min: 1, max: 6, default: 3, label: 'Tentes' },
      sapins: { type: 'int', min: 0, max: 6, default: 3, label: 'Sapins' },
      table: { type: 'bool', default: true, label: 'Table de pique-nique' },
    },
    footprint: (p) => {
      const s = campSize(p);
      return { w: s, d: s };
    },
    build(b, p) {
      const rng = b.rng;
      const S = campSize(p);
      const lay = new Layout(b, { minX: 0, minZ: 0, maxX: S, maxZ: S });
      const C = S / 2;
      const Cc = Math.floor(S / 2);
      lay.put('feu-de-camp', { style: rng.pick(['flammes', 'buches', 'pierres']) }, { at: [Cc, Cc], label: 'Feu de camp', optional: true });
      const rT = Math.min(3.2, C - 1.3);
      const a0 = rng.float(0, Math.PI * 2);
      let tents = 0;
      for (let k = 0; k < p.tentes; k++) {
        const a = a0 + (k * 2 * Math.PI) / p.tentes;
        const tx = C + rT * Math.cos(a), tz = C + rT * Math.sin(a);
        const rot = rotFacingFromMinusX(C - tx, C - tz);
        if (lay.put('tente', { forme: 'canadienne', longueur: S > 7 ? rng.int(1, 2) : 1 }, { tx, tz, rot, optional: true, label: `Tente ${k + 1}` })) tents++;
      }
      if (p.table) lay.put('table-pique-nique', { longueur: 2 }, { tx: C + 2.5, tz: C + 2.5, optional: true, label: 'Table de pique-nique' });
      let trees = 0;
      for (let k = 0; k < p.sapins; k++) {
        const a = rng.float(0, Math.PI * 2);
        const forme = b.available('TT') >= 4 ? 'simple' : 'buisson';
        if (lay.put('sapin', { forme, tronc: 0, cime: 'fleche' }, {
          tx: C + (C - 0.7) * Math.cos(a), tz: C + (C - 0.7) * Math.sin(a), optional: true, label: forme === 'simple' ? `Sapin ${k + 1}` : `Buisson ${k + 1}`,
        })) trees++;
      }
      if (tents < p.tentes) b.note(`Campement : ${tents} tentes sur ${p.tentes}, faute de place ou de pièces`);
      if (trees < p.sapins) b.note(`Campement : ${trees} sapins sur ${p.sapins}, faute de place ou de pièces`);
    },
  });

  // ============================================================ FÊTE FORAINE
  // Hexagone régulier de côté 1 (sommet 0 vers +X ; côté 1 face au sud, +Z).
  const HEX = [[1, 0], [0.5, EQ_H], [-0.5, EQ_H], [-1, 0], [-0.5, -EQ_H], [0.5, -EQ_H]];
  const hexAt = (cx, y, cz) => HEX.map(([a, c]) => [cx + a, y, cz + c]);
  // Pyramide hexagonale à faces en grands triangles : l'arête latérale vaut celle du grand triangle.
  const HEX_APEX = Math.sqrt(TT_H * TT_H - 0.75);
  const UP = [0, 1, 0];

  /** Anneau hexagonal de murs (centre (cx, cz), base y) ; kindOf(k) = genre du côté k. */
  function hexWallJobs(b, cx, y, cz, kindOf) {
    const V = hexAt(cx, y, cz);
    return V.map((A, k) => () => b.quad(kindOf(k), A, V[(k + 1) % 6], add(A, UP)));
  }
  /**
   * Toit d'un hexagone de côté 1 posé à la hauteur y : pyramide de 6 grands
   * triangles (1,6 de haut), sinon éventail plat de 6 triangles équilatéraux.
   */
  function hexRoof(b, cx, y, cz, what, flat) {
    const V = hexAt(cx, y, cz);
    if (!flat && b.available('TT') >= 6) {
      const apex = [cx, y + HEX_APEX, cz];
      steps(b, 'Toit pointu', V.map((A, k) => () => b.tri('TT', A, V[(k + 1) % 6], apex)));
      return 'TT';
    }
    if (!flat) b.note(`${what} : toit plat, faute de grands triangles (6 pour le toit pointu)`);
    const C = [cx, y, cz];
    steps(b, 'Toit plat', V.map((A, k) => () => b.tri('EQ', A, V[(k + 1) % 6], C)));
    return 'EQ';
  }
  /** Toit d'un carré 2 × 2 à la hauteur y : grande flèche (16 grands triangles), sinon pyramide (16 triangles équilatéraux). */
  function squareRoof2(b, x, y, z, want, what) {
    if (want === 'pointu' && b.canAfford({ TT: 16 })) {
      const rows = bigSpireRows(b, x, y, z);
      steps(b, 'Toit pointu', rows[0], 12);
      steps(b, 'Toit — pointe', rows[1], 12);
      return 'TT';
    }
    if (want === 'pointu') b.note(`${what} : toit en pyramide, faute de grands triangles (16 pour la flèche)`);
    for (let j = 0; j < 2; j++) steps(b, `Toit — rangée ${j + 1}`, pyramidRowJobs(b, x, y, z, 2, j), 12);
    return 'EQ';
  }

  /** Chapiteau de cirque : murs rayés (entrée en arche au sud), toit pointu. */
  function buildBigTop(b, p) {
    const stripe = (k, l) => (p.rayures && (k + l) % 2 ? 'frame' : 'solid');
    if (p.base === 'hexagone') {
      for (let l = 0; l < p.niveaux; l++) {
        steps(b, p.niveaux > 1 ? `Murs — niveau ${l + 1}` : 'Murs', hexWallJobs(b, 1, l, 1, (k) => (l === 0 && k === 1 ? 'arch' : stripe(k, l))));
      }
      return { roof: hexRoof(b, 1, p.niveaux, 1, 'Chapiteau', p.toit === 'bas') };
    }
    for (let l = 0; l < p.niveaux; l++) {
      steps(b, p.niveaux > 1 ? `Murs — niveau ${l + 1}` : 'Murs', roomJobs(b, 0, l, 0, 2, 2, ({ side, i }) => {
        if (l === 0 && side === 'S' && i === 1) return 'arch';
        const k = side === 'N' || side === 'S' ? i : i + 1;
        return stripe(k, l);
      }), 8);
    }
    return { roof: squareRoof2(b, 0, p.niveaux, 0, p.toit, 'Chapiteau') };
  }

  /** Manège : plancher, chevaux en demi-rectangles rayonnant du centre, arcades et cadres, toit pointu. */
  function buildCarousel(b, p) {
    const pick = (i) => (i % 2 ? 'frame' : 'arch');
    let horses = 0;
    if (p.base === 'hexagone') {
      const C = [1, 0, 1];
      const V = hexAt(1, 0, 1);
      const jobs = V.map((A, k) => () => b.tri('EQ', A, V[(k + 1) % 6], C));
      const n = Math.min(p.chevaux, 6, Math.floor(b.available('HR!')));
      const spokes = [...new Set(Array.from({ length: n }, (_, i) => Math.round((i * 6) / n) % 6))];
      for (const k of spokes) jobs.push(() => b.quad('HR!', C, V[k], add(C, [0, HR_H, 0])));
      horses = spokes.length;
      steps(b, horses ? 'Plancher et chevaux' : 'Plancher', jobs, 12);
      steps(b, 'Arcades', hexWallJobs(b, 1, 0, 1, pick));
      return { horses, roof: hexRoof(b, 1, 1, 1, 'Manège', p.toit === 'bas') };
    }
    const jobs = floorJobs(b, 0, 0, 0, 2, 2, 'floor');
    const n = Math.min(p.chevaux, 4, Math.floor(b.available('HR!')));
    const C = [1, 0, 1];
    const ends = [[1, 0, 0], [2, 0, 1], [1, 0, 2], [0, 0, 1]];
    for (let i = 0; i < n; i++) {
      const E = ends[i % 4];
      jobs.push(() => b.quad('HR!', C, E, add(C, [0, HR_H, 0])));
    }
    horses = n;
    steps(b, horses ? 'Plancher et chevaux' : 'Plancher', jobs, 12);
    steps(b, 'Arcades', roomJobs(b, 0, 0, 0, 2, 2, ({ side, i }) => pick(i + (side === 'E' || side === 'W' ? 1 : 0))), 8);
    return { horses, roof: squareRoof2(b, 0, 1, 0, p.toit, 'Manège') };
  }

  registerModule({
    id: 'chapiteau',
    label: 'Chapiteau',
    description:
      'Chapiteau de cirque : murs rayés, entrée en arche au sud (+Z), toit pointu. Hexagone (emprise 2 × 2, 6 grands triangles, ' +
      '1 pack) ou carré 2 × 2 (flèche de 16 grands triangles, double pack ; sinon pyramide). Repli : toit plat.',
    params: {
      base: { type: 'enum', values: ['hexagone', 'carre'], default: 'hexagone', label: 'Base' },
      niveaux: { type: 'int', min: 1, max: 2, default: 1, label: 'Hauteur des murs' },
      toit: { type: 'enum', values: ['pointu', 'bas'], default: 'pointu', label: 'Toit (bas : sans grands triangles)' },
      rayures: { type: 'bool', default: true, label: 'Murs rayés' },
    },
    footprint: () => ({ w: 2, d: 2 }),
    build(b, p) {
      return buildBigTop(b, p);
    },
  });

  registerModule({
    id: 'manege',
    label: 'Manège',
    description:
      'Manège (carrousel) : plancher, chevaux en demi-rectangles rayonnant du centre, arcades et cadres ajourés, toit pointu. ' +
      'Hexagone (emprise 2 × 2, 6 grands triangles) ou carré 2 × 2 (16 grands triangles ou pyramide). Pour une fête foraine.',
    params: {
      base: { type: 'enum', values: ['hexagone', 'carre'], default: 'hexagone', label: 'Base' },
      chevaux: { type: 'int', min: 0, max: 6, default: 3, label: 'Chevaux' },
      toit: { type: 'enum', values: ['pointu', 'bas'], default: 'pointu', label: 'Toit (bas : sans grands triangles)' },
    },
    footprint: () => ({ w: 2, d: 2 }),
    build(b, p) {
      return buildCarousel(b, p);
    },
  });

  // ================================================================ THÈMES
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---------------------------------------------------------------- fusée
  MT.registerTheme({
    id: 'fusee',
    name: 'Fusée & espace',
    emoji: '🚀',
    tagline: 'Fusée à ailerons sur son pas de tir, rover et base lunaire',
    keywords: keywords([
      'fusee', 'espace', 'spatial', 'astronaute', 'cosmonaute', 'spationaute', 'lune', 'lunaire', 'planete', 'mars',
      'martien', 'etoile', 'galaxie', 'cosmos', 'univers', 'satellite', 'station spatiale', 'navette', 'decollage',
      'lancement', 'rover', 'alien', 'extraterrestre', 'ovni', 'soucoupe', 'nasa', 'apollo', 'ariane', 'capsule',
      'buzz', 'objectif lune', 'vaisseau', 'base lunaire', 'meteorite', 'comete', 'systeme solaire', 'soleil',
      'astronomie', 'telescope', 'orbite', 'star wars', 'robot',
    ]),
    generate(b, { size, rng }) {
      const [, hi] = TARGET[size];
      const lay = new Layout(b);
      let main, core, titles;
      if (size === 1) {
        const L = rng.int(3, 5);
        const cone = rng.chance(0.75) ? 'fleche' : 'pyramide';
        main = lay.put('fusee', { niveaux: L, largeur: 1, coiffe: cone, ailerons: true }, { at: [3, 3], label: 'Fusée' });
        core = `une fusée de ${L} niveaux à ailerons et coiffe ${main.info.cone === 'TT' ? 'pointue' : 'en pyramide'}`;
        titles = [`Fusée de ${L} niveaux`, 'Prête au décollage', 'Ma petite fusée'];
      } else {
        let p = null;
        if (size === 2) {
          const L = rng.int(4, 5);
          p = { niveaux: L, largeur: 1, tour: L - rng.int(0, 1), passerelles: rng.int(1, 2), plateforme: rng.chance(0.6), coiffe: rng.chance(0.8) ? 'fleche' : 'pyramide', capsule: rng.chance(0.4) };
        } else if (size === 3) {
          if (rng.chance(0.6)) {
            const L = rng.int(5, 6);
            p = { niveaux: L, largeur: 1, tour: L - rng.int(0, 1), passerelles: 2, plateforme: true, coiffe: 'fleche', capsule: rng.chance(0.5) };
          }
        } else {
          const w = rng.chance(0.65) ? 2 : 1;
          const L = rng.int(5, 6);
          p = w === 2
            ? { niveaux: L, largeur: 2, tour: L - rng.int(0, 1), passerelles: rng.int(2, 3), plateforme: false, propulseurs: true, coiffe: 'fleche' }
            : { niveaux: 6, largeur: 1, tour: rng.int(5, 6), passerelles: 3, plateforme: true, propulseurs: true, coiffe: 'fleche', capsule: true };
        }
        if (p) {
          main = lay.put('pas-de-tir', p, { at: [3, 3], label: 'Pas de tir' });
          const i = main.info;
          const nb = i.boosters;
          core = `une fusée de ${p.niveaux} niveaux${p.largeur === 2 ? ' et 2 carrés de diamètre' : ''}` +
            `${nb ? ` à ${nb} propulseurs` : ''}${p.plateforme ? ' sur sa plateforme' : ''}, ` +
            `sa tour de lancement et ${i.arms > 1 ? `ses ${i.arms} passerelles` : 'sa passerelle'}`;
          titles = nb
            ? [p.largeur === 2 ? 'Lanceur lourd' : 'Lanceur à propulseurs', 'Le grand départ', 'Base de lancement']
            : [`Fusée de ${p.niveaux} niveaux sur son pas de tir`, 'Compte à rebours', 'Le pas de tir'];
        } else {
          const L = rng.int(4, 5);
          main = lay.put('fusee', { niveaux: L, largeur: 1, coiffe: 'fleche', propulseurs: true, ailerons: true }, { at: [3, 3], label: 'Fusée' });
          const nb = main.info.boosters;
          core = `une fusée de ${L} niveaux à ${nb} propulseurs et ailerons`;
          titles = [nb === 4 ? 'Fusée à quatre propulseurs' : 'Fusée à deux propulseurs', 'Lanceur spatial', 'Vers les étoiles'];
        }
      }
      // Éléments autour : rover(s), base lunaire, rochers lunaires.
      const around = (rad) => {
        const a = rng.float(0, Math.PI * 2);
        return { tx: main.cx + rad * Math.cos(a), tz: main.cz + rad * Math.sin(a) };
      };
      let rovers = 0, rocks = 0, baseTxt = '';
      const addRover = () => {
        const po = { ...around(size >= 3 ? 6 : 4.5), rot: rng.pick([0, 90, 180, 270]), optional: true, max: hi, label: 'Rover lunaire' };
        const toit = b.available('EQ') >= 4 ? rng.pick(['bulle', 'plat', 'antenne']) : rng.pick(['plat', 'antenne']);
        if (lay.put('rover', { toit, benne: b.available('HR!') >= 3 && rng.chance(0.7) }, po)) rovers++;
      };
      const addBase = (n, wantAntenna) => {
        const pos = around(size >= 3 ? 8 : 6);
        const rot = rng.pick([0, 90, 180, 270]);
        for (let m = n; m >= 1; m--) {
          for (const ant of wantAntenna ? [true, false] : [false]) {
            const r = lay.put('base-lunaire', { modules: m, antenne: ant }, { ...pos, rot, optional: true, max: hi, label: 'Base lunaire' });
            if (r) {
              baseTxt = `une base lunaire ${m > 1 ? `de ${m} modules` : 'à un module'}${r.info.antenna ? ' avec son antenne' : ''}`;
              return;
            }
          }
        }
      };
      const addRock = () => {
        const po = { ...around(rng.float(3.5, size >= 3 ? 8 : 6)), optional: true, max: hi, label: 'Rocher lunaire', jitter: 2 };
        if (lay.put('solide', { forme: rng.pick(['octaedre', 'tetraedre', 'bipyramide', 'octaedre']), motif: 'plein' }, po)) rocks++;
      };
      if (size === 1) {
        rng.pick([[addRover], [() => addBase(1, false)], [addRover, addRock]]).forEach((f) => f());
      } else if (size === 2) {
        addRover();
        addBase(rng.int(1, 2), rng.chance(0.4));
        if (rng.chance(0.5)) addRock();
      } else if (size === 3) {
        addRover();
        addBase(rng.int(2, 3), true);
        addRover();
        for (let k = 0; k < 3; k++) addRock();
      } else {
        addRover();
        addRover();
        addBase(rng.int(3, 5), true);
        addRover();
        for (let k = 0; k < 4; k++) addRock();
        addRover();
      }
      if (size === 1 && (rovers || baseTxt)) titles = rovers && baseTxt ? ['Fusée, rover et base lunaire'] : rovers ? ['Fusée et rover lunaire', 'Mission sur la Lune'] : ['Fusée et base lunaire', 'Mission sur la Lune'];
      const extras = [];
      if (rovers) extras.push(rovers > 1 ? `${rovers} rovers` : 'un rover');
      if (baseTxt) extras.push(baseTxt);
      if (rocks) extras.push(plural(rocks, 'un rocher lunaire', 'rochers lunaires'));
      const summary = `${cap(core)}${extras.length ? `, avec ${listFr(extras)}` : ''}.`;
      return { title: rng.pick(titles), summary };
    },
  });

  // ---------------------------------------------------------------- Égypte
  MT.registerTheme({
    id: 'egypte',
    name: 'Égypte',
    emoji: '🔺',
    tagline: 'Pyramides, sphinx, obélisques et temple à arcades',
    keywords: keywords([
      'egypte', 'egyptien', 'egyptienne', 'egypte antique', 'pyramide', 'pharaon', 'momie', 'sphinx', 'obelisque',
      'desert', 'nil', 'antiquite', 'temple', 'tombeau', 'tombe', 'sarcophage', 'hieroglyphe', 'papyrus', 'cleopatre',
      'nefertiti', 'toutankhamon', 'ramses', 'dieu', 'anubis', 'osiris', 'ziggourat', 'maya', 'azteque', 'inca',
      'babylone', 'mesopotamie', 'archeologue', 'explorateur', 'indiana jones', 'chameau', 'oasis', 'palmier', 'dune',
      'scarabee', 'gizeh', 'caire',
    ]),
    generate(b, { size, rng }) {
      const [, hi] = TARGET[size];
      const lay = new Layout(b);
      const dir = rng.chance(0.5) ? 1 : -1; // côté du temple (+X ou −X)
      const n = size === 4 ? 3 : 2;
      const PX = 9 + rng.int(0, 2), PZ = 6 + rng.int(0, 1); // place derrière pour le temple et la ziggourat
      const pcx = PX + n / 2;
      const got = { pyr: 0, queen: 0, sphinx: 0, temple: null, obel: 0, palm: 0, zig: 0, degres: false };
      const opt = (id, params, po) => lay.put(id, params, Object.assign({ optional: true, max: hi, jitter: 0.6 }, po));
      // La grande pyramide est la pièce maîtresse : posée d'abord, au centre.
      const mainPyramid = () => {
        if (lay.put('pyramide', { n }, { at: [PX, PZ], label: 'Grande pyramide' })) got.pyr++;
      };
      const pyramid = (k, tx, tz, label) => {
        const r = opt('pyramide', { n: k }, { tx, tz, label: label || 'Pyramide de reine' });
        if (r) k === 1 ? got.queen++ : got.pyr++;
        return r;
      };
      // Obélisque : fût de carrés pleins seulement ; pyramidion (triangles équilatéraux) de préférence,
      // flèche de grands triangles quand les pyramides ont pris les triangles.
      const tipFor = (k) => (b.available('EQ') >= 4 * k ? 'pyramidion' : 'fleche');
      const obelisk = (tx, tz, label, tip) => {
        if (!b.canAfford({ 'SQ!': 7 })) return null;
        const pointe = tip || tipFor(1);
        const r = opt('obelisque', { niveaux: 2, pointe, socle: false }, { tx, tz, label: label || 'Obélisque', jitter: 0.2 });
        if (r) got.obel++;
        return r;
      };
      // Paire d'obélisques assortis (même pointe).
      const obeliskPair = (a, c) => {
        const tip = tipFor(2);
        obelisk(a[0], a[1], null, tip);
        obelisk(c[0], c[1], null, tip);
      };
      // Sphinx seulement si son corps bas en demi-rectangles et sa tête en carrés pleins
      // sont assurés (sinon on y renonce plutôt que de le monter en fenêtres).
      const sphinx = (len, po, label) => {
        if (b.available('HR!') < 2 * len + 1 || !b.canAfford({ 'SQ!': 3 + len })) return null;
        const coiffe = b.available('EQ') >= 4 ? 'pyramide' : 'plate';
        const r = opt('c-sphinx', { longueur: len, coiffe }, Object.assign({ rot: 90, label: label || 'Sphinx', jitter: 0.3 }, po));
        if (r) got.sphinx++;
        return r;
      };
      // Sphinx tourné vers le spectateur (+Z), gardé par deux obélisques derrière ses épaules
      // (le sphinx reste au premier plan, les obélisques ne l'écrasent pas).
      const sphinxGroup = (len, tx, tz, withObelisks, label) => {
        const r = sphinx(len, { tx, tz }, label);
        if (r && withObelisks) obeliskPair([r.x - 1.5, r.z + 0.5], [r.x + 2.5, r.z + 0.5]);
        return r;
      };
      // Temple à arcades et ses deux obélisques devant la façade.
      const templeGroup = (w, d, pylones, tx, tz, withObelisks) => {
        const r = opt('temple', { largeur: w, profondeur: d, pylones }, { tx, tz, label: 'Temple', jitter: 0.2 });
        if (r) {
          got.temple = r;
          // Détachés de la façade : pas de silhouette d'église à deux clochers.
          if (withObelisks) obeliskPair([r.x - 0.5, r.z + r.d + 2.5], [r.x + r.w + 0.5, r.z + r.d + 2.5]);
        }
        return r;
      };
      // Palmier : tronc de 2 niveaux (plus bas, les palmes toucheraient le sol), chaque niveau
      // d'un seul type de carré ; faute de quoi on y renonce.
      const palm = (tx, tz) => {
        const h = 2;
        const levels = ['SQ', 'WIN2', 'FRAME', 'WIN4'].reduce((sum, t) => sum + Math.floor(b.available(t + '!') / 4), 0);
        if (levels < h || b.available('RT') < 4) return null;
        const r = opt('palmier', { hauteur: h, touffu: false }, { tx, tz, label: `Palmier ${got.palm + 1}`, jitter: 1 });
        if (r) got.palm++;
        return r;
      };
      const oasis = (k, cx, cz, rad) => {
        const a0 = rng.float(0, Math.PI * 2);
        for (let i = 0; i < k; i++) {
          const a = a0 + (2 * Math.PI * i) / k;
          palm(cx + rad * Math.cos(a), cz + rad * Math.sin(a));
        }
      };
      // Ziggourat en dernier : seulement si ses terrasses et ses murs visibles sont en carrés pleins.
      const ziggurat = (e, tx, tz) => {
        for (let k = e; k >= 2; k--) {
          const need = k === 3 ? { 'SQ!': 57, window: 16 } : { 'SQ!': 22, window: 4 };
          if (!b.canAfford(need)) continue;
          const sommet = b.available('EQ') >= 4 ? rng.pick(['pyramide', 'plat']) : 'plat';
          const r = opt('ziggourat', { etages: k, sommet }, { tx, tz, label: 'Ziggourat' });
          if (r) {
            got.zig = k;
            return r;
          }
        }
        return null;
      };
      const front = PZ + n + 1; // première rangée libre devant la grande pyramide
      const variant = rng.pick({
        1: ['sphinx', 'obelisques', 'trois', 'degres'],
        2: ['gizeh', 'temple', 'ziggourat', 'oasis'],
        3: ['plateau', 'avenue', 'mesopotamie'],
        4: ['vallee', 'gizeh', 'karnak'],
      }[size]);
      let titles;
      switch (variant) {
        case 'sphinx':
          mainPyramid();
          sphinxGroup(2, pcx + dir * rng.float(0, 1), front + 2.5, false);
          titles = ['La pyramide et le sphinx', 'Le gardien de la pyramide', 'Le sphinx du désert'];
          break;
        case 'obelisques':
          mainPyramid();
          obeliskPair([PX - 1.5, front + 0.5], [PX + n + 1.5, front + 0.5]);
          titles = ['Pyramide et obélisques', 'L’entrée de la pyramide'];
          break;
        case 'trois':
          mainPyramid();
          pyramid(1, pcx - dir * 2.5, PZ - 0.5);
          pyramid(1, pcx - dir * 4.5, PZ - 1.5);
          obelisk(pcx + dir * 2.5, front);
          titles = ['Les trois pyramides', 'Petit Gizeh'];
          break;
        case 'degres':
          if (lay.put('ziggourat', { etages: 2, sommet: rng.pick(['pyramide', 'plat']) }, { at: [PX, PZ], label: 'Pyramide à degrés' })) got.degres = true;
          obelisk(PX + 1.5 + dir * 3, PZ + 4);
          titles = ['Pyramide à degrés', 'La ziggourat', 'Le temple à degrés'];
          break;
        case 'gizeh':
          // Trois pyramides en diagonale, le sphinx devant la plus grande.
          mainPyramid();
          pyramid(1, pcx - dir * (n / 2 + 2), PZ - 1);
          if (size === 4) pyramid(1, pcx - dir * (n / 2 + 4), PZ - 2);
          sphinxGroup(size === 4 ? 3 : 2, pcx + dir * 1.5, front + 3, true);
          if (size === 4) {
            templeGroup(rng.int(3, 4), 2, true, pcx + dir * (n / 2 + 5), PZ - 1, true);
            oasis(rng.int(2, 4), pcx - dir * 6, front + 1, 1.8);
            ziggurat(2, pcx - dir * (n / 2 + 8), PZ - 4);
          } else oasis(1, pcx - dir * 3, front + 3, 0.5);
          titles = size === 4 ? ['Le grand plateau de Gizeh', 'Les pyramides de Gizeh'] : ['Le plateau de Gizeh', 'Les pyramides et le sphinx'];
          break;
        case 'temple':
          mainPyramid();
          templeGroup(3, 2, rng.chance(0.5), pcx + dir * (n / 2 + 3.5), PZ - 0.5, true);
          sphinxGroup(2, pcx, front + 2.5, false);
          titles = ['Le temple du pharaon', 'Pyramide et temple'];
          break;
        case 'ziggourat':
          mainPyramid();
          ziggurat(2, pcx - dir * (n / 2 + 3.5), PZ - 0.5);
          obeliskPair([pcx + dir * 2.5, front + 0.5], [pcx - dir * 1.5, front + 1.5]);
          oasis(1, pcx + dir * 4, front + 2, 0.5);
          titles = ['Pyramides d’Égypte et de Mésopotamie', 'Deux pyramides, deux styles'];
          break;
        case 'oasis':
          mainPyramid();
          sphinxGroup(2, pcx + dir * 1, front + 2.5, false);
          oasis(rng.int(2, 3), pcx - dir * 4, front + 2.5, 2);
          obelisk(pcx + dir * 3.5, front + 0.5);
          titles = ['L’oasis du pharaon', 'Palmiers et pyramide'];
          break;
        case 'plateau':
          mainPyramid();
          pyramid(1, pcx - dir * (n / 2 + 2), PZ - 0.5);
          sphinxGroup(2, pcx, front + 2.5, false);
          templeGroup(rng.int(3, 4), 2, false, pcx + dir * (n / 2 + 4.5), PZ - 0.5, true);
          oasis(rng.int(1, 2), pcx - dir * 4, front + 3, 1.5);
          titles = ['Le plateau des pyramides', 'Au pays des pharaons'];
          break;
        case 'avenue':
        case 'karnak': {
          // Temple devant la pyramide, allée jusqu'au spectateur : sphinx face à face
          // (taille 4) ou palmiers (taille 3 : un pack n'a de demi-rectangles que pour un
          // sphinx), sphinx au bout de l'allée tourné vers le spectateur.
          // Les sphinx passent avant les obélisques : ils gardent leur coiffe en pyramide.
          mainPyramid();
          const tr = templeGroup(4, 2, size === 4, pcx + dir * 0.5, front + 2, false);
          const ax = tr ? tr.x + tr.w / 2 : pcx;
          const az = tr ? tr.z + tr.d + 1 : front;
          if (variant === 'karnak') {
            sphinx(2, { tx: ax + 3, tz: az + 2.5, rot: 0 }, 'Sphinx 1');
            sphinx(2, { tx: ax - 3, tz: az + 2.5, rot: 180 }, 'Sphinx 2');
            sphinxGroup(2, ax, az + 7, true, 'Sphinx 3');
            if (tr) obeliskPair([tr.x - 1.5, tr.z + tr.d + 0.5], [tr.x + tr.w + 1.5, tr.z + tr.d + 0.5]);
            pyramid(1, pcx - dir * (n / 2 + 2), PZ - 0.5);
            oasis(2, ax + dir * 6, az + 4, 1.5);
            ziggurat(2, pcx - dir * (n / 2 + 7), PZ - 2);
          } else {
            sphinxGroup(2, ax, az + 4.5, true, 'Sphinx');
            pyramid(1, pcx - dir * (n / 2 + 2), PZ - 0.5);
            palm(ax - 3, az + 1.5);
            palm(ax + 3, az + 1.5);
          }
          titles = variant === 'karnak' ? ['Karnak et la grande pyramide', 'L’allée des sphinx'] : ['L’allée du temple', 'Le temple et son sphinx'];
          break;
        }
        case 'mesopotamie':
          // La ziggourat passe avant le reste : elle veut ses carrés pleins.
          mainPyramid();
          ziggurat(2, pcx - dir * (n / 2 + 3.5), PZ - 0.5);
          sphinxGroup(2, pcx, front + 2.5, false);
          obelisk(pcx + dir * 3, front + 0.5);
          oasis(2, pcx + dir * 4, front + 3.5, 1.5);
          titles = ['Pyramides d’Égypte et de Mésopotamie', 'Le pays des pyramides'];
          break;
        default:
          // vallee (taille 4) : deux sphinx gardés par des obélisques, temple et reine.
          mainPyramid();
          sphinxGroup(rng.int(2, 3), pcx - dir * 1.5, front + 2.5, true);
          templeGroup(rng.int(3, 4), 2, rng.chance(0.7), pcx + dir * (n / 2 + 4.5), PZ - 1.5, true);
          sphinx(2, { tx: pcx + dir * (n / 2 + 4.5), tz: PZ + 4.5 }, 'Petit sphinx');
          pyramid(1, pcx - dir * (n / 2 + 2), PZ - 0.5);
          oasis(rng.int(2, 4), pcx - dir * 6.5, PZ + 2, 1.8);
          ziggurat(rng.chance(0.5) ? 3 : 2, pcx - dir * (n / 2 + 7), PZ - 4);
          titles = ['La vallée des pharaons', 'L’Égypte des pharaons'];
      }
      // Résumé d'après ce qui a vraiment été posé.
      const made = [];
      if (got.degres) made.push('une pyramide à degrés');
      if (got.pyr) made.push(n === 3 ? `une grande pyramide de 36 triangles${got.pyr > 1 ? ' et sa voisine' : ''}` : 'une grande pyramide');
      if (got.queen) made.push(plural(got.queen, 'une pyramide de reine', 'pyramides de reines'));
      if (got.sphinx) made.push(got.sphinx > 1 ? `${got.sphinx} sphinx` : 'le sphinx');
      if (got.temple) made.push(got.temple.info.pylons ? 'un temple à pylônes' : 'un temple à arcades');
      if (got.obel) made.push(plural(got.obel, 'un obélisque', 'obélisques'));
      if (got.zig) made.push(got.zig === 3 ? 'une ziggourat à 3 étages' : 'une ziggourat');
      if (got.palm) made.push(plural(got.palm, 'un palmier', 'palmiers'));
      return { title: rng.pick(titles), summary: `Un décor d’Égypte antique avec ${listFr(made)}.` };
    },
  });

  // ---------------------------------------------------------------- géométrie
  MT.registerTheme({
    id: 'geometrie',
    name: 'Formes géométriques',
    emoji: '🔷',
    tagline: 'Galerie de solides : cube, octaèdre, icosaèdre, prismes…',
    keywords: keywords([
      'geometrie', 'forme', 'solide', 'cube', 'tetraedre', 'octaedre', 'icosaedre', 'prisme', 'polyedre', 'polycube',
      'maths', 'mathematiques', 'triangle', 'carre', 'hexagone', 'diamant', 'cristal', 'cristaux', 'de a jouer',
      'des a jouer', 'de geant', 'volume', 'sculpture', 'galerie', 'abstrait', 'figure', 'platon', 'bipyramide',
      'coupole', 'antiprisme', 'boule a facettes',
    ]),
    generate(b, { size, rng }) {
      const [lo, hi] = TARGET[size];
      const lay = new Layout(b);
      const motif = () => rng.pick(['melange', 'melange', 'plein', 'fenetres', 'cadres', 'rayures']);
      // Pièces maîtresses (taille 2 et plus) ; en taille 4 elles exigent le double pack
      // et laissent au moins 16 triangles équilatéraux aux petits solides.
      const star = {
        1: [],
        2: [rng.pick(['icosaedre', 'prisme-hexagonal', 'coupole', 'bipyramide-pentagonale', 'diamant', 'escalier', 'arche-cubes'])],
        3: rng.pick([
          ['grand-cube', 'icosaedre'], ['grand-cube', 'prisme-hexagonal'], ['grande-pyramide', 'escalier'],
          ['grand-tetraedre', 'arche-cubes'], ['grand-cube', 'diamant'], ['croix', 'icosaedre'],
        ]),
        4: rng.pick([
          ['grand-octaedre', 'grand-cube', 'croix'],
          ['grand-tetraedre', 'grande-pyramide', 'grand-cube'],
          ['icosaedre', 'grand-cube', 'arche-cubes', 'escalier'],
          ['grande-pyramide', 'prisme-hexagonal', 'croix'],
        ]),
      }[size];
      // Choix des solides selon le stock (demandes cumulées) et la taille visée :
      // au plus 2 exemplaires de chaque forme, un prisme à triangles rectangles.
      const goal = rng.int(Math.round(lo + (hi - lo) * 0.45), hi - 2);
      const cheap = ['cube', 'pave', 'tour', 'maison', 'fleche', 'prisme', 'prisme-debout', 'prisme-droit', 'pave-plat',
        'pyramide', 'tetraedre', 'cubes-l', 'cubes-t', 'grand-pave', 'octaedre', 'bipyramide'];
      const list = [
        ...star,
        'prisme-droit',
        ...rng.shuffle(SOLID_IDS.filter((id) => !(SOLIDS[id] && SOLIDS[id].big) && !star.includes(id))),
        ...rng.shuffle(cheap),
      ];
      const chosen = [];
      const copies = {};
      let acc = {}, total = 0;
      for (const id of list) {
        if (total >= goal) break;
        if ((copies[id] || 0) >= 2) continue;
        const c = solidCost(id);
        const k = costTotal(c);
        const next = Object.assign({}, acc);
        for (const [key, v] of Object.entries(c)) next[key] = (next[key] || 0) + v;
        const must = size === 4 && star.includes(id);
        if (!must && (total + k > hi || !b.canAfford(next))) continue;
        chosen.push(id);
        copies[id] = (copies[id] || 0) + 1;
        acc = next;
        total += k;
      }
      let items = chosen.map((id) => ({ id, g: solidGeom(id), must: size === 4 && star.includes(id) }));
      const arrangement = size === 1 ? rng.pick(['rangee', 'taille', 'grille'])
        : size === 2 ? rng.pick(['rangee', 'taille', 'grille', 'cercle'])
          : rng.pick(['grille', 'cercle', 'cercle']);
      if (arrangement === 'taille') items = items.slice().sort((a, c) => a.g.height - c.g.height);
      const made = [];
      const put = (it, po) => {
        const r = lay.put('solide', { forme: it.id, motif: motif() }, Object.assign({ optional: !it.must, label: it.g.name, jitter: 0 }, po));
        if (r) made.push(it.g.name.toLowerCase());
        return r;
      };
      if (arrangement === 'cercle') {
        // Pièces maîtresses au centre, les autres en couronne.
        const center = items.filter((it) => star.includes(it.id));
        const ring = items.filter((it) => !star.includes(it.id));
        const C = 12;
        const span = center.reduce((s, it) => s + it.g.w + 1, 0);
        center.forEach((it, i) => put(it, { tx: C - span / 2 + center.slice(0, i).reduce((s, o) => s + o.g.w + 1, 0) + it.g.w / 2, tz: C }));
        const per = ring.reduce((s, it) => s + Math.max(it.g.w, it.g.d) + 1.3, 0);
        const R = Math.max(span / 2 + 2.5, per / (2 * Math.PI));
        const a0 = rng.float(0, Math.PI * 2);
        ring.forEach((it, i) => {
          const a = a0 + (2 * Math.PI * i) / ring.length;
          put(it, { tx: C + R * Math.cos(a), tz: C + R * Math.sin(a) });
        });
      } else {
        // Rangées (une ou plusieurs), centrées les unes sur les autres.
        const perRow = arrangement === 'grille' ? Math.max(3, Math.ceil(Math.sqrt(items.length * 1.6))) : items.length > 7 ? Math.ceil(items.length / 2) : items.length;
        const rows = [];
        for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));
        const widths = rows.map((row) => row.reduce((s, it) => s + it.g.w + 1, -1));
        const maxW = Math.max(...widths);
        let z = 1;
        rows.forEach((row, r) => {
          const D = Math.max(...row.map((it) => it.g.d));
          let x = 1 + Math.floor((maxW - widths[r]) / 2);
          for (const it of row) {
            put(it, { at: [x, z + Math.floor((D - it.g.d) / 2)] });
            x += it.g.w + 1;
          }
          z += D + 1;
        });
      }
      const n = made.length;
      const uniq = [...new Set(made)];
      const title = rng.pick({
        rangee: [`Rangée de ${n} solides`, `${n} solides en file`],
        taille: ['Du plus petit au plus grand', `${n} solides par taille`],
        grille: [`Galerie de ${n} solides`, 'Le musée des formes', `Exposition de ${n} solides`],
        cercle: [`Cercle de ${n} solides`, 'La ronde des solides'],
      }[arrangement]);
      const summary = `Des solides exacts posés à plat sur une face${arrangement === 'taille' ? ', du plus petit au plus grand' : ''} : ` +
        `${uniq.length > 6 ? `${uniq.slice(0, 6).join(', ')} et d’autres` : listFr(uniq)}.`;
      return { title, summary };
    },
  });

  // ---------------------------------------------------------------- camping
  MT.registerTheme({
    id: 'camping',
    name: 'Camping & forêt',
    emoji: '⛺',
    tagline: 'Tentes autour du feu, sapins, cabane et tour de guet',
    keywords: keywords([
      'camping', 'camp', 'tente', 'foret', 'sapin', 'arbre', 'feu de camp', 'feu', 'cabane',
      'cabane dans les arbres', 'vacances', 'nature', 'randonnee', 'scout', 'montagne', 'lac', 'pique-nique',
      'piquenique', 'camping-car', 'caravane', 'tipi', 'indien', 'trappeur', 'ours', 'marshmallow', 'guimauve', 'guet',
      'garde forestier', 'colonie', 'bivouac', 'refuge', 'nuit etoilee', 'ecureuil', 'sac de couchage', 'canoe',
      'kayak', 'peche',
    ]),
    generate(b, { size, rng }) {
      const [, hi] = TARGET[size];
      const lay = new Layout(b);
      const C = { 1: 5, 2: 7, 3: 8, 4: 10 }[size];
      const c = C + 0.5;
      const opt = (id, params, po) => lay.put(id, params, Object.assign({ optional: true, max: hi }, po));
      const got = { tents: 0, tipis: 0, firs: 0, noel: 0, bushes: 0, table: false, cabin: null, tower: false, camper: 0 };
      // 1. Feu de camp au centre.
      const fire = lay.put('feu-de-camp', { style: rng.pick(['flammes', 'flammes', 'buches', 'buches', 'pierres']) }, { at: [C, C], label: 'Feu de camp' });
      const forest = rng.float(0, Math.PI * 2);
      const away = forest + Math.PI;
      // 2. Cabane et tour de guet d'abord : elles reçoivent les carrés pleins (toit sans trous).
      if (size >= 2) {
        const a = away + rng.float(-0.5, 0.5);
        const tx = c + 6 * Math.cos(a), tz = c + 6 * Math.sin(a);
        const options = size === 4
          ? [{ largeur: 3, profondeur: 2, niveaux: 2, terrasse: true }, { largeur: 3, profondeur: 2, niveaux: 1, terrasse: true }]
          : size === 3
            ? rng.shuffle([{ largeur: 2, profondeur: 2, niveaux: 1, terrasse: rng.chance(0.5) }, { largeur: 3, profondeur: 1, niveaux: 1, terrasse: true }])
            : [{ largeur: 2, profondeur: 1, niveaux: 1, terrasse: rng.chance(0.5) }];
        options.push({ largeur: 2, profondeur: 1, niveaux: 1, terrasse: false });
        for (const p of options) {
          if (!b.canAfford(cabinCost(p.largeur, p.profondeur, p.niveaux, p.terrasse))) continue;
          const r = opt('cabane', p, { tx, tz, rot: rotFacingFromPlusZ(c - tx, c - tz), label: 'Cabane' });
          if (r) {
            got.cabin = p;
            break;
          }
        }
      }
      if (size >= 3) {
        const a = away + (rng.chance(0.5) ? 1 : -1) * 1.1;
        const params = size === 4 ? { niveaux: 5, largeur: 1, toit: 'fleche' } : { niveaux: rng.int(3, 4), largeur: 1, toit: 'pyramide' };
        got.tower = !!opt('tour-de-guet', params, { tx: c + 7 * Math.cos(a), tz: c + 7 * Math.sin(a), label: 'Tour de guet' });
      }
      // 3. Tentes tournées vers le feu. En taille 4, les 8 tentes canadiennes fermées
      // (16 triangles rectangles) sont obligatoires : elles exigent le double pack.
      const nT = { 1: rng.int(2, 3), 2: rng.int(3, 4), 3: rng.int(4, 5), 4: 8 }[size];
      const a0 = rng.float(0, Math.PI * 2);
      for (let k = 0; k < nT; k++) {
        const a = a0 + (k * 2 * Math.PI) / nT + rng.float(-0.2, 0.2);
        const rad = size === 4 ? 4.2 + (k % 2) * 1.6 : 3.2;
        const tx = c + rad * Math.cos(a), tz = c + rad * Math.sin(a);
        const tipi = size >= 2 && size < 4 && !got.tipis && rng.chance(0.3) && b.available('TT') >= 8;
        const params = tipi ? { forme: 'tipi' } : { forme: 'canadienne', longueur: rng.int(1, 2), ouverte: size < 4 && rng.chance(0.25) };
        const rot = tipi ? 0 : rotFacingFromMinusX(c - tx, c - tz);
        const r = lay.put('tente', params, { tx, tz, rot, optional: size < 4, max: size < 4 ? hi : null, jitter: 0.5, label: tipi ? 'Tipi' : `Tente ${k + 1}` });
        if (r) tipi ? got.tipis++ : got.tents++;
      }
      // 4. Forêt d'un côté du camp : sapins à flèche tant qu'il reste des grands triangles,
      // puis buissons (jamais un cube coiffé d'une pyramide, qui ferait une maisonnette).
      let nTree = 0;
      const addTrees = (k) => {
        for (let i = 0; i < k; i++) {
          const a = forest + rng.float(-1.2, 1.2);
          const rad = rng.float(4.8, size >= 3 ? 8.5 : 6.5);
          const po = { tx: c + rad * Math.cos(a), tz: c + rad * Math.sin(a), jitter: 1.5 };
          let r = null;
          if (b.available('TT') >= 4) {
            const tronc = b.available('HR!') >= 4 ? 0 : 1;
            r = opt('sapin', { forme: 'simple', tronc, cime: 'fleche' }, Object.assign({ label: `Sapin ${nTree + 1}` }, po));
            if (r) got.firs++;
          }
          if (!r && b.available('EQ') >= 4 && got.bushes < (size === 4 ? 3 : 2)) {
            r = opt('sapin', { forme: 'buisson' }, Object.assign({ label: 'Buisson' }, po));
            if (r) got.bushes++;
          }
          if (r) nTree++;
        }
      };
      // Grand sapin étagé au bord de la forêt (taille 4), avant les petits arbres.
      if (size === 4 && b.available('RT') >= 12) {
        const a = forest + rng.float(-0.4, 0.4);
        if (opt('sapin', { forme: 'noel', tronc: 0, etages: 2, cime: b.available('TT') >= 4 ? 'fleche' : 'pyramide' }, { tx: c + 5.5 * Math.cos(a), tz: c + 5.5 * Math.sin(a), jitter: 1, label: 'Grand sapin' })) got.noel++;
      }
      addTrees({ 1: rng.int(2, 3), 2: rng.int(2, 3), 3: rng.int(3, 4), 4: rng.int(5, 6) }[size]);
      // 5. Table près du feu (bancs si les demi-rectangles le permettent).
      if (size >= 2 || rng.chance(0.5)) {
        const a = a0 + Math.PI / nT;
        got.table = !!opt('table-pique-nique', { longueur: rng.int(1, 2), bancs: b.available('HR!') >= 4 }, { tx: c + 2.4 * Math.cos(a), tz: c + 2.4 * Math.sin(a), label: 'Table de pique-nique' });
      }
      // 6. Camping-car du côté opposé à la forêt.
      if (size >= 3 || (size === 2 && rng.chance(0.4))) {
        const a = away - (rng.chance(0.5) ? 1 : -1) * 0.9;
        const rot = rng.pick([0, 90, 180, 270]);
        const tx = c + 7.5 * Math.cos(a), tz = c + 7.5 * Math.sin(a);
        for (let k = 0; k < (size === 4 ? 3 : 1); k++) {
          const step = rot % 180 ? [2 * k, 0] : [0, 2 * k];
          if (opt('c-camping-car', {}, { tx: tx + step[0], tz: tz + step[1], rot, label: k ? `Caravane ${k}` : 'Camping-car', jitter: 0.3 })) got.camper++;
        }
      }
      addTrees({ 1: 1, 2: rng.int(1, 2), 3: rng.int(2, 3), 4: rng.int(3, 5) }[size]);
      const made = [];
      if (got.tents) made.push(plural(got.tents, 'une tente', 'tentes'));
      if (got.tipis) made.push(plural(got.tipis, 'un tipi', 'tipis'));
      made.push(fire.info.style === 'pierres' ? 'un feu de camp entouré de pierres' : 'un feu de camp');
      if (got.firs) made.push(plural(got.firs, 'un sapin', 'sapins'));
      if (got.noel) made.push('un grand sapin étagé');
      if (got.bushes) made.push(plural(got.bushes, 'un buisson', 'buissons'));
      if (got.table) made.push('une table de pique-nique');
      if (got.cabin) made.push(got.cabin.niveaux > 1 ? 'une cabane à étage' : 'une cabane');
      if (got.tower) made.push('une tour de guet');
      if (got.camper) made.push(got.camper > 1 ? `${got.camper} camping-cars et caravanes` : 'un camping-car');
      const title = rng.pick({
        1: ['Petit bivouac', 'Nuit sous la tente', 'Bivouac en forêt'],
        2: ['Camping en forêt', 'Le camp des scouts', 'Week-end au camping'],
        3: ['Grand camping', 'Colonie de vacances', 'Le camp au bord du bois'],
        4: ['Village de vacances en forêt', 'Le grand camping de l’été', 'Camp de base en forêt'],
      }[size]);
      return { title, summary: `Un campement avec ${listFr(made)}.` };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
