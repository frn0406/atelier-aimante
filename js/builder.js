/*
 * Atelier Aimanté — moteur de construction.
 *
 * - Builder : pose des pièces (primitives de grille, toits, pyramides, plateaux
 *   à roues…), gère le stock avec substitutions et les étapes de montage.
 * - validate : vérifie qu'une construction est physiquement cohérente
 *   (pièces reliées par des bords aimantés, rien ne flotte, aucune pièce ne
 *   traverse une autre).
 * - Registres : thèmes (MT.registerTheme) et modules réutilisables
 *   (MT.registerModule), MT.generate (thème → construction) et MT.compose
 *   (plan de modules → construction, utilisé par le thème libre IA).
 *
 * Repère : Y vers le haut, sol à y = 0, 1 unité = côté d'un carré.
 * Une cellule (x, z) couvre [x, x+1] × [z, z+1].
 * Côtés d'une cellule : N = -Z, S = +Z, E = +X, W = -X.
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});
  const P = MT.PIECES;
  const EQ_H = MT.EQ_H, TT_H = MT.TT_H, CAR = MT.CAR;
  const SQRT2 = Math.SQRT2;
  const TT_SIDE = Math.hypot(0.5, TT_H);

  // ---------------------------------------------------------------- vecteurs
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => {
    const l = len(a);
    return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clean = (a) => a.map((x) => (Math.abs(x) < 1e-12 ? 0 : x));
  MT.vec = { add, sub, scale, madd, dot, cross, len, norm, lerp };

  // ------------------------------------------------ géométrie d'une placement
  function worldPoint(p, x, y) {
    return [
      p.pos[0] + p.u[0] * x + p.v[0] * y,
      p.pos[1] + p.u[1] * x + p.v[1] * y,
      p.pos[2] + p.u[2] * x + p.v[2] * y,
    ];
  }
  const worldOutline = (p) => P[p.type].outline.map(([x, y]) => worldPoint(p, x, y));
  const worldMagnetEdges = (p) =>
    MT.magnetEdges(p.type).map(([a, b]) => [worldPoint(p, a[0], a[1]), worldPoint(p, b[0], b[1])]);
  const worldCentroid = (p) => worldPoint(p, P[p.type].centroid[0], P[p.type].centroid[1]);
  const toLocal = (p, X) => {
    const d = sub(X, p.pos);
    return [dot(d, p.u), dot(d, p.v)];
  };
  MT.worldPoint = worldPoint;
  MT.worldOutline = worldOutline;
  MT.worldMagnetEdges = worldMagnetEdges;
  MT.worldCentroid = worldCentroid;

  // ----------------------------------------------------------------- hasard
  function makeRng(seed) {
    // Mélange de la graine (murmur3 fmix32) : des graines voisines donnent des suites décorrélées.
    let h = (seed >>> 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    let s = (h ^ (h >>> 16)) >>> 0 || 0x9e3779b9;
    const next = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const rng = () => next();
    rng.float = (a, b) => a + (b - a) * next();
    rng.int = (a, b) => a + Math.floor(next() * (b - a + 1));
    rng.pick = (arr) => arr[Math.floor(next() * arr.length)];
    rng.chance = (p) => next() < p;
    rng.shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    return rng;
  }
  MT.makeRng = makeRng;

  // ------------------------------------------------ genres et substitutions
  /*
   * Un « genre » (kind) décrit ce qu'on veut poser ; le stock sert le premier
   * type disponible de la chaîne. Tous les types d'une chaîne ont le même
   * contour, donc la substitution ne change jamais la géométrie.
   * Suffixe « ! » (ex. 'ARCH!') : type exact, sans substitution.
   * Attention : 'half' peut servir un CR, dont le haut crénelé n'a pas
   * d'aimant ; pour porter quelque chose sur un demi-mur, demander 'HR!'.
   */
  // Les murs ne prennent jamais d'arche en substitut (une porte en l'air à l'étage).
  const CH = {
    solid: ['SQ', 'WIN4', 'WIN2', 'FRAME'],
    window: ['WIN4', 'WIN2', 'FRAME', 'SQ'],
    window2: ['WIN2', 'WIN4', 'FRAME', 'SQ'],
    frame: ['FRAME', 'WIN4', 'WIN2', 'SQ'],
    arch: ['ARCH', 'FRAME', 'WIN2', 'WIN4', 'SQ'],
    floor: ['SQ', 'FRAME', 'WIN4', 'WIN2'],
    half: ['HR', 'CR'],
    crenel: ['CR', 'HR'],
  };
  const KINDS = {
    solid: CH.solid, square: CH.solid, wall: CH.solid, SQ: CH.solid,
    window: CH.window, window4: CH.window, WIN4: CH.window,
    window2: CH.window2, WIN2: CH.window2,
    frame: CH.frame, FRAME: CH.frame,
    arch: CH.arch, door: CH.arch, ARCH: CH.arch,
    floor: CH.floor, roof: CH.floor,
    EQ: ['EQ'], RT: ['RT'], TT: ['TT'],
    half: CH.half, HR: CH.half,
    crenel: CH.crenel, CR: CH.crenel,
    CAR: ['CAR'],
  };
  function kindChain(kind) {
    if (typeof kind !== 'string') return null;
    if (kind.endsWith('!')) {
      const t = kind.slice(0, -1);
      return P[t] ? [t] : null;
    }
    return KINDS[kind] || null;
  }
  MT.KINDS = KINDS;
  MT.kindChain = kindChain;

  // Représentant de famille : sert à la clé d'emplacement (anti-doublon).
  const FAMILY_REP = { square: 'SQ', eq: 'EQ', rt: 'RT', tt: 'TT', half: 'HR', car: 'CAR' };
  function placementKey(type, pos, u, v) {
    const fam = P[type].family;
    const c = P[FAMILY_REP[fam]].centroid;
    const q = (x) => Math.round(x * 50);
    const cx = pos[0] + u[0] * c[0] + v[0] * c[1];
    const cy = pos[1] + u[1] * c[0] + v[1] * c[1];
    const cz = pos[2] + u[2] * c[0] + v[2] * c[1];
    let n = cross(u, v);
    let m = 0;
    for (let i = 1; i < 3; i++) if (Math.abs(n[i]) > Math.abs(n[m])) m = i;
    if (n[m] < 0) n = scale(n, -1);
    return `${fam}|${q(cx)},${q(cy)},${q(cz)}|${Math.round(n[0] * 20)},${Math.round(n[1] * 20)},${Math.round(n[2] * 20)}`;
  }

  const SIDES = { N: [0, 0, -1], S: [0, 0, 1], E: [1, 0, 0], W: [-1, 0, 0] };
  const UP = [0, 1, 0];
  MT.SIDES = SIDES;

  // ------------------------------------------------------------- paramètres
  // Repli tolérant pour les plans écrits par une IA : accents, casse, espaces.
  const fold = (x) =>
    String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[\s_]+/g, '-');
  MT.fold = fold;

  function normalizeParams(mod, params) {
    const out = {};
    const src = params && typeof params === 'object' ? params : {};
    const folded = {};
    for (const [k, v] of Object.entries(src)) folded[fold(k)] = v;
    for (const [k, spec] of Object.entries(mod.params || {})) {
      let val = Object.prototype.hasOwnProperty.call(src, k) ? src[k] : folded[fold(k)];
      if (val === undefined && spec.label) val = folded[fold(spec.label)];
      switch (spec.type) {
        case 'int': {
          val = Number(val);
          if (!Number.isFinite(val)) val = spec.default;
          val = Math.round(Math.min(spec.max, Math.max(spec.min, val)));
          break;
        }
        case 'number': {
          val = Number(val);
          if (!Number.isFinite(val)) val = spec.default;
          val = Math.min(spec.max, Math.max(spec.min, val));
          break;
        }
        case 'enum':
          if (!spec.values.includes(val)) {
            const f = val == null ? '' : fold(val);
            const hit = spec.values.find((v) => fold(v) === f);
            val = hit === undefined ? spec.default : hit;
          }
          break;
        case 'bool':
          if (typeof val === 'string') {
            if (/^(true|vrai|oui|1)$/i.test(val.trim())) val = true;
            else if (/^(false|faux|non|0)$/i.test(val.trim())) val = false;
          } else if (typeof val === 'number') val = val !== 0;
          val = typeof val === 'boolean' ? val : !!spec.default;
          break;
        default:
          val = val === undefined ? spec.default : val;
      }
      out[k] = val;
    }
    return out;
  }
  MT.normalizeParams = normalizeParams;

  // ------------------------------------------------------------------ Builder
  class Builder {
    constructor(opts) {
      const o = opts || {};
      this.packs = o.packs === 2 ? 2 : 1;
      this.seed = o.seed >>> 0;
      this.rng = makeRng(this.seed);
      // opts.stock : stock explicite (tests) ; sinon 1 ou 2 packs.
      this.stock = o.stock ? Object.assign(MT.inventoryFor(this.packs), o.stock) : MT.inventoryFor(this.packs);
      this.placements = [];
      this.keys = new Map();
      this.shortages = {};
      this.shortTotal = 0;
      this.steps = [{ label: 'Base', count: 0 }];
      this.cur = 0;
      this.xf = [];
      this.labels = [];
      this.notes = [];
      this.warnings = [];
      this.deduped = 0;
    }

    /** Nombre de pièces posées jusqu'ici. */
    get count() {
      return this.placements.length;
    }

    // ----- étapes de montage
    _label(label) {
      const m = this.labels[this.labels.length - 1];
      if (m) return label ? `${m} — ${label}` : m;
      return label || 'Étape';
    }
    /** Démarre une nouvelle étape de montage (réutilise l'étape courante si elle est vide). */
    step(label) {
      const full = this._label(label);
      const s = this.steps[this.cur];
      if (s.count === 0) {
        s.label = full;
        return this;
      }
      this.steps.push({ label: full, count: 0 });
      this.cur = this.steps.length - 1;
      return this;
    }
    note(text) {
      this.notes.push(text);
      return this;
    }

    // ----- repères (translation + rotation par quart de tour autour de Y)
    /**
     * Exécute fn dans un repère local dont l'origine est (x, y, z) et tourné
     * de rot ∈ {0, 90, 180, 270}. w × d = emprise locale (nécessaire pour que
     * l'emprise tournée reste dans le rectangle qui commence en (x, z)).
     * À 90° et 270°, l'emprise monde devient d × w.
     */
    at(o, fn) {
      const x = o.x || 0, y = o.y || 0, z = o.z || 0;
      const w = o.w == null ? 1 : o.w, d = o.d == null ? 1 : o.d;
      const rot = (((o.rot || 0) % 360) + 360) % 360;
      let pt, vec;
      switch (rot) {
        case 0:
          vec = (v) => v;
          pt = (p) => [p[0] + x, p[1] + y, p[2] + z];
          break;
        case 90:
          vec = (v) => [v[2], v[1], -v[0]];
          pt = (p) => [p[2] + x, p[1] + y, w - p[0] + z];
          break;
        case 180:
          vec = (v) => [-v[0], v[1], -v[2]];
          pt = (p) => [w - p[0] + x, p[1] + y, d - p[2] + z];
          break;
        case 270:
          vec = (v) => [-v[2], v[1], v[0]];
          pt = (p) => [d - p[2] + x, p[1] + y, p[0] + z];
          break;
        default:
          throw new Error('rot doit valoir 0, 90, 180 ou 270');
      }
      this.xf.push({ pt, vec });
      try {
        return fn();
      } finally {
        this.xf.pop();
      }
    }
    _pt(p) {
      for (let i = this.xf.length - 1; i >= 0; i--) p = this.xf[i].pt(p);
      return p;
    }
    _vec(v) {
      for (let i = this.xf.length - 1; i >= 0; i--) v = this.xf[i].vec(v);
      return v;
    }

    /** Pose un module enregistré, emprise locale commençant en (x, z). opts : { rot, y, label } */
    module(id, x, z, params, opts) {
      const mod = MT.modules[id];
      if (!mod) throw new Error('module inconnu : ' + id);
      const o = opts || {};
      const prm = normalizeParams(mod, params);
      const fp = mod.footprint(prm);
      this.labels.push(o.label || mod.label);
      try {
        this.step('');
        return this.at({ x, z, y: o.y || 0, rot: o.rot || 0, w: fp.w, d: fp.d }, () =>
          mod.build(this, prm, { rng: this.rng })
        );
      } finally {
        this.labels.pop();
      }
    }

    // ----- stock
    /** Nombre de pièces encore disponibles pour un genre (chaîne de substitution comprise). */
    available(kind) {
      const chain = kindChain(kind);
      if (!chain) return 0;
      return chain.reduce((s, t) => s + this.stock[t], 0);
    }
    /** Vrai si le stock couvre toutes les demandes { genre: nombre } (allocation gloutonne). */
    canAfford(req) {
      const st = Object.assign({}, this.stock);
      const entries = Object.entries(req).sort((a, b) => kindChain(a[0]).length - kindChain(b[0]).length);
      for (const [kind, count] of entries) {
        const chain = kindChain(kind);
        let need = count;
        for (const t of chain) {
          const take = Math.min(need, st[t]);
          st[t] -= take;
          need -= take;
          if (!need) break;
        }
        if (need > 0) return false;
      }
      return true;
    }
    hasShortage() {
      return this.shortTotal > 0;
    }
    /**
     * Essaie fn ; si une pièce a manqué pendant fn, annule tout ce que fn a
     * posé et renvoie false. Sert aux parties optionnelles d'une construction.
     * Seul l'état du Builder est restauré : une structure annexe tenue par le
     * thème (carte d'occupation…) doit vérifier que ses pièces existent encore
     * (b.placements[p.id] === p).
     */
    tryBuild(fn) {
      const snap = {
        n: this.placements.length,
        stock: Object.assign({}, this.stock),
        shortages: Object.assign({}, this.shortages),
        shortTotal: this.shortTotal,
        steps: this.steps.map((s) => ({ label: s.label, count: s.count })),
        cur: this.cur,
        warnings: this.warnings.length,
        notes: this.notes.length,
        deduped: this.deduped,
      };
      const restore = () => {
        for (const p of this.placements.splice(snap.n)) this.keys.delete(p._key);
        this.stock = snap.stock;
        this.shortages = snap.shortages;
        this.shortTotal = snap.shortTotal;
        this.steps = snap.steps;
        this.cur = snap.cur;
        this.warnings.length = snap.warnings;
        this.notes.length = snap.notes;
        this.deduped = snap.deduped;
      };
      try {
        fn();
      } catch (e) {
        restore();
        throw e;
      }
      if (this.shortTotal > snap.shortTotal) {
        restore();
        return false;
      }
      return true;
    }

    // ----- pose bas niveau
    /**
     * Pose une pièce : pos = origine locale (sommet (0,0) du contour),
     * u = direction du bord de base, v = direction « haut » de la pièce.
     * Si l'emplacement est déjà occupé par une pièce de même forme, renvoie
     * la pièce existante. Renvoie null (et note un manque) si le stock est vide.
     */
    place(kind, pos, u, v, meta) {
      const chain = kindChain(kind);
      if (!chain) throw new Error('genre de pièce inconnu : ' + kind);
      const wpos = clean(this._pt(pos));
      const wu = clean(norm(this._vec(u)));
      const wv = clean(norm(this._vec(v)));
      const key = placementKey(chain[0], wpos, wu, wv);
      const existing = this.keys.get(key);
      if (existing) {
        this.deduped++;
        return existing;
      }
      let type = null;
      for (const t of chain) {
        if (this.stock[t] > 0) {
          type = t;
          break;
        }
      }
      if (!type) {
        this.shortages[kind] = (this.shortages[kind] || 0) + 1;
        this.shortTotal++;
        return null;
      }
      this.stock[type]--;
      const p = {
        id: this.placements.length,
        type,
        kind,
        pos: wpos,
        u: wu,
        v: wv,
        n: clean(cross(wu, wv)),
        step: this.cur,
        _key: key,
      };
      if (meta) Object.assign(p, meta);
      this.placements.push(p);
      this.keys.set(key, p);
      this.steps[this.cur].count++;
      return p;
    }

    /** Pièce rectangulaire : A = coin bas-gauche, B = coin bas-droit, D = coin haut-gauche. */
    quad(kind, A, B, D, meta) {
      const chain = kindChain(kind);
      if (!chain) throw new Error('genre de pièce inconnu : ' + kind);
      const shape = P[chain[0]];
      const ab = sub(B, A), ad = sub(D, A);
      const lw = len(ab), lh = len(ad);
      if (Math.abs(lw - shape.w) > 0.04 || Math.abs(lh - shape.h) > 0.04 || Math.abs(dot(ab, ad)) > 0.04 * lw * lh) {
        this.warnings.push(
          `forme ${chain[0]} incohérente : ${lw.toFixed(2)} × ${lh.toFixed(2)} (attendu ${shape.w.toFixed(2)} × ${shape.h.toFixed(2)})`
        );
      }
      return this.place(kind, A, ab, ad, meta);
    }

    /**
     * Pièce triangulaire : A → B = bord de base, C = sommet opposé.
     * Pour 'RT', l'angle droit est en A (B et C au bout des deux côtés de 1).
     */
    tri(kind, A, B, C, meta) {
      const chain = kindChain(kind);
      if (!chain) throw new Error('genre de pièce inconnu : ' + kind);
      const shape = P[chain[0]];
      const ab = sub(B, A);
      const L = len(ab);
      const u = scale(ab, 1 / L);
      const ac = sub(C, A);
      const cx = dot(ac, u);
      const perp = sub(ac, scale(u, cx));
      const cy = len(perp);
      const apex = shape.outline[2];
      if (shape.outline.length !== 3 || Math.abs(L - shape.w) > 0.04 || Math.abs(cx - apex[0]) > 0.04 || Math.abs(cy - apex[1]) > 0.04) {
        this.warnings.push(
          `forme ${chain[0]} incohérente : base ${L.toFixed(2)}, sommet (${cx.toFixed(2)}, ${cy.toFixed(2)})`
        );
      }
      return this.place(kind, A, u, cy > 1e-9 ? scale(perp, 1 / cy) : UP, meta);
    }

    /**
     * Face de polyèdre donnée par ses sommets (3 ou 4 points, dans l'ordre du
     * contour). Détecte le type de pièce d'après les longueurs des côtés.
     * kind (optionnel) force le genre pour les faces carrées (défaut 'solid').
     */
    face(pts, kind, meta) {
      if (pts.length === 4) return this.quad(kind || 'solid', pts[0], pts[1], pts[3], meta);
      if (pts.length !== 3) throw new Error('face : 3 ou 4 sommets attendus');
      const near = (x, y) => Math.abs(x - y) < 0.05;
      const L = [len(sub(pts[1], pts[0])), len(sub(pts[2], pts[1])), len(sub(pts[0], pts[2]))];
      // côté i = pts[i] → pts[i+1] ; sommet opposé = pts[i+2]
      if (L.every((l) => near(l, 1))) return this.tri(kind || 'EQ', pts[0], pts[1], pts[2], meta);
      for (let i = 0; i < 3; i++) {
        const a = pts[i], b = pts[(i + 1) % 3], c = pts[(i + 2) % 3];
        const others = [L[(i + 1) % 3], L[(i + 2) % 3]];
        if (near(L[i], SQRT2) && others.every((l) => near(l, 1))) return this.tri('RT', c, a, b, meta);
        if (near(L[i], 1) && others.every((l) => near(l, TT_SIDE))) return this.tri('TT', a, b, c, meta);
      }
      this.warnings.push(`face : aucune pièce ne correspond aux côtés ${L.map((l) => l.toFixed(2)).join(' / ')}`);
      return null;
    }

    // ----- primitives de grille
    /** Panneau carré vertical sur le côté `side` de la cellule (x, z), base à la hauteur y. */
    wall(x, y, z, side, kind, meta) {
      const o = SIDES[side];
      if (!o) throw new Error('côté inconnu : ' + side);
      const u = cross(UP, o);
      const A = [x + 0.5 + o[0] * 0.5 - u[0] * 0.5, y, z + 0.5 + o[2] * 0.5 - u[2] * 0.5];
      return this.place(kind || 'solid', A, u, UP, meta);
    }
    /** Demi-rectangle vertical (1 × 0,66) sur un côté de cellule. */
    halfWall(x, y, z, side, kind, meta) {
      return this.wall(x, y, z, side, kind || 'half', meta);
    }
    /** Créneaux posés sur le haut d'un mur (y = hauteur du haut du mur). */
    crenel(x, y, z, side, meta) {
      return this.wall(x, y, z, side, 'crenel', meta);
    }
    /** Carré horizontal couvrant la cellule (x, z) à la hauteur y. */
    floor(x, y, z, kind, meta) {
      return this.place(kind || 'floor', [x, y, z], [1, 0, 0], [0, 0, 1], meta);
    }
    floorRect(x0, y, z0, w, d, kind) {
      const out = [];
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push(this.floor(x0 + i, y, z0 + j, kind));
      return out;
    }
    /**
     * Murs du périmètre d'un rectangle w × d à la hauteur y.
     * kind : genre, ou fonction ({ side, i, x, z, y }) → genre | false (pas de mur).
     * Parcours : N (x croissant), E (z croissant), S (x décroissant), W (z décroissant).
     */
    room(x0, y, z0, w, d, kind, fn) {
      const out = [];
      const put = fn || ((x, yy, z, side, k) => this.wall(x, yy, z, side, k));
      const k = (side, i, x, z) => (typeof kind === 'function' ? kind({ side, i, x, z, y }) : kind || 'solid');
      const go = (side, i, x, z) => {
        const kk = k(side, i, x, z);
        if (kk) out.push(put(x, y, z, side, kk));
      };
      for (let i = 0; i < w; i++) go('N', i, x0 + i, z0);
      for (let j = 0; j < d; j++) go('E', j, x0 + w - 1, z0 + j);
      for (let i = w - 1; i >= 0; i--) go('S', i, x0 + i, z0 + d - 1);
      for (let j = d - 1; j >= 0; j--) go('W', j, x0, z0 + j);
      return out.filter(Boolean);
    }
    /** Rangée de créneaux sur tout le périmètre d'un rectangle, y = haut des murs. */
    crenelRim(x0, y, z0, w, d, kind) {
      return this.room(x0, y, z0, w, d, kind || 'crenel');
    }
    /** Demi-murs sur le périmètre (clôture, bordure, muret). */
    halfRoom(x0, y, z0, w, d, kind) {
      return this.room(x0, y, z0, w, d, kind || 'half');
    }
    /** Boîte 1 × 1 : spec = { N, S, E, W, floor, top } (genre ou false). Murs 'solid' par défaut. */
    box(x, y, z, spec) {
      const s = spec || {};
      const out = [];
      if (s.floor) out.push(this.floor(x, y, z, s.floor === true ? 'floor' : s.floor));
      for (const side of ['N', 'E', 'S', 'W']) {
        const k = s[side] === undefined ? 'solid' : s[side];
        if (k) out.push(this.wall(x, y, z, side, k));
      }
      if (s.top) out.push(this.floor(x, y + 1, z, s.top === true ? 'roof' : s.top));
      return out.filter(Boolean);
    }

    // ----- triangles et toits
    /** Rangée j d'un grand triangle équilatéral A-B-Q de côté n pavé en n² triangles 'EQ'. */
    _triRow(A, B, Q, n, j, kind) {
      const e1 = scale(sub(B, A), 1 / n), e2 = scale(sub(Q, A), 1 / n);
      const P_ = (i, jj) => madd(madd(A, e1, i), e2, jj);
      const out = [];
      for (let i = 0; i + j <= n - 1; i++) {
        out.push(this.tri(kind || 'EQ', P_(i, j), P_(i + 1, j), P_(i, j + 1)));
        if (i + j <= n - 2) out.push(this.tri(kind || 'EQ', P_(i, j + 1), P_(i + 1, j + 1), P_(i + 1, j)));
      }
      return out;
    }
    /** Grand triangle équilatéral (base A → B de longueur n, sommet Q) pavé en n² triangles. */
    triGrid(A, B, Q, n, kind) {
      const out = [];
      for (let j = 0; j < n; j++) out.push(...this._triRow(A, B, Q, n, j, kind));
      return out.filter(Boolean);
    }
    /** Toit pyramidal sur la cellule (x, z), y = haut des murs. kind : 'EQ' (pointu) ou 'TT' (flèche). */
    pyramidRoof(x, y, z, kind) {
      const k = kind || 'EQ';
      const h = k === 'TT' ? TT_H : EQ_H;
      const H = Math.sqrt(h * h - 0.25);
      const apex = [x + 0.5, y + H, z + 0.5];
      const c = [[x, y, z], [x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z]];
      return c.map((a, i) => this.tri(k, a, c[(i + 1) % 4], apex)).filter(Boolean);
    }
    /**
     * Pyramide à base carrée n × n dont les faces sont des triangles
     * équilatéraux de côté n, chacune pavée en n² triangles 'EQ' (4n² au total).
     * Base à la hauteur y. opts.floor : genre des carrés du sol (défaut : pas de sol).
     */
    bigPyramid(x, y, z, n, opts) {
      const o = opts || {};
      const out = [];
      if (o.floor) out.push(...this.floorRect(x, y, z, n, n, o.floor === true ? 'floor' : o.floor));
      const Q = [x + n / 2, y + n / SQRT2, z + n / 2];
      const c = [[x, y, z], [x, y, z + n], [x + n, y, z + n], [x + n, y, z]];
      for (let j = 0; j < n; j++) {
        for (let f = 0; f < 4; f++) out.push(...this._triRow(c[f], c[(f + 1) % 4], Q, n, j, 'EQ'));
      }
      return out.filter(Boolean);
    }
    /**
     * Toit à deux pans sur un bâtiment de largeur `width` (1, 2 ou 3) et de
     * longueur `len`, y = haut des murs. Pignons en triangles équilatéraux
     * (width² par pignon), pans en carrés inclinés à 60° (width × len par pan).
     * axis 'x' : faîtage le long de X, emprise [x, x+len] × [z, z+width].
     * axis 'z' : faîtage le long de Z, emprise [x, x+width] × [z, z+len].
     */
    gableRoof(x, y, z, length, width, axis, kind) {
      const w = width || 1;
      const L = length || 1;
      const map = axis === 'z' ? (a, yy, b) => [x + b, yy, z + a] : (a, yy, b) => [x + a, yy, z + b];
      const out = [];
      for (let r = 0; r < w; r++) {
        for (const a of [0, L]) {
          out.push(...this._triRow(map(a, y, 0), map(a, y, w), map(a, y + w * EQ_H, w / 2), w, r, 'EQ'));
        }
        for (let k = 0; k < L; k++) {
          const y0 = y + r * EQ_H, y1 = y + (r + 1) * EQ_H;
          out.push(this.quad(kind || 'roof', map(k, y0, r * 0.5), map(k + 1, y0, r * 0.5), map(k, y1, (r + 1) * 0.5)));
          out.push(this.quad(kind || 'roof', map(k, y0, w - r * 0.5), map(k + 1, y0, w - r * 0.5), map(k, y1, w - (r + 1) * 0.5)));
        }
      }
      return out.filter(Boolean);
    }
    /**
     * Tente en A : deux pans de carrés inclinés à 45° qui se rejoignent au
     * faîtage, pignons en triangles rectangles (angle droit en haut).
     * Largeur au sol √2 ≈ 1,41 ; y = hauteur de la base.
     * axis 'x' : emprise [x, x+len] × [z, z+√2] ; axis 'z' : [x, x+√2] × [z, z+len].
     */
    aFrame(x, y, z, length, axis, opts) {
      const o = opts || {};
      const L = length || 1;
      const s = SQRT2 / 2;
      const map = axis === 'z' ? (a, yy, b) => [x + b, yy, z + a] : (a, yy, b) => [x + a, yy, z + b];
      const out = [];
      for (let k = 0; k < L; k++) {
        out.push(this.quad(o.kind || 'roof', map(k, y, 0), map(k + 1, y, 0), map(k, y + s, s)));
        out.push(this.quad(o.kind || 'roof', map(k, y, SQRT2), map(k + 1, y, SQRT2), map(k, y + s, SQRT2 - s)));
      }
      for (const a of o.gables === false ? [] : [0, L]) {
        out.push(this.tri('RT', map(a, y + s, s), map(a, y, 0), map(a, y, SQRT2)));
      }
      return out.filter(Boolean);
    }
    /**
     * Plateau à roues posé au sol. axis 'x' : emprise [x, x+2] × [z, z+1] ;
     * axis 'z' : emprise [x, x+1] × [z, z+2]. Le dessus est à y = MT.CAR.top :
     * on y pose des murs avec wall(cx, MT.CAR.top, cz, …).
     */
    car(x, z, axis) {
      if (axis === 'z') return this.place('CAR', [x, CAR.top, z], [0, 0, 1], [1, 0, 0]);
      return this.place('CAR', [x, CAR.top, z], [1, 0, 0], [0, 0, 1]);
    }

    // ----- fin
    finish() {
      const map = new Map();
      const steps = [];
      this.steps.forEach((s, i) => {
        if (s.count > 0) {
          map.set(i, steps.length);
          steps.push({ label: s.label, ids: [] });
        }
      });
      const placements = this.placements.map((p) => {
        const q = Object.assign({}, p);
        delete q._key;
        q.step = map.get(p.step);
        steps[q.step].ids.push(q.id);
        return q;
      });
      const used = {};
      for (const t of MT.PIECE_ORDER) used[t] = 0;
      for (const p of placements) used[p.type]++;
      const available = MT.inventoryFor(this.packs);
      const remaining = {};
      for (const t of MT.PIECE_ORDER) remaining[t] = available[t] - used[t];
      return {
        packs: this.packs,
        placements,
        steps,
        used,
        available,
        remaining,
        shortages: Object.assign({}, this.shortages),
        shortTotal: this.shortTotal,
        warnings: this.warnings.slice(),
        notes: this.notes.slice(),
        deduped: this.deduped,
        pieceCount: placements.length,
      };
    }
  }
  MT.Builder = Builder;

  // --------------------------------------------------------------- validation
  function bbox(pts) {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const p of pts) {
      for (let i = 0; i < 3; i++) {
        b[i] = Math.min(b[i], p[i]);
        b[i + 3] = Math.max(b[i + 3], p[i]);
      }
    }
    return b;
  }
  const bbOverlap = (a, b, m) =>
    a[0] - m <= b[3] && b[0] - m <= a[3] && a[1] - m <= b[4] && b[1] - m <= a[4] && a[2] - m <= b[5] && b[2] - m <= a[5];

  function segMate(a, b) {
    const da = sub(a[1], a[0]);
    const La = len(da);
    const ua = scale(da, 1 / La);
    const off = (X) => len(cross(sub(X, a[0]), ua));
    if (off(b[0]) > 0.03 || off(b[1]) > 0.03) return false;
    const t0 = dot(sub(b[0], a[0]), ua), t1 = dot(sub(b[1], a[0]), ua);
    const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(La, Math.max(t0, t1));
    return hi - lo >= 0.25;
  }

  function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function distToPoly(pt, poly) {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      let t = l2 ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(pt[0] - a[0] - dx * t, pt[1] - a[1] - dy * t));
    }
    return best;
  }
  const strictlyInside = (pt, poly, m) => pointInPoly(pt, poly) && distToPoly(pt, poly) > m;

  // Échantillons intérieurs d'une pièce (coordonnées monde).
  function samples(p) {
    const o = P[p.type].outline;
    const c = P[p.type].centroid;
    const pts = [c];
    for (const v of o) pts.push([c[0] + (v[0] - c[0]) * 0.6, c[1] + (v[1] - c[1]) * 0.6]);
    return pts.filter((q) => strictlyInside(q, o, 0.02)).map((q) => worldPoint(p, q[0], q[1]));
  }

  function coplanarOverlap(A, B) {
    const oa = P[A.p.type].outline, ob = P[B.p.type].outline;
    for (const X of B.samples) if (strictlyInside(toLocal(A.p, X), oa, 0.03)) return true;
    for (const X of A.samples) if (strictlyInside(toLocal(B.p, X), ob, 0.03)) return true;
    return false;
  }

  function crosses(A, B) {
    const ob = P[B.p.type].outline;
    const W = A.W;
    for (let i = 0; i < W.length; i++) {
      const a0 = W[i], a1 = W[(i + 1) % W.length];
      const d0 = dot(B.n, a0) - B.d, d1 = dot(B.n, a1) - B.d;
      if ((d0 > 0.01 && d1 < -0.01) || (d0 < -0.01 && d1 > 0.01)) {
        const X = lerp(a0, a1, d0 / (d0 - d1));
        if (strictlyInside(toLocal(B.p, X), ob, 0.03)) return true;
      }
    }
    return false;
  }

  /**
   * Vérifie une construction. Erreurs : pièce sous le sol, groupe de pièces
   * qui flotte (ne touche pas le sol), pièces superposées dans un même plan,
   * pièce qui en traverse une autre. Avertissements : pièce posée seule sans
   * aucun contact aimanté.
   */
  function validate(placements) {
    const n = placements.length;
    const G = placements.map((p) => {
      const W = worldOutline(p);
      const nn = norm(cross(p.u, p.v));
      return { p, W, n: nn, d: dot(nn, p.pos), bb: bbox(W), edges: worldMagnetEdges(p), samples: samples(p) };
    });
    const parent = placements.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const mates = new Array(n).fill(0);
    const overlaps = [], crossings = [];
    let mateCount = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const A = G[i], B = G[j];
        if (!bbOverlap(A.bb, B.bb, 0.05)) continue;
        let mated = false;
        for (const ea of A.edges) {
          for (const eb of B.edges) {
            if (segMate(ea, eb)) {
              mated = true;
              break;
            }
          }
          if (mated) break;
        }
        if (mated) {
          mates[i]++;
          mates[j]++;
          mateCount++;
          parent[find(i)] = find(j);
        }
        const c = dot(A.n, B.n);
        if (Math.abs(c) > 0.999) {
          if (Math.abs(A.d - Math.sign(c) * B.d) < 0.02 && coplanarOverlap(A, B)) overlaps.push([i, j]);
        } else if (crosses(A, B) || crosses(B, A)) {
          crossings.push([i, j]);
        }
      }
    }
    const grounded = G.map(({ p, W }) => {
      if (p.type === 'CAR') return Math.abs(p.pos[1] - CAR.top) < 0.02;
      for (let i = 0; i < W.length; i++) {
        const a = W[i], b = W[(i + 1) % W.length];
        if (Math.abs(a[1]) < 0.02 && Math.abs(b[1]) < 0.02) return true;
      }
      return false;
    });
    const below = G.filter(({ W }) => W.some((q) => q[1] < -0.02)).map(({ p }) => p.id);
    const comps = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!comps.has(r)) comps.set(r, { ids: [], grounded: false });
      const c = comps.get(r);
      c.ids.push(i);
      if (grounded[i]) c.grounded = true;
    }
    const components = [...comps.values()];
    const floating = components.filter((c) => !c.grounded).flatMap((c) => c.ids);
    const isolated = [];
    for (let i = 0; i < n; i++) if (!mates[i]) isolated.push(i);

    const errors = [], warnings = [];
    if (below.length) errors.push(`${below.length} pièce(s) sous le sol : ${below.slice(0, 8).join(', ')}`);
    if (floating.length) errors.push(`${floating.length} pièce(s) flottent sans toucher le sol : ${floating.slice(0, 8).join(', ')}`);
    if (overlaps.length) errors.push(`${overlaps.length} superposition(s) : ${overlaps.slice(0, 5).map((x) => x.join('/')).join(', ')}`);
    if (crossings.length) errors.push(`${crossings.length} croisement(s) : ${crossings.slice(0, 5).map((x) => x.join('/')).join(', ')}`);
    const loners = isolated.filter((i) => placements[i].type !== 'CAR');
    if (loners.length) warnings.push(`${loners.length} pièce(s) sans contact aimanté : ${loners.slice(0, 8).join(', ')}`);
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      below,
      components: components.length,
      isolated,
      floating,
      overlaps,
      crossings,
      mateCount,
    };
  }
  MT.validate = validate;

  // --------------------------------------------------------------- registres
  MT.themes = MT.themes || {};
  MT.themeList = MT.themeList || [];
  MT.modules = MT.modules || {};
  MT.moduleList = MT.moduleList || [];

  /**
   * Thème : { id, name, emoji, tagline, keywords: [..], generate(b, ctx) }
   * ctx = { size: 1..4, packs: 1|2, rng, seed }. generate peut renvoyer
   * { title, summary } pour décrire la construction obtenue.
   */
  MT.registerTheme = function (def) {
    for (const k of ['id', 'name', 'generate']) if (!def[k]) throw new Error(`thème : champ ${k} manquant`);
    if (MT.themes[def.id]) throw new Error('thème en double : ' + def.id);
    def.keywords = def.keywords || [];
    MT.themes[def.id] = def;
    MT.themeList.push(def);
    return def;
  };

  /**
   * Module : { id, label, description, params: { nom: spec }, footprint(p) → { w, d },
   *            build(b, p, ctx) } — construit dans l'emprise [0, w] × [0, d], sol à y = 0.
   * spec : { type: 'int'|'number', min, max, default, label } | { type: 'enum', values, default, label }
   *        | { type: 'bool', default, label }
   */
  MT.registerModule = function (def) {
    for (const k of ['id', 'label', 'description', 'footprint', 'build']) if (!def[k]) throw new Error(`module : champ ${k} manquant`);
    if (MT.modules[def.id]) throw new Error('module en double : ' + def.id);
    def.params = def.params || {};
    MT.modules[def.id] = def;
    MT.moduleList.push(def);
    return def;
  };

  MT.footprintOf = function (id, params, rot) {
    const mod = MT.modules[id];
    const fp = mod.footprint(normalizeParams(mod, params));
    return rot === 90 || rot === 270 ? { w: fp.d, d: fp.w } : { w: fp.w, d: fp.d };
  };

  /*
   * Les tailles 1 à 3 tiennent dans UN pack, même quand le double pack est
   * activé : le second pack ne sert qu'aux constructions qui en ont besoin
   * (taille 4 et thème libre). La construction est alors identique en 1 et
   * 2 packs pour une même graine ; seul l'affichage du stock change.
   */
  function runTheme(theme, size, packs, seed) {
    const eff = size <= 3 ? 1 : packs;
    const b = new Builder({ packs, seed, stock: eff === packs ? undefined : MT.inventoryFor(eff) });
    const meta = theme.generate(b, { size, packs: eff, rng: b.rng, seed }) || {};
    const r = b.finish();
    r.title = meta.title || theme.name;
    r.summary = meta.summary || '';
    return r;
  }

  /**
   * Thème → construction. Si la taille demandée dépasse le stock, réduit la
   * taille jusqu'à ce que tout tienne. opts : { size = 2, packs = 1, seed = 1 }
   * Tailles 1 à 3 : un seul pack utilisé ; taille 4 : le stock choisi.
   */
  MT.generate = function (themeId, opts) {
    const theme = MT.themes[themeId];
    if (!theme) throw new Error('thème inconnu : ' + themeId);
    const o = opts || {};
    const req = Math.max(1, Math.min(4, Math.round(o.size || 2)));
    const packs = o.packs === 2 ? 2 : 1;
    const seed = o.seed >>> 0;
    let r = null;
    let size = req;
    for (; size >= 1; size--) {
      r = runTheme(theme, size, packs, seed);
      if (!r.shortTotal) break;
    }
    if (size < 1) size = 1;
    r.themeId = themeId;
    r.seed = seed;
    r.size = size;
    r.requestedSize = req;
    r.downsized = size < req;
    r.doubleFits = false;
    if (packs === 1 && r.downsized) r.doubleFits = runTheme(theme, req, 2, seed).shortTotal === 0;
    r.validation = validate(r.placements);
    return r;
  };

  // Familles de pièces interchangeables (même contour).
  const FAMILY = { SQ: 'carre', WIN2: 'carre', FRAME: 'carre', ARCH: 'carre', WIN4: 'carre', EQ: 'EQ', RT: 'RT', TT: 'TT', HR: 'demi', CR: 'demi', CAR: 'CAR' };
  const FAMILY_LABEL = {
    carre: 'carrés', EQ: 'triangles équilatéraux', RT: 'triangles rectangles', TT: 'grands triangles',
    demi: 'demi-rectangles et créneaux', CAR: 'plateaux à roues',
  };
  MT.FAMILY = FAMILY;
  MT.FAMILY_LABEL = FAMILY_LABEL;
  const familyCount = (counts) => {
    const d = {};
    for (const t of MT.PIECE_ORDER) d[FAMILY[t]] = (d[FAMILY[t]] || 0) + (counts[t] || 0);
    return d;
  };
  MT.familyCount = familyCount;

  const demandCache = new Map();
  /** Pièces demandées par un module, par famille (construction à blanc, stock illimité). */
  function demandOf(mod, params) {
    const key = mod.id + '|' + JSON.stringify(params);
    if (demandCache.has(key)) return demandCache.get(key);
    const big = {};
    for (const t of MT.PIECE_ORDER) big[t] = MT.PACK[t] * 20;
    const b = new Builder({ packs: 2, seed: 1, stock: big });
    let d;
    try {
      b.module(mod.id, 0, 0, params);
      const used = {};
      for (const p of b.placements) used[p.type] = (used[p.type] || 0) + 1;
      d = familyCount(used);
      d.total = b.placements.length;
    } catch (e) {
      d = { total: 0, error: true };
    }
    demandCache.set(key, d);
    return d;
  }
  MT.moduleDemand = (id, params) => demandOf(MT.modules[id], normalizeParams(MT.modules[id], params));

  /** Variantes « un cran plus petites » d'un jeu de paramètres. */
  function shrinkCandidates(mod, params) {
    const out = [];
    for (const [k, spec] of Object.entries(mod.params || {})) {
      const v = params[k];
      if ((spec.type === 'int' || spec.type === 'number') && v > spec.min) {
        out.push(Object.assign({}, params, { [k]: Math.max(spec.min, v - 1) }));
      } else if (spec.type === 'bool' && v === true) {
        out.push(Object.assign({}, params, { [k]: false }));
      } else if (spec.type === 'enum' && !spec.fixed) {
        // spec.fixed : valeur qui porte le sens du module (espèce, forme…), jamais changée.
        for (const alt of spec.values) if (alt !== v) out.push(Object.assign({}, params, { [k]: alt }));
      }
    }
    return out;
  }

  // Décalages triés par distance : l'emplacement libre le plus proche d'abord,
  // à distance égale ceux qui ne bougent que sur un axe.
  const OFFSETS = [];
  for (let dx = -14; dx <= 14; dx++) {
    for (let dz = -14; dz <= 14; dz++) OFFSETS.push([dx * dx + dz * dz + (dx && dz ? 0.25 : 0), dx, dz]);
  }
  OFFSETS.sort((a, c) => a[0] - c[0]);

  /**
   * Plan de modules → construction (thème libre).
   * plan : { title, summary, items: [{ module, x, z, rot, params, label }] }
   * 1. Budget : tant qu'une famille de pièces est demandée au-delà du stock,
   *    on réduit d'un cran le module qui en consomme le plus (le premier item,
   *    le plus important, pèse pour moitié) ; faute de réduction possible, la
   *    pose réelle tranche (repli interne du module, sinon abandon).
   * 2. Pose dans l'ordre du plan ; une emprise occupée est décalée vers
   *    l'emplacement libre le plus proche (1 case d'écart entre modules) ;
   *    si le stock manque encore, on essaie les variantes réduites et on garde
   *    celle qui manque le moins et pose le plus de pièces.
   * report[i].status : ok | moved | reduced | adapted (le module a changé un
   * détail, voir notes) | skipped (voir missing : familles manquantes) | unknown.
   */
  MT.compose = function (plan, opts) {
    const o = opts || {};
    const packs = o.packs === 2 ? 2 : 1;
    const seed = o.seed >>> 0;
    const b = new Builder({ packs, seed });
    const occ = new Set();
    const report = [];
    const raw = Array.isArray(plan && plan.items) ? plan.items.slice(0, 40) : [];
    const free = (x, z, w, d) => {
      for (let i = -1; i <= w; i++) for (let j = -1; j <= d; j++) if (occ.has(`${x + i},${z + j}`)) return false;
      return true;
    };

    // Lecture du plan
    const entries = [];
    for (const item of raw) {
      const id = item && typeof item.module === 'string' ? item.module : '';
      const mod = MT.modules[id] || MT.moduleList.find((m) => fold(m.id) === fold(id) || fold(m.label) === fold(id));
      if (!mod) {
        report.push({ module: String(id), label: String((item && item.label) || id), status: 'unknown' });
        continue;
      }
      const r0 = (((Math.round(Number(item.rot) / 90) * 90) % 360) + 360) % 360;
      const params = normalizeParams(mod, item.params);
      entries.push({
        mod,
        params,
        rot: Number.isFinite(r0) ? r0 : 0,
        label: typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 40) : mod.label,
        x: Math.max(0, Math.round(Number(item.x) || 0)),
        z: Math.max(0, Math.round(Number(item.z) || 0)),
        demand: demandOf(mod, params),
        reduced: false,
        dropped: null,
      });
    }

    // 1. Budget par famille. Marge sur les carrés : les murs n'utilisent pas
    // les portes en arche, donc la famille est un peu moins riche qu'il n'y paraît.
    const cap = familyCount(b.stock);
    cap.carre = Math.floor(cap.carre - b.stock.ARCH * 0.5);
    const weight = (e, f, live) => (e.demand[f] || 0) * (e === live[0] ? 0.5 : 1);
    // Famille qu'aucune réduction ne fait plus baisser : on laisse la pose
    // réelle trancher (les modules ont souvent un repli interne).
    const stuck = new Set();
    for (let iter = 0; iter < 300; iter++) {
      const live = entries.filter((e) => !e.dropped);
      const tot = {};
      for (const e of live) for (const f in cap) tot[f] = (tot[f] || 0) + (e.demand[f] || 0);
      let f = null;
      for (const k in cap) if (!stuck.has(k) && (tot[k] || 0) > cap[k] && (!f || tot[k] - cap[k] > tot[f] - cap[f])) f = k;
      if (!f) break;
      const consumers = live.filter((e) => (e.demand[f] || 0) > 0);
      // Le premier item (le plus important) compte pour moitié : il n'est
      // réduit que s'il consomme bien plus que les autres.
      const pool = consumers.slice().sort((a, c) => weight(c, f, live) - weight(a, f, live));
      let done = false;
      for (const e of pool) {
        let best = null, bestD = null;
        for (const cand of shrinkCandidates(e.mod, e.params)) {
          const d = demandOf(e.mod, cand);
          if (d.error || !d.total || (d[f] || 0) >= (e.demand[f] || 0)) continue;
          if (!best || d.total > bestD.total || (d.total === bestD.total && (d[f] || 0) < (bestD[f] || 0))) {
            best = cand;
            bestD = d;
          }
        }
        if (best) {
          e.params = best;
          e.demand = bestD;
          e.reduced = true;
          done = true;
          break;
        }
      }
      if (!done) stuck.add(f);
    }

    // 2. Pose
    for (const e of entries) {
      const { mod, rot, label } = e;
      if (e.dropped) {
        report.push({ module: mod.id, label, status: 'skipped', missing: [e.dropped], params: e.params, notes: [] });
        continue;
      }
      let params = e.params;
      const fpOf = (prm) => {
        const f = mod.footprint(prm);
        return rot % 180 ? { w: Math.ceil(f.d), d: Math.ceil(f.w) } : { w: Math.ceil(f.w), d: Math.ceil(f.d) };
      };
      let x = e.x, z = e.z;
      let placed = false, moved = false, reduced = e.reduced, notes = [], missing = [];
      for (let attempt = 0; attempt < 25 && !placed; attempt++) {
        const fp = fpOf(params);
        let spot = null;
        for (const [, dx, dz] of OFFSETS) {
          if (x + dx < 0 || z + dz < 0) continue;
          if (free(x + dx, z + dz, fp.w, fp.d)) {
            spot = [x + dx, z + dz];
            break;
          }
        }
        if (!spot) break;
        const n0 = b.notes.length;
        const ok = b.tryBuild(() => b.module(mod.id, spot[0], spot[1], params, { rot, label }));
        if (ok) {
          placed = true;
          notes = b.notes.slice(n0);
          moved = spot[0] !== e.x || spot[1] !== e.z;
          x = spot[0];
          z = spot[1];
          for (let i = 0; i < fp.w; i++) for (let j = 0; j < fp.d; j++) occ.add(`${x + i},${z + j}`);
          break;
        }
        // Variante réduite qui manque le moins, puis qui pose le plus de pièces.
        let best = null, score = null;
        for (const cand of shrinkCandidates(mod, params)) {
          const t = new Builder({ packs, seed, stock: Object.assign({}, b.stock) });
          try {
            t.module(mod.id, 0, 0, cand);
          } catch (err) {
            continue;
          }
          const sc = [t.shortTotal, -t.placements.length];
          if (!best || sc[0] < score[0] || (sc[0] === score[0] && sc[1] < score[1])) {
            best = cand;
            score = sc;
          }
        }
        if (!best) {
          const t = new Builder({ packs, seed, stock: Object.assign({}, b.stock) });
          try {
            t.module(mod.id, 0, 0, params);
          } catch (err) {
            /* rien de plus à signaler */
          }
          missing = [...new Set(Object.keys(t.shortages).map((k) => FAMILY[(kindChain(k) || ['SQ'])[0]]))];
          break;
        }
        params = best;
        reduced = true;
      }
      report.push({
        module: mod.id,
        label,
        status: placed ? (reduced ? 'reduced' : notes.length ? 'adapted' : moved ? 'moved' : 'ok') : 'skipped',
        x,
        z,
        rot,
        params,
        notes,
        missing,
      });
    }
    const r = b.finish();
    r.title = (plan && typeof plan.title === 'string' && plan.title.slice(0, 80)) || 'Construction libre';
    r.summary = (plan && typeof plan.summary === 'string' && plan.summary.slice(0, 300)) || '';
    r.themeId = 'libre';
    r.seed = seed;
    r.size = null;
    r.requestedSize = null;
    r.downsized = report.some((x) => x.status === 'reduced' || x.status === 'skipped');
    r.doubleFits = false;
    if (packs === 1 && r.downsized && !o._noDouble) {
      const r2 = MT.compose(plan, { packs: 2, seed, _noDouble: true });
      r.doubleFits = !r2.report.some((x) => x.status === 'reduced' || x.status === 'skipped');
    }
    r.report = report;
    r.validation = validate(r.placements);
    return r;
  };
})(typeof window !== 'undefined' ? window : globalThis);
