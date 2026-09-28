/*
 * Atelier Aimanté — lot B : thèmes « Ville & gratte-ciel », « Train & gare »
 * et « Ponts & aqueducs », avec leurs modules réutilisables.
 *
 * Modules : gratte-ciel, immeuble, boutique, abribus, voiture, grande-roue
 * (ville) ; train, gare (train) ; pont, aqueduc, bateau (ponts et rivière).
 *
 * Conventions des modules : emprise [0, w] × [0, d], sol à y = 0, façade
 * principale (porte) côté sud (+Z). Véhicules et bateau : avant vers −X.
 *
 * Stock : les thèmes planifient leur budget avant de construire (carrés hors
 * arches, triangles, demi-rectangles, plateaux), posent d'abord les éléments
 * signature puis l'optionnel dans tryBuild. Les modules demandent un type
 * exact ('SQ!', 'HR!', 'CR!'…) quand une substitution serait laide (toit
 * troué, créneaux mélangés), réservent les carrés pleins de leurs toits et
 * tabliers, et signalent tout repli par b.note(…). Les titres et résumés
 * décrivent ce qui a réellement été posé.
 *
 * Tailles 1 à 3 : le socle ne fournit qu'un pack ; taille 4 : le stock choisi.
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const EQ_H = MT.EQ_H;
  const HR_H = MT.HR_H;
  const TT_H = MT.TT_H;
  const CAR = MT.CAR;
  const S3 = Math.sqrt(3);
  /** Écart entre les origines de deux plateaux attelés (2 + 2 × attelage ≈ 2,6). */
  const HITCH = CAR.length + 2 * CAR.hitch;

  const WIN_TYPES = { 'quatre-carreaux': 'WIN4', doubles: 'WIN2', cadres: 'FRAME' };
  const WIN_NAMES = Object.keys(WIN_TYPES);
  /** Carrés sans porte : les arches sont réservées aux entrées et aux arcades. */
  const SQUARES = ['SQ', 'WIN4', 'WIN2', 'FRAME'];
  /** Nombre maximal de pièces visé par taille (parties optionnelles comprises). */
  const MAX_BY_SIZE = [0, 45, 90, 136, 272];

  // ================================================================ outils

  /** « a, b et c » */
  function joinFr(list) {
    return list.length > 1 ? `${list.slice(0, -1).join(', ')} et ${list[list.length - 1]}` : list[0] || '';
  }
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /** Mur plein qui ne puise jamais dans les portes en arche. */
  function solid(b) {
    for (const t of SQUARES) if (b.stock[t] > 0) return t + '!';
    return 'solid';
  }

  /** Genre exact tant que ce type est en stock, sinon repli (mur plein par défaut). */
  function pref(b, type, fallback) {
    return b.stock[type] > 0 ? type + '!' : fallback || solid(b);
  }

  /** Premier type de la liste dont le stock couvre n pièces (rangée homogène), sinon null. */
  function rowType(b, n, types) {
    for (const t of types) if (b.stock[t] >= n) return t;
    return null;
  }

  /**
   * Met des pièces de côté : spec = { SQ: n, ARCH: n… } (type exact) ou
   * { sq: n } (carrés sans porte, pleins d'abord). Renvoie release(count) qui
   * rend count pièces (toutes par défaut). À utiliser dans une même fonction :
   * un tryBuild qui échoue restaure de toute façon le stock d'avant.
   */
  function hold(b, spec) {
    const held = [];
    for (const [k, n0] of Object.entries(spec)) {
      let n = n0;
      for (const t of k === 'sq' ? SQUARES : [k]) {
        if (n <= 0) break;
        const take = Math.max(0, Math.min(n, b.stock[t]));
        b.stock[t] -= take;
        held.push([t, take]);
        n -= take;
      }
    }
    return (count) => {
      let left = count == null ? Infinity : count;
      for (const h of held) {
        const k = Math.min(left, h[1]);
        b.stock[h[0]] += k;
        h[1] -= k;
        left -= k;
        if (!left) break;
      }
    };
  }

  /** Partie optionnelle : annulée si une pièce manque ou si le total dépasse max. */
  function optional(b, max, fn) {
    let out;
    const ok = b.tryBuild(() => {
      out = fn();
      // Dépassement du plafond de la taille : on simule un manque pour tout annuler.
      if (b.placements.length > max) b.shortTotal++;
    });
    return ok ? out === undefined ? true : out : false;
  }

  /** Nouvelle étape seulement si elle comptera au moins 3 pièces (sinon on complète la précédente). */
  function stepIf(b, label, n) {
    if (n >= 3) b.step(label);
  }

  /** Pose une liste en étapes équilibrées d'au plus max pièces. */
  function chunks(b, label, list, put, max) {
    if (!list.length) return;
    const k = Math.ceil(list.length / (max || 10));
    const per = Math.ceil(list.length / k);
    for (let i = 0; i < k; i++) {
      if (k > 1) b.step(i ? `${label} (suite)` : label);
      else stepIf(b, label, list.length);
      for (const it of list.slice(i * per, (i + 1) * per)) put(it);
    }
  }

  // ---------------------------------------------------- budget d'un plan
  const demandCache = new Map();
  /** Pièces (par type) qu'un module demande, construit à blanc avec un stock illimité. */
  function demand(id, params) {
    const mod = MT.modules[id];
    const prm = MT.normalizeParams(mod, params);
    const key = id + '|' + JSON.stringify(prm);
    if (demandCache.has(key)) return demandCache.get(key);
    const big = {};
    for (const t of MT.PIECE_ORDER) big[t] = MT.PACK[t] * 20;
    const t = new MT.Builder({ packs: 2, seed: 1, stock: big });
    t.module(id, 0, 0, prm);
    const d = {};
    for (const p of t.placements) d[p.type] = (d[p.type] || 0) + 1;
    demandCache.set(key, d);
    return d;
  }

  /**
   * Familles dont la demande dépasse le stock courant : { carre, EQ, RT, TT,
   * HR, CR, CAR } → excédent, ou null si tout tient. Les arches demandées au-delà
   * du stock retombent sur des carrés ordinaires (cadres, fenêtres).
   */
  function overBudget(b, needs) {
    const n = {};
    for (const d of needs) for (const [t, k] of Object.entries(d || {})) n[t] = (n[t] || 0) + k;
    const s = b.stock;
    const nonArch = SQUARES.reduce((a, t) => a + s[t], 0);
    const needSq = SQUARES.reduce((a, t) => a + (n[t] || 0), 0) + Math.max(0, (n.ARCH || 0) - s.ARCH);
    const over = {};
    if (needSq > nonArch) over.carre = needSq - nonArch;
    for (const t of ['EQ', 'RT', 'TT', 'HR', 'CR', 'CAR']) if ((n[t] || 0) > s[t]) over[t] = n[t] - s[t];
    return Object.keys(over).length ? over : null;
  }

  // ------------------------------------------------------------ sommets
  const CAP_NAME = { fleche: 'flèche', pyramide: 'pyramide', couronne: 'couronne de créneaux', plat: 'toit plat' };
  const CAP_ART = { fleche: 'la flèche', pyramide: 'la pyramide', couronne: 'la couronne de créneaux', plat: 'le toit plat' };
  const CAP_MISSING = { fleche: 'grands triangles', pyramide: 'triangles', couronne: 'créneaux', plat: 'carrés' };
  const CAP_ORDER = {
    fleche: ['fleche', 'pyramide', 'plat'],
    pyramide: ['pyramide', 'fleche', 'plat'],
    couronne: ['couronne', 'pyramide', 'plat'],
    plat: ['plat'],
  };

  /**
   * Sommet de colonnes 1 × 1 (y = haut des murs) : flèche (4 grands
   * triangles), pyramide (4 triangles), couronne (toit + 4 créneaux) ou toit
   * plat, avec repli selon le stock signalé par b.note. Plusieurs cellules :
   * toits plats partout, sommet pointu sur la première seulement (ou sur
   * toutes avec opts.twin). Renvoie le sommet posé (ou null).
   */
  function capTop(b, cells, y, want, what, opts) {
    const o = opts || {};
    const pts = o.twin ? cells.length : 1;
    const multi = cells.length > 1;
    const roofs = (k) => (k === 'fleche' || k === 'pyramide' ? (multi ? cells.length : 0) : cells.length);
    const fits = (k) => {
      if (b.available('roof') < roofs(k)) return false;
      if (k === 'fleche') return b.stock.TT >= 4 * pts;
      if (k === 'pyramide') return b.stock.EQ >= 4 * pts;
      if (k === 'couronne') return b.stock.CR >= 4 * pts;
      return true;
    };
    const k = (CAP_ORDER[want] || CAP_ORDER.plat).find(fits);
    if (!k) {
      b.note(`${what} : sommet omis, faute de carrés`);
      return null;
    }
    if (k !== want) b.note(`${what} : ${CAP_NAME[k]} au lieu de ${CAP_ART[want]}, faute de ${CAP_MISSING[want]}`);
    stepIf(b, what === 'Sommet' ? cap1(CAP_NAME[k]) : `${what} — ${CAP_NAME[k]}`, roofs(k) + (k === 'plat' ? 0 : 4 * pts));
    if (roofs(k)) for (const [x, z] of cells) b.floor(x, y, z, 'roof');
    for (const [x, z] of cells.slice(0, pts)) {
      if (k === 'fleche') b.pyramidRoof(x, y, z, 'TT');
      else if (k === 'pyramide') b.pyramidRoof(x, y, z, 'EQ');
      else if (k === 'couronne') b.crenelRim(x, y, z, 1, 1, 'CR!');
    }
    return k;
  }

  /**
   * Toit à deux pans (comme b.gableRoof), découpé en étapes de 12 pièces au
   * plus. opts.skip0 / opts.skip1 : pas de pignon au début / à la fin (un mur
   * plus haut le ferme) ; opts.sameStep : dans l'étape courante.
   */
  function gable(b, x, y, z, L, W, axis, kind, opts) {
    const o = opts || {};
    const map = axis === 'z' ? (a, yy, c) => [x + c, yy, z + a] : (a, yy, c) => [x + a, yy, z + c];
    const ends = [];
    if (!o.skip0) ends.push(0);
    if (!o.skip1) ends.push(L);
    const lbl = o.label || 'Toit à deux pans';
    const pignons = () => {
      for (const a of ends) b.triGrid(map(a, y, 0), map(a, y, W), map(a, y + W * EQ_H, W / 2), W, 'EQ');
    };
    const pan = (r, second) => {
      const y0 = y + r * EQ_H, y1 = y + (r + 1) * EQ_H;
      for (let k = 0; k < L; k++) {
        if (!second) b.quad(kind || 'roof', map(k, y0, r * 0.5), map(k + 1, y0, r * 0.5), map(k, y1, (r + 1) * 0.5));
        else b.quad(kind || 'roof', map(k, y0, W - r * 0.5), map(k + 1, y0, W - r * 0.5), map(k, y1, W - (r + 1) * 0.5));
      }
    };
    if (W === 1) {
      if (o.sameStep || ends.length + 2 * L <= 12) {
        if (!o.sameStep) b.step(lbl);
        pignons();
        pan(0, false);
        pan(0, true);
        return;
      }
      b.step(`${lbl} — pignons et premier pan`);
      pignons();
      pan(0, false);
      b.step(`${lbl} — second pan`);
      pan(0, true);
      return;
    }
    if (!o.sameStep) stepIf(b, `${lbl} — pignons`, ends.length * W * W);
    pignons();
    for (let r = 0; r < W; r++) {
      if (2 * L <= 12) {
        b.step(`${lbl} — rang ${r + 1}`);
        pan(r, false);
        pan(r, true);
      } else {
        b.step(`${lbl} — rang ${r + 1}, premier pan`);
        pan(r, false);
        b.step(`${lbl} — rang ${r + 1}, second pan`);
        pan(r, true);
      }
    }
  }

  /** Murs d'un niveau ; au-delà de 12 pièces, deux étapes (façade + ouest, puis arrière + est). */
  function level(b, x0, y, z0, w, d, label, kindFn) {
    if (2 * (w + d) <= 12) {
      b.step(label);
      b.room(x0, y, z0, w, d, kindFn);
      return;
    }
    b.step(`${label} — façade`);
    b.room(x0, y, z0, w, d, (a) => (a.side === 'S' || a.side === 'W' ? kindFn(a) : false));
    b.step(`${label} — arrière`);
    b.room(x0, y, z0, w, d, (a) => (a.side === 'N' || a.side === 'E' ? kindFn(a) : false));
  }

  /** Pyramide n × n (4n² triangles équilatéraux), montée rangée par rangée. */
  function pyramidRows(b, x, y, z, n, label) {
    const { sub, scale, madd } = MT.vec;
    const Q = [x + n / 2, y + n / Math.SQRT2, z + n / 2];
    const c = [[x, y, z], [x, y, z + n], [x + n, y, z + n], [x + n, y, z]];
    for (let j = 0; j < n; j++) {
      b.step(j === 0 ? label : j === n - 1 ? `${label} — pointe` : `${label} — rang ${j + 1}`);
      for (let f = 0; f < 4; f++) {
        const A = c[f];
        const e1 = scale(sub(c[(f + 1) % 4], A), 1 / n);
        const e2 = scale(sub(Q, A), 1 / n);
        const P = (i, k) => madd(madd(A, e1, i), e2, k);
        for (let i = 0; i + j <= n - 1; i++) {
          b.tri('EQ', P(i, j), P(i + 1, j), P(i, j + 1));
          if (i + j <= n - 2) b.tri('EQ', P(i, j + 1), P(i + 1, j + 1), P(i + 1, j));
        }
      }
    }
  }

  /** Arbre : cône de 4 grands triangles posé au sol (rien sans grands triangles). */
  function tree(b, x, z) {
    if (b.stock.TT < 4) return false;
    b.pyramidRoof(x, 0, z, 'TT');
    return true;
  }

  /** Arbre en bac : bac de 4 demi-rectangles, cône de grands triangles (ou buisson de triangles). */
  function planter(b, x, z) {
    if (b.stock.HR < 4) return null;
    const kind = b.stock.TT >= 4 ? 'TT' : 'EQ';
    b.halfRoom(x, 0, z, 1, 1, 'HR!');
    b.pyramidRoof(x, HR_H, z, kind);
    return kind === 'TT' ? 'arbre' : 'buisson';
  }

  // ============================================================ bâtiments

  /**
   * Genre d'un mur de façade. st = { win, pattern, door, shop } ; façade avant = S.
   * Rez-de-chaussée : porte en arche, vitrines ; étages : motif de fenêtres.
   */
  function facadeKind(b, st, l, side, i) {
    if (l === 0) {
      if (side !== 'S') return solid(b);
      if (i === st.door) return 'arch';
      return st.shop ? pref(b, st.shop) : solid(b);
    }
    const win = () => {
      for (const t of [st.win, 'WIN4', 'WIN2', 'FRAME']) if (b.stock[t] > 0) return t + '!';
      return solid(b);
    };
    switch (st.pattern) {
      case 'verre':
        return win();
      case 'bandes':
        return l % 2 === 1 ? win() : solid(b);
      case 'damier':
        return (i + l) % 2 === 0 ? win() : solid(b);
      case 'rue':
        return side === 'S' ? win() : solid(b);
      default:
        return side === 'N' ? solid(b) : win();
    }
  }

  /** Couronne de créneaux (ou garde-corps lisse) sur un toit-terrasse w × d ; renvoie le type posé. */
  function crownRim(b, w, d, y) {
    const n = 2 * (w + d);
    const t = rowType(b, n, ['CR', 'HR']);
    if (!t) {
      b.note('Couronne omise, faute de créneaux et de demi-rectangles');
      return null;
    }
    if (t === 'HR') b.note('Couronne en demi-rectangles, faute de créneaux');
    b.step(t === 'CR' ? 'Couronne de créneaux' : 'Garde-corps du toit');
    b.room(0, y, 0, w, d, t + '!');
    return t;
  }

  /**
   * Gratte-ciel. Tour 1 × 1 : 5 étages au plus (stabilité). Tour large : une
   * flèche (ou une pyramide sur une tour non carrée) se pose sur un étage 1 × 1
   * en retrait ; pyramide sur tour carrée sans retrait = grande pyramide.
   * Renvoie { levels, sommet } (niveaux de murs réellement posés).
   */
  function buildSkyscraper(b, p, rng) {
    const w = p.largeur, d = p.profondeur;
    const wide = w > 1 || d > 1;
    let L = p.etages;
    if (!wide && L > 5) {
      L = 5;
      b.note('Tour 1×1 limitée à 5 étages pour rester stable');
    }
    const st = { win: WIN_TYPES[p.fenetres], pattern: p.facade, door: Math.floor((w - 1) / 2), shop: w > 1 ? WIN_TYPES[p.fenetres] : null };
    // Carrés pleins du toit mis de côté : sinon il serait troué de cadres.
    const roofSq = wide ? w * d : p.sommet === 'plat' || p.sommet === 'couronne' ? 1 : 0;
    const rel = hold(b, { SQ: roofSq });
    for (let l = 0; l < L; l++) {
      level(b, 0, l, 0, w, d, l === 0 ? 'Rez-de-chaussée' : `Étage ${l}`, ({ side, i }) => facadeKind(b, st, l, side, i));
    }
    rel();
    if (!wide) return { levels: L, sommet: capTop(b, [[0, 0]], L, p.sommet, 'Sommet') };
    let r = Math.min(2, p.retrait);
    if (!r && p.sommet === 'pyramide' && w === d) {
      if (b.stock.EQ >= 4 * w * w) {
        pyramidRows(b, 0, L, 0, w, 'Toit en pyramide');
        return { levels: L, sommet: 'pyramide' };
      }
      b.note('Grande pyramide remplacée par un étage en retrait, faute de triangles');
    }
    if (!r && (p.sommet === 'fleche' || p.sommet === 'pyramide')) r = 1;
    b.step('Toit-terrasse');
    b.floorRect(0, L, 0, w, d, 'roof');
    if (!r) {
      const t = p.sommet === 'couronne' ? crownRim(b, w, d, L) : null;
      return { levels: L, sommet: t === 'CR' ? 'couronne' : 'plat' };
    }
    const cx = rng.int(0, w - 1);
    for (let k = 0; k < r; k++) {
      b.step(`Étage en retrait ${k + 1}`);
      b.room(cx, L + k, 0, 1, 1, () => pref(b, st.win));
    }
    return { levels: L + r, sommet: capTop(b, [[cx, 0]], L + r, p.sommet, 'Sommet') };
  }

  /** Immeuble ; renvoie { toit, garde } (garde : 'tour' | 'rue' | null). */
  function buildBlock(b, p) {
    const w = p.largeur, d = p.profondeur, L = p.etages;
    const win = WIN_TYPES[p.fenetres];
    const st = { win, pattern: 'rue', door: Math.floor((w - 1) / 2), shop: win };
    const deux = p.toit === 'deux-pans';
    // Toit plat de 2 cases de profondeur et 3 de long : cloison sous la jonction.
    const inner = !deux && d === 2 && w >= 3;
    const rel = hold(b, { SQ: (deux ? 2 * w * d : w * d) + (inner ? w : 0) });
    for (let l = 0; l < L; l++) {
      level(b, 0, l, 0, w, d, l === 0 ? 'Rez-de-chaussée' : `Étage ${l}`, ({ side, i }) => facadeKind(b, st, l, side, i));
    }
    if (inner) {
      b.step('Cloison sous le toit');
      for (let i = 0; i < w; i++) b.wall(i, L - 1, 0, 'S', solid(b));
    }
    rel();
    if (deux) {
      gable(b, 0, L, 0, w, d, 'x', 'roof');
      return { toit: 'deux-pans', garde: null };
    }
    stepIf(b, p.toit === 'terrasse' ? 'Toit-terrasse' : 'Toit plat', w * d);
    b.floorRect(0, L, 0, w, d, 'roof');
    if (p.toit !== 'terrasse') return { toit: 'plat', garde: null };
    // Garde-corps tout autour si le stock le permet, sinon côté rue seulement.
    const all = 2 * (w + d);
    if (b.stock.HR >= all) {
      b.step('Garde-corps de la terrasse');
      b.halfRoom(0, L, 0, w, d, 'HR!');
      return { toit: 'terrasse', garde: 'tour' };
    }
    if (b.stock.HR >= w) {
      b.note('Garde-corps côté rue seulement, faute de demi-rectangles');
      stepIf(b, 'Garde-corps côté rue', w);
      for (let i = 0; i < w; i++) b.halfWall(i, L, d - 1, 'S', 'HR!');
      return { toit: 'terrasse', garde: 'rue' };
    }
    b.note('Terrasse sans garde-corps, faute de demi-rectangles');
    return { toit: 'terrasse', garde: null };
  }

  function buildShop(b, p) {
    const w = p.largeur;
    const vit = WIN_TYPES[p.vitrine];
    const door = Math.floor((w - 1) / 2);
    const rel = hold(b, { SQ: w });
    b.step(w === 1 ? 'Murs' : 'Murs de la boutique');
    b.room(0, 0, 0, w, 1, ({ side, i }) => (side === 'S' ? (i === door ? 'arch' : pref(b, vit)) : solid(b)));
    rel();
    // Toit et enseigne dans la même étape (sauf gros toit en pyramides).
    const ens = p.enseigne === 'fronton' ? w : p.enseigne === 'triangle' ? 1 : p.enseigne === 'auvent' ? w + 2 : 0;
    stepIf(b, p.enseigne === 'aucune' ? 'Toit' : 'Toit et enseigne', w + ens);
    b.floorRect(0, 1, 0, w, 1, 'roof');
    let enseigne = p.enseigne;
    if (enseigne === 'fronton') {
      // Fronton lisse seulement (des créneaux feraient un château).
      if (b.stock.HR >= w) for (let i = 0; i < w; i++) b.halfWall(i, 1, 0, 'S', 'HR!');
      else if (b.stock.EQ > 0) {
        b.note('Enseigne en triangle au lieu du fronton, faute de demi-rectangles');
        b.tri('EQ', [door, 1, 1], [door + 1, 1, 1], [door + 0.5, 1 + EQ_H, 1]);
        enseigne = 'triangle';
      } else {
        b.note('Fronton omis, faute de demi-rectangles');
        enseigne = 'aucune';
      }
    } else if (enseigne === 'triangle') {
      b.tri('EQ', [door, 1, 1], [door + 1, 1, 1], [door + 0.5, 1 + EQ_H, 1]);
    } else if (enseigne === 'auvent') {
      // Auvent horizontal accroché au haut de la façade, tenu par deux équerres.
      for (let i = 0; i < w; i++) b.floor(i, 1, 1, pref(b, 'FRAME', 'roof'));
      b.tri('RT', [0, 1, 1], [0, 1, 2], [0, 0, 1]);
      b.tri('RT', [w, 1, 1], [w, 1, 2], [w, 0, 1]);
    }
    let toit = 'plat';
    if (p.toit === 'pyramide') {
      if (b.stock.EQ >= 4 * w) {
        stepIf(b, 'Toit pointu', 4 * w);
        for (let i = 0; i < w; i++) b.pyramidRoof(i, 1, 0, 'EQ');
        toit = 'pyramide';
      } else b.note('Toit plat, faute de triangles pour le toit pointu');
    }
    return { enseigne, toit };
  }

  function buildShelter(b) {
    // Paroi vitrée au nord, toit tenu par deux équerres : ouvert au sud.
    const glass = rowType(b, 2, ['WIN2', 'FRAME', 'WIN4']);
    b.step('Paroi, toit et équerres');
    for (let i = 0; i < 2; i++) b.wall(i, 0, 0, 'N', glass ? glass + '!' : solid(b));
    for (let i = 0; i < 2; i++) b.floor(i, 1, 0, b.stock.SQ > 0 ? 'SQ!' : 'roof');
    b.tri('RT', [0, 1, 0], [0, 1, 1], [0, 0, 0]);
    b.tri('RT', [2, 1, 0], [2, 1, 1], [2, 0, 0]);
    return {};
  }

  /** Voiture sur un plateau à roues (avant vers −X) ; renvoie { modele } réellement posé. */
  function buildCar(b, p) {
    const y = CAR.top;
    let modele = p.modele;
    if (modele === 'cabriolet' && b.stock.HR < 4) {
      b.note('Berline au lieu du cabriolet, faute de demi-rectangles');
      modele = 'berline';
    }
    b.step('Plateau et habitacle');
    b.car(0, 0, 'x');
    if (modele === 'camionnette') {
      const rel = hold(b, { SQ: 2 });
      b.room(0, y, 0, 2, 1, ({ side, i }) => {
        if (side === 'W') return pref(b, 'WIN4');
        if ((side === 'N' || side === 'S') && i === 0) return pref(b, 'WIN2');
        return solid(b);
      });
      rel();
      b.floorRect(0, y + 1, 0, 2, 1, b.stock.SQ >= 2 ? 'SQ!' : 'roof');
      return { modele };
    }
    if (modele === 'cabriolet') {
      // Carrosserie basse : dossier en U à l'arrière, pare-brise à l'avant.
      b.halfWall(1, y, 0, 'N', 'HR!');
      b.halfWall(1, y, 0, 'S', 'HR!');
      b.halfWall(1, y, 0, 'E', 'HR!');
      b.halfWall(0, y, 0, 'W', 'HR!');
      return { modele };
    }
    // Berline : habitacle à l'arrière, capot à l'avant. Pick-up : cabine à l'avant, benne à l'arrière.
    const cab = modele === 'pick-up' ? 0 : 1;
    const other = 1 - cab;
    b.wall(cab, y, 0, 'W', pref(b, 'WIN4'));
    b.wall(cab, y, 0, 'N', pref(b, 'WIN2'));
    b.wall(cab, y, 0, 'S', pref(b, 'WIN2'));
    b.wall(cab, y, 0, 'E', solid(b));
    b.floor(cab, y + 1, 0, b.stock.SQ > 0 ? 'SQ!' : 'roof');
    if (b.stock.HR >= 3) {
      b.step(cab ? 'Capot' : 'Benne');
      b.halfWall(other, y, 0, 'N', 'HR!');
      b.halfWall(other, y, 0, 'S', 'HR!');
      b.halfWall(other, y, 0, other === 0 ? 'W' : 'E', 'HR!');
    } else b.note(`${cab ? 'Capot' : 'Benne'} omis, faute de demi-rectangles`);
    return { modele };
  }

  /**
   * Grande roue : roue verticale en dodécagone (hexagone de 6 triangles au
   * centre, 6 carrés-nacelles, 6 triangles entre eux ; 3,73 de diamètre),
   * face au sud, posée sur un socle-guichet 1 × 1 et deux pieds en triangles
   * rectangles. Taille 2 : socle de 2 niveaux et double roue reliée par 5
   * nacelles. Emprise 4 × 1.
   */
  function buildWheel(b, p) {
    const hp = p.taille >= 2 ? 2 : 1;
    let two = p.taille >= 2;
    if (two && b.stock.EQ < 24) {
      two = false;
      b.note('Roue simple, faute de triangles pour la double roue');
    }
    const cx = 2, cy = hp + (2 + S3) / 2;
    const planes = two ? [0, 1] : [1];
    b.step('Socle et guichet');
    for (let l = 0; l < hp; l++) b.room(1.5, l, 0, 1, 1, ({ side }) => (side === 'S' && l === 0 ? 'arch' : solid(b)));
    b.floor(1.5, hp, 0, b.stock.SQ > 0 ? 'SQ!' : 'roof');
    stepIf(b, 'Pieds', 2 * planes.length);
    for (const zf of planes) {
      b.tri('RT', [1.5, 0, zf], [0.5, 0, zf], [1.5, 1, zf]);
      b.tri('RT', [2.5, 0, zf], [3.5, 0, zf], [2.5, 1, zf]);
    }
    const H = (k) => [cx + Math.cos((k * Math.PI) / 3), cy + Math.sin((k * Math.PI) / 3)];
    const N = (k) => [Math.cos(((k + 0.5) * Math.PI) / 3), Math.sin(((k + 0.5) * Math.PI) / 3)];
    const at = (q, z) => [q[0], q[1], z];
    const plus = (q, n) => [q[0] + n[0], q[1] + n[1]];
    for (const zw of planes) {
      const lbl = two ? (zw === 1 ? 'Roue avant' : 'Roue arrière') : 'Roue';
      b.step(`${lbl} — moyeu et nacelles`);
      for (let k = 0; k < 6; k++) b.tri('EQ', at(H(k), zw), at(H(k + 1), zw), [cx, cy, zw]);
      for (let k = 0; k < 6; k++) b.quad('window', at(H(k), zw), at(H(k + 1), zw), at(plus(H(k), N(k)), zw));
      b.step(`${lbl} — jante`);
      for (let k = 0; k < 6; k++) {
        const V = H(k + 1);
        b.tri('EQ', at(plus(V, N(k)), zw), at(plus(V, N(k + 1)), zw), at(V, zw));
      }
    }
    if (two) {
      b.step('Nacelles entre les deux roues');
      for (const k of [0, 1, 2, 3, 5]) {
        const A = plus(H(k), N(k)), B = plus(H(k + 1), N(k));
        b.quad(pref(b, 'FRAME', 'window'), at(A, 0), at(B, 0), at(A, 1));
      }
    }
    return { roues: two ? 2 : 1 };
  }

  // ======================================================= modules : ville

  MT.registerModule({
    id: 'gratte-ciel',
    label: 'Gratte-ciel',
    description:
      'Porte au sud (+Z). Tour de 1×1 à 2×2 cases, 2 à 8 étages (1×1 : 5 au plus). Tour large : flèche = +1 étage 1×1 ' +
      'en retrait ; pyramide sur tour carrée = 4 triangles par case au sol. Sommet plat, pyramide, flèche ou créneaux.',
    params: {
      largeur: { type: 'int', min: 1, max: 2, default: 2, label: 'Largeur (X)' },
      profondeur: { type: 'int', min: 1, max: 2, default: 2, label: 'Profondeur (Z)' },
      etages: { type: 'int', min: 2, max: 8, default: 5, label: 'Étages' },
      retrait: { type: 'int', min: 0, max: 2, default: 0, label: 'Étages en retrait (tours larges)' },
      sommet: { type: 'enum', values: ['fleche', 'pyramide', 'plat', 'couronne'], default: 'fleche', label: 'Sommet' },
      facade: { type: 'enum', values: ['facade', 'verre', 'bandes', 'damier'], default: 'facade', label: 'Motif des fenêtres' },
      fenetres: { type: 'enum', values: WIN_NAMES, default: 'quatre-carreaux', label: 'Type de fenêtres' },
    },
    footprint: (p) => ({ w: p.largeur, d: p.profondeur }),
    build(b, p, { rng }) {
      return buildSkyscraper(b, p, rng);
    },
  });

  MT.registerModule({
    id: 'immeuble',
    label: 'Immeuble',
    description:
      'Porte et fenêtres au sud (+Z). Immeuble de 2 à 4 × 1 ou 2 cases, 1 à 4 étages ; toit à deux pans (faîtage le ' +
      'long de X), plat ou terrasse bordée de demi-rectangles (2 × (largeur + profondeur)).',
    params: {
      largeur: { type: 'int', min: 2, max: 4, default: 3, label: 'Largeur (X)' },
      profondeur: { type: 'int', min: 1, max: 2, default: 1, label: 'Profondeur (Z)' },
      etages: { type: 'int', min: 1, max: 4, default: 2, label: 'Étages' },
      toit: { type: 'enum', values: ['deux-pans', 'plat', 'terrasse'], default: 'deux-pans', label: 'Toit' },
      fenetres: { type: 'enum', values: WIN_NAMES, default: 'doubles', label: 'Type de fenêtres' },
    },
    footprint: (p) => ({ w: p.largeur, d: p.profondeur }),
    build(b, p) {
      return buildBlock(b, p);
    },
  });

  MT.registerModule({
    id: 'boutique',
    label: 'Boutique',
    description:
      'Porte et vitrines au sud (+Z) ; l’auvent déborde d’une case au sud (emprise largeur × 2). Boutique de ' +
      'plain-pied de 1 à 3 cases, enseigne en demi-rectangles, triangle ou auvent, toit plat ou pointu (triangles).',
    params: {
      largeur: { type: 'int', min: 1, max: 3, default: 2, label: 'Largeur (X)' },
      enseigne: { type: 'enum', values: ['auvent', 'fronton', 'triangle', 'aucune'], default: 'auvent', label: 'Enseigne' },
      vitrine: { type: 'enum', values: ['doubles', 'cadres', 'quatre-carreaux'], default: 'doubles', label: 'Vitrines' },
      toit: { type: 'enum', values: ['plat', 'pyramide'], default: 'plat', label: 'Toit' },
    },
    footprint: (p) => ({ w: p.largeur, d: p.enseigne === 'auvent' ? 2 : 1 }),
    build(b, p) {
      return buildShop(b, p);
    },
  });

  MT.registerModule({
    id: 'abribus',
    label: 'Abribus',
    description:
      'Ouvert au sud (+Z), emprise 2 × 1 : paroi vitrée au nord, toit de 2 carrés tenu par 2 triangles rectangles. ' +
      'Petit décor de rue (6 pièces) ; sert aussi de kiosque ou de guichet.',
    params: {},
    footprint: () => ({ w: 2, d: 1 }),
    build(b) {
      return buildShelter(b);
    },
  });

  MT.registerModule({
    id: 'voiture',
    label: 'Voiture',
    description:
      'Avant vers −X, emprise 2 × 1, 1 plateau à roues (2 par pack). Berline ou pick-up (5 carrés + 3 demi-rectangles), ' +
      'camionnette (8 carrés) ou cabriolet (4 demi-rectangles, aucun carré).',
    params: {
      modele: { type: 'enum', values: ['berline', 'camionnette', 'pick-up', 'cabriolet'], default: 'berline', label: 'Modèle' },
    },
    footprint: () => ({ w: 2, d: 1 }),
    build(b, p) {
      return buildCar(b, p);
    },
  });

  MT.registerModule({
    id: 'grande-roue',
    label: 'Grande roue',
    description:
      'Roue de fête foraine face au sud (+Z), emprise 4 × 1, sur un socle-guichet et deux pieds. Taille 1 : roue de ' +
      '12 triangles et 6 carrés (25 pièces, 4,7 de haut) ; taille 2 : double roue et nacelles (24 triangles, 5,7 de haut).',
    params: {
      taille: { type: 'int', min: 1, max: 2, default: 1, label: 'Taille' },
    },
    footprint: () => ({ w: 4, d: 1 }),
    build(b, p) {
      return buildWheel(b, p);
    },
  });

  // ======================================================== thème : ville

  /** Nombre de fenêtres qu'un gratte-ciel consomme avec un motif donné (estimation). */
  function windowCount(p, pattern) {
    const L = Math.min(p.etages, p.largeur === 1 && p.profondeur === 1 ? 5 : 99) - 1;
    const w = p.largeur, d = p.profondeur, per = 2 * (w + d);
    let n;
    if (pattern === 'verre') n = L * per;
    else if (pattern === 'bandes') n = Math.ceil(L / 2) * per;
    else if (pattern === 'damier') n = Math.ceil((L * per) / 2);
    else n = L * (w + 2 * d);
    const wide = w > 1 || d > 1;
    const bigPyr = p.sommet === 'pyramide' && w === d && !p.retrait;
    const lantern = wide ? p.retrait || ((p.sommet === 'fleche' || p.sommet === 'pyramide') && !bigPyr ? 1 : 0) : 0;
    return n + 4 * lantern + (w > 1 ? w - 1 : 0);
  }

  /** Motif de fenêtres de chaque tour pour que l'ensemble tienne dans le budget de fenêtres. */
  function fitPatterns(R, towers, budget) {
    const full = towers.map((t) => windowCount(t.params, 'verre'));
    const total = full.reduce((a, c) => a + c, 0) || 1;
    towers.forEach((t, k) => {
      const share = (budget * full[k]) / total;
      const opts = ['verre', 'facade', 'bandes', 'damier']
        .map((pt) => [pt, windowCount(t.params, pt)])
        .filter(([, n]) => n <= share + 1)
        .sort((a, c) => c[1] - a[1]);
      t.params.facade = opts.length ? R.pick(opts.slice(0, 2))[0] : 'damier';
    });
  }

  const SHOP_NAMES = ['Boulangerie', 'Café', 'Fleuriste', 'Librairie', 'Épicerie', 'Pharmacie', 'Glacier', 'Pâtisserie'];
  const TOWER_NAMES = ['Tour de verre', 'Tour des bureaux', 'Tour bleue', 'Tour du parc', 'Tour de la banque', 'Tour de l’hôtel'];
  const CAR_LABELS = { berline: 'Voiture', camionnette: 'Camionnette', 'pick-up': 'Pick-up', cabriolet: 'Cabriolet' };

  /** Demande en pièces d'un élément de scène (module ou arbre). */
  function itemDemand(it) {
    if (it.module) return demand(it.module, it.params);
    if (it.kind === 'tree') return { TT: 4 };
    if (it.kind === 'planter') return { HR: 4, TT: 4 };
    return {};
  }

  /*
   * Rangée de bâtiments le long de X. row = { north, front } : façades
   * alignées sur z = front, tournées vers la rue (+Z au nord, −Z au sud).
   * Le socle est posé de gauche à droite (addCore) ; les éléments optionnels
   * s'ajoutent ensuite à droite ou à gauche (addOptional).
   */
  function cityRow(b, R, row) {
    const st = { xl: 0, xr: 0, left: null, right: null, built: [], side: R.chance(0.5) };
    const widthOf = (it) => (it.module ? MT.footprintOf(it.module, it.params, 0).w : 1);
    const gapBetween = (a, c) => {
      if (!a || !c) return 0;
      if (a.gable || a.crown || c.gable || c.crown || (a.tower && c.tower) || a.shelter || c.shelter) return 1;
      return R.chance(0.4) ? 1 : 0;
    };
    const put = (it, x) => {
      if (!it.module) {
        b.step(it.label);
        const z = row.north ? row.front - 1 : row.front;
        if (it.kind === 'tree') {
          if (!tree(b, x, z)) b.shortTotal++;
          it.info = 'arbre';
        } else {
          it.info = planter(b, x, z);
          if (!it.info) b.shortTotal++;
        }
        return it.info;
      }
      const fpD = MT.footprintOf(it.module, it.params, 0).d;
      const z = row.north ? row.front - it.bodyD : row.front - (fpD - it.bodyD);
      it.info = b.module(it.module, x, z, it.params, { rot: row.north ? 0 : 180, label: it.label });
      return it.info;
    };
    st.addCore = (it) => {
      const x = st.xr + gapBetween(st.right, it);
      put(it, x);
      if (!st.left) st.left = it;
      st.right = it;
      st.xr = x + widthOf(it);
      st.built.push(it);
    };
    st.addOptional = (it, max) => {
      const w = widthOf(it);
      st.side = !st.side;
      for (const toRight of [st.side, !st.side]) {
        const x = toRight ? st.xr + gapBetween(st.right, it) : st.xl - gapBetween(it, st.left) - w;
        if (optional(b, max, () => put(it, x))) {
          if (toRight) {
            st.right = it;
            st.xr = x + w;
          } else {
            st.left = it;
            st.xl = x;
          }
          if (!st.left) st.left = it;
          if (!st.right) st.right = it;
          st.built.push(it);
          return true;
        }
      }
      return false;
    };
    return st;
  }

  function generateCity(b, ctx) {
    const { size } = ctx;
    const R = ctx.rng;
    const max = MAX_BY_SIZE[size];
    const winOrder = R.shuffle(WIN_NAMES);
    const shopNames = R.shuffle(SHOP_NAMES);
    const towerNames = R.shuffle(TOWER_NAMES);
    let wi = 0, si = 0, ti = 0;

    const tower = (w, d, etages, sommet, extra) => ({
      module: 'gratte-ciel', bodyD: d, tower: true, crown: sommet === 'couronne',
      label: w > 1 ? towerNames[ti++ % towerNames.length] : etages >= 5 ? 'Tour élancée' : 'Petite tour',
      params: Object.assign(
        { largeur: w, profondeur: d, etages, retrait: 0, sommet, facade: 'facade', fenetres: winOrder[wi++ % 3] },
        extra || {}
      ),
    });
    const shop = (w, extra) => ({
      module: 'boutique', bodyD: 1, shop: true, label: shopNames[si++ % shopNames.length],
      params: Object.assign({
        largeur: w, enseigne: R.pick(['auvent', 'fronton', 'triangle', 'auvent']),
        vitrine: R.pick(['doubles', 'cadres', 'quatre-carreaux']), toit: R.chance(0.35) ? 'pyramide' : 'plat',
      }, extra || {}),
    });
    const block = (w, d, etages) => {
      const toit = R.pick(['deux-pans', 'plat', 'terrasse']);
      return {
        module: 'immeuble', bodyD: d, gable: toit === 'deux-pans', crown: toit === 'terrasse', block: true, label: 'Immeuble',
        params: { largeur: w, profondeur: d, etages, toit, fenetres: winOrder[wi++ % 3] },
      };
    };
    const shelter = () => ({ module: 'abribus', bodyD: 1, shelter: true, label: 'Abribus', params: {} });
    const treeIt = () => ({ kind: 'tree', label: 'Arbre' });
    const planterIt = () => ({ kind: 'planter', label: 'Arbre en bac', crown: true });
    const slim = (etages, sommet) => tower(1, 1, etages, sommet || R.pick(['fleche', 'pyramide', 'fleche', 'couronne']));
    const wide = (etages, top) => tower(2, 2, etages, top.sommet, { retrait: top.retrait || 0 });
    const wideTop = () => R.pick([{ sommet: 'fleche' }, { sommet: 'pyramide' }, { sommet: 'pyramide', retrait: 1 }, { sommet: 'couronne', retrait: 1 }]);

    // ---- programme de la taille
    let north = [], south = [], extras = [], cars = [], farTrees = 0, park = false, variant = '';
    const carModel = () => R.pick(['berline', 'berline', 'cabriolet', 'pick-up', 'camionnette']);
    if (size === 1) {
      north.push(slim(R.int(3, 4)));
      north.push(R.chance(0.6) ? shop(R.int(1, 2)) : slim(R.int(2, 3), R.pick(['pyramide', 'couronne', 'plat'])));
      if (R.chance(0.75)) cars.push(R.pick(['berline', 'cabriolet', 'pick-up']));
      extras = R.shuffle([treeIt(), shelter(), planterIt()]).slice(0, 2);
    } else if (size === 2) {
      north.push(R.chance(0.5) ? wide(3, wideTop()) : slim(4));
      north.push(R.chance(0.5) ? block(R.int(2, 3), 1, 2) : slim(R.int(3, 4)));
      north.push(shop(1));
      cars.push(carModel());
      if (R.chance(0.5)) cars.push(cars[0] === 'cabriolet' ? 'berline' : R.pick(['cabriolet', 'pick-up']));
      extras = R.shuffle([treeIt(), shelter(), planterIt(), shop(1)]);
      farTrees = 1;
    } else if (size === 3) {
      variant = R.pick(['retrait', 'pyramide', 'trois']);
      if (variant === 'retrait') {
        north.push(wide(4, { sommet: R.pick(['fleche', 'pyramide']), retrait: 1 }));
        north.push(slim(4, R.pick(['couronne', 'fleche'])));
        north.push(shop(1));
      } else if (variant === 'pyramide') {
        north.push(wide(5, { sommet: 'pyramide' }));
        north.push(slim(R.int(3, 4), 'fleche'));
        north.push(shop(R.int(1, 2)));
      } else {
        north.push(slim(5, 'fleche'), slim(4, 'couronne'), slim(3, 'pyramide'));
        north.push(shop(1));
      }
      cars.push(R.pick(['berline', 'pick-up']), 'cabriolet');
      extras = R.shuffle([treeIt(), planterIt(), shelter(), shop(1), treeIt()]);
      farTrees = 2;
    } else {
      variant = R.pick(['avenue', 'parc']);
      north.push(wide(6, { sommet: R.pick(['fleche', 'pyramide']), retrait: R.int(1, 2) }));
      north.push(slim(5, R.pick(['couronne', 'fleche'])));
      north.push(shop(2, { toit: 'pyramide' }));
      if (variant === 'avenue') {
        south.push(block(R.int(2, 3), 1, R.int(2, 3)), shop(1), shop(1, { enseigne: 'auvent' }));
        extras = R.shuffle([shelter(), treeIt(), planterIt(), slim(4, 'couronne'), shop(1)]);
      } else {
        park = true;
        north.push(slim(4, 'couronne'));
        extras = R.shuffle([shop(1), treeIt(), block(2, 1, 2), planterIt()]);
      }
      cars.push('berline', R.pick(['camionnette', 'pick-up']), 'cabriolet', R.pick(['berline', 'pick-up']));
    }
    north = R.shuffle(north);
    south = R.shuffle(south);

    // ---- budget : le socle, les voitures et les arbres prévus doivent tenir ensemble.
    const plannedTrees = extras.filter((it) => it.kind === 'tree').length + farTrees;
    const minFloors = [0, 2, 3, 4, 5][size];
    for (let guard = 0; guard < 40; guard++) {
      const core = north.concat(south);
      const needs = core.map(itemDemand).concat(cars.map((m) => demand('voiture', { modele: m })));
      if (park) needs.push(demand('grande-roue', { taille: 1 }));
      needs.push({ TT: 4 * Math.min(plannedTrees, 1) });
      const over = overBudget(b, needs);
      if (!over) break;
      const towers = core.filter((it) => it.tower).sort((a, c) => c.params.etages * c.params.largeur - a.params.etages * a.params.largeur);
      if (over.carre) {
        const vanI = cars.indexOf('camionnette');
        const big = towers.find((t) => t.params.etages > (t === towers[0] ? minFloors : Math.max(2, minFloors - 1)));
        if (vanI >= 0) cars[vanI] = 'cabriolet';
        else if (big) big.params.etages--;
        else if (cars.length > 1) cars.pop();
        else if (core.length > 2) {
          const drop = core[core.length - 1];
          north = north.filter((it) => it !== drop);
          south = south.filter((it) => it !== drop);
        } else break;
        continue;
      }
      if (over.TT) {
        const t = towers.find((it) => it.params.sommet === 'fleche');
        if (t) t.params.sommet = 'pyramide';
        else break;
        continue;
      }
      if (over.EQ) {
        const t = towers.find((it) => it.params.sommet === 'pyramide');
        const s = core.find((it) => it.shop && it.params.toit === 'pyramide');
        if (s) s.params.toit = 'plat';
        else if (t) t.params.sommet = 'plat';
        else break;
        continue;
      }
      if (over.HR) {
        const c = cars.indexOf('cabriolet');
        const terr = core.find((it) => it.block && it.params.toit === 'terrasse');
        if (c >= 0) cars[c] = 'berline';
        else if (terr) {
          terr.params.toit = 'plat';
          terr.crown = false;
        } else if (cars.length > 1) cars.pop();
        else break;
        continue;
      }
      if (over.CR) {
        const t = towers.find((it) => it.params.sommet === 'couronne');
        if (t) t.params.sommet = 'pyramide';
        else break;
        continue;
      }
      if (over.CAR) {
        cars.pop();
        continue;
      }
      break;
    }
    // Nom des tours fines d'après leur hauteur finale.
    for (const t of north.concat(south, extras)) {
      if (t.tower && t.params.largeur === 1) t.label = t.params.etages >= 5 ? 'Tour élancée' : 'Petite tour';
    }
    {
      const core = north.concat(south);
      const reserve = core.reduce((n, it) => n + (it.shop ? it.params.largeur - 1 : 0) + (it.block ? it.params.largeur * it.params.etages : 0), 0);
      fitPatterns(R, core.filter((it) => it.tower), (size === 4 ? 48 : 24) - reserve - 2 * cars.length);
    }

    // ---- socle : rangée nord (façades au sud), rangée sud éventuelle (façades au nord)
    const nFront = Math.max(1, ...north.map((it) => it.bodyD || 1));
    const rows = [cityRow(b, R, { north: true, front: nFront })];
    if (south.length) rows.push(cityRow(b, R, { north: false, front: nFront + 4 }));
    for (const it of north) rows[0].addCore(it);
    for (const it of south) rows[1].addCore(it);
    const span = () => [Math.min(...rows.map((r) => r.xl)), Math.max(...rows.map((r) => r.xr))];

    // ---- voitures sur la voie centrale de la rue, espacées
    const carsBuilt = [];
    {
      // Places espacées de 3 le long de la rue, qui déborde un peu des bâtiments.
      const [xl, xr] = span();
      const x0 = xl - (cars.length > 2 ? 2 : 0) + R.int(0, 1);
      const slots = R.shuffle(Array.from({ length: Math.max(cars.length, Math.floor((xr - x0) / 3)) }, (_, i) => x0 + 3 * i));
      for (const x of slots) {
        if (carsBuilt.length >= cars.length) break;
        // Modèle prévu, adapté aux demi-rectangles restants (sinon capot ou benne manquerait).
        let modele = cars[carsBuilt.length];
        if (modele === 'cabriolet' && b.stock.HR < 4) modele = 'berline';
        if ((modele === 'berline' || modele === 'pick-up') && b.stock.HR < 3) modele = 'camionnette';
        const rot = R.pick([0, 180]);
        let got = null;
        for (const m of [modele, 'berline']) {
          got = optional(b, max, () => b.module('voiture', x, nFront + 1.5, { modele: m }, { rot, label: CAR_LABELS[m] }));
          if (got) break;
        }
        if (!got) continue;
        carsBuilt.push(got.modele);
      }
    }

    // ---- place de la grande roue (taille 4, variante parc), au sud de la rue
    let wheel = null;
    if (park) {
      const [xl, xr] = span();
      const xw = Math.round((xl + xr) / 2) - 2 + R.int(-1, 1);
      wheel = optional(b, max, () => b.module('grande-roue', xw, nFront + 4, { taille: 1 }, { label: 'Grande roue' }));
      if (wheel) {
        // Abribus face à la rue et arbres autour de la roue.
        optional(b, max, () => b.module('abribus', xw - 3, nFront + 3, {}, { rot: 180, label: 'Abribus' })) && (wheel.shelter = true);
        wheel.trees = 0;
        for (const [x, z] of R.shuffle([[xw - 1, nFront + 6], [xw + 5, nFront + 5], [xw + 5, nFront + 7], [xw - 2, nFront + 5]])) {
          if (optional(b, max, () => {
            b.step('Arbre du parc');
            if (!tree(b, x, z)) b.shortTotal++;
          })) wheel.trees++;
        }
      }
    }

    // ---- éléments optionnels, répartis sur les rangées
    extras.forEach((it, i) => {
      if (it.tower && it.bodyD > nFront) return;
      rows[i % rows.length].addOptional(it, max);
    });
    const built = rows.flatMap((r) => r.built);

    // ---- arbres alignés sur le trottoir d'en face (pas de rangée sud)
    let nTrees = built.filter((it) => it.info === 'arbre').length + (wheel ? wheel.trees : 0);
    let nBush = built.filter((it) => it.info === 'buisson').length;
    if (!south.length && !park) {
      const [xl, xr] = span();
      for (let k = 0, x = xl + R.int(0, 1); k < farTrees && x < xr; k++, x += 3 + R.int(0, 1)) {
        if (optional(b, max, () => {
          b.step('Arbre du trottoir');
          if (!tree(b, x, nFront + 3)) b.shortTotal++;
        })) nTrees++;
      }
    }

    // ---- texte d'après ce qui a été posé
    const towers = built.filter((it) => it.tower);
    const nShops = built.filter((it) => it.shop).length;
    const nBlocks = built.filter((it) => it.block).length;
    const nShelters = built.filter((it) => it.shelter).length + (wheel && wheel.shelter ? 1 : 0);
    const southBuilt = rows[1] ? rows[1].built.filter((it) => it.module && !it.shelter).length : 0;
    const tallest = Math.max(...towers.map((t) => (t.info && t.info.levels) || t.params.etages));
    const parts = [];
    parts.push(towers.length === 1 ? `un gratte-ciel de ${tallest} étages` : `${towers.length} gratte-ciel (le plus haut : ${tallest} étages)`);
    if (nBlocks) parts.push(plural(nBlocks, 'immeuble', 'immeubles'));
    if (nShops) parts.push(plural(nShops, 'boutique', 'boutiques'));
    if (nShelters) parts.push(plural(nShelters, 'abribus', 'abribus'));
    if (carsBuilt.length) parts.push(plural(carsBuilt.length, 'voiture', 'voitures'));
    if (nTrees) parts.push(plural(nTrees, 'arbre', 'arbres'));
    if (nBush) parts.push(plural(nBush, 'buisson en bac', 'buissons en bac'));
    let where;
    if (southBuilt >= 2) where = 'Une avenue bordée de bâtiments des deux côtés';
    else if (southBuilt === 1) where = 'Une rue avec un bâtiment en face';
    else where = 'Une rue';
    let title;
    if (wheel) title = towers.length > 1 ? `Ville à ${towers.length} gratte-ciel et grande roue` : 'Gratte-ciel et grande roue';
    else if (towers.length < 2) title = 'Rue et son gratte-ciel';
    else title = `${southBuilt >= 2 ? 'Avenue' : nShops > 1 ? 'Rue commerçante' : 'Ville'} à ${towers.length} gratte-ciel`;
    let summary = `${where} : ${joinFr(parts)}.`;
    if (wheel) summary += ` Au sud de la rue, une grande roue de fête foraine${wheel.trees ? ' entourée d’arbres' : ''}.`;
    return { title, summary };
  }

  MT.registerTheme({
    id: 'ville',
    name: 'Ville & gratte-ciel',
    emoji: '🏙️',
    tagline: 'Gratte-ciel à fenêtres, boutiques et voitures dans la rue',
    keywords: [
      'ville', 'gratte-ciel', 'building', 'immeuble', 'tour', 'new york', 'manhattan', 'city', 'metropole', 'rue',
      'avenue', 'centre-ville', 'boutique', 'magasin', 'commerce', 'voiture', 'taxi', 'bureau', 'skyline', 'urbain',
      'appartement', 'hotel', 'banque', 'police', 'pompier', 'cinema', 'super-heros', 'spiderman', 'spider man',
      'batman', 'gotham', 'paris', 'londres', 'tokyo', 'eiffel', 'tour eiffel', 'jumelles', 'hopital', 'garage',
      'parking', 'bus', 'abribus', 'camion', 'autoroute', 'station service', 'aeroport', 'grue', 'chantier',
      'supermarche', 'restaurant', 'mairie', 'dubai', 'burj khalifa', 'pat patrouille', 'lego city', 'zootopie',
      'flash mcqueen', 'cabriolet',
    ],
    generate: generateCity,
  });

  // ======================================================== train & gare

  const WAGON_NAMES = { couvert: 'Wagon couvert', voyageurs: 'Voiture de voyageurs', tombereau: 'Wagon tombereau', citerne: 'Wagon-citerne' };
  const WAGON_DESC = { couvert: 'un wagon couvert', voyageurs: 'une voiture de voyageurs', tombereau: 'un wagon tombereau chargé', citerne: 'un wagon-citerne' };
  const HR_WAGONS = ['tombereau', 'citerne'];

  /**
   * Locomotive sur un plateau à roues d'origine (x, z), avant vers −X.
   * Vapeur : cabine vitrée à l'arrière, chaudière basse en demi-rectangles
   * (en carrés s'il en manque) et cheminée dressée à l'avant.
   * Diesel : cabine à fenêtres avant et arrière, capot bas à l'avant (caisse
   * pleine s'il manque des demi-rectangles).
   */
  function buildLoco(b, x, z, style, pre) {
    const y = CAR.top;
    b.step(`${pre} — plateau et cabine`);
    b.car(x, z, 'x');
    const lowFront = b.stock.HR >= 3;
    if (style === 'diesel') {
      b.wall(x + 1, y, z, 'W', lowFront ? pref(b, 'WIN4') : solid(b));
      b.wall(x + 1, y, z, 'E', pref(b, 'WIN4'));
      b.wall(x + 1, y, z, 'N', pref(b, 'WIN2'));
      b.wall(x + 1, y, z, 'S', pref(b, 'WIN2'));
      b.floor(x + 1, y + 1, z, b.stock.SQ > 0 ? 'SQ!' : 'roof');
      b.step(`${pre} — capot`);
      if (lowFront) {
        for (const side of ['N', 'S', 'W']) b.halfWall(x, y, z, side, 'HR!');
        b.floor(x, y + HR_H, z, b.stock.SQ > 0 ? 'SQ!' : 'roof');
      } else {
        b.note('Locomotive diesel à caisse pleine, faute de demi-rectangles pour le capot');
        b.wall(x, y, z, 'W', pref(b, 'WIN4'));
        b.wall(x, y, z, 'N', solid(b));
        b.wall(x, y, z, 'S', solid(b));
        b.floor(x, y + 1, z, b.stock.SQ > 0 ? 'SQ!' : 'roof');
      }
      return;
    }
    b.wall(x + 1, y, z, 'N', pref(b, 'WIN4'));
    b.wall(x + 1, y, z, 'S', pref(b, 'WIN4'));
    b.wall(x + 1, y, z, 'E', solid(b));
    b.wall(x + 1, y, z, 'W', solid(b));
    b.floor(x + 1, y + 1, z, b.stock.SQ > 0 ? 'SQ!' : 'roof');
    b.step(`${pre} — chaudière et cheminée`);
    let top;
    if (lowFront) {
      for (const side of ['N', 'S', 'W']) b.halfWall(x, y, z, side, 'HR!');
      top = y + HR_H;
    } else {
      b.note('Chaudière en carrés, faute de demi-rectangles');
      for (const side of ['N', 'S', 'W']) b.wall(x, y, z, side, solid(b));
      top = y + 1;
    }
    b.floor(x, top, z, b.stock.SQ > 0 ? 'SQ!' : 'roof');
    // Cheminée : grand triangle dressé en travers sur le bord avant de la chaudière.
    if (b.stock.TT > 0) b.tri('TT', [x, top, z], [x, top, z + 1], [x, top + TT_H, z + 0.5]);
    else if (b.available('solid') > 0) {
      b.note('Cheminée en carré, faute de grands triangles');
      b.quad(solid(b), [x, top, z], [x, top, z + 1], [x, top + 1, z]);
    } else b.note('Cheminée omise, faute de pièces');
  }

  /** Wagon sur un plateau à roues d'origine (x, z) ; renvoie le type réellement posé. */
  function buildWagon(b, x, z, type, pre) {
    const y = CAR.top;
    if (HR_WAGONS.includes(type) && b.stock.HR < 6) {
      b.note(`${WAGON_NAMES[type]} remplacé par un wagon couvert, faute de demi-rectangles`);
      type = 'couvert';
      pre = WAGON_NAMES.couvert;
    }
    b.step(`${pre} — plateau et caisse`);
    b.car(x, z, 'x');
    if (type === 'couvert') {
      const rel = hold(b, { SQ: 4 });
      b.room(x, y, z, 2, 1, ({ side, i }) => ((side === 'N' || side === 'S') && i === 1 ? pref(b, 'FRAME') : solid(b)));
      rel();
      gable(b, x, y + 1, z, 2, 1, 'x', 'roof', { label: `${pre} — toit` });
    } else if (type === 'voyageurs') {
      const rel = hold(b, { SQ: 2 });
      b.room(x, y, z, 2, 1, ({ side }) => (side === 'N' || side === 'S' ? pref(b, 'WIN2', pref(b, 'WIN4')) : pref(b, 'ARCH')));
      rel();
      b.floorRect(x, y + 1, z, 2, 1, b.stock.SQ >= 2 ? 'SQ!' : 'roof');
    } else if (type === 'tombereau') {
      // Rebord de demi-rectangles ; tas de chargement posés sur le haut du rebord.
      b.halfRoom(x, y, z, 2, 1, 'HR!');
      b.step(`${pre} — chargement`);
      for (let i = 0; i < 2; i++) b.tryBuild(() => b.pyramidRoof(x + i, y + HR_H, z, 'EQ'));
    } else {
      // Citerne : cuve basse fermée, dôme de remplissage au milieu de la cuve avant.
      b.halfRoom(x, y, z, 2, 1, 'HR!');
      b.step(`${pre} — cuve et dôme`);
      b.floorRect(x, y + HR_H, z, 2, 1, 'roof');
      b.tryBuild(() => b.pyramidRoof(x, y + HR_H, z, 'EQ'));
    }
    return type;
  }

  /** Train complet le long de X : locomotive en tête (côté −X) puis wagons attelés. */
  function buildTrain(b, x, z, loco, types) {
    buildLoco(b, x, z, loco, 'Locomotive');
    const got = types.map((t, k) =>
      buildWagon(b, x + HITCH * (k + 1), z, t, `${WAGON_NAMES[t]}${types.length > 1 ? ` ${k + 1}` : ''}`)
    );
    return { loco, wagons: got };
  }

  /** Marquise vitrée au-dessus du quai (côté sud), tenue par des équerres. */
  function marquise(b, Lg, P) {
    b.step('Marquise du quai');
    const ok = b.tryBuild(() => {
      for (let i = 0; i < Lg; i++) b.floor(i, 1, P, pref(b, 'WIN2', 'roof'));
      const xs = [];
      for (let xb = 0; xb < Lg; xb += 2) xs.push(xb);
      xs.push(Lg);
      for (const xb of xs) b.tri('RT', [xb, 1, P], [xb, 1, P + 1], [xb, 0, P]);
    });
    if (!ok) b.note('Marquise omise, faute de pièces');
    return ok;
  }

  /** Gare ; renvoie { horloge, clocher, marquise }. */
  function buildStation(b, p) {
    const Lg = p.longueur, P = p.profondeur, E = p.etages;
    const deux = p.toit === 'deux-pans';
    const doors = Lg >= 4 ? [1, Lg - 2] : [Math.floor((Lg - 1) / 2)];
    // Tour de l'horloge à l'est : 1 × 1 sur la case avant, ou toute la
    // profondeur quand un toit à deux pans de 2 cases vient s'y appuyer.
    const tCells = !p.horloge ? [] : P === 2 && deux ? [[Lg, 1], [Lg, 0]] : [[Lg, P - 1]];
    const tz = tCells.length ? Math.min(...tCells.map((c) => c[1])) : 0;
    const td = tCells.length;
    const tl = p.horloge ? E + (deux ? P : 1) : 0;
    const inner = !deux && P === 2 && Lg >= 3;
    const out = { horloge: !!p.horloge, clocher: null, marquise: false };
    const rel = hold(b, { SQ: (deux ? 2 * Lg * P : Lg * P) + (inner ? Lg : 0) });
    const towerLevel = (l) => {
      const top = l === tl - 1;
      b.step(top ? 'Tour de l’horloge — cadrans' : `Tour de l’horloge — niveau ${l + 1}`);
      b.room(Lg, l, tz, 1, td, ({ side }) => {
        if (top) return pref(b, 'FRAME');
        if (l === 0 && side === 'S') return 'arch';
        return solid(b);
      });
    };
    for (let l = 0; l < E; l++) {
      level(b, 0, l, 0, Lg, P, l === 0 ? 'Rez-de-chaussée' : 'Étage', ({ side, i }) => {
        if (side === 'S') return l === 0 ? (doors.includes(i) ? 'arch' : pref(b, 'WIN2')) : pref(b, 'WIN4');
        if (side === 'N' || (side === 'E' && p.horloge)) return solid(b);
        return l === 0 ? pref(b, 'WIN4') : solid(b);
      });
      if (p.horloge) towerLevel(l);
      if (l === 0 && p.marquise) out.marquise = marquise(b, Lg, P);
    }
    if (inner) {
      b.step('Cloison sous le toit');
      for (let i = 0; i < Lg; i++) b.wall(i, E - 1, 0, 'S', solid(b));
    }
    rel();
    if (deux) gable(b, 0, E, 0, Lg, P, 'x', 'roof', { skip1: td === P });
    else {
      stepIf(b, 'Toit plat', Lg * P);
      b.floorRect(0, E, 0, Lg, P, 'roof');
    }
    for (let l = E; l < tl; l++) towerLevel(l);
    if (p.horloge) out.clocher = capTop(b, tCells, tl, p.clocher, 'Clocher');
    return out;
  }

  /**
   * Tunnel en forme de montagne sur une voie le long de X : trois rangs de
   * carrés inclinés à 60° de chaque côté (crête à 2,6 de haut ; le train
   * mesure 1,36), ouvert aux deux bouts, pointe de chaque entrée en triangle.
   * Emprise [x, x + len] × [z, z + 3] ; la voie passe au milieu (z + 1 à z + 2).
   */
  function buildTunnel(b, x, z, len) {
    const map = (a, yy, c) => [x + a, yy, z + c];
    const row = (r) => {
      const y0 = r * EQ_H, y1 = (r + 1) * EQ_H;
      for (let k = 0; k < len; k++) {
        const kind = b.stock.SQ > 0 ? 'SQ!' : solid(b);
        b.quad(kind, map(k, y0, r * 0.5), map(k + 1, y0, r * 0.5), map(k, y1, (r + 1) * 0.5));
        b.quad(b.stock.SQ > 0 ? 'SQ!' : solid(b), map(k, y0, 3 - r * 0.5), map(k + 1, y0, 3 - r * 0.5), map(k, y1, 3 - (r + 1) * 0.5));
      }
    };
    if (len === 1) {
      b.step('Tunnel');
      for (let r = 0; r < 3; r++) row(r);
    } else {
      b.step('Tunnel — flancs');
      row(0);
      row(1);
      b.step('Tunnel — crête');
      row(2);
    }
    // Pointe de chaque entrée : un triangle au-dessus du passage du train.
    for (const a of [0, len]) if (b.stock.EQ > 0) b.tri('EQ', map(a, 2 * EQ_H, 1), map(a, 2 * EQ_H, 2), map(a, 3 * EQ_H, 1.5));
    return true;
  }

  /** Poste d'aiguillage : cube avec porte, cabine vitrée à l'étage, toit en pyramide. */
  function buildSignalBox(b, x, z) {
    b.step('Poste d’aiguillage — rez-de-chaussée');
    b.room(x, 0, z, 1, 1, ({ side }) => (side === 'S' ? 'arch' : solid(b)));
    b.step('Poste d’aiguillage — cabine vitrée');
    b.room(x, 1, z, 1, 1, () => pref(b, 'WIN4', pref(b, 'WIN2')));
    capTop(b, [[x, z]], 2, 'pyramide', 'Poste d’aiguillage');
  }

  /** Château d'eau : pied ajouré de 2 niveaux, réservoir de demi-rectangles et toit pointu. */
  function buildWaterTower(b, x, z) {
    b.step('Château d’eau — pied');
    b.room(x, 0, z, 1, 1, ({ side }) => (side === 'S' ? 'arch' : pref(b, 'FRAME')));
    b.room(x, 1, z, 1, 1, () => pref(b, 'FRAME'));
    b.step('Château d’eau — réservoir');
    b.floor(x, 2, z, b.stock.SQ > 0 ? 'SQ!' : 'roof');
    let top = 2;
    if (b.stock.HR >= 4) {
      b.halfRoom(x, 2, z, 1, 1, 'HR!');
      top = 2 + HR_H;
    } else {
      b.note('Réservoir en carrés, faute de demi-rectangles');
      b.room(x, 2, z, 1, 1, () => solid(b));
      top = 3;
    }
    if (b.stock.EQ >= 4) b.pyramidRoof(x, top, z, 'EQ');
  }

  /** Remise à locomotives : portes en arche face à la voie, toit à deux pans. */
  function buildDepot(b, x, z, w) {
    b.step('Remise — murs');
    const rel = hold(b, { SQ: 2 * w });
    b.room(x, 0, z, w, 1, ({ side }) => (side === 'S' ? 'ARCH!' : solid(b)));
    rel();
    gable(b, x, 1, z, w, 1, 'x', 'roof', { label: 'Remise — toit' });
  }

  MT.registerModule({
    id: 'train',
    label: 'Train',
    description:
      'Le long de X, locomotive en tête à l’ouest (−X). 1 plateau à roues par véhicule : 1 pack = locomotive + 1 wagon, ' +
      '2 packs = 3 wagons. Emprise (2 + 2,6 × wagons) × 1. Vapeur (cheminée) ou diesel ; wagons variés.',
    params: {
      wagons: { type: 'int', min: 0, max: 3, default: 1, label: 'Wagons' },
      locomotive: { type: 'enum', values: ['vapeur', 'diesel'], default: 'vapeur', label: 'Locomotive' },
      composition: { type: 'enum', values: ['varie', 'marchandises', 'voyageurs'], default: 'varie', label: 'Type de wagons' },
    },
    footprint: (p) => ({ w: Math.ceil(CAR.length + HITCH * p.wagons - 1e-9), d: 1 }),
    build(b, p, { rng }) {
      let types;
      if (p.composition === 'voyageurs') types = ['voyageurs', 'voyageurs', 'voyageurs'];
      else if (p.composition === 'marchandises') types = ['tombereau', 'couvert', 'citerne'];
      else types = rng.shuffle(['couvert', 'voyageurs', 'tombereau', 'citerne']);
      return buildTrain(b, 0, 0, p.locomotive, types.slice(0, p.wagons));
    },
  });

  MT.registerModule({
    id: 'gare',
    label: 'Gare',
    description:
      'Façade et quai au sud (+Z) : poser la voie au sud, parallèle. Gare de 2 à 6 cases (X), 1 ou 2 de profondeur, ' +
      '1 ou 2 niveaux ; tour de l’horloge à l’est (+1 case en X), marquise au sud (+1 case en Z).',
    params: {
      longueur: { type: 'int', min: 2, max: 6, default: 4, label: 'Longueur (X)' },
      profondeur: { type: 'int', min: 1, max: 2, default: 1, label: 'Profondeur (Z)' },
      etages: { type: 'int', min: 1, max: 2, default: 1, label: 'Niveaux' },
      toit: { type: 'enum', values: ['deux-pans', 'plat'], default: 'deux-pans', label: 'Toit' },
      horloge: { type: 'bool', default: true, label: 'Tour de l’horloge' },
      clocher: { type: 'enum', values: ['fleche', 'pyramide'], default: 'fleche', label: 'Sommet de la tour' },
      marquise: { type: 'bool', default: true, label: 'Marquise du quai' },
    },
    footprint: (p) => ({ w: p.longueur + (p.horloge ? 1 : 0), d: p.profondeur + (p.marquise ? 1 : 0) }),
    build(b, p) {
      return buildStation(b, p);
    },
  });

  /** Pièces (par type) d'un train donné, construit à blanc avec un stock illimité. */
  function trainDemand(loco, types) {
    const big = {};
    for (const t of MT.PIECE_ORDER) big[t] = MT.PACK[t] * 20;
    const t = new MT.Builder({ packs: 2, seed: 1, stock: big });
    buildTrain(t, 0, 0, loco, types);
    const d = {};
    for (const p of t.placements) d[p.type] = (d[p.type] || 0) + 1;
    return d;
  }

  function generateTrain(b, ctx) {
    const { size } = ctx;
    const R = ctx.rng;
    const max = MAX_BY_SIZE[size];
    const big = b.stock.CAR >= 4;
    const nW = big ? (R.chance(0.4) ? 2 : 3) : 1;
    const crossing = big && nW === 2;
    const loco = R.chance(0.7) ? 'vapeur' : 'diesel';
    // Disposition : halte (taille 1) ; tunnel ou poste (2) ; tunnel, hôtel ou remise (3) ; tout (4).
    const layout = size === 1 ? 'halte' : size === 2 ? (R.chance(0.6) ? 'tunnel' : 'poste') : size === 3 ? R.pick(['tunnel', 'hotel', 'remise']) : 'tout';
    const water = (size === 3 && layout !== 'tunnel' && R.chance(0.7)) || (size === 4 && R.chance(0.7));
    // Wagons à demi-rectangles (6 chacun) seulement s'il en reste après la locomotive et le château d'eau.
    let hr = b.stock.HR - 3 - (water ? 4 : 0);
    const types = [];
    for (const t of R.shuffle(['couvert', 'voyageurs', 'tombereau', 'citerne'])) {
      if (types.length >= nW) break;
      if (HR_WAGONS.includes(t)) {
        if (hr < 6) continue;
        hr -= 6;
      }
      types.push(t);
    }
    while (types.length < nW) types.push(R.pick(['couvert', 'voyageurs']));
    const clocher = R.pick(['fleche', 'pyramide']);
    const toit = R.pick(['deux-pans', 'plat']);
    let gare;
    if (size === 1) gare = { longueur: 2, profondeur: 1, etages: 1, toit, horloge: false, clocher, marquise: R.chance(0.5) };
    else if (size === 2) gare = { longueur: R.int(3, 4), profondeur: 1, etages: 1, toit, horloge: R.chance(0.6), clocher, marquise: true };
    else if (size === 3) {
      // Taille 3 : gare de 5 cases, ou de 4 cases sur 2 niveaux (nettement plus grande qu'en taille 2).
      const tall = layout !== 'hotel' && R.chance(0.45);
      gare = { longueur: tall ? 4 : 5, profondeur: 1, etages: tall ? 2 : 1, toit, horloge: true, clocher, marquise: true };
    } else gare = { longueur: R.int(5, 6), profondeur: R.int(1, 2), etages: 2, toit, horloge: true, clocher, marquise: true };
    const tunnel = layout === 'tunnel' || layout === 'tout';
    let tLen = size >= 3 ? 2 : 1;
    // Budget : le train, la gare et le tunnel doivent tenir ensemble (sinon tunnel court, puis gare plus basse).
    if (tunnel) {
      for (let guard = 0; guard < 6; guard++) {
        const needs = [trainDemand(loco, types), demand('gare', gare), { SQ: 6 * tLen, EQ: 2 }];
        if (!overBudget(b, needs)) break;
        if (tLen > 1) tLen = 1;
        else if (gare.etages > 1 && size < 4) Object.assign(gare, { etages: 1, longueur: 5 });
        else if (gare.longueur > 3) gare.longueur--;
        else break;
      }
    }
    const P = gare.profondeur;
    const gw = gare.longueur + (gare.horloge ? 1 : 0);
    const zt = P + 1.5; // voie : juste au sud du quai couvert
    const Ltr = CAR.length + HITCH * nW;

    // Tunnel à l'ouest ou à l'est ; train à quai, ou à l'entrée (ou à la sortie) du tunnel.
    const tSide = R.pick(['W', 'E']);
    const atMouth = tunnel && size >= 3 && R.chance(0.6);
    let tx = (gare.longueur - Ltr) / 2;
    let tunnelX = 0;
    if (tunnel && tSide === 'W') {
      if (atMouth) {
        tunnelX = -1 - tLen;
        tx = -0.5;
      } else tunnelX = Math.min(-1, Math.floor(tx - CAR.hitch) - 2) - tLen;
    } else if (tunnel) {
      if (atMouth) tx = Math.max(tx, gw + 0.5 - Ltr - CAR.hitch);
      const tail = tx + Ltr + CAR.hitch;
      tunnelX = Math.max(gw + 1, Math.ceil(tail + (atMouth ? 0.2 : 1.5)));
    }
    const trainX0 = tx - CAR.hitch, trainX1 = tx + Ltr + CAR.hitch;

    // ---- socle : le train, puis la gare
    const train = buildTrain(b, tx, zt, loco, types);
    let st = null;
    if (size === 1) st = optional(b, max, () => b.module('gare', 0, 0, gare, { label: 'Halte' }));
    else st = b.module('gare', 0, 0, gare, { label: 'Gare' });

    // ---- parties optionnelles, dans l'ordre de la disposition
    const got = {};
    let xl = -2, xr = gw + 1;
    const zRow = P - 1;
    const north = (name, w, fn) => () => {
      const left = R.chance(0.5);
      const x = left ? xl - w + 1 : xr;
      if (optional(b, max, () => fn(x))) {
        if (left) xl -= w + 1;
        else xr += w + 1;
        got[name] = true;
      }
    };
    const hp = { largeur: size === 4 ? 3 : 2, profondeur: 1, etages: size === 4 ? 3 : 2, toit: R.pick(['deux-pans', 'terrasse']), fenetres: R.pick(WIN_NAMES) };
    const T = {
      tunnel: () => {
        if (optional(b, max, () => buildTunnel(b, tunnelX, P + 0.5, tLen))) got.tunnel = true;
      },
      poste: north('poste', 1, (x) => buildSignalBox(b, x, zRow)),
      chateau: north('chateau', 1, (x) => buildWaterTower(b, x, zRow)),
      hotel: north('hotel', hp.largeur, (x) => b.module('immeuble', x, zRow, hp, { label: 'Hôtel de la gare' })),
      remise: north('remise', 2, (x) => buildDepot(b, x, zRow, 2)),
      quai: () => {
        if (optional(b, max, () => {
          b.step('Quai');
          for (let i = 0; i < gare.longueur; i++) b.floor(i, 0, P, b.stock.SQ > 0 ? 'SQ!' : 'floor');
        })) got.quai = true;
      },
      passage: () => {
        // Voiture au passage à niveau, du côté opposé au tunnel.
        const west = tunnel ? tSide === 'E' : R.chance(0.5);
        const xc = west ? Math.floor(trainX0) - 2 : Math.ceil(trainX1) + 1;
        const modele = b.stock.HR >= 3 ? R.pick(['berline', 'pick-up']) : 'camionnette';
        if (optional(b, max, () => b.module('voiture', xc, P + 3, { modele }, { rot: 270, label: 'Voiture au passage à niveau' }))) got.passage = true;
      },
    };
    let order;
    if (layout === 'halte') order = [];
    else if (layout === 'poste') order = ['poste'];
    else if (layout === 'tunnel') order = ['tunnel', ...R.shuffle(water ? ['poste', 'chateau'] : ['poste'])];
    else if (layout === 'hotel') order = ['hotel', ...R.shuffle(water ? ['poste', 'chateau'] : ['poste'])];
    else if (layout === 'remise') order = ['remise', ...R.shuffle(water ? ['chateau', 'poste'] : ['poste'])];
    else order = ['tunnel', ...R.shuffle(['hotel', 'remise', 'poste', 'quai'].concat(water ? ['chateau'] : []))];
    if (crossing) order.splice(1, 0, 'passage');
    for (const k of order) T[k]();
    // Arbres derrière la gare.
    let nTrees = 0;
    const used = [];
    for (const x of R.shuffle(Array.from({ length: Math.max(2, xr - xl) }, (_, i) => xl + i))) {
      if (nTrees >= size || used.some((u) => Math.abs(u - x) < 2)) continue;
      if (optional(b, max, () => {
        b.step('Arbre');
        if (!tree(b, x, -2)) b.shortTotal++;
      })) {
        used.push(x);
        nTrees++;
      }
    }
    // Buissons (petites pyramides de triangles) le long de la voie, côté sud.
    let nBush = 0;
    const busy = (x) => (tunnel && x >= tunnelX - 1 && x <= tunnelX + tLen) || (got.passage && Math.abs(x - (tunnel && tSide === 'E' ? Math.floor(trainX0) - 2 : Math.ceil(trainX1) + 1)) < 2);
    const bushes = [];
    for (const x of R.shuffle(Array.from({ length: Math.max(2, xr - xl) }, (_, i) => xl + i))) {
      if (nBush >= size - 1 || b.stock.EQ < 4 || busy(x) || bushes.some((u) => Math.abs(u - x) < 2)) continue;
      if (optional(b, max, () => {
        b.step('Buisson le long de la voie');
        b.pyramidRoof(x, 0, P + 4, 'EQ');
      })) {
        bushes.push(x);
        nBush++;
      }
    }

    // ---- texte d'après ce qui a été posé
    const list = joinFr(train.wagons.map((t) => WAGON_DESC[t]));
    const extrasTxt = [];
    if (got.tunnel) extrasTxt.push(atMouth ? (tSide === 'W' ? 'un tunnel où il va s’engouffrer' : 'le tunnel dont il sort') : 'un tunnel sous la montagne');
    if (got.quai) extrasTxt.push('un quai');
    if (got.poste) extrasTxt.push('un poste d’aiguillage');
    if (got.chateau) extrasTxt.push('un château d’eau');
    if (got.hotel) extrasTxt.push('l’hôtel de la gare');
    if (got.remise) extrasTxt.push('une remise à locomotives');
    if (got.passage) extrasTxt.push('une voiture qui attend au passage à niveau');
    if (nTrees) extrasTxt.push(plural(nTrees, 'arbre', 'arbres'));
    if (nBush) extrasTxt.push(plural(nBush, 'buisson', 'buissons'));
    const trainName = nW >= 2 ? `Train de ${nW} wagons` : loco === 'vapeur' ? 'Train à vapeur' : 'Locomotive diesel';
    const gareName = !st ? '' : size === 1 ? 'halte' : gare.etages > 1 ? 'grande gare' : 'gare';
    const extraName = got.tunnel ? 'tunnel' : got.hotel ? 'hôtel' : got.remise ? 'remise' : got.chateau ? 'château d’eau' : got.poste ? 'poste d’aiguillage' : '';
    const title = gareName && extraName ? `${trainName}, ${gareName} et ${extraName}` : gareName ? `${trainName} et sa ${gareName}` : trainName;
    let where = '';
    if (st) {
      const feats = [];
      if (st.horloge && st.clocher) feats.push('à horloge');
      if (st.marquise) feats.push('à marquise');
      const kindTxt = size === 1 ? 'petite halte' : gare.etages > 1 ? 'grande gare' : 'gare';
      where = ` le long du quai d’une ${kindTxt}${feats.length ? ' ' + joinFr(feats) : ''}`;
    }
    return {
      title,
      summary:
        `Une locomotive ${loco === 'vapeur' ? 'à vapeur' : 'diesel'} tire ${list}${where}` +
        `${extrasTxt.length ? `, avec ${joinFr(extrasTxt)}` : ''}.`,
    };
  }

  MT.registerTheme({
    id: 'train',
    name: 'Train & gare',
    emoji: '🚂',
    tagline: 'Locomotive, wagons attelés, gare à horloge et tunnel',
    keywords: [
      'train', 'gare', 'locomotive', 'loco', 'wagon', 'chemin de fer', 'rail', 'voie ferree', 'vapeur',
      'tchou-tchou', 'quai', 'voyageur', 'marchandise', 'tunnel', 'conducteur', 'chef de gare', 'sncf', 'tgv',
      'metro', 'tramway', 'thomas', 'poudlard express', 'far west', 'western', 'horloge', 'billet', 'aiguillage',
      'depot', 'convoi', 'citerne', 'fret', 'chuggington', 'passage a niveau', 'orient express', 'wagonnet',
      'petit train', 'train electrique', 'chateau d eau',
    ],
    generate: generateTrain,
  });

  // ==================================================== ponts & aqueducs

  /** Dimensions d'un pont : portée s entre piles, marches e à chaque bout, tablier Ld, emprise w. */
  function bridgeSize(p) {
    const s = p.style === 'consoles' ? 2 : 1;
    const e = p.escaliers ? p.hauteur - 1 : 0;
    const Ld = p.travees * (s + 1) + 1;
    return { s, e, Ld, w: Ld + 2 * e };
  }

  /**
   * Pont le long de X. Style « arches » : deux façades continues, portes en
   * arche au sol entre les piles, tympans pleins au-dessus (comme un pont
   * romain) ; style « consoles » : piles en colonnes de cubes et consoles en
   * triangles rectangles sous le tablier. Tablier et marches en carrés pleins
   * (réservés d'avance), tours d'entrée à portes homogènes, garde-corps d'un
   * seul type posés en dernier. Renvoie ce qui a été posé.
   */
  function buildBridge(b, p) {
    const T = p.travees, h = p.hauteur, W = p.largeur;
    const { s, e, Ld } = bridgeSize(p);
    const x0 = e, x1 = e + Ld - 1;
    const piers = Array.from({ length: T + 1 }, (_, k) => x0 + k * (s + 1));
    const zs = Array.from({ length: W }, (_, j) => j);
    const out = { arcade: null, gate: null, cap: null, rails: null, towers: false, stairs: e > 0 };
    // Réserve : tablier et marches en carrés pleins (une route sans trous).
    const relDeck = hold(b, { SQ: Ld * W + 2 * e * W });
    const deckKind = () => (b.stock.SQ > 0 ? 'SQ!' : 'floor');
    // Arcades puis portes des tours : chaque rangée d'un seul type.
    const arcN = s === 1 ? 2 * T : 0;
    if (s === 1) {
      out.arcade = rowType(b, arcN, ['ARCH', 'FRAME', 'WIN2', 'WIN4']);
      if (!out.arcade) b.note('Pont : arcades murées, faute de portes en arche et de cadres');
    }
    let relGate = null;
    if (p.tours !== 'aucune') {
      const spare = (t) => b.stock[t] - (out.arcade === t ? arcN : 0);
      out.gate = spare('ARCH') >= 4 * W ? 'ARCH' : spare('FRAME') >= 4 * W ? 'FRAME' : null;
      if (out.gate) relGate = hold(b, { [out.gate]: 4 * W });
      else b.note('Pont : tours d’entrée omises, faute de portes en arche et de cadres');
    }

    if (s === 1) {
      // Façades continues, niveau par niveau.
      for (let l = 0; l < h; l++) {
        const face = [], cross = [];
        for (let x = x0; x <= x1; x++) {
          const span = !piers.includes(x);
          for (const [z, side] of [[0, 'N'], [W - 1, 'S']]) face.push([x, z, side, l === 0 && span && out.arcade ? out.arcade + '!' : null]);
          if (l === 0 && span) for (const z of zs) cross.push([x, z, 'W'], [x, z, 'E']);
          // Pont large : muret central sous la jonction du tablier (hors passages).
          if (W === 2 && l === h - 1 && !(l === 0 && span)) cross.push([x, 0, 'S']);
        }
        for (const z of zs) cross.push([x0, z, 'W'], [x1, z, 'E']);
        const put = ([x, z, side, k]) => b.wall(x, l, z, side, k || solid(b));
        // Arcades d'abord (types exacts), puis les murs pleins.
        face.sort((a, c) => (c[3] ? 1 : 0) - (a[3] ? 1 : 0));
        chunks(b, h > 1 ? `Façades — niveau ${l + 1}` : 'Façades et arcades', face, put, 10);
        chunks(b, l === 0 ? 'Voûtes et murs des extrémités' : `Murs intérieurs — niveau ${l + 1}`, cross, put, 10);
      }
    } else {
      piers.forEach((xp, k) => {
        const name = k === 0 ? 'Pile ouest' : k === T ? 'Pile est' : `Pile ${k + 1}`;
        if ((2 + 2 * W) * h <= 12) {
          b.step(name);
          for (let l = 0; l < h; l++) b.room(xp, l, 0, 1, W, () => solid(b));
        } else {
          for (let l = 0; l < h; l++) {
            b.step(`${name} — niveau ${l + 1}`);
            b.room(xp, l, 0, 1, W, () => solid(b));
          }
        }
      });
    }
    // Escaliers : colonnes de hauteur croissante jusqu'au tablier, marches en carrés pleins.
    for (const west of [true, false]) {
      if (!e) break;
      const list = [];
      for (let j = 0; j < e; j++) {
        const x = west ? j : x1 + e - j;
        const outSide = west ? 'W' : 'E';
        for (let l = 0; l <= j; l++) list.push(['w', x, l, 0, 'N'], ['w', x, l, W - 1, 'S']);
        if (j === 0) for (const z of zs) list.push(['w', x, 0, z, outSide]);
        else for (const z of zs) list.push(['w', x, j, z, outSide]);
        for (const z of zs) list.push(['f', x, j + 1, z]);
      }
      chunks(b, `Escalier ${west ? 'ouest' : 'est'}`, list, ([k, x, l, z, side]) => {
        if (k === 'w') b.wall(x, l, z, side, solid(b));
        else {
          relDeck(1);
          b.floor(x, l, z, deckKind());
        }
      }, 10);
    }
    if (s === 2) {
      for (let k = 0; k < T; k++) {
        const xp = piers[k];
        b.step(`Consoles — travée ${k + 1}`);
        for (const zf of [0, W]) {
          b.tri('RT', [xp + 1, h, zf], [xp + 2, h, zf], [xp + 1, h - 1, zf]);
          b.tri('RT', [xp + 3, h, zf], [xp + 2, h, zf], [xp + 3, h - 1, zf]);
        }
      }
    }
    // Tablier : carrés pleins posés sur le haut des façades ou des piles.
    relDeck();
    const cells = [];
    for (let x = x0; x <= x1; x++) for (const z of zs) cells.push([x, z]);
    chunks(b, 'Tablier', cells, ([x, z]) => b.floor(x, h, z, deckKind()), 10);
    // Tours d'entrée sur les piles des extrémités.
    if (relGate) {
      relGate();
      out.towers = true;
      for (const [xt, name] of [[x0, 'ouest'], [x1, 'est']]) {
        b.step(`Tour d’entrée ${name}`);
        b.room(xt, h, 0, 1, W, ({ side }) => (side === 'E' || side === 'W' ? out.gate + '!' : solid(b)));
        const c = capTop(b, zs.slice().reverse().map((z) => [xt, z]), h + 1, p.tours, `Tour d’entrée ${name}`, { twin: true });
        out.cap = out.cap || c;
      }
    }
    // Garde-corps en dernier : un seul type sur tout le pont.
    if (p.gardecorps) bridgeRails(b, p, out, '');
    return out;
  }

  /**
   * Garde-corps d'un pont (repère du module) : un seul type sur tout le pont,
   * des deux côtés si le stock le permet, sinon côté sud (face au spectateur).
   * Complète info.rails ('CR' | 'HR') et info.railSides ; pre préfixe les étapes.
   */
  function bridgeRails(b, p, info, pre) {
    const { e, Ld } = bridgeSize(p);
    const x0 = e, x1 = e + Ld - 1, W = p.largeur, h = p.hauteur;
    const xs = [];
    for (let x = x0; x <= x1; x++) if (!(info.towers && (x === x0 || x === x1))) xs.push(x);
    if (!xs.length) return null;
    const order = info.towers ? ['CR', 'HR'] : ['HR', 'CR'];
    let sides = [['N', 0, 'nord'], ['S', W - 1, 'sud']];
    let t = rowType(b, 2 * xs.length, order);
    if (!t) {
      t = rowType(b, xs.length, order);
      sides = sides.slice(1);
      if (t) b.note('Pont : garde-corps côté sud seulement, faute de demi-rectangles et de créneaux');
    }
    if (!t) {
      b.note('Pont : garde-corps omis, faute de demi-rectangles et de créneaux');
      return null;
    }
    for (const [side, z, name] of sides) chunks(b, `${pre}Garde-corps ${name}`, xs, (x) => b.wall(x, h, z, side, t + '!'), 8);
    info.rails = t;
    info.railSides = sides.length;
    return t;
  }

  /**
   * Aqueduc : par étage, deux rangées d'arcades (façade sud d'abord, la plus
   * visible), chacune d'un seul type (arches, sinon cadres ou fenêtres),
   * tablier de carrés pleins, canal bordé de demi-rectangles au sommet.
   * Renvoie ce qui a été posé.
   */
  function buildAqueduct(b, p) {
    const L = p.longueur, T = p.etages;
    const out = { rows: [], canal: false, arches: 0 };
    for (let t = 0; t < T; t++) {
      const relDeck = hold(b, { SQ: L });
      const order = t < 2 ? ['ARCH', 'FRAME', 'WIN2', 'WIN4'] : ['WIN2', 'FRAME', 'ARCH', 'WIN4'];
      const tS = rowType(b, L, order);
      const relS = tS ? hold(b, { [tS]: L }) : null;
      const tN = rowType(b, L, order);
      if (relS) relS();
      out.rows.push({ S: tS || 'SQ', N: tN || 'SQ' });
      out.arches += (tS === 'ARCH' ? 1 : 0) + (tN === 'ARCH' ? 1 : 0);
      for (const [side, type, name] of [['S', tS, 'sud'], ['N', tN, 'nord']]) {
        if (2 * L > 12) b.step(`Arcades ${name} — étage ${t + 1}`);
        else if (side === 'S') b.step(`Arcades — étage ${t + 1}`);
        for (let i = 0; i < L; i++) b.wall(i, t, 0, side, type ? type + '!' : solid(b));
      }
      relDeck();
      b.step(t === T - 1 ? 'Tablier du canal' : `Tablier — étage ${t + 1}`);
      for (let i = 0; i < L; i++) b.floor(i, t + 1, 0, b.stock.SQ > 0 ? 'SQ!' : 'floor');
    }
    if (p.canal) aqueductCanal(b, p, out, '');
    return out;
  }

  /** Canal au sommet d'un aqueduc (repère du module) : rebords de demi-rectangles des deux côtés. */
  function aqueductCanal(b, p, info, pre) {
    const L = p.longueur, T = p.etages;
    if (b.stock.HR < 2 * L) {
      b.note('Aqueduc : canal omis, faute de demi-rectangles');
      return false;
    }
    for (const [side, name] of [['S', 'sud'], ['N', 'nord']]) {
      if (2 * L > 10) b.step(`${pre}Canal — rebord ${name}`);
      else if (side === 'S') b.step(`${pre}Canal`);
      for (let i = 0; i < L; i++) b.halfWall(i, T, 0, side, 'HR!');
    }
    info.canal = true;
    return true;
  }

  /**
   * Bateau posé au sol, proue pointue vers −X. Coque de carrés (sabords en
   * fenêtres pour le pirate), pont de carrés pleins, proue en deux carrés en
   * pointe et un triangle. Pirate : voiles carrées, pavillon, bastingage
   * crénelé, château arrière ; voilier : voiles en grands triangles ;
   * péniche : cabine arrière et chargement.
   */
  function buildBoat(b, p) {
    const n = p.longueur, style = p.style;
    const X = 1 - S3 / 2; // pointe de la proue
    const castle = style === 'peniche' || (style === 'pirate' && n >= 3);
    const out = { style, masts: 0, castle: false, rail: null, cargo: 0 };
    const rel = hold(b, { SQ: n + (castle ? 1 : 0) });
    const hullT = style === 'pirate' ? rowType(b, 2 * n, ['WIN2', 'WIN4']) : null;
    b.step('Coque et proue');
    for (let i = 0; i < n; i++) {
      b.wall(1 + i, 0, 0, 'N', hullT ? hullT + '!' : solid(b));
      b.wall(1 + i, 0, 0, 'S', hullT ? hullT + '!' : solid(b));
    }
    b.wall(n, 0, 0, 'E', solid(b));
    b.quad(solid(b), [1, 0, 0], [X, 0, 0.5], [1, 1, 0]);
    b.quad(solid(b), [1, 0, 1], [X, 0, 0.5], [1, 1, 1]);
    rel(n);
    b.step('Pont du bateau');
    for (let i = 0; i < n; i++) b.floor(1 + i, 1, 0, b.stock.SQ > 0 ? 'SQ!' : 'floor');
    if (b.stock.EQ > 0) b.tri('EQ', [1, 1, 1], [1, 1, 0], [X, 1, 0.5]);
    else b.note('Bateau : pointe du pont omise, faute de triangles');
    const mast = (m, squares, top) => {
      for (let k = 0; k < squares; k++) b.quad(b.stock.SQ > 0 ? 'SQ!' : solid(b), [m, 1 + k, 0], [m, 1 + k, 1], [m, 2 + k, 0]);
      const y = 1 + squares;
      if (top === 'TT') b.tri('TT', [m, y, 0], [m, y, 1], [m, y + TT_H, 0.5]);
      else if (top === 'EQ') b.tri('EQ', [m, y, 0], [m, y, 1], [m, y + EQ_H, 0.5]);
      else if (top === 'HR') b.quad('HR!', [m, y, 0], [m, y, 1], [m, y + HR_H, 0]);
      out.masts++;
    };
    if (style === 'pirate') {
      const cells = castle ? n - 1 : n;
      out.rail = rowType(b, 2 * cells, ['CR', 'HR']);
      if (out.rail) {
        b.step('Bastingage');
        for (let i = 0; i < cells; i++) {
          b.wall(1 + i, 1, 0, 'N', out.rail + '!');
          b.wall(1 + i, 1, 0, 'S', out.rail + '!');
        }
      } else b.note('Bateau : bastingage omis, faute de créneaux');
      b.step('Mâts, voiles et pavillon');
      mast(2, 2, b.stock.HR > 0 ? 'HR' : b.stock.EQ > 0 ? 'EQ' : null);
      if (n >= 4) mast(3, 1, null);
    } else if (style === 'voilier') {
      // Voiles dressées sur le bord sud de la coque : foc (triangle rectangle) à l'avant,
      // grand-voile (grand triangle), artimon à l'arrière sur les longues coques.
      stepIf(b, 'Voiles', n >= 4 ? 3 : 2);
      const sail = (x) => {
        if (b.stock.TT > 0) b.tri('TT', [x, 1, 1], [x + 1, 1, 1], [x + 0.5, 1 + TT_H, 1]);
        else {
          b.note('Voile en triangle équilatéral, faute de grands triangles');
          b.tri('EQ', [x, 1, 1], [x + 1, 1, 1], [x + 0.5, 1 + EQ_H, 1]);
        }
        out.masts++;
      };
      if (b.stock.RT > 0) b.tri('RT', [2, 1, 1], [1, 1, 1], [2, 2, 1]);
      sail(2);
      if (n >= 4) sail(4);
    }
    if (castle) {
      rel();
      b.step(style === 'peniche' ? 'Cabine' : 'Château arrière');
      b.wall(n, 1, 0, 'N', pref(b, 'WIN4'));
      b.wall(n, 1, 0, 'S', pref(b, 'WIN4'));
      b.wall(n, 1, 0, 'E', style === 'pirate' ? pref(b, 'WIN4') : solid(b));
      b.wall(n, 1, 0, 'W', pref(b, 'ARCH', pref(b, 'WIN2')));
      b.floor(n, 2, 0, b.stock.SQ > 0 ? 'SQ!' : 'roof');
      out.castle = true;
      if (style === 'pirate' && b.stock.CR >= 4) {
        b.crenelRim(n, 2, 0, 1, 1, 'CR!');
        out.castle = 'crenele';
      }
    }
    rel();
    if (style === 'peniche') {
      const k = Math.min(n - 1, Math.floor(b.stock.EQ / 4));
      if (k < n - 1) b.note('Péniche : chargement réduit, faute de triangles');
      stepIf(b, 'Chargement', 4 * k);
      for (let i = 0; i < k; i++) b.pyramidRoof(1 + i, 1, 0, 'EQ');
      out.cargo = k;
    }
    return out;
  }

  MT.registerModule({
    id: 'pont',
    label: 'Pont',
    description:
      'Le long de X, largeur 1 ou 2 (Z). Arches au sol (portée 1) ou consoles (portée 2). Emprise X = travées × (portée + 1) ' +
      '+ 1, plus 2 × (hauteur − 1) avec escaliers. Tablier à 1–3 de haut, tours d’entrée, garde-corps.',
    params: {
      travees: { type: 'int', min: 1, max: 5, default: 3, label: 'Travées' },
      style: { type: 'enum', values: ['arches', 'consoles'], default: 'arches', label: 'Style' },
      hauteur: { type: 'int', min: 1, max: 3, default: 2, label: 'Hauteur du tablier' },
      largeur: { type: 'int', min: 1, max: 2, default: 1, label: 'Largeur (Z)' },
      tours: { type: 'enum', values: ['fleche', 'pyramide', 'aucune'], default: 'fleche', label: 'Tours d’entrée' },
      escaliers: { type: 'bool', default: true, label: 'Escaliers' },
      gardecorps: { type: 'bool', default: true, label: 'Garde-corps' },
    },
    footprint: (p) => ({ w: bridgeSize(p).w, d: p.largeur }),
    build(b, p) {
      return buildBridge(b, p);
    },
  });

  MT.registerModule({
    id: 'aqueduc',
    label: 'Aqueduc',
    description:
      'Le long de X, 1 case de large, emprise longueur × 1. Arcades sur 1 à 3 étages (8 portes en arche par pack, ' +
      'au-delà cadres ou fenêtres), tablier de carrés à chaque étage, canal au sommet (2 demi-rectangles par arcade).',
    params: {
      longueur: { type: 'int', min: 2, max: 8, default: 4, label: 'Arcades (X)' },
      etages: { type: 'int', min: 1, max: 3, default: 2, label: 'Étages d’arcades' },
      canal: { type: 'bool', default: true, label: 'Canal au sommet' },
    },
    footprint: (p) => ({ w: p.longueur, d: 1 }),
    build(b, p) {
      return buildAqueduct(b, p);
    },
  });

  MT.registerModule({
    id: 'bateau',
    label: 'Bateau',
    description:
      'Proue vers −X, emprise (longueur + 1) × 1, posé au sol. Pirate (voiles carrées, pavillon, créneaux, château ' +
      'arrière), voilier (foc et grand-voile en triangles) ou péniche (cabine, chargement). 12 à 35 pièces.',
    params: {
      longueur: { type: 'int', min: 2, max: 4, default: 3, label: 'Longueur de la coque' },
      style: { type: 'enum', values: ['pirate', 'voilier', 'peniche'], default: 'pirate', label: 'Style', fixed: true },
    },
    footprint: (p) => ({ w: p.longueur + 1, d: 1 }),
    build(b, p) {
      return buildBoat(b, p);
    },
  });

  /** Hauteur approximative d'un ouvrage (pour décider de sa place dans la scène). */
  function deckHeight(it) {
    return it.module === 'aqueduc' ? it.params.etages : it.params.hauteur;
  }

  function structureHeight(it) {
    const p = it.params;
    if (it.module === 'aqueduc') return p.etages + (p.canal ? HR_H : 0);
    return p.hauteur + (p.tours !== 'aucune' ? 1 + (p.tours === 'fleche' ? TT_H : EQ_H) : HR_H);
  }

  function generateBridges(b, ctx) {
    const { size } = ctx;
    const R = ctx.rng;
    const max = MAX_BY_SIZE[size];
    const tours = () => R.pick(['fleche', 'pyramide']);
    const style = () => R.pick(['arches', 'consoles']);
    const pont = (p, label) => ({ module: 'pont', label: label || 'Pont', params: Object.assign({ largeur: 1, escaliers: true, gardecorps: true }, p) });
    const aqueduc = (p) => ({ module: 'aqueduc', label: 'Aqueduc', params: Object.assign({ canal: true }, p) });
    let main, second = null;
    if (size === 1) {
      const v = R.pick(['pont', 'haut', 'aqueduc']);
      if (v === 'pont') main = pont({ travees: 1, style: style(), hauteur: 1, tours: tours() });
      else if (v === 'haut') main = pont({ travees: 1, style: 'arches', hauteur: 2, tours: 'aucune' });
      else main = aqueduc(R.chance(0.5) ? { longueur: 4, etages: 1 } : { longueur: 3, etages: 2 });
    } else if (size === 2) {
      const v = R.pick(['pont', 'viaduc', 'aqueduc']);
      const tw = R.chance(0.2) ? 'aucune' : tours();
      if (v === 'pont') main = pont({ travees: 2, style: 'arches', hauteur: 2, tours: tw });
      else if (v === 'viaduc') main = pont({ travees: 2, style: 'consoles', hauteur: 2, tours: tw }, 'Viaduc');
      else {
        main = aqueduc({ longueur: 4, etages: 2 });
        // Les arcades de l'aqueduc prennent les arches et les cadres : petit pont à consoles.
        second = pont({ travees: 1, style: 'consoles', hauteur: 1, tours: 'aucune', escaliers: false }, 'Petit pont');
      }
    } else if (size === 3) {
      const v = R.pick(['pont', 'viaduc', 'aqueduc']);
      if (v === 'pont') {
        main = pont({ travees: 3, style: 'arches', hauteur: 2, tours: tours() });
        second = aqueduc({ longueur: R.int(3, 4), etages: 1 });
      } else if (v === 'viaduc') {
        main = pont({ travees: 3, style: 'consoles', hauteur: 2, tours: tours() }, 'Viaduc');
        second = aqueduc({ longueur: R.int(3, 4), etages: 1 });
      } else {
        main = aqueduc({ longueur: R.int(4, 5), etages: 2 });
        second = pont({ travees: 2, style: 'consoles', hauteur: 1, tours: 'aucune', escaliers: false }, 'Petit pont');
      }
    } else {
      const v = R.pick(['pont', 'viaduc', 'large']);
      if (v === 'pont') {
        main = pont({ travees: R.int(3, 4), style: 'arches', hauteur: 3, tours: tours() });
        second = aqueduc({ longueur: R.int(4, 5), etages: 2 });
      } else if (v === 'viaduc') {
        main = pont({ travees: 3, style: 'consoles', hauteur: 3, tours: tours() }, 'Viaduc');
        second = aqueduc({ longueur: R.int(4, 5), etages: 3 });
      } else {
        main = pont({ travees: 3, style: 'arches', hauteur: 2, largeur: 2, tours: tours() }, 'Grand pont');
        second = aqueduc({ longueur: R.int(5, 6), etages: 2 });
      }
    }
    // Garde-corps et canal : décors posés après les ouvrages, selon le stock restant.
    for (const it of [main, second]) {
      if (!it) continue;
      it.decor = it.module === 'pont' ? it.params.gardecorps : it.params.canal;
      if (it.module === 'pont') it.params.gardecorps = false;
      else it.params.canal = false;
    }
    // Bateau sur la rivière (voilier en taille 1) et voitures au pied du pont.
    const boatStyle = size === 4 ? R.pick(['pirate', 'voilier', 'peniche']) : R.pick(['voilier', 'peniche', 'voilier']);
    let boat = R.chance([0, 0.5, 0.7, 0.85, 1][size])
      ? { module: 'bateau', params: { longueur: size === 4 ? R.int(3, 4) : size === 3 ? R.int(2, 3) : 2, style: size === 1 ? 'voilier' : boatStyle } }
      : null;
    let nCars = size === 1 ? (R.chance(0.4) ? 1 : 0) : size === 4 ? 2 : 1;

    // Budget : le second ouvrage, le bateau puis les voitures se réduisent pour que tout tienne.
    for (let guard = 0; guard < 30; guard++) {
      const needs = [demand(main.module, main.params)];
      if (second) needs.push(demand(second.module, second.params));
      if (boat) needs.push(demand('bateau', boat.params));
      for (let k = 0; k < nCars; k++) needs.push({ SQ: 5, CAR: 1 });
      if (!overBudget(b, needs)) break;
      const sp = second && second.params;
      if (sp && second.module === 'aqueduc' && sp.longueur > 3) sp.longueur--;
      else if (sp && second.module === 'aqueduc' && sp.etages > 1) sp.etages--;
      else if (sp && second.module === 'pont' && sp.travees > 1) sp.travees--;
      else if (boat && boat.params.longueur > 2) boat.params.longueur--;
      else if (nCars > 1) nCars--;
      else if (boat) boat = null;
      else if (nCars) nCars--;
      else if (second) second = null;
      else break;
    }

    // ---- socle : l'ouvrage principal
    const fp = (it) => MT.footprintOf(it.module, it.params, 0);
    const mw = fp(main).w, md = fp(main).d;
    const mainInfo = b.module(main.module, 0, 0, main.params, { label: main.label });
    const occ = new Set();
    const mark = (x, z, w, d) => {
      for (let i = Math.floor(x); i < Math.ceil(x + w); i++) for (let j = Math.floor(z); j < Math.ceil(z + d); j++) occ.add(`${i},${j}`);
    };
    const free = (x, z, w, d) => {
      for (let i = Math.floor(x) - 1; i <= Math.ceil(x + w); i++) for (let j = Math.floor(z) - 1; j <= Math.ceil(z + d); j++) if (occ.has(`${i},${j}`)) return false;
      return true;
    };
    mark(0, 0, mw, md);
    const addDecor = (it, info, x, z) => {
      if (!it.decor) return;
      const f = fp(it);
      optional(b, max, () => b.at({ x, z, w: f.w, d: f.d }, () =>
        it.module === 'pont' ? bridgeRails(b, it.params, info, `${it.label} — `) : aqueductCanal(b, it.params, info, `${it.label} — `)
      ));
    };

    // ---- second ouvrage : devant s'il est plus bas, sinon derrière, décalé pour rester visible
    let secondInfo = null, secondFront = false;
    if (second) {
      const sw = fp(second).w, sd = fp(second).d;
      // Devant seulement s'il reste plus bas que le tablier (ou le canal) de l'ouvrage principal.
      secondFront = structureHeight(second) < deckHeight(main) - 0.3;
      const sx = secondFront
        ? Math.round((mw - sw) / 2) + R.pick([-1, 1]) * R.int(1, 2)
        : R.chance(0.5) ? mw + 1 : -sw - 1;
      // Devant : on laisse la place du bateau entre les deux ouvrages.
      const sz = secondFront ? md + 2 + (boat ? boat.params.longueur + 2 : 0) : -sd - 1;
      secondInfo = optional(b, max, () => b.module(second.module, sx, sz, second.params, { label: second.label }));
      if (secondInfo) {
        mark(sx, sz, sw, sd);
        second.x = sx;
        second.z = sz;
      }
    }
    // ---- décors des ouvrages : garde-corps, canal
    addDecor(main, mainInfo, 0, 0);
    if (secondInfo) addDecor(second, secondInfo, second.x, second.z);

    // ---- bateau sur la rivière, devant une travée, proue vers le pont
    let boatInfo = null;
    if (boat) {
      const bl = boat.params.longueur + 1;
      let xs;
      if (main.module === 'pont') {
        const { s, e } = bridgeSize(main.params);
        xs = Array.from({ length: main.params.travees }, (_, k) => e + k * (s + 1) + 1);
      } else xs = Array.from({ length: main.params.longueur }, (_, i) => i);
      const label = { pirate: 'Bateau pirate', voilier: 'Voilier', peniche: 'Péniche' }[boat.params.style];
      for (const bx of R.shuffle(xs)) {
        const bz = md + 1;
        if (!free(bx, bz, 1, bl)) continue;
        boatInfo = optional(b, max, () => b.module('bateau', bx, bz, boat.params, { rot: 270, label }));
        if (boatInfo) {
          mark(bx, bz, 1, bl);
          break;
        }
      }
    }
    // ---- voitures au pied du pont, dans l'axe de la route, tournées vers lui
    let carsBuilt = 0;
    for (let k = 0; k < nCars; k++) {
      const east = k % 2 === 0;
      const x = east ? mw + 0.5 : -2.5;
      const modele = b.stock.HR >= 4 && R.chance(0.3) ? 'cabriolet' : b.stock.HR >= 3 ? R.pick(['berline', 'pick-up']) : 'camionnette';
      if (optional(b, max, () => b.module('voiture', x, 0, { modele }, { rot: east ? 0 : 180, label: CAR_LABELS[modele] }))) {
        mark(x, 0, 2.3, 1);
        carsBuilt++;
      }
    }
    // ---- cyprès (cônes de grands triangles) sur les berges
    const spots = R.shuffle([[-2, md + 1], [mw + 1, md + 1], [-3, -2], [mw + 2, -2], [-1, md + 3], [mw, md + 3], [-4, 0], [mw + 3, md + 1]]);
    let nTrees = 0;
    for (const [x, z] of spots) {
      if (nTrees >= size + 1) break;
      if (!free(x, z, 1, 1)) continue;
      if (optional(b, max, () => {
        b.step('Cyprès sur la berge');
        if (!tree(b, x, z)) b.shortTotal++;
      })) {
        mark(x, z, 1, 1);
        nTrees++;
      }
    }
    // ---- buissons (petites pyramides de triangles) le long de la rivière, avec les triangles restants
    let nBush = 0;
    const bushSpots = R.shuffle([[-2, md + 3], [mw + 1, md + 3], [-3, md + 1], [mw + 2, md + 2], [-2, -1], [mw + 1, -1], [-5, md], [mw + 4, 0]]);
    for (const [x, z] of bushSpots) {
      if (nBush >= size || b.stock.EQ < 4) break;
      if (!free(x, z, 1, 1)) continue;
      if (optional(b, max, () => {
        b.step('Buisson sur la berge');
        b.pyramidRoof(x, 0, z, 'EQ');
      })) {
        mark(x, z, 1, 1);
        nBush++;
      }
    }

    // ---- texte d'après ce qui a été posé
    const ARC_TXT = { ARCH: 'arcades', FRAME: 'arcades en cadres', WIN2: 'arcades à fenêtres doubles', WIN4: 'arcades à fenêtres', SQ: 'arcades murées' };
    const describe = (it, info) => {
      const p = it.params;
      if (it.module === 'aqueduc') {
        const kind = info.arches ? 'un aqueduc romain' : 'un aqueduc';
        return `${kind} de ${p.longueur} ${ARC_TXT[info.rows[0].S]} sur ${plural(p.etages, 'étage', 'étages')}${info.canal ? ', canal au sommet' : ''}`;
      }
      const bits = [];
      if (p.style === 'arches') {
        const arch = info.arcade === 'ARCH';
        bits.push(`${plural(p.travees, arch ? 'arche' : 'arcade', arch ? 'arches' : 'arcades')} au pied des piles`);
      } else bits.push(plural(p.travees, 'travée à consoles', 'travées à consoles'));
      bits.push(`tablier à ${plural(p.hauteur, 'cube', 'cubes')} de haut`);
      if (info.towers && info.cap) bits.push(`tours d’entrée à ${info.cap === 'fleche' ? 'flèche' : info.cap === 'pyramide' ? 'pyramide' : 'toit plat'}`);
      if (info.stairs) bits.push('escaliers aux deux bouts');
      if (info.rails) bits.push(`${info.rails === 'CR' ? 'parapet crénelé' : 'garde-corps'}${info.railSides === 1 ? ' d’un seul côté' : ''}`);
      const name = { Viaduc: 'un viaduc', 'Petit pont': 'un petit pont', 'Grand pont': 'un grand pont' }[it.label] || 'un pont';
      return `${name} (${bits.join(', ')})`;
    };
    const mp = main.params;
    let title;
    if (main.module === 'aqueduc') title = `${mainInfo.arches ? 'Aqueduc romain' : 'Aqueduc'} à ${plural(mp.etages, 'étage', 'étages')}`;
    else if (mp.style === 'consoles') title = `Viaduc à ${plural(mp.travees, 'travée', 'travées')}`;
    else title = `${main.label} à ${plural(mp.travees, mainInfo.arcade === 'ARCH' ? 'arche' : 'arcade', mainInfo.arcade === 'ARCH' ? 'arches' : 'arcades')}`;
    if (secondInfo) title += second.module === 'aqueduc' ? ' et aqueduc' : ' et petit pont';
    else if (boatInfo) title += { pirate: ' et bateau pirate', voilier: ' et voilier', peniche: ' et péniche' }[boat.params.style];
    let summary = cap1(describe(main, mainInfo));
    if (secondInfo) summary += ` ; ${secondFront ? 'devant' : 'derrière'}, ${describe(second, secondInfo)}`;
    const more = [];
    if (boatInfo) more.push({ pirate: 'un bateau pirate', voilier: 'un voilier', peniche: 'une péniche' }[boat.params.style] + ' sur la rivière');
    if (carsBuilt) more.push(`${carsBuilt > 1 ? `${carsBuilt} voitures` : 'une voiture'} au pied ${main.module === 'aqueduc' ? 'de l’aqueduc' : 'du pont'}`);
    if (nTrees) more.push(`${nTrees} cyprès sur les berges`);
    if (nBush) more.push(plural(nBush, 'buisson', 'buissons'));
    if (more.length) summary += ` ; ${joinFr(more)}`;
    return { title, summary: summary + '.' };
  }

  MT.registerTheme({
    id: 'pont',
    name: 'Ponts & aqueducs',
    emoji: '🌉',
    tagline: 'Arches romaines, viaducs, tours d’entrée et bateaux sur la rivière',
    keywords: [
      'pont', 'aqueduc', 'viaduc', 'arche', 'arcade', 'riviere', 'fleuve', 'romain', 'rome', 'pont du gard',
      'passerelle', 'traversee', 'canal', 'gaulois', 'ingenieur', 'vallee', 'ravin', 'pont de pierre',
      'golden gate', 'tower bridge', 'pont de londres', 'venise', 'troll', 'pont suspendu', 'barrage', 'ecluse',
      'bateau', 'peniche', 'voilier',
    ],
    generate: generateBridges,
  });
})(typeof window !== 'undefined' ? window : globalThis);
