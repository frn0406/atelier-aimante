/*
 * Atelier Aimanté — thèmes « habitat » : Château fort, Maison & village, Ferme,
 * et leurs modules réutilisables (tour, donjon, rempart, porte fortifiée,
 * château, maison, maisonnette, puits, arbre, grange, silo, enclos, tracteur,
 * moulin, animal, village, ferme).
 *
 * Principes de construction :
 * - le budget est planifié AVANT de construire : un plan est essayé du plus
 *   riche au plus modeste (b.tryBuild), le premier qui tient dans le stock est
 *   gardé ; les parties optionnelles viennent ensuite, dans l'ordre d'importance ;
 * - les murs pleins et les pans de toit sont des carrés exacts ('SQ!') ; les
 *   fenêtres, cadres et portes sont posés volontairement (meurtrières, façades) ;
 *   un mur n'est jamais remplacé par des triangles ;
 * - les créneaux sont de vrais créneaux ('CR!'), posés par côtés entiers ;
 * - titres et résumés décrivent ce qui a vraiment été posé ; un module qui
 *   change un détail faute de pièces le signale par b.note().
 *
 * Repère du Builder : Y en haut, sol à y = 0, cellule (x, z) = [x, x+1] × [z, z+1],
 * côtés N = −Z, S = +Z (façade, vers le spectateur), E = +X, W = −X.
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const EQ_H = MT.EQ_H, HR_H = MT.HR_H, TT_H = MT.TT_H, CAR = MT.CAR;
  const SIDES4 = ['N', 'E', 'S', 'W'];
  // Plafond de pièces par taille (au-delà, les parties optionnelles sont refusées).
  const CAPS = { 1: 45, 2: 90, 3: 136, 4: 272 };

  // ================================================================ outils
  const range = (a, b) => {
    const out = [];
    for (let i = a; i < b; i++) out.push(i);
    return out;
  };
  /** Découpe arr en paquets équilibrés d'au plus n éléments. */
  function chunks(arr, n) {
    const k = Math.max(1, Math.ceil(arr.length / n));
    const size = Math.max(1, Math.ceil(arr.length / k));
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // Les premiers tirages de graines voisines (1, 2, 3…) se ressemblent : on les écarte.
  const warmUp = (rng) => {
    rng();
    rng();
    rng();
  };

  const OVER = { over: true };
  /**
   * Essaie fn : tout est annulé si une pièce manque ou si le nombre total de
   * pièces dépasse cap. Renvoie true si la partie a été construite.
   */
  function attempt(b, cap, fn) {
    try {
      return b.tryBuild(() => {
        fn();
        if (cap && b.placements.length > cap) throw OVER;
      });
    } catch (e) {
      if (e === OVER) return false;
      throw e;
    }
  }

  /** Met des pièces de côté pendant fn (réserve pour des parties posées ensuite). */
  function withReserve(b, res, fn) {
    const took = {};
    for (const [t, n] of Object.entries(res || {})) {
      const k = Math.max(0, Math.min(n, b.stock[t]));
      b.stock[t] -= k;
      took[t] = k;
    }
    try {
      return fn();
    } finally {
      for (const [t, k] of Object.entries(took)) b.stock[t] += k;
    }
  }

  /**
   * Planification : essaie le plan cfg, puis ses versions réduites (shrink),
   * du plus riche au plus modeste ; le premier qui tient est gardé. Le plan le
   * plus modeste est posé sans filet : s'il manque des pièces, MT.generate
   * réduira la taille. force : poser cfg directement (Géante avec un seul pack).
   */
  function buildPlanned(b, cap, cfg, build, shrink, force) {
    let cur = cfg;
    if (!force) {
      for (let i = 0; i < 60; i++) {
        const next = shrink(cur);
        if (!next) break;
        let st = null;
        if (attempt(b, cap, () => {
          st = build(b, cur);
        })) return { cfg: cur, st };
        cur = next;
      }
    }
    return { cfg: cur, st: build(b, cur) };
  }

  // ---------------------------------------------------------------- textes
  const NUM_F = ['zéro', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'];
  const NUM_M = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'];
  const numF = (n) => NUM_F[n] || String(n);
  const numM = (n) => NUM_M[n] || String(n);
  const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const joinFr = (arr) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} et ${arr[arr.length - 1]}`);
  const sentence = (arr) => cap1(joinFr(arr.filter(Boolean))) + '.';
  const lab = (name, rest) => (name ? `${name} — ${rest}` : cap1(rest));
  /** Libellé d'un groupe de niveaux (0-indexé, fin exclue). */
  function lvLabel(a, e) {
    return e - a === 1 ? `niveau ${a + 1}` : e - a === 2 ? `niveaux ${a + 1} et ${e}` : `niveaux ${a + 1} à ${e}`;
  }
  const ORD = ['', '', 'Deuxième', 'Troisième', 'Quatrième', 'Cinquième', 'Sixième', 'Septième'];
  /** Nomme les exemplaires : « Maison », « Deuxième maison »… */
  const namer = () => {
    const seen = {};
    return (label) => {
      seen[label] = (seen[label] || 0) + 1;
      const n = seen[label];
      return n === 1 ? label : `${ORD[n] || n + 'e'} ${label.charAt(0).toLowerCase() + label.slice(1)}`;
    };
  };

  // ============================================================ murs et sols
  // Occupation des segments de grille : hauteur du haut du mur le plus haut.
  function segKey(x, z, side) {
    if (side === 'N') return `H${x},${z}`;
    if (side === 'S') return `H${x},${z + 1}`;
    if (side === 'W') return `V${x},${z}`;
    return `V${x + 1},${z}`;
  }
  // (les marques d'une partie annulée par tryBuild sont ignorées : on vérifie que la pièce existe encore)
  function makeOcc(b) {
    const tops = new Map();
    return {
      mark(x, z, side, y, p) {
        const k = segKey(x, z, side);
        if (!tops.has(k)) tops.set(k, []);
        tops.get(k).push([y, p]);
      },
      top(x, z, side) {
        let t = 0;
        for (const [y, p] of tops.get(segKey(x, z, side)) || []) if (!p || b.placements[p.id] === p) t = Math.max(t, y);
        return t;
      },
    };
  }
  /** Mur carré sur le côté `side` de la cellule (x, z), base à y ; noté dans occ. */
  function wl(b, x, y, z, side, kind, occ) {
    const p = b.wall(x, y, z, side, kind);
    if (p && occ) occ.mark(x, z, side, y + 1, p);
    return p;
  }
  /** Créneaux exacts sur le haut d'un mur, sauf si un mur plus haut occupe le segment. */
  function crenelOn(b, x, y, z, side, occ) {
    if (occ && occ.top(x, z, side) > y + 0.01) return null;
    return b.wall(x, y, z, side, 'CR!');
  }
  /**
   * Genre de demi-mur pour n pièces : un seul type si possible (créneaux ou
   * demi-rectangles), pour une clôture homogène. prefer : 'CR' ou 'HR'.
   */
  function uniformHalf(b, n, prefer) {
    const order = prefer === 'HR' ? ['HR', 'CR'] : ['CR', 'HR'];
    for (const t of order) if (b.stock[t] >= n) return t + '!';
    return 'half';
  }
  /** Genres d'une clôture de demi-murs [cx, cz, side] : côtés entiers d'un même type. */
  function fenceKinds(b, segs, prefer) {
    const k = uniformHalf(b, segs.length, prefer);
    if (k !== 'half') return segs.map(() => k);
    const left = { CR: b.stock.CR, HR: b.stock.HR };
    const bySide = {};
    for (const s of segs) (bySide[s[2]] = bySide[s[2]] || []).push(s);
    const kindOf = {};
    for (const [side, list] of Object.entries(bySide)) {
      const t = ['CR', 'HR'].find((u) => left[u] >= list.length);
      if (t) {
        left[t] -= list.length;
        kindOf[side] = t + '!';
      } else kindOf[side] = 'half';
    }
    return segs.map((s) => kindOf[s[2]]);
  }

  // ---------------------------------------------------------------- toits
  const ROOF1 = {
    fleche: { cost: { TT: 4 }, label: 'toit en flèche' },
    pyramide: { cost: { EQ: 4 }, label: 'toit pointu' },
    creneaux: { cost: { CR: 4 }, label: 'créneaux' },
    plat: { cost: { SQ: 1 }, label: 'toit plat' },
  };
  const ROOF2 = {
    creneaux: { cost: { CR: 8 }, label: 'créneaux' },
    pyramide: { cost: { EQ: 16 }, label: 'grand toit pointu' },
    pyramides: { cost: { EQ: 16, SQ: 4 }, label: 'terrasse et quatre clochetons' },
    plat: { cost: { SQ: 4 }, label: 'terrasse' },
  };
  const FALLBACK1 = {
    fleche: ['fleche', 'pyramide', 'creneaux', 'plat'],
    pyramide: ['pyramide', 'fleche', 'creneaux', 'plat'],
    creneaux: ['creneaux', 'pyramide', 'fleche', 'plat'],
    plat: ['plat', 'pyramide', 'fleche', 'creneaux'],
  };
  const FALLBACK2 = {
    creneaux: ['creneaux', 'pyramide', 'plat'],
    pyramide: ['pyramide', 'creneaux', 'plat'],
    pyramides: ['pyramides', 'pyramide', 'creneaux', 'plat'],
    plat: ['plat', 'creneaux', 'pyramide'],
  };
  const ROOF_FR = { fleche: 'toit en flèche', pyramide: 'toit pointu', creneaux: 'créneaux', plat: 'toit plat', pyramides: 'clochetons' };
  const ROOF_NEED = { fleche: 'grands triangles', pyramide: 'triangles', creneaux: 'créneaux', plat: 'carrés', pyramides: 'triangles' };
  function roofNote(b, what, want, got) {
    if (got === want) return;
    b.note(got ? `${what} : ${ROOF_FR[got]} au lieu de ${ROOF_FR[want]}, faute de ${ROOF_NEED[want]}` : `${what} : pas de toit, faute de pièces`);
  }
  /**
   * Choisit les toits d'après le stock restant, dans l'ordre de priorité des
   * groupes ({ big (donjon 2×2), want, n (toits identiques : paire de tours), order }).
   * upgrade : change ensuite les toits pointus en flèches tant qu'il reste des
   * grands triangles (la flèche est la signature du château).
   */
  function planRoofs(b, groups, upgrade) {
    const st = { TT: b.stock.TT, EQ: b.stock.EQ, CR: b.stock.CR, SQ: b.stock.SQ };
    const fits = (c, n) => Object.entries(c).every(([t, k]) => st[t] >= k * n);
    const take = (c, n) => {
      for (const [t, k] of Object.entries(c)) st[t] -= k * n;
    };
    const out = groups.map((gr) => {
      const table = gr.big ? ROOF2 : ROOF1;
      const order = gr.order || (gr.big ? FALLBACK2 : FALLBACK1)[gr.want] || Object.keys(table);
      for (const r of order) {
        if (table[r] && fits(table[r].cost, gr.n || 1)) {
          take(table[r].cost, gr.n || 1);
          return r;
        }
      }
      return null;
    });
    if (upgrade) {
      groups.forEach((gr, i) => {
        const n = gr.n || 1;
        if (!gr.big && out[i] === 'pyramide' && st.TT >= 4 * n) {
          out[i] = 'fleche';
          st.TT -= 4 * n;
          st.EQ += 4 * n;
        }
      });
    }
    return out;
  }
  /** Toit d'une cellule 1×1 posé sur le haut des murs (y). */
  function roof1(b, x, y, z, r, occ) {
    if (r === 'fleche') b.pyramidRoof(x, y, z, 'TT');
    else if (r === 'pyramide') b.pyramidRoof(x, y, z, 'EQ');
    else if (r === 'creneaux') for (const s of SIDES4) crenelOn(b, x, y, z, s, occ);
    else if (r === 'plat') b.floor(x, y, z, 'SQ!');
  }

  // ================================================================ château
  /**
   * Murs d'une tour 1×1 (cellule x, z), niveaux [from, to[ : carrés pleins,
   * porte en arche au rez-de-chaussée (o.door), meurtrières (fenêtres doubles)
   * sur les faces o.slits à chaque étage ; o.dense : fenêtres sur les autres faces aussi.
   */
  function towerWalls(b, x, z, from, to, o) {
    for (let l = from; l < to; l++) {
      if ((l - from) % 2 === 0) b.step(lab(o.name, lvLabel(l, Math.min(to, l + 2))));
      for (const s of SIDES4) {
        let k = 'SQ!';
        if (l === 0) {
          if (o.door === s) k = 'arch';
        } else if (o.slits && o.slits.includes(s)) k = 'window2';
        else if (o.dense) k = 'window';
        wl(b, x, l, z, s, k, o.occ);
      }
    }
  }

  /** Cellules des murs d'un donjon 2×2 : [côté, index, x, z]. */
  function keepSegs(x, z) {
    return [
      ['N', 0, x, z], ['N', 1, x + 1, z], ['E', 0, x + 1, z], ['E', 1, x + 1, z + 1],
      ['S', 0, x, z + 1], ['S', 1, x + 1, z + 1], ['W', 0, x, z], ['W', 1, x, z + 1],
    ];
  }
  /**
   * Murs d'un donjon 2×2, niveaux [from, to[ : porte en arche au sud, une
   * fenêtre par face à chaque étage (toutes les faces si o.dense), galerie de
   * cadres en façade au dernier niveau (o.top ≥ 3). o : { name, door, doorAt, occ, top, dense }
   */
  function keepWalls(b, x, z, from, to, o) {
    for (let l = from; l < to; l++) {
      b.step(lab(o.name, `niveau ${l + 1}`));
      for (const [s, i, cx, cz] of keepSegs(x, z)) {
        const si = SIDES4.indexOf(s);
        let k = 'SQ!';
        if (l === 0) {
          if (s === (o.door || 'S') && i === (o.doorAt || 0)) k = 'arch';
        } else if (o.top >= 3 && l === o.top - 1 && s === 'S') k = 'frame';
        else if (o.dense || i === (l + si) % 2) k = l % 2 ? 'window2' : 'window';
        wl(b, cx, l, cz, s, k, o.occ);
      }
    }
  }
  /** Toit ou sommet d'un donjon 2×2 dont le haut des murs est à y. */
  function roof2(b, x, y, z, r, occ, name) {
    if (r === 'creneaux') for (const [s, , cx, cz] of keepSegs(x, z)) crenelOn(b, cx, y, cz, s, occ);
    else if (r === 'pyramide') {
      // grand toit pointu : 4 faces de 4 triangles, en deux étapes
      const Q = [x + 1, y + Math.SQRT2, z + 1];
      const c = [[x, y, z], [x, y, z + 2], [x + 2, y, z + 2], [x + 2, y, z]];
      for (let f = 0; f < 4; f++) {
        if (f === 2) b.step(lab(name, 'grand toit pointu (suite)'));
        b.triGrid(c[f], c[(f + 1) % 4], Q, 2, 'EQ');
      }
    } else {
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) b.floor(x + dx, y, z + dz, 'SQ!');
      if (r === 'pyramides') {
        [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([dx, dz], i) => {
          if (i % 2 === 0) b.step(lab(name, i ? 'clochetons sud' : 'clochetons nord'));
          b.pyramidRoof(x + dx, y, z + dz, 'EQ');
        });
      }
    }
  }

  /**
   * Porte fortifiée : tourelles en (x, z) et (x+2, z), passage voûté en (x+1, z)
   * avec une arche côté N et une arche côté S ; pont-levis au sol en (x+1, z+1).
   * o : { name, levels (hauteur du passage), towerLevels, occ, dense, pont }
   */
  function gatehouseWalls(b, x, z, o) {
    const nm = (t) => lab(o.name, t);
    const gh = o.levels, th = Math.max(o.towerLevels || 0, gh + 1);
    towerWalls(b, x, z, 0, th, { name: nm('tour gauche'), occ: o.occ, slits: ['S', 'W'], dense: o.dense });
    towerWalls(b, x + 2, z, 0, th, { name: nm('tour droite'), occ: o.occ, slits: ['S', 'E'], dense: o.dense });
    b.step(nm(`passage voûté${o.pont ? ' et pont-levis' : ''}`));
    for (let l = 0; l < gh; l++) {
      wl(b, x + 1, l, z, 'N', l === 0 ? 'arch' : 'SQ!', o.occ);
      wl(b, x + 1, l, z, 'S', l === 0 ? 'arch' : l === gh - 1 ? 'window2' : 'SQ!', o.occ);
    }
    let pont = false;
    if (o.pont) pont = attempt(b, 0, () => b.floor(x + 1, 0, z + 1, 'SQ!'));
    return { th, pont };
  }

  const CORNER_FR = { NW: 'nord-ouest', NE: 'nord-est', SW: 'sud-ouest', SE: 'sud-est' };
  const SIDE_FR = { N: 'nord', S: 'sud', E: 'est', W: 'ouest' };
  const CORNER_CELL = (W, D) => ({ SW: [0, D - 1], SE: [W - 1, D - 1], NW: [0, 0], NE: [W - 1, 0] });

  /**
   * Château dans le rectangle [0, W] × [0, D] (D = 1 : simple rempart dont les
   * tours dépassent vers le nord). Les tours d'angle occupent les cellules des
   * coins, à fleur des remparts qui courent sur le bord du rectangle ; la porte
   * est au sud, le pont-levis devant, sur la ligne z = D.
   * c = {
   *   W, D, h, sides ('NESW', 'SW'…), dense (fenêtres partout aux étages),
   *   towers: { SW|SE|NW|NE: { levels, roof, door } },
   *   gate: { at, type: 'arche'|'fortifiee', levels, towerLevels, roof, pont },
   *   keep: { x, z, levels, roof, doorAt }, crenels, upgrade, notes
   * }
   * Renvoie les statistiques de ce qui a été posé.
   */
  function castle(b, c) {
    const occ = makeOcc(b);
    const W = c.W, D = c.D, h = c.h || 1;
    const sides = c.sides || 'NESW';
    const line = D === 1;
    const cellOf = CORNER_CELL(W, D);
    const outOf = { SW: ['S', 'W'], SE: ['S', 'E'], NW: ['N', 'W'], NE: ['N', 'E'] };
    const towers = [];
    for (const k of ['SW', 'SE', 'NW', 'NE']) {
      const t = c.towers && c.towers[k];
      if (!t || (line && k[0] === 'N')) continue;
      const [x, z] = cellOf[k];
      towers.push({
        key: k, x, z, levels: Math.max(t.levels, h + 1), want: t.roof || 'pyramide', door: t.door || null,
        slits: line ? ['S', k === 'SW' ? 'W' : 'E'] : outOf[k], front: k[0] === 'S',
        name: line ? (k === 'SW' ? 'Tour ouest' : 'Tour est') : `Tour ${CORNER_FR[k]}`,
      });
    }
    const tcell = new Set(towers.map((t) => `${t.x},${t.z}`));
    const g = c.gate && sides.includes('S') ? c.gate : null;
    const fort = !!(g && g.type === 'fortifiee');
    const ghx = fort ? [g.at - 1, g.at, g.at + 1] : [];
    const segs = { N: [], E: [], S: [], W: [] };
    for (let i = 0; i < W; i++) {
      if (!line) segs.N.push({ x: i, z: 0, s: 'N' });
      segs.S.push({ x: i, z: D - 1, s: 'S' });
    }
    if (!line) {
      for (let j = 0; j < D; j++) {
        segs.W.push({ x: 0, z: j, s: 'W' });
        segs.E.push({ x: W - 1, z: j, s: 'E' });
      }
    }
    for (const s of SIDES4) segs[s] = segs[s].filter((sg) => !tcell.has(`${sg.x},${sg.z}`) && !(s === 'S' && ghx.includes(sg.x)));
    const sideList = SIDES4.filter((s) => sides.includes(s) && segs[s].length);
    const st = { towers: towers.length, roofs: {}, keep: null, gate: g ? g.type : null, pont: false, crenelSides: [], crenels: 0, gateTowers: 0, levels: 0, sides: sideList, tents: 0, well: false };
    const sideName = (list, all) =>
      line ? 'Rempart' : all && list.length > 1 ? 'Remparts' : `Rempart${list.length > 1 ? 's' : ''} ${joinFr(list.map((s) => SIDE_FR[s]))}`;

    // --- A. tours d'angle
    for (const t of towers) {
      towerWalls(b, t.x, t.z, 0, t.levels, { name: t.name, door: t.door, slits: t.slits, occ, dense: c.dense });
      st.levels = Math.max(st.levels, t.levels);
    }
    // --- B. remparts (carrés pleins ; porte en arche et pont-levis au sud)
    for (let l = 0; l < h; l++) {
      const groups = [];
      let cur = null;
      for (const s of sideList) {
        if (!cur || cur.n + segs[s].length > 11) groups.push((cur = { sides: [], n: 0 }));
        cur.sides.push(s);
        cur.n += segs[s].length;
      }
      for (const grp of groups) {
        const pont = l === 0 && g && !fort && g.pont && grp.sides.includes('S');
        b.step(`${sideName(grp.sides, grp.sides.length === sideList.length)} — niveau ${l + 1}${pont ? ' et pont-levis' : ''}`);
        for (const s of grp.sides) {
          for (const sg of segs[s]) {
            const isGate = g && !fort && s === 'S' && sg.x === g.at && l === 0;
            wl(b, sg.x, l, sg.z, sg.s, isGate ? 'arch' : 'SQ!', occ);
          }
        }
        if (pont) st.pont = attempt(b, 0, () => b.floor(g.at, 0, D, 'SQ!'));
      }
    }
    // --- C. porte fortifiée
    let gate = null;
    if (fort) {
      const gh = Math.max(g.levels || h + 1, h);
      const gw = gatehouseWalls(b, g.at - 1, D - 1, { name: 'Porte', levels: gh, towerLevels: g.towerLevels, occ, dense: c.dense, pont: g.pont });
      gate = { x: g.at - 1, z: D - 1, gh, th: gw.th };
      st.pont = gw.pont;
      st.gateTowers = 2;
      st.levels = Math.max(st.levels, gw.th);
    }
    // --- D. donjon
    if (c.keep) {
      const kp = c.keep;
      const lv = Math.max(kp.levels, h + 1);
      keepWalls(b, kp.x, kp.z, 0, lv, { name: 'Donjon', door: 'S', doorAt: kp.doorAt || 0, occ, top: lv, dense: c.dense });
      st.keep = { levels: lv, roof: null };
    }
    // --- E. créneaux : côtés entiers, en commençant par la façade (jamais de demi-rectangles plats)
    if (c.crenels !== false) {
      const items = [];
      let left = b.stock.CR;
      for (const s of ['S', 'E', 'W', 'N']) {
        if (!sideList.includes(s)) continue;
        const list = segs[s].filter((sg) => occ.top(sg.x, sg.z, sg.s) <= h + 0.01);
        if (list.length && list.length <= left) {
          items.push({ side: s, list, y: h });
          left -= list.length;
        }
      }
      if (gate && left >= 2) {
        items.push({ side: 'P', list: [{ x: gate.x + 1, z: gate.z, s: 'N' }, { x: gate.x + 1, z: gate.z, s: 'S' }], y: gate.gh });
      }
      const groups = [];
      for (const it of items) {
        const last = groups[groups.length - 1];
        if (last && last.n + it.list.length <= 12) {
          last.items.push(it);
          last.n += it.list.length;
        } else groups.push({ items: [it], n: it.list.length });
      }
      const walls = items.filter((it) => it.side !== 'P').map((it) => it.side);
      for (const grp of groups) {
        const ws = grp.items.filter((it) => it.side !== 'P').map((it) => it.side);
        const parts = [];
        if (ws.length) parts.push(sideName(ws, ws.length === sideList.length && walls.length === ws.length).toLowerCase());
        if (grp.items.some((it) => it.side === 'P')) parts.push('passage de la porte');
        b.step(`Créneaux — ${parts.join(' et ')}`);
        for (const it of grp.items) {
          for (const sg of it.list) crenelOn(b, sg.x, it.y, sg.z, sg.s, occ);
          if (it.side === 'P') st.gateCrenels = true;
          else {
            st.crenelSides.push(it.side);
            st.crenels += it.list.length;
          }
        }
      }
      if (c.notes && sideList.length && st.crenelSides.length < sideList.length) {
        b.note(st.crenelSides.length ? 'une partie des remparts sans créneaux, faute de créneaux' : 'remparts sans créneaux, faute de créneaux');
      }
    }
    // --- F. toits : tours de façade d'abord (les flèches y vont en priorité), porte, tours arrière, donjon
    const groups = [];
    const pushPair = (list, extra) => {
      if (!list.length) return;
      groups.push(Object.assign({ big: false, want: list[0].want, n: list.length, slots: list }, extra || {}));
    };
    const byWant = (list) => {
      const m = {};
      for (const t of list) (m[t.want] = m[t.want] || []).push(t);
      return Object.values(m);
    };
    for (const grp of byWant(towers.filter((t) => t.front))) pushPair(grp);
    if (gate) {
      const gw = g.roof || 'pyramide';
      pushPair([
        { x: gate.x, z: gate.z, levels: gate.th, name: 'Porte — tour gauche', want: gw },
        { x: gate.x + 2, z: gate.z, levels: gate.th, name: 'Porte — tour droite', want: gw },
      ], { gate: true });
    }
    for (const grp of byWant(towers.filter((t) => !t.front))) pushPair(grp);
    if (st.keep) groups.push({ big: true, want: c.keep.roof || 'creneaux', n: 1, slots: [{ x: c.keep.x, z: c.keep.z, levels: st.keep.levels, name: 'Donjon' }], keep: true });
    const plan = planRoofs(b, groups, c.upgrade);
    groups.forEach((gr, i) => {
      const r = plan[i];
      for (const sl of gr.slots) {
        if (c.notes) roofNote(b, sl.name, gr.want, r);
        if (!r) continue;
        b.step(lab(sl.name, (gr.big ? ROOF2 : ROOF1)[r].label));
        if (gr.big) roof2(b, sl.x, sl.levels, sl.z, r, occ, sl.name);
        else roof1(b, sl.x, sl.levels, sl.z, r, occ);
        if (gr.keep) st.keep.roof = r;
        else if (gr.gate) st.gateRoof = r;
        else st.roofs[r] = (st.roofs[r] || 0) + 1;
      }
    });
    return st;
  }

  /** Version un cran plus petite d'un plan de château (null : plus rien à réduire). */
  function shrinkCastle(c) {
    const n = clone(c);
    const h = n.h || 1;
    const lower = (keys, min) => {
      const list = keys.map((k) => n.towers[k]).filter((t) => t && t.levels > min);
      if (!list.length) return false;
      const top = Math.max(...list.map((t) => t.levels));
      for (const t of list) if (t.levels === top) t.levels--; // les paires restent symétriques
      return true;
    };
    if (!n.dense) {
      n.dense = true;
      return n;
    }
    if (lower(['NW', 'NE'], h + 1)) return n;
    if (n.keep && n.keep.levels > Math.max(h + 1, n.keep.min || 2)) {
      n.keep.levels--;
      return n;
    }
    const fort = n.gate && n.gate.type === 'fortifiee';
    if (fort && n.gate.towerLevels > (n.gate.levels || h + 1) + 1) {
      n.gate.towerLevels--;
      return n;
    }
    if (lower(['SW', 'SE'], h + 1)) return n;
    if (fort && (n.gate.levels || h + 1) > h + 1) {
      n.gate.levels = (n.gate.levels || h + 1) - 1;
      return n;
    }
    if (h > 1) {
      n.h = h - 1;
      if (fort) n.gate.levels = Math.min(n.gate.levels || h, h);
      return n;
    }
    if (fort) {
      n.gate = { at: n.gate.at, type: 'arche', pont: true };
      return n;
    }
    if (n.keep && !n.keepCore) {
      n.keep = null;
      return n;
    }
    return null;
  }

  /** Cellules occupées d'un château (tours, donjon, porte, abords de l'entrée). */
  function castleBlocked(c) {
    const out = [];
    const cellOf = CORNER_CELL(c.W, c.D);
    for (const k of Object.keys(c.towers || {})) if (c.towers[k]) out.push(cellOf[k]);
    if (c.keep) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) out.push([c.keep.x + dx, c.keep.z + dz]);
    if (c.gate) {
      out.push([c.gate.at, c.D - 1], [c.gate.at, c.D - 2]);
      if (c.gate.type === 'fortifiee') out.push([c.gate.at - 1, c.D - 1], [c.gate.at + 1, c.D - 1]);
    }
    return out;
  }
  /** Blocs 2×2 de [x0, x1[ × [z0, z1[ qui évitent les cellules interdites, sans se chevaucher. */
  function freeBlocks(x0, z0, x1, z1, blocked) {
    const out = [];
    for (let a = x0; a + 2 <= x1; a++) {
      for (let z = z0; z + 2 <= z1; z++) {
        let ok = true;
        for (const [bx, bz] of blocked) if (bx >= a && bx < a + 2 && bz >= z && bz < z + 2) ok = false;
        if (ok && !out.some(([oa, oz]) => Math.abs(oa - a) < 2 && Math.abs(oz - z) < 2)) out.push([a, z]);
      }
    }
    return out;
  }
  /** Tente de chevalier (tente en A de carrés pleins, pignons en triangles rectangles) dans le bloc 2×2 (a, z). */
  function tent(b, a, z, name) {
    b.step(name);
    b.aFrame(a + 0.5, 0, z + 0.3, 1, 'x', { kind: 'SQ!' });
  }
  /** Pavillon de tournoi : anneau de 4 demi-rectangles coiffé d'un toit pointu de 4 triangles. */
  function pavilion(b, x, z, name) {
    b.step(name || 'Pavillon de tournoi');
    for (const s of SIDES4) b.halfWall(x, 0, z, s, 'HR!');
    b.pyramidRoof(x, HR_H, z, 'EQ');
  }
  /** Charrette (plateau à roues) dans les cases [a, a+3[ × [z, z+1[, chargée de foin (8 triangles) ou à ridelles. */
  function cart(b, a, z, load, name) {
    const cx = a + 0.5;
    b.step(name || (load === 'foin' ? 'Charrette de foin' : 'Charrette'));
    b.car(cx, z, 'x');
    if (load === 'foin') {
      b.pyramidRoof(cx, CAR.top, z, 'EQ');
      b.pyramidRoof(cx + 1, CAR.top, z, 'EQ');
    } else {
      const segs = [[cx, z, 'N'], [cx + 1, z, 'N'], [cx + 1, z, 'E'], [cx + 1, z, 'S'], [cx, z, 'S'], [cx, z, 'W']];
      const kinds = fenceKinds(b, segs, 'HR');
      segs.forEach(([x, zz, s], i) => b.halfWall(x, CAR.top, zz, s, kinds[i]));
    }
  }
  /**
   * Garnit la cour d'un château tant que le stock le permet : tentes de
   * chevaliers, puits, charrette, pavillons de tournoi. want : { tents, well, cart, pavilions }
   */
  function castleExtras(b, rng, cap, c, want) {
    const blocked = castleBlocked(c);
    const has = (x, z) => blocked.some(([bx, bz]) => bx === x && bz === z);
    const res = { tents: 0, well: false, cart: null, pavilions: 0 };
    for (const [a, z] of rng.shuffle(freeBlocks(0, 0, c.W, c.D, blocked))) {
      if (res.tents >= (want.tents || 0)) break;
      if (attempt(b, cap, () => tent(b, a, z, res.tents ? 'Seconde tente de chevalier' : 'Tente de chevalier'))) {
        res.tents++;
        blocked.push([a, z], [a + 1, z], [a, z + 1], [a + 1, z + 1]);
      }
    }
    // cellules de la cour dont aucun bord ne porte de mur
    const inner = (x, z) => x >= 1 && z >= 1 && x <= c.W - 2 && z <= c.D - 2 && !has(x, z) &&
      [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => !has(x + dx, z + dz));
    const take = (x, z) => blocked.push([x, z]);
    if (want.cart) {
      const spots = [];
      // le plateau est en retrait de 0,2 aux deux bouts : seuls les bords nord et sud doivent être libres de murs
      for (let z = 1; z < c.D - 1; z++) {
        for (let a = 0; a + 3 <= c.W; a++) {
          if ([0, 1, 2].every((i) => !has(a + i, z) && !has(a + i, z - 1) && !has(a + i, z + 1))) spots.push([a, z]);
        }
      }
      for (const [a, z] of rng.shuffle(spots)) {
        const load = rng.pick(['foin', 'ridelles']);
        const done = [load, load === 'foin' ? 'ridelles' : 'foin'].find((ld) => attempt(b, cap, () => cart(b, a, z, ld)));
        if (done) {
          res.cart = done;
          for (let i = 0; i < 3; i++) take(a + i, z);
          break;
        }
      }
    }
    const singles = () => {
      const cand = [];
      for (let x = 1; x < c.W - 1; x++) for (let z = 1; z < c.D - 1; z++) if (inner(x, z)) cand.push([x, z]);
      return rng.shuffle(cand);
    };
    if (want.well) {
      for (const [x, z] of singles()) {
        if (attempt(b, cap, () => well(b, x, z, false, 'Puits de la cour'))) {
          res.well = true;
          take(x, z);
          break;
        }
      }
    }
    for (const [x, z] of singles()) {
      if (res.pavilions >= (want.pavilions || 0)) break;
      if (!inner(x, z)) continue;
      if (b.stock.HR >= 4 && attempt(b, cap, () => pavilion(b, x, z, res.pavilions ? 'Second pavillon de tournoi' : 'Pavillon de tournoi'))) {
        res.pavilions++;
        take(x, z);
      }
    }
    return res;
  }

  // ------------------------------------------------------ modules du château
  /** Tour isolée : murs, puis toit selon le stock (note si le toit change). */
  function soloTower(b, levels, roof, door, name) {
    const occ = makeOcc(b);
    towerWalls(b, 0, 0, 0, levels, { name, door, slits: ['S', 'E'], occ });
    const [r] = planRoofs(b, [{ big: false, want: roof, n: 1 }], false);
    roofNote(b, name || 'Tour', roof, r);
    if (r) {
      b.step(lab(name, ROOF1[r].label));
      roof1(b, 0, levels, 0, r, occ);
    }
    return r;
  }

  MT.registerModule({
    id: 'tour',
    label: 'Tour',
    description:
      'Tour carrée 1×1 (emprise 1×1) : 1 à 6 étages de carrés à meurtrières, porte en arche au sud ; toit en flèche ' +
      '(4 grands triangles), pointu (4 triangles), créneaux (4) ou plat. Sans grands triangles, la flèche devient un toit pointu.',
    params: {
      etages: { type: 'int', min: 1, max: 6, default: 3, label: 'Étages' },
      toit: { type: 'enum', values: ['fleche', 'pyramide', 'creneaux', 'plat'], default: 'fleche', label: 'Toit' },
      porte: { type: 'bool', default: true, label: 'Porte en arche' },
    },
    footprint: () => ({ w: 1, d: 1 }),
    build(b, p) {
      soloTower(b, p.etages, p.toit, p.porte ? 'S' : null, '');
    },
  });

  MT.registerModule({
    id: 'donjon',
    label: 'Donjon',
    description:
      'Donjon carré 2×2 (emprise 2×2) : 2 à 6 étages de 8 carrés (porte en arche au sud, fenêtres, galerie de cadres en haut) ; ' +
      'sommet crénelé (8 créneaux), grand toit pointu (16 triangles), terrasse à 4 clochetons ou terrasse.',
    params: {
      etages: { type: 'int', min: 2, max: 6, default: 3, label: 'Étages' },
      toit: { type: 'enum', values: ['creneaux', 'pyramide', 'pyramides', 'plat'], default: 'creneaux', label: 'Sommet' },
      porte: { type: 'bool', default: true, label: 'Porte en arche' },
    },
    footprint: () => ({ w: 2, d: 2 }),
    build(b, p) {
      const occ = makeOcc(b);
      keepWalls(b, 0, 0, 0, p.etages, { name: '', door: p.porte ? 'S' : 'none', occ, top: p.etages });
      const [r] = planRoofs(b, [{ big: true, want: p.toit, n: 1 }], false);
      roofNote(b, 'Donjon', p.toit, r);
      if (r) {
        b.step(cap1(ROOF2[r].label));
        roof2(b, 0, p.etages, 0, r, occ, '');
      }
    },
  });

  MT.registerModule({
    id: 'rempart',
    label: 'Rempart',
    description:
      'Rempart droit (emprise (longueur + 2) × 2 ; sans tours : longueur ; sans porte : profondeur 1) : mur de carrés de 1 à 3 niveaux ' +
      'le long du sud, porte en arche au milieu et pont-levis devant, créneaux, une tour à chaque bout (hauteur + 1 étages).',
    params: {
      longueur: { type: 'int', min: 1, max: 6, default: 3, label: 'Longueur du mur' },
      hauteur: { type: 'int', min: 1, max: 3, default: 1, label: 'Hauteur du mur' },
      tours: { type: 'bool', default: true, label: 'Tours aux extrémités' },
      porte: { type: 'bool', default: true, label: 'Porte et pont-levis' },
      creneaux: { type: 'bool', default: true, label: 'Créneaux' },
      toit: { type: 'enum', values: ['pyramide', 'fleche', 'creneaux', 'plat'], default: 'pyramide', label: 'Toit des tours' },
    },
    footprint: (p) => ({ w: p.longueur + (p.tours ? 2 : 0), d: p.porte ? 2 : 1 }),
    build(b, p) {
      const W = p.longueur + (p.tours ? 2 : 0);
      const t = { levels: p.hauteur + 1, roof: p.toit };
      castle(b, {
        W, D: 1, h: p.hauteur, sides: 'S',
        towers: p.tours ? { SW: t, SE: Object.assign({}, t) } : {},
        gate: p.porte ? { at: Math.floor((W - 1) / 2), type: 'arche', pont: true } : null,
        crenels: p.creneaux, notes: true,
      });
    },
  });

  MT.registerModule({
    id: 'porte-fortifiee',
    label: 'Porte fortifiée',
    description:
      'Porte fortifiée (emprise 3×2, 3×1 sans pont-levis) : passage voûté (arche devant et derrière) entre deux tourelles ' +
      'plus hautes, créneaux au-dessus du passage, pont-levis posé au sol devant (sud).',
    params: {
      hauteur: { type: 'int', min: 1, max: 3, default: 2, label: 'Hauteur du passage' },
      toit: { type: 'enum', values: ['pyramide', 'fleche', 'creneaux', 'plat'], default: 'pyramide', label: 'Toit des tourelles' },
      pontLevis: { type: 'bool', default: true, label: 'Pont-levis' },
    },
    footprint: (p) => ({ w: 3, d: p.pontLevis ? 2 : 1 }),
    build(b, p) {
      const occ = makeOcc(b);
      const gw = gatehouseWalls(b, 0, 0, { name: '', levels: p.hauteur, towerLevels: p.hauteur + 1, occ, pont: p.pontLevis });
      if (p.pontLevis && !gw.pont) b.note('pas de pont-levis, faute de carrés');
      if (b.stock.CR >= 2) {
        b.step('Créneaux du passage');
        crenelOn(b, 1, p.hauteur, 0, 'N', occ);
        crenelOn(b, 1, p.hauteur, 0, 'S', occ);
      } else b.note('passage sans créneaux, faute de créneaux');
      const [r] = planRoofs(b, [{ big: false, want: p.toit, n: 2 }], false);
      roofNote(b, 'Tourelles', p.toit, r);
      if (r) {
        for (const [x, nm] of [[0, 'Tour gauche'], [2, 'Tour droite']]) {
          b.step(`${nm} — ${ROOF1[r].label}`);
          roof1(b, x, gw.th, 0, r, occ);
        }
      }
    },
  });

  // Toit voulu d'une tour selon le style (les tours de façade veulent toujours une flèche).
  function styleRoof(style, front, rng) {
    if (style === 'fleches') return 'fleche';
    if (style === 'pyramides') return front ? 'fleche' : 'pyramide';
    if (style === 'creneaux') return front ? 'fleche' : 'creneaux';
    return front ? 'fleche' : rng.pick(['pyramide', 'pyramide', 'creneaux']);
  }

  MT.registerModule({
    id: 'chateau',
    label: 'Château',
    description:
      'Château fort (emprise largeur × profondeur, +1 au sud avec pont-levis) : 4 tours d’angle, remparts crénelés, porte au sud, tente. ' +
      'Donjon si largeur et profondeur ≥ 4, porte fortifiée si largeur ≥ 5 : double pack. Flèche = 4 grands triangles par tour.',
    params: {
      largeur: { type: 'int', min: 3, max: 8, default: 5, label: 'Largeur (cases)' },
      profondeur: { type: 'int', min: 3, max: 8, default: 4, label: 'Profondeur (cases)' },
      hauteur: { type: 'int', min: 1, max: 2, default: 1, label: 'Hauteur des remparts' },
      tours: { type: 'int', min: 2, max: 5, default: 3, label: 'Étages des tours (au moins hauteur + 1)' },
      donjon: { type: 'bool', default: false, label: 'Donjon (largeur et profondeur ≥ 4)' },
      porte: { type: 'enum', values: ['arche', 'fortifiee'], default: 'arche', label: 'Porte (fortifiée si largeur ≥ 5)' },
      toits: { type: 'enum', values: ['varies', 'fleches', 'pyramides', 'creneaux'], default: 'varies', label: 'Toits des tours' },
      tente: { type: 'bool', default: true, label: 'Tente dans la cour' },
      pontLevis: { type: 'bool', default: true, label: 'Pont-levis' },
    },
    footprint: (p) => ({ w: p.largeur, d: p.profondeur + (p.pontLevis ? 1 : 0) }),
    build(b, p, { rng }) {
      const W = p.largeur, D = p.profondeur, h = p.hauteur;
      let fort = p.porte === 'fortifiee';
      if (fort && W < 5) {
        fort = false;
        b.note('porte en arche : la porte fortifiée demande une largeur d’au moins 5');
      }
      const at = Math.floor((W - 1) / 2);
      const roofOf = (k) =>
        p.toits === 'fleches' ? 'fleche' : p.toits === 'pyramides' ? 'pyramide' : p.toits === 'creneaux' ? 'creneaux' : styleRoof('mixte', k[0] === 'S', rng);
      const towers = {};
      for (const k of ['SW', 'SE', 'NW', 'NE']) towers[k] = { levels: p.tours, roof: roofOf(k), door: k[0] === 'S' ? 'S' : null };
      if (towers.NE.roof !== towers.NW.roof) towers.NE.roof = towers.NW.roof;
      const cfg = {
        W, D, h, sides: 'NESW', towers, notes: true,
        gate: { at, type: fort ? 'fortifiee' : 'arche', pont: p.pontLevis, levels: h + 1, towerLevels: h + 2, roof: roofOf('NW') },
      };
      if (p.donjon) {
        if (W >= 4 && D >= 4) {
          const kx = Math.floor((W - 2) / 2);
          cfg.keep = {
            x: kx, z: 0, levels: Math.max(p.tours, h + 1) + 1, doorAt: Math.max(0, Math.min(1, at - kx)),
            roof: p.toits === 'pyramides' ? 'pyramide' : p.toits === 'fleches' ? 'pyramides' : 'creneaux',
          };
        } else b.note('donjon omis : il demande une largeur et une profondeur d’au moins 4');
      }
      // carrés mis de côté pour la tente ; faute de carrés pleins, plus de fenêtres aux étages
      withReserve(b, { SQ: p.tente ? 2 : 0 }, () => {
        if (!attempt(b, 0, () => castle(b, cfg))) castle(b, Object.assign({}, cfg, { dense: true }));
      });
      if (p.tente) {
        const ex = castleExtras(b, rng, 0, cfg, { tents: 1 });
        if (!ex.tents) b.note('tente omise : pas de place 2×2 libre dans la cour ou pas assez de pièces');
      }
    },
  });

  // ------------------------------------------------------- thème Château fort
  function roofSummary(roofs) {
    const parts = [];
    if (roofs.fleche) parts.push(roofs.fleche === 1 ? 'une tour à flèche' : `${numF(roofs.fleche)} tours à flèche`);
    if (roofs.pyramide) parts.push(roofs.pyramide === 1 ? 'une tour au toit pointu' : `${numF(roofs.pyramide)} tours aux toits pointus`);
    if (roofs.creneaux) parts.push(roofs.creneaux === 1 ? 'une tour crénelée' : `${numF(roofs.creneaux)} tours crénelées`);
    if (roofs.plat) parts.push(roofs.plat === 1 ? 'une tour en terrasse' : `${numF(roofs.plat)} tours en terrasse`);
    return parts;
  }
  const GATE_ROOF_FR = { fleche: ' à tourelles à flèche', pyramide: ' à tourelles aux toits pointus', creneaux: ' à tourelles crénelées', plat: ' à tourelles en terrasse' };
  const KEEP_ROOF_FR = { creneaux: 'crénelé', pyramide: 'coiffé d’un grand toit pointu', pyramides: 'à quatre clochetons', plat: 'en terrasse' };

  /** Plan de château pour une disposition et une taille (le plus riche ; buildPlanned réduit). */
  function castleConfig(layout, size, rng, style) {
    const T = (levels, front, door) => ({ levels, roof: styleRoof(style, front, rng), door: door || null });
    const pairRoof = (t) => {
      // les tours arrière d'une même paire ont le même toit
      if (t.NE && t.NW) t.NE.roof = t.NW.roof;
      return t;
    };
    let c;
    if (layout === 'ligne') {
      if (size === 1) {
        const W = rng.pick([3, 5]);
        const lv = rng.int(2, 3);
        c = { W, D: 1, h: 1, sides: 'S', towers: { SW: T(lv, true), SE: T(lv, true) }, gate: { at: (W - 1) / 2, type: 'arche', pont: rng.chance(0.7) } };
      } else {
        const W = rng.pick([7, 9]);
        const lv = rng.int(3, 4);
        c = {
          W, D: 1, h: 1, sides: 'S', towers: { SW: T(lv, true), SE: T(lv, true) },
          gate: { at: (W - 1) / 2, type: 'fortifiee', levels: 2, towerLevels: 3, roof: styleRoof(style, false, rng), pont: rng.chance(0.6) },
        };
      }
      c.tents = 0;
    } else if (layout === 'L') {
      const big = size >= 3;
      const W = 5, D = big ? 5 : rng.int(4, 5);
      const lv = big ? 4 : 3;
      c = {
        W, D, h: 1, sides: 'SW',
        towers: { SW: T(lv, true, 'S'), SE: T(lv, true, 'S'), NW: T(lv - 1, false) },
        gate: { at: 2, type: 'arche', pont: rng.chance(0.7) }, tents: 1, pavilions: 1, cart: big,
      };
      if (big) c.keep = { x: 2, z: 1, levels: 4, min: 3, roof: rng.pick(['creneaux', 'pyramide', 'pyramides']), doorAt: 0 };
    } else if (layout === 'central') {
      const big = size >= 4;
      const W = big ? 6 : 4;
      const kx = big ? 2 : 1;
      const at = kx + rng.int(0, 1);
      c = {
        W, D: W, h: 1, sides: 'NESW',
        towers: pairRoof({ SW: T(big ? 5 : 3, true), SE: T(big ? 5 : 3, true), NW: T(big ? 4 : 2, false), NE: T(big ? 4 : 2, false) }),
        gate: { at, type: 'arche', pont: true },
        keep: { x: kx, z: kx, levels: big ? 6 : 4, min: big ? 4 : 3, doorAt: at - kx, roof: rng.pick(['creneaux', 'pyramide', 'pyramides']) },
        keepCore: true, tents: big ? 1 : 0, well: big, cart: big, pavilions: big ? 2 : 0,
      };
    } else if (size === 4) {
      // forteresse : enceinte, porte fortifiée, donjon adossé au rempart nord
      const W = 7, D = 6, h = rng.pick([1, 2]);
      const kx = rng.int(2, 3);
      c = {
        W, D, h, sides: 'NESW',
        towers: pairRoof({ SW: T(h + 4, true), SE: T(h + 4, true), NW: T(h + 3, false), NE: T(h + 3, false) }),
        gate: { at: 3, type: 'fortifiee', levels: h + 1, towerLevels: h + 3, roof: styleRoof(style, false, rng), pont: rng.chance(0.7) },
        keep: { x: kx, z: 0, levels: h + 4, min: h + 2, doorAt: rng.int(0, 1), roof: rng.pick(['creneaux', 'pyramide', 'pyramides']) },
        tents: 2, well: true, cart: true, pavilions: 2,
      };
    } else {
      // enceinte à quatre tours
      const W = 5, D = size === 2 ? 4 : 5;
      const front = size === 2 ? 3 : 4;
      c = {
        W, D, h: 1, sides: 'NESW',
        towers: pairRoof({ SW: T(front, true, rng.pick(['S', null])), SE: T(front, true), NW: T(front - 1, false), NE: T(front - 1, false) }),
        gate: { at: 2, type: 'arche', pont: rng.chance(0.8) }, tents: size === 2 ? 1 : 2, well: size >= 3,
        cart: size >= 3, pavilions: size >= 3 ? 1 : 0,
      };
      if (c.towers.SW.door) c.towers.SE.door = 'S';
    }
    c.layout = layout;
    c.upgrade = true;
    return c;
  }

  /** Petit donjon flanqué d'une tour (taille 1). */
  function smallKeep(b, rng) {
    const occ = makeOcc(b);
    const left = rng.chance(0.5);
    const kx = left ? 1 : 0, tx = left ? 0 : 2, tz = rng.int(0, 1);
    const kroof = rng.pick(['creneaux', 'creneaux', 'pyramide']);
    const tl = kroof === 'pyramide' ? 3 : rng.int(3, 4);
    keepWalls(b, kx, 0, 0, 2, { name: 'Donjon', door: 'S', doorAt: rng.int(0, 1), occ, top: 2 });
    towerWalls(b, tx, tz, 0, tl, { name: 'Tour', slits: [left ? 'W' : 'E', tz ? 'S' : 'N'], occ });
    const [tr, kr] = planRoofs(b, [{ big: false, want: 'fleche', n: 1 }, { big: true, want: kroof, n: 1 }], true);
    if (tr) {
      b.step(`Tour — ${ROOF1[tr].label}`);
      roof1(b, tx, tl, tz, tr, occ);
    }
    if (kr) {
      b.step(`Donjon — ${ROOF2[kr].label}`);
      roof2(b, kx, 2, 0, kr, occ, 'Donjon');
    }
    const towerTxt = tr === 'fleche' ? 'à flèche' : tr === 'creneaux' ? 'crénelée' : tr === 'pyramide' ? 'au toit pointu' : 'en terrasse';
    return {
      title: 'Donjon et sa tour',
      summary: `Un donjon carré ${kr ? KEEP_ROOF_FR[kr] : 'à ciel ouvert'} flanqué d’une tour de ${numF(tl)} étages ${towerTxt}.`,
    };
  }

  MT.registerTheme({
    id: 'chateau',
    name: 'Château fort',
    emoji: '🏰',
    tagline: 'Tours à flèche, remparts crénelés, donjon et pont-levis',
    keywords: [
      'chateau', 'fort', 'forteresse', 'citadelle', 'donjon', 'tourelle', 'rempart', 'creneaux', 'pont levis', 'douves',
      'chevalier', 'princesse', 'prince', 'roi', 'reine', 'royaume', 'couronne', 'medieval', 'moyen age', 'dragon', 'epee',
      'armure', 'catapulte', 'palais', 'conte de fees', 'fee', 'sorciere', 'magicien', 'merlin', 'arthur', 'camelot',
      'raiponce', 'cendrillon', 'belle au bois dormant', 'licorne', 'castle', 'poudlard', 'harry potter', 'reine des neiges',
      'elsa', 'fort boyard',
    ],
    generate(b, { size, packs, rng }) {
      const cap = CAPS[size];
      warmUp(rng);
      const style = rng.pick(['mixte', 'mixte', 'fleches', 'pyramides', 'creneaux']);
      let layout;
      if (size === 1) layout = rng.pick(['ligne', 'donjon']);
      else if (size === 2) layout = rng.pick(['L', 'enceinte', 'ligne']);
      else if (size === 3) layout = rng.pick(['enceinte', 'central', 'L']);
      else layout = rng.pick(['enceinte', 'enceinte', 'central']);
      if (layout === 'donjon') return smallKeep(b, rng);

      const base = castleConfig(layout, size, rng, style);
      // Réserve : 2 carrés par tente prévue (les tentes sont posées après le château).
      const { cfg, st } = withReserve(b, { SQ: 2 * (base.tents || 0) }, () =>
        buildPlanned(b, cap, base, castle, shrinkCastle, size === 4 && packs === 1));
      const ex = castleExtras(b, rng, cap, cfg, { tents: cfg.tents || 0, well: cfg.well, cart: cfg.cart, pavilions: cfg.pavilions || 0 });

      // --- titre et résumé, d'après ce qui a été posé
      const nT = st.towers + st.gateTowers;
      const fortGate = st.gate === 'fortifiee';
      let title;
      if (layout === 'ligne') title = fortGate ? 'Rempart et porte fortifiée' : 'Rempart gardé par deux tours';
      else if (layout === 'L') title = st.keep ? 'Château en L avec donjon' : 'Château en L à trois tours';
      else if (layout === 'central') title = `Donjon entouré de ${numF(st.towers)} tours`;
      else title = `${size >= 4 ? 'Forteresse' : 'Château'} à ${numF(nT)} tours${st.keep ? ' et donjon' : ''}`;
      const bits = [];
      const allCren = st.crenelSides.length && st.crenelSides.length === st.sides.length;
      if (layout === 'ligne') bits.push(`un rempart${st.crenels ? ' crénelé' : ''} entre ${joinFr(roofSummary(st.roofs)) || 'deux tours'}`);
      else if (layout === 'central') {
        bits.push(`un donjon de ${numM(st.keep.levels)} étages ${KEEP_ROOF_FR[st.keep.roof] || ''} au milieu d’une cour étroite`.replace(/ +/g, ' '));
        bits.push(`des remparts${allCren ? ' crénelés' : st.crenels ? ' en partie crénelés' : ''} reliant les tours d’angle`);
      } else if (cfg.sides.length === 4) bits.push(`une enceinte de ${cfg.W} × ${cfg.D} cases${allCren ? ' aux remparts crénelés' : st.crenels ? ' aux remparts en partie crénelés' : ''}`);
      else bits.push(`deux remparts${st.crenels ? ' crénelés' : ''} en équerre`);
      if (layout !== 'ligne') bits.push(...roofSummary(st.roofs));
      if (st.keep && layout !== 'central') bits.push(`un donjon de ${numM(st.keep.levels)} étages ${KEEP_ROOF_FR[st.keep.roof] || ''}`.trim());
      if (fortGate) bits.push(`une porte fortifiée${GATE_ROOF_FR[st.gateRoof] || ''}${st.pont ? ' avec pont-levis' : ''}`);
      else if (st.gate) bits.push(`une porte en arche${st.pont ? ' avec pont-levis' : ''}`);
      if (ex.tents) bits.push(ex.tents === 1 ? 'une tente de chevalier' : `${numF(ex.tents)} tentes de chevaliers`);
      if (ex.well) bits.push('un puits dans la cour');
      if (ex.cart) bits.push(ex.cart === 'foin' ? 'une charrette de foin' : 'une charrette');
      if (ex.pavilions) bits.push(ex.pavilions === 1 ? 'un pavillon de tournoi' : `${numM(ex.pavilions)} pavillons de tournoi`);
      return { title, summary: sentence(bits) };
    },
  });

  // ================================================================ maisons
  /**
   * Toit à deux pans, faîtage le long de X, sur un bâtiment [x, x+len] × [z, z+wid]
   * dont le haut des murs est à y. Pignons en triangles équilatéraux (wid² chacun),
   * pans de carrés pleins inclinés à 60°. o : { name, start, end } (false = pas de pignon).
   */
  function gable(b, x, y, z, len, wid, kind, o) {
    const opt = o || {};
    const map = (a, yy, c) => [x + a, yy, z + c];
    const ends = [];
    if (opt.start !== false) ends.push(0);
    if (opt.end !== false) ends.push(len);
    const total = ends.length * wid * wid + 2 * len * wid;
    const split = total > 12;
    b.step(lab(opt.name, split ? 'pignons du toit' : 'toit à deux pans'));
    for (const a of ends) b.triGrid(map(a, y, 0), map(a, y, wid), map(a, y + wid * EQ_H, wid / 2), wid, 'EQ');
    for (const near of [true, false]) {
      if (split) b.step(lab(opt.name, near ? 'premier pan du toit' : 'second pan du toit'));
      for (let r = 0; r < wid; r++) {
        const y0 = y + r * EQ_H, y1 = y + (r + 1) * EQ_H;
        const c0 = near ? r * 0.5 : wid - r * 0.5;
        const c1 = near ? (r + 1) * 0.5 : wid - (r + 1) * 0.5;
        for (let k = 0; k < len; k++) b.quad(kind || 'SQ!', map(k, y0, c0), map(k + 1, y0, c0), map(k, y1, c1));
      }
    }
  }

  const WIN_KINDS = { carreaux: 'window', doubles: 'window2', cadres: 'frame' };
  /**
   * Maison len × wid (façade au sud sur la ligne z + wid) : porte en arche au
   * rez-de-chaussée, fenêtres en façade, fenêtres doubles aux étages, murs
   * pleins en carrés exacts ; toit 'deux-pans' (pans en carrés pleins) ou, pour
   * une maison 1×1, 'pyramide' / 'fleche'. o : { name, door, win, roof, gableEnd, dense, notes }
   * Renvoie le toit posé.
   */
  function house(b, x, z, len, wid, floors, o) {
    const win = o.win || 'window';
    const door = o.door == null ? Math.floor((len - 1) / 2) : o.door;
    for (let f = 0; f < floors; f++) {
      b.step(lab(o.name, f === 0 ? 'rez-de-chaussée' : f === 1 ? 'premier étage' : 'deuxième étage'));
      for (let i = 0; i < len; i++) wl(b, x + i, f, z + wid - 1, 'S', f === 0 && i === door ? 'arch' : win);
      for (let j = 0; j < wid; j++) wl(b, x + len - 1, f, z + wid - 1 - j, 'E', f > 0 || (o.dense && j === 0) ? 'window2' : 'SQ!');
      for (let i = len - 1; i >= 0; i--) wl(b, x + i, f, z, 'N', (f > 0 || o.dense) && (i + f) % 2 === 0 ? (o.dense ? 'frame' : 'window2') : 'SQ!');
      for (let j = 0; j < wid; j++) wl(b, x, f, z + j, 'W', f > 0 || (o.dense && j === wid - 1) ? 'window2' : 'SQ!');
    }
    const small = len === 1 && wid === 1;
    let roof = small ? o.roof || 'pyramide' : 'deux-pans';
    if (small) {
      const can = { fleche: b.stock.TT >= 4, pyramide: b.stock.EQ >= 4, 'deux-pans': b.stock.EQ >= 2 && b.stock.SQ >= 2 };
      if (!can[roof]) {
        const alt = ['pyramide', 'deux-pans', 'fleche'].find((r) => can[r]);
        if (alt) {
          if (o.notes) b.note(`${o.name || 'Maison'} : ${alt === 'deux-pans' ? 'toit à deux pans' : ROOF_FR[alt]} au lieu de ${roof === 'deux-pans' ? 'toit à deux pans' : ROOF_FR[roof]}, faute de pièces`);
          roof = alt;
        }
      }
    } else if (o.notes && o.roof && o.roof !== 'deux-pans') b.note('toit à deux pans : le toit pointu ou en flèche est réservé aux maisons 1×1');
    if (roof === 'pyramide' || roof === 'fleche') {
      b.step(lab(o.name, roof === 'fleche' ? 'toit pointu en flèche' : 'toit pointu'));
      b.pyramidRoof(x, floors, z, roof === 'fleche' ? 'TT' : 'EQ');
    } else gable(b, x, floors, z, len, wid, 'SQ!', { name: o.name, end: o.gableEnd });
    return roof;
  }

  /**
   * Appentis (abri en pente) contre un mur : carrés pleins inclinés à 45°
   * accrochés à l'arête horizontale y = 1 du mur, portés par deux triangles
   * rectangles posés au sol. P0 = début de l'arête (y = 1), e = direction du
   * mur, o = direction extérieure (vecteurs unitaires horizontaux), n = longueur.
   */
  function leanToAlong(b, P0, e, o, n, name) {
    const s = Math.SQRT1_2;
    b.step(lab(name, 'appentis'));
    for (let j = 0; j < n; j++) {
      const D = [P0[0] + e[0] * j, 1, P0[2] + e[2] * j];
      const A = [D[0] + o[0] * s, 1 - s, D[2] + o[2] * s];
      b.quad('SQ!', A, [A[0] + e[0], A[1], A[2] + e[2]], D);
    }
    for (const k of [0, n]) {
      const G = [P0[0] + e[0] * k, 0, P0[2] + e[2] * k];
      b.tri('RT', G, [G[0] + o[0], 0, G[2] + o[2]], [G[0], 1, G[2]]);
    }
  }
  /** Appentis contre un mur sur la ligne x = X (côté 'E' vers +X, 'W' vers −X), de z0 à z0 + n. */
  function leanTo(b, X, z0, n, side, name) {
    leanToAlong(b, [X, 1, z0], [0, 0, 1], [side === 'W' ? -1 : 1, 0, 0], n, name);
  }

  /** Clôture de jardin en demi-murs d'un seul type devant une façade (ligne z), profondeur depth. */
  function frontFence(b, x, z, len, depth, gate) {
    const segs = [];
    for (let j = 0; j < depth; j++) segs.push([x, z + j, 'W']);
    for (let i = 0; i < len; i++) if (i !== gate) segs.push([x + i, z + depth - 1, 'S']);
    for (let j = depth - 1; j >= 0; j--) segs.push([x + len - 1, z + j, 'E']);
    const kinds = fenceKinds(b, segs, 'CR');
    segs.forEach(([cx, cz, s], i) => b.halfWall(cx, 0, cz, s, kinds[i]));
  }

  /**
   * Arbre 1×1 : 'sapin' = cône de 4 grands triangles (sur un anneau de 4
   * demi-rectangles si trunk), 'buisson' = petite pyramide de 4 triangles au sol.
   * Sans grands triangles, un sapin devient un buisson. Renvoie ce qui a été posé.
   */
  function tree(b, x, z, kind, trunk, name, notes) {
    let k = kind;
    if (k === 'sapin' && b.stock.TT < 4) {
      k = b.stock.EQ >= 4 ? 'buisson' : null;
      if (notes) b.note(k ? 'buisson au lieu d’un sapin, faute de grands triangles' : 'arbre omis, faute de triangles');
    } else if (k === 'buisson' && b.stock.EQ < 4) {
      k = b.stock.TT >= 4 ? 'sapin' : null;
      if (notes) b.note(k ? 'sapin au lieu d’un buisson, faute de triangles' : 'arbre omis, faute de triangles');
    }
    if (!k) return null;
    b.step(name || (k === 'sapin' ? 'Sapin' : 'Buisson'));
    let y = 0;
    if (k === 'sapin' && trunk) {
      if (b.stock.HR >= 4) {
        // demi-rectangles exacts : le haut des créneaux n'a pas d'aimant pour porter le cône
        for (const s of SIDES4) b.halfWall(x, 0, z, s, 'HR!');
        y = HR_H;
      } else if (notes) b.note('sapin sans tronc, faute de demi-rectangles');
    }
    b.pyramidRoof(x, y, z, k === 'sapin' ? 'TT' : 'EQ');
    return k;
  }

  /** Puits 1×1 : margelle de demi-murs d'un seul type ; avec toit, deux cadres portent un petit toit à deux pans. */
  function well(b, x, z, roofed, name) {
    b.step(name || 'Puits');
    if (!roofed) {
      const k = uniformHalf(b, 4, 'HR');
      for (const s of SIDES4) b.halfWall(x, 0, z, s, k);
      return;
    }
    wl(b, x, 0, z, 'W', 'frame');
    wl(b, x, 0, z, 'E', 'frame');
    const k = uniformHalf(b, 2, 'HR');
    b.halfWall(x, 0, z, 'N', k);
    b.halfWall(x, 0, z, 'S', k);
    b.triGrid([x, 1, z], [x, 1, z + 1], [x, 1 + EQ_H, z + 0.5], 1, 'EQ');
    b.triGrid([x + 1, 1, z], [x + 1, 1, z + 1], [x + 1, 1 + EQ_H, z + 0.5], 1, 'EQ');
    b.quad('SQ!', [x, 1, z], [x + 1, 1, z], [x, 1 + EQ_H, z + 0.5]);
    b.quad('SQ!', [x, 1, z + 1], [x + 1, 1, z + 1], [x, 1 + EQ_H, z + 0.5]);
  }
  /** Puits couvert si possible, sinon simple margelle. Renvoie 'couvert' | 'margelle' | null. */
  function anyWell(b, cap, x, z, roofed, name) {
    if (roofed && attempt(b, cap, () => well(b, x, z, true, name))) return 'couvert';
    if (attempt(b, cap, () => well(b, x, z, false, name))) return 'margelle';
    return null;
  }

  // ------------------------------------------------------ modules des maisons
  MT.registerModule({
    id: 'maison',
    label: 'Maison',
    description:
      'Maison (emprise longueur × largeur ; +1 en x avec appentis, +2 en z avec jardin) : 1 à 3 niveaux, porte en arche et fenêtres ' +
      'au sud, toit à deux pans en carrés (4 carrés et 2 triangles par case) ; toit pointu ou en flèche pour une maison 1×1.',
    params: {
      longueur: { type: 'int', min: 1, max: 4, default: 2, label: 'Longueur (cases)' },
      largeur: { type: 'int', min: 1, max: 2, default: 1, label: 'Largeur (cases)' },
      etages: { type: 'int', min: 1, max: 3, default: 2, label: 'Niveaux' },
      fenetres: { type: 'enum', values: ['carreaux', 'doubles', 'cadres'], default: 'carreaux', label: 'Fenêtres' },
      toit: { type: 'enum', values: ['deux-pans', 'pyramide', 'fleche'], default: 'deux-pans', label: 'Toit (pointu ou flèche : 1×1)' },
      jardin: { type: 'bool', default: false, label: 'Jardin clôturé' },
      appentis: { type: 'bool', default: false, label: 'Appentis' },
    },
    footprint: (p) => ({ w: p.longueur + (p.appentis ? 1 : 0), d: p.largeur + (p.jardin ? 2 : 0) }),
    build(b, p) {
      const L = p.longueur, Wd = p.largeur;
      house(b, 0, 0, L, Wd, p.etages, { name: '', win: WIN_KINDS[p.fenetres], roof: p.toit, notes: true });
      if (p.appentis && !attempt(b, 0, () => leanTo(b, L, 0, Wd, 'E', ''))) b.note('appentis omis, faute de pièces');
      if (p.jardin) {
        const ok = attempt(b, 0, () => {
          b.step('Clôture du jardin');
          frontFence(b, 0, Wd, L, 2, L >= 2 ? Math.floor((L - 1) / 2) : -1);
        });
        if (!ok) b.note('jardin omis, faute de demi-rectangles');
      }
    },
  });

  MT.registerModule({
    id: 'maisonnette',
    label: 'Maisonnette',
    description:
      'Maisonnette 1×1 (emprise 1×1) : porte en arche au sud, 1 ou 2 niveaux, toit pointu (4 triangles), en flèche (4 grands triangles) ou à deux pans.',
    params: {
      etages: { type: 'int', min: 1, max: 2, default: 1, label: 'Niveaux' },
      toit: { type: 'enum', values: ['pyramide', 'fleche', 'deux-pans'], default: 'pyramide', label: 'Toit' },
    },
    footprint: () => ({ w: 1, d: 1 }),
    build(b, p) {
      house(b, 0, 0, 1, 1, p.etages, { name: '', roof: p.toit, win: 'frame', notes: true });
    },
  });

  MT.registerModule({
    id: 'puits',
    label: 'Puits',
    description: 'Puits 1×1 (emprise 1×1) : margelle de 4 demi-rectangles ; avec toit, deux cadres portent un petit toit à deux pans (2 triangles, 2 carrés).',
    params: { toit: { type: 'bool', default: true, label: 'Toit' } },
    footprint: () => ({ w: 1, d: 1 }),
    build(b, p) {
      if (anyWell(b, 0, 0, 0, p.toit, 'Puits') === 'margelle' && p.toit) b.note('puits sans toit, faute de pièces');
    },
  });

  MT.registerModule({
    id: 'arbre',
    label: 'Arbre',
    description:
      'Arbre 1×1 (emprise 1×1) : sapin (cône de 4 grands triangles, posé sur un petit tronc de 4 demi-rectangles si tronc) ' +
      'ou buisson bas (pyramide de 4 triangles). Sans grands triangles, le sapin devient un buisson.',
    params: {
      feuillage: { type: 'enum', values: ['sapin', 'buisson'], default: 'sapin', label: 'Feuillage' },
      tronc: { type: 'bool', default: true, label: 'Tronc (sapin)' },
    },
    footprint: () => ({ w: 1, d: 1 }),
    build(b, p) {
      tree(b, 0, 0, p.feuillage, p.tronc, p.feuillage === 'sapin' ? 'Sapin' : 'Buisson', true);
    },
  });

  // ------------------------------------------------------ thème Maison & village
  const HOUSE_TYPES = {
    maison: { len: 2, wid: 1, floors: 2, label: 'Maison', desc: 'une maison à étage' },
    longere: { len: 3, wid: 1, floors: 1, label: 'Longère', desc: 'une longère' },
    chaumiere: { len: 2, wid: 2, floors: 1, label: 'Chaumière', desc: 'une chaumière' },
    grande: { len: 2, wid: 2, floors: 2, label: 'Grande maison', desc: 'une grande maison à étage' },
    manoir: { len: 3, wid: 2, floors: 2, label: 'Manoir', desc: 'un manoir à étage' },
    haute: { len: 3, wid: 1, floors: 2, label: 'Maison haute', desc: 'une maison haute' },
    maisonnette: { len: 1, wid: 1, floors: 1, label: 'Maisonnette', desc: 'une maisonnette', roof: 'pyramide' },
    tourelle: { len: 1, wid: 1, floors: 2, label: 'Maisonnette à tourelle', desc: 'une maisonnette à tourelle', roof: 'fleche' },
  };
  function houseStyle(rng) {
    return { win: rng.pick(['window', 'window', 'window2', 'frame']) };
  }
  /** Maison optionnelle : essai normal, puis avec plus de fenêtres (moins de carrés pleins). */
  function tryHouse(b, cap, fn) {
    return attempt(b, cap, () => fn(false)) || attempt(b, cap, () => fn(true));
  }

  // Grille d'occupation des cellules (maisons, arbres, puits…).
  function makeLot() {
    const cells = new Set();
    const k = (x, z) => `${x},${z}`;
    const lot = {
      mark(x, z, w, d) {
        for (let i = 0; i < Math.ceil(w); i++) for (let j = 0; j < Math.ceil(d); j++) cells.add(k(Math.floor(x) + i, Math.floor(z) + j));
      },
      has: (x, z) => cells.has(k(x, z)),
      /** Rectangle libre, entouré d'une marge de `margin` cases libres. */
      free(x, z, w, d, margin) {
        const m = margin == null ? 1 : margin;
        for (let i = -m; i < w + m; i++) for (let j = -m; j < d + m; j++) if (cells.has(k(x + i, z + j))) return false;
        return true;
      },
      // cellule libre dont aucun voisin direct n'est occupé (aucun mur partagé)
      alone(x, z) {
        return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => !cells.has(k(x + dx, z + dz)));
      },
    };
    return lot;
  }

  /** Petits objets 1×1 (arbres, puits…) sur des cellules isolées, tant que le stock le permet. */
  function scatter(b, cap, lot, spots, n, make) {
    let made = 0;
    for (const [x, z] of spots) {
      if (made >= n) break;
      if (!lot.alone(x, z)) continue;
      let ok = false;
      if (attempt(b, cap, () => {
        ok = !!make(x, z, made);
      }) && ok) {
        lot.mark(x, z, 1, 1);
        made++;
      }
    }
    return made;
  }
  /** Arbres : sapins (grands triangles) et buissons (triangles) ; compte séparé pour le résumé. */
  function plantTrees(b, rng, cap, lot, spots, n, sapinShare) {
    const res = { sapins: 0, buissons: 0 };
    scatter(b, cap, lot, spots, n, (x, z) => {
      const want = rng.chance(sapinShare == null ? 0.6 : sapinShare) ? 'sapin' : 'buisson';
      const k = tree(b, x, z, want, rng.chance(0.6), null, false);
      if (k === 'sapin') res.sapins++;
      else if (k === 'buisson') res.buissons++;
      return k;
    });
    return res;
  }
  function treeText(t) {
    const out = [];
    if (t.sapins) out.push(t.sapins === 1 ? 'un sapin' : `${numM(t.sapins)} sapins`);
    if (t.buissons) out.push(t.buissons === 1 ? 'un buisson' : `${numM(t.buissons)} buissons`);
    return out;
  }

  /**
   * Village : une rue (z ∈ [2, 5[) bordée de maisons au nord (façade sur z = 2)
   * et au sud (façade sur z = 5, tournées vers la rue), puits au milieu de la
   * rue, arbres et potager clôturé.
   * spec : { north, south, church, churchAt, southStart, extraSouth, trees, wells, potager, core (nombre de maisons obligatoires) }
   */
  function buildVillage(b, rng, cap, spec) {
    const lot = makeLot();
    const name = namer();
    const out = { houses: [], church: false, trees: { sapins: 0, buissons: 0 }, wells: 0, potager: false };
    let built = 0;
    const place = (x, z, rot, t, fallback) => {
      for (const u of [t, ...(fallback || [])]) {
        const T = HOUSE_TYPES[u];
        const nm = name(T.label);
        const st = houseStyle(rng);
        const make = (dense) => b.at({ x, z: rot ? z : z - T.wid + 1, rot, w: T.len, d: T.wid }, () =>
          house(b, 0, 0, T.len, T.wid, T.floors, Object.assign({ name: nm, roof: T.roof, dense }, st)));
        // maisons obligatoires : essai normal, puis avec plus de fenêtres, puis sans filet
        let ok = tryHouse(b, cap, make);
        if (!ok && built < (spec.core || 0)) {
          make(true);
          ok = true;
        }
        if (ok) {
          lot.mark(x, rot ? z : z - T.wid + 1, T.len, T.wid);
          out.houses.push(u);
          built++;
          return T.len;
        }
      }
      return 0;
    };
    // les maisons laissent de côté quelques triangles pour les arbres (spec.reserve)
    const took = {};
    for (const [t, n] of Object.entries(spec.reserve || {})) {
      took[t] = Math.max(0, Math.min(n, b.stock[t]));
      b.stock[t] -= took[t];
    }
    // rangée nord (façades sur la ligne z = 2), avec l'église éventuelle
    let cx = 0;
    const north = spec.north.slice();
    // l'église (posée sans filet) passe avant les maisons optionnelles
    if (spec.church) north.splice(spec.churchAt == null ? rng.int(0, Math.min(1, north.length)) : spec.churchAt, 0, 'eglise');
    for (const t of north) {
      if (t === 'eglise') {
        const tl = rng.int(3, 4);
        b.at({ x: cx, z: 1, rot: 0, w: 4, d: 1 }, () => {
          house(b, 0, 0, 3, 1, 1, { name: 'Église', win: 'frame', door: 1, gableEnd: false });
          towerWalls(b, 3, 0, 0, tl, { name: 'Clocher', door: 'S', slits: ['S', 'E'], occ: null });
          const [r] = planRoofs(b, [{ big: false, want: 'fleche', n: 1, order: ['fleche', 'pyramide', 'plat'] }], false);
          if (r) {
            b.step(`Clocher — ${ROOF1[r].label}`);
            roof1(b, 3, tl, 0, r, null);
          }
          out.churchRoof = r;
        });
        lot.mark(cx, 1, 4, 1);
        out.church = true;
        cx += 5;
        continue;
      }
      const w = place(cx, 1, 0, t, ['maisonnette']);
      if (w) cx += w + 1;
    }
    const northEnd = cx - 1;
    // rangée sud, décalée, tournée vers la rue
    let sx = spec.southStart == null ? rng.int(0, 1) : spec.southStart;
    for (const t of spec.south) {
      const w = place(sx, 5, 180, t, ['maisonnette']);
      if (w) sx += w + 1;
    }
    for (const t of spec.extraSouth || []) {
      if (sx + HOUSE_TYPES[t].len > northEnd + 1) break;
      const w = place(sx, 5, 180, t);
      if (w) sx += w + 1;
    }
    for (const [t, k] of Object.entries(took)) b.stock[t] += k;
    const maxX = Math.max(northEnd, sx - 1, 2);
    // puits au milieu de la rue
    const mid = Math.floor(maxX / 2);
    const wellSpots = [[mid, 3], [mid + 1, 3], [mid - 1, 3], [mid + 2, 3], [mid - 2, 3], [1, 3], [maxX - 1, 3]];
    for (const [x, z] of wellSpots) {
      if (out.wells >= (spec.wells || 0)) break;
      if (!lot.alone(x, z) || !lot.free(x, z, 1, 1, 1)) continue;
      if (anyWell(b, cap, x, z, true, out.wells ? 'Second puits' : 'Puits de la place')) {
        lot.mark(x, z, 1, 1);
        out.wells++;
      }
    }
    // potager clôturé à l'ouest de la rue : clôture d'un seul type et rangs de légumes
    if (spec.potager) {
      out.potager = attempt(b, cap, () => {
        b.step('Potager clôturé');
        const segs = [];
        for (let i = 0; i < 2; i++) segs.push([-3 + i, 2, 'N'], [-3 + i, 3, 'S']);
        for (let j = 0; j < 2; j++) segs.push([-2, 2 + j, 'E'], [-3, 2 + j, 'W']);
        const kinds = fenceKinds(b, segs, 'HR');
        segs.forEach(([x, z, s], i) => b.halfWall(x, 0, z, s, kinds[i]));
        if (b.stock.EQ >= 4) b.pyramidRoof(rng.int(-3, -2), 0, rng.int(2, 3), 'EQ');
      });
      if (out.potager) lot.mark(-3, 2, 2, 2);
    }
    // arbres le long de la rue, puis aux deux bouts
    if (spec.trees) {
      const edge = [];
      for (let x = -1; x <= maxX + 1; x++) edge.push([x, 2], [x, 4]);
      const ends = [[-1, 0], [-2, 1], [maxX + 2, 1], [maxX + 2, 3], [maxX + 1, 6], [-1, 6], [-2, 5], [maxX + 3, 5],
        [-4, 0], [maxX + 3, 0], [-4, 5], [maxX + 4, 3], [-5, 3], [maxX + 1, -1], [2, -1]];
      out.trees = plantTrees(b, rng, cap, lot, rng.shuffle(edge).concat(rng.shuffle(ends)), spec.trees, 0.5);
    }
    out.maxX = maxX;
    return out;
  }

  MT.registerTheme({
    id: 'maison',
    name: 'Maison & village',
    emoji: '🏠',
    tagline: 'Maisons à toit pointu, jardins, puits et place du village',
    keywords: [
      'maison', 'village', 'hameau', 'bourg', 'jardin', 'chaumiere', 'maisonnette', 'cottage', 'villa', 'manoir', 'famille',
      'habitation', 'puits', 'eglise', 'chapelle', 'cathedrale', 'clocher', 'mairie', 'niche', 'potager', 'barriere',
      'maison de poupee', 'lutins', 'schtroumpfs', 'hobbit', 'trois petits cochons', 'hansel et gretel', 'boucle d or',
      'maison du pere noel', 'grand mere', 'chaperon rouge', 'barbie', 'lotissement',
    ],
    generate(b, { size, packs, rng }) {
      const cap = CAPS[size];
      warmUp(rng);
      if (size <= 2) {
        // --- une maison et son jardin
        const pool = size === 1 ? ['maison', 'longere', 'chaumiere', 'haute'] : ['grande', 'manoir', 'haute', 'maison'];
        const t = rng.pick(pool);
        const T = HOUSE_TYPES[t];
        const st = houseStyle(rng);
        const door = rng.int(0, T.len - 1);
        const lot = makeLot();
        house(b, 0, 0, T.len, T.wid, T.floors, Object.assign({ name: T.label, door }, st));
        lot.mark(0, 0, T.len, T.wid);
        const extras = [];
        const side = size >= 2 && attempt(b, cap, () => leanTo(b, T.len, 0, T.wid, 'E', T.label));
        if (side) {
          lot.mark(T.len, 0, 1, T.wid);
          extras.push('un appentis');
        }
        const garden = attempt(b, cap, () => {
          b.step('Clôture du jardin');
          frontFence(b, 0, T.wid, T.len, 2, door);
        });
        if (garden) {
          lot.mark(0, T.wid, T.len, 2);
          extras.push('un jardin clôturé');
        }
        let shed = false;
        const east = T.len + (side ? 2 : 1);
        if (size >= 2) {
          shed = attempt(b, cap, () =>
            house(b, east, 0, 1, 1, rng.int(1, 2), { name: 'Cabane de jardin', roof: rng.pick(['pyramide', 'deux-pans']), win: 'frame' }));
          if (shed) {
            lot.mark(east, 0, 1, 1);
            extras.push('une cabane de jardin');
          }
          const wx = shed ? east + 2 : east;
          const w = lot.alone(wx, T.wid + 1) ? anyWell(b, cap, wx, T.wid + 1, rng.chance(0.7), 'Puits') : null;
          if (w) {
            lot.mark(wx, T.wid + 1, 1, 1);
            extras.push(w === 'couvert' ? 'un puits couvert' : 'un puits');
          }
        }
        // bosquet de sapins aux coins arrière de la maison, haie de buissons le long du jardin
        const trees = { sapins: 0, buissons: 0 };
        const grove = rng.shuffle([[-2, -1], [-2, 0], [T.len + 2, -1], [T.len + 1, -2], [-1, -2], [T.len + 3, -1]]);
        for (const [x, z] of grove) {
          if (trees.sapins + trees.buissons >= (size === 1 ? 1 : 2)) break;
          if (!lot.free(x, z, 1, 1, 1)) continue;
          let k = null;
          if (attempt(b, cap, () => {
            k = tree(b, x, z, 'sapin', rng.chance(0.7), trees.sapins ? 'Second sapin' : 'Sapin');
          }) && k) {
            lot.mark(x, z, 1, 1);
            if (k === 'sapin') trees.sapins++;
            else trees.buissons++;
          }
        }
        if (garden && size >= 2) {
          // haie : buissons collés au côté ouest de la clôture
          for (let j = 0; j < 2; j++) {
            let k = null;
            if (attempt(b, cap, () => {
              k = tree(b, -1, T.wid + j, 'buisson', false, j ? 'Haie (suite)' : 'Haie de buissons');
            }) && k) trees.buissons++;
          }
        }
        extras.push(...treeText(trees));
        return {
          title: garden ? `${T.label} et son jardin` : T.label,
          summary: sentence([`${T.desc} avec porte en arche et fenêtres`, ...extras]),
        };
      }

      // --- village
      const big = size >= 4;
      const northPool = ['maison', 'longere', 'chaumiere', 'grande', 'haute', ...(big ? ['manoir'] : [])];
      const southPool = ['maison', 'longere', 'maisonnette', 'tourelle', 'haute'];
      const north = range(0, big ? 4 : rng.int(2, 3)).map(() => rng.pick(northPool));
      const south = range(0, big ? 3 : rng.int(1, 2)).map(() => rng.pick(southPool));
      const v = buildVillage(b, rng, cap, {
        north, south, church: big, extraSouth: big ? ['maisonnette', 'tourelle'] : [rng.pick(['maisonnette', 'tourelle', 'maison'])],
        trees: big ? 8 : 4, wells: big ? 2 : 1, potager: true, core: big && packs === 1 ? 4 : big ? 3 : 1,
        reserve: big ? { TT: 8, EQ: 12 } : { TT: 4, EQ: 4 },
      });
      const n = v.houses.length;
      const bits = [`${n === 1 ? 'une maison' : `${numF(n)} maisons`} de part et d’autre d’une rue`];
      if (v.church) bits.push(v.churchRoof === 'fleche' ? 'une église à clocher pointu' : 'une église et son clocher');
      if (v.wells) bits.push(v.wells === 1 ? 'un puits sur la place' : `${numM(v.wells)} puits`);
      bits.push(...treeText(v.trees));
      if (v.potager) bits.push('un potager clôturé');
      return {
        title: v.church ? `Village et son église (${numF(n)} maisons)` : n <= 3 ? `Hameau de ${numF(n)} maisons` : `Village de ${numF(n)} maisons`,
        summary: sentence(bits),
      };
    },
  });

  // ================================================================== ferme
  /**
   * Grange de largeur 2 et de profondeur len (cellules [x, x+2[ × [z, z+len[) :
   * grandes portes doubles en arche sur le pignon sud, toit à deux pans nord-sud
   * en carrés pleins, `floors` niveaux (le second = fenil, porte de chargement en cadre).
   * o : { name, win, loft (0|1), backDoor (0|1|-1), leanTo ('E'|'W'|null) }
   */
  function barn(b, x, z, len, floors, o) {
    const name = o.name || 'Grange';
    const win = o.win || 'window2';
    // Repère local tourné de 270° : faîtage le long de X local, pignon avant en X = len (monde : sud),
    // côté local z = 0 → monde : est, côté local z = 2 → monde : ouest.
    b.at({ x, z, rot: 270, w: len, d: 2 }, () => {
      for (let f = 0; f < floors; f++) {
        b.step(lab(name, f === 0 ? 'rez-de-chaussée et grandes portes' : 'fenil'));
        for (let j = 0; j < 2; j++) wl(b, len - 1, f, j, 'E', f === 0 ? 'arch' : j === (o.loft || 0) ? 'frame' : 'SQ!');
        for (let i = len - 1; i >= 0; i--) wl(b, i, f, 1, 'S', i === Math.floor(len / 2) ? win : 'SQ!');
        for (let j = 1; j >= 0; j--) wl(b, 0, f, j, 'W', f === 0 && j === o.backDoor ? 'arch' : 'SQ!');
        for (let i = 0; i < len; i++) wl(b, i, f, 0, 'N', i === Math.floor((len - 1) / 2) ? win : 'SQ!');
      }
      gable(b, 0, floors, 0, len, 2, 'SQ!', { name });
      if (o.leanTo) barnLeanTo(b, len, o.leanTo, name);
    });
  }
  /** Appentis contre un long côté de la grange (à appeler dans le repère local de barn). */
  function barnLeanTo(b, len, side, name) {
    if (side === 'W') leanToAlong(b, [0, 1, 2], [1, 0, 0], [0, 0, 1], len, name);
    else leanToAlong(b, [0, 1, 0], [1, 0, 0], [0, 0, -1], len, name);
  }

  /** Silo : tour 1×1 de carrés pleins, lucarne au dernier niveau (sud), toit pointu ou en flèche. */
  function silo(b, x, z, levels, roof, name, notes) {
    for (let l = 0; l < levels; l++) {
      if (l % 2 === 0) b.step(lab(name, lvLabel(l, Math.min(levels, l + 2))));
      for (const s of SIDES4) wl(b, x, l, z, s, l === levels - 1 && s === 'S' ? 'window2' : 'SQ!');
    }
    const want = roof || 'pyramide';
    const [r] = planRoofs(b, [{ big: false, want, n: 1, order: want === 'fleche' ? ['fleche', 'pyramide', 'plat'] : ['pyramide', 'fleche', 'plat'] }], false);
    if (notes) roofNote(b, name || 'Silo', want, r);
    if (r) {
      b.step(lab(name, ROOF1[r].label));
      roof1(b, x, levels, z, r, null);
    }
    return r;
  }

  /** Segments d'un périmètre w × d (sans le côté sud de la case gate) : [cx, cz, side]. */
  function perimeter(x, z, w, d, gate) {
    const segs = [];
    for (let i = 0; i < w; i++) segs.push([x + i, z, 'N']);
    for (let j = 0; j < d; j++) segs.push([x + w - 1, z + j, 'E']);
    for (let i = w - 1; i >= 0; i--) if (i !== gate) segs.push([x + i, z + d - 1, 'S']);
    for (let j = d - 1; j >= 0; j--) segs.push([x, z + j, 'W']);
    return segs;
  }
  /**
   * Clôture de triangles rectangles : autour du périmètre, les cases sont
   * groupées deux par deux et chaque paire forme un « pignon » de deux triangles
   * debout, dos à dos, qui partagent leur côté vertical (poteau). Portillon :
   * une paire du côté sud est retirée (ouverture de 2 cases). Renvoie le nombre de pièces.
   */
  function rtFence(b, x, z, w, d, gate, name) {
    const cyc = [];
    for (let i = 0; i < w; i++) cyc.push([[x + i, z], [x + i + 1, z]]);
    for (let j = 0; j < d; j++) cyc.push([[x + w, z + j], [x + w, z + j + 1]]);
    for (let i = w; i > 0; i--) cyc.push([[x + i, z + d], [x + i - 1, z + d]]);
    for (let j = d; j > 0; j--) cyc.push([[x, z + j], [x, z + j - 1]]);
    const P = cyc.length;
    let off = 0, skip = -1;
    if (gate >= 0) {
      const c = Math.max(1, Math.min(w - 1, gate));
      skip = w + d + (w - 1 - c);
      off = skip % 2;
    }
    const pairs = [];
    for (let k = off; k < P + off; k += 2) if (k !== skip) pairs.push([cyc[k % P], cyc[(k + 1) % P]]);
    chunks(pairs, 6).forEach((part, i) => {
      b.step(lab(name, i ? 'clôture (suite)' : 'clôture'));
      for (const [s1, s2] of part) {
        const post = s1[1];
        const A = [post[0], 0, post[1]], top = [post[0], 1, post[1]];
        b.tri('RT', A, [s1[0][0], 0, s1[0][1]], top);
        b.tri('RT', A, [s2[1][0], 0, s2[1][1]], top);
      }
    });
    return pairs.length * 2;
  }
  /**
   * Enclos w × d. o : { name, gate (case du portillon au sud, −1 = aucun),
   * fence: 'demi' | 'triangles' | 'cadres', shelter: false | 'centre' | 'fond' }.
   */
  function pen(b, x, z, w, d, o) {
    const fence = o.fence || 'demi';
    if (fence === 'triangles') rtFence(b, x, z, w, d, o.gate, o.name);
    else {
      const segs = perimeter(x, z, w, d, o.gate);
      const kinds = fence === 'cadres' ? segs.map(() => 'frame') : fenceKinds(b, segs, 'CR');
      const parts = chunks(segs.map((s, i) => [s, kinds[i]]), 10);
      parts.forEach((part, k) => {
        b.step(lab(o.name, `clôture${parts.length > 1 ? ` (${k + 1}/${parts.length})` : ''}`));
        for (const [[cx, cz, s], kind] of part) {
          if (fence === 'cadres') b.wall(cx, 0, cz, s, kind);
          else b.halfWall(cx, 0, cz, s, kind);
        }
      });
    }
    if (o.shelter) shelter(b, x + (w - 1) / 2, o.shelter === 'fond' ? z + 0.3 : z + (d - Math.SQRT2) / 2, lab(o.name, 'abri des animaux'));
  }
  /** Abri en A (2 carrés pleins, pignons en triangles rectangles), emprise 1 × 1,41 à partir de (x, z). */
  function shelter(b, x, z, name) {
    b.step(name);
    b.aFrame(x, 0, z, 1, 'x', { kind: 'SQ!' });
  }

  /** Tracteur sur plateau à roues (capot à l'ouest, cabine à l'est). */
  function tractor(b, x, z, o) {
    const name = o.name || 'Tracteur';
    const y = CAR.top;
    b.step(lab(name, 'plateau à roues et capot'));
    b.car(x, z, 'x');
    // capot bas en demi-rectangles exacts (le haut des créneaux n'a pas d'aimant), sinon capot carré
    const hood = b.stock.HR >= 3 ? HR_H : 1;
    for (const s of ['N', 'W', 'S']) {
      if (hood < 1) b.halfWall(x, y, z, s, 'HR!');
      else wl(b, x, y, z, s, 'SQ!');
    }
    b.floor(x, y + hood, z, 'SQ!');
    b.step(lab(name, 'cabine'));
    wl(b, x + 1, y, z, 'W', 'window');
    wl(b, x + 1, y, z, 'N', 'window2');
    wl(b, x + 1, y, z, 'E', 'SQ!');
    wl(b, x + 1, y, z, 'S', 'window2');
    b.floor(x + 1, y + 1, z, 'SQ!');
  }
  /** Remorque attelée derrière le tracteur (vers l'est) : ridelles en demi-rectangles ou chargement de foin. */
  function trailer(b, x, z, name, load) {
    const tx = x + 2 + 2 * CAR.hitch;
    b.step(lab(name, load === 'foin' ? 'remorque de foin' : 'remorque à ridelles'));
    b.car(tx, z, 'x');
    if (load === 'foin') {
      b.pyramidRoof(tx, CAR.top, z, 'EQ');
      b.pyramidRoof(tx + 1, CAR.top, z, 'EQ');
    } else {
      const segs = [[tx, z, 'N'], [tx + 1, z, 'N'], [tx + 1, z, 'E'], [tx + 1, z, 'S'], [tx, z, 'S'], [tx, z, 'W']];
      const kinds = fenceKinds(b, segs, 'HR');
      segs.forEach(([cx, cz, s], i) => b.halfWall(cx, CAR.top, cz, s, kinds[i]));
    }
  }

  /**
   * Moulin à vent, emprise 5 × 2 : tour 1×1 en (x+2, z), toit pointu ; au
   * dernier niveau, un caisson en saillie vers le sud (plancher porté par deux
   * consoles en triangles rectangles, deux joues, façade en cadre = moyeu) tient
   * le moyeu par trois bords ; quatre ailes en grands triangles s'y accrochent.
   * door : côté de la porte en arche ('W' ou 'E').
   */
  function windmill(b, x, z, levels, name, door) {
    const tx = x + 2;
    for (let l = 0; l < levels; l++) {
      if (l % 2 === 0) b.step(lab(name, lvLabel(l, Math.min(levels, l + 2))));
      const back = door === 'E' ? 'W' : 'E';
      for (const s of SIDES4) {
        let k = 'SQ!';
        if (l === 0) k = s === (door || 'W') ? 'arch' : 'SQ!';
        else if ((s === back && l % 2 === 1) || (s === (door || 'W') && l % 2 === 0) || (s === 'N' && l === levels - 1)) k = 'window2';
        wl(b, tx, l, z, s, k);
      }
    }
    const [r] = planRoofs(b, [{ big: false, want: 'pyramide', n: 1, order: ['pyramide', 'fleche', 'plat'] }], false);
    if (r) {
      b.step(lab(name, ROOF1[r].label));
      roof1(b, tx, levels, z, r, null);
    }
    const y = levels - 1, zf = z + 1, zs = z + 2;
    b.step(lab(name, 'caisson du moyeu'));
    b.floor(tx, y, zf, 'SQ!');
    b.tri('RT', [tx, y, zf], [tx, y - 1, zf], [tx, y, zs]);
    b.tri('RT', [tx + 1, y, zf], [tx + 1, y - 1, zf], [tx + 1, y, zs]);
    wl(b, tx, y, zf, 'W', 'SQ!');
    wl(b, tx, y, zf, 'E', 'SQ!');
    wl(b, tx, y, zf, 'S', 'frame');
    b.step(lab(name, 'ailes'));
    b.tri('TT', [tx, y + 1, zs], [tx + 1, y + 1, zs], [tx + 0.5, y + 1 + TT_H, zs]);
    b.tri('TT', [tx + 1, y, zs], [tx + 1, y + 1, zs], [tx + 1 + TT_H, y + 0.5, zs]);
    b.tri('TT', [tx + 1, y, zs], [tx, y, zs], [tx + 0.5, y - TT_H, zs]);
    b.tri('TT', [tx, y + 1, zs], [tx, y, zs], [tx - TT_H, y + 0.5, zs]);
  }

  // ================================================================= animaux
  const SPECIES = ['cheval', 'vache', 'lion', 'girafe', 'dragon'];
  const SPECIES_FR = { cheval: 'Cheval', vache: 'Vache', lion: 'Lion', girafe: 'Girafe', dragon: 'Dragon' };
  const SPECIES_ART = { cheval: 'un cheval', vache: 'une vache', lion: 'un lion', girafe: 'une girafe', dragon: 'un dragon' };
  const SPECIES_PL = { cheval: ['chevaux', false], vache: ['vaches', true], lion: ['lions', false], girafe: ['girafes', true], dragon: ['dragons', false] };
  /** « un cheval et deux vaches » : animaux regroupés par espèce. */
  function animalsText(list) {
    const n = {};
    for (const sp of list) n[sp] = (n[sp] || 0) + 1;
    return joinFr(Object.entries(n).map(([sp, k]) => (k === 1 ? SPECIES_ART[sp] : `${SPECIES_PL[sp][1] ? numF(k) : numM(k)} ${SPECIES_PL[sp][0]}`)));
  }
  const SPECIES_DETAIL = {
    cheval: 'museau, oreilles et queue', vache: 'cornes et queue', lion: 'crinière, museau et queue',
    girafe: 'museau et cornes', dragon: 'gueule, cornes, ailes, crête et queue',
  };
  /**
   * Animal stylisé, tête vers −X, dans l'emprise [0, 5] × [0, 1] : museau
   * x ∈ [0, 1], corps x ∈ [1, 4] (boîte de carrés : flancs, bouts et dos),
   * queue x ∈ [4, 5]. Quatre pattes (demi-rectangles pour la taille 1, carrés
   * pour la taille 2) sous la première et la dernière case du corps, côtés nord
   * et sud ; cou et tête en colonne au-dessus de l'avant. Les détails (museau,
   * oreilles, crinière, ailes, queue) sont omis ou remplacés s'il manque des
   * pièces, avec une note.
   */
  function animal(b, sp, taille, name, notes) {
    const nm = name || SPECIES_FR[sp];
    const note = (t) => {
      if (notes) b.note(`${nm} : ${t}`);
    };
    let legs = taille >= 2 ? 'solid' : 'HR!';
    if (legs === 'HR!' && b.stock.HR < 4) {
      legs = 'solid';
      note('pattes en carrés, faute de demi-rectangles');
    }
    const yb = legs === 'HR!' ? HR_H : 1;
    const skin = sp === 'vache' || sp === 'girafe' ? 'window' : 'solid'; // robe tachetée : carrés à fenêtres
    const y1 = yb + 1;
    b.step(lab(nm, 'pattes et corps'));
    for (const cx of [1, 3]) for (const s of ['N', 'S']) b.wall(cx, 0, 0, s, legs);
    for (let cx = 1; cx <= 3; cx++) {
      b.wall(cx, yb, 0, 'N', skin);
      b.wall(cx, yb, 0, 'S', skin);
    }
    b.wall(1, yb, 0, 'W', skin);
    b.wall(3, yb, 0, 'E', skin);
    b.step(lab(nm, sp === 'girafe' ? 'dos et long cou' : 'dos et tête'));
    for (let cx = 1; cx <= 3; cx++) b.floor(cx, y1, 0, 'floor');
    let top;
    if (sp === 'vache') {
      // tête basse : trois demi-murs sous un carré
      const hk = b.stock.HR >= 3 ? 'HR!' : 'solid';
      for (const s of ['N', 'S', 'W']) b.wall(1, y1, 0, s, hk);
      top = y1 + (hk === 'HR!' ? HR_H : 1);
    } else {
      const lv = sp === 'girafe' ? (taille >= 2 ? 3 : 2) : 1;
      for (let l = 0; l < lv; l++) for (const s of ['N', 'S', 'W']) b.wall(1, y1 + l, 0, s, sp === 'girafe' ? 'window' : 'solid');
      top = y1 + lv;
    }
    b.floor(1, top, 0, 'floor');
    b.step(lab(nm, SPECIES_DETAIL[sp]));
    const zs = [0, 1];
    // museau (ou gueule) : deux triangles rectangles prolongent les flancs de la tête vers l'avant
    if (sp !== 'vache') {
      if (b.stock.RT >= 2) for (const zz of zs) b.tri('RT', [1, top, zz], [0, top, zz], [1, top - 1, zz]);
      else note('sans museau, faute de triangles rectangles');
    }
    // crinière du lion : créneaux autour du haut de la tête ; sinon oreilles ou cornes en triangles
    if (sp === 'lion' && b.stock.CR >= 3) for (const s of ['N', 'S', 'W']) b.wall(1, top, 0, s, 'CR!');
    else {
      if (sp === 'lion') note('crinière en triangles, faute de créneaux');
      if (b.stock.EQ >= 2) for (const zz of zs) b.tri('EQ', [1, top, zz], [2, top, zz], [1.5, top + EQ_H, zz]);
      else note('sans oreilles ni cornes, faute de triangles');
    }
    if (sp === 'dragon') {
      // ailes : grands triangles debout sur les bords du dos ; crête de créneaux sur l'arrière
      const wing = b.stock.TT >= 2 ? 'TT' : b.stock.EQ >= 2 ? 'EQ' : null;
      if (wing !== 'TT') note(wing ? 'petites ailes, faute de grands triangles' : 'sans ailes, faute de triangles');
      if (wing) for (const zz of zs) b.tri(wing, [2, y1, zz], [3, y1, zz], [2.5, y1 + (wing === 'TT' ? TT_H : EQ_H), zz]);
      if (b.stock.CR >= 2) {
        b.wall(3, y1, 0, 'N', 'CR!');
        b.wall(3, y1, 0, 'S', 'CR!');
      } else note('sans crête, faute de créneaux');
    }
    // queue : triangle(s) rectangle(s) prolongeant les flancs vers l'arrière
    const tails = sp === 'dragon' ? zs : sp === 'girafe' ? [] : [1];
    if (tails.length) {
      if (b.stock.RT >= tails.length) for (const zz of tails) b.tri('RT', [4, yb, zz], [5, yb, zz], [4, yb + 1, zz]);
      else note('sans queue, faute de triangles rectangles');
    }
  }
  /*
   * Paramètres d'espèce : type 'espece' (et non 'enum'), pour que la réduction
   * automatique de MT.compose ne change jamais un lion en dragon ; la valeur est
   * normalisée ici (accents, casse), l'espèce inconnue retombe sur la valeur par défaut.
   */
  const speciesOf = (v, dflt) => {
    const f = v == null ? '' : MT.fold(v);
    return SPECIES.find((sp) => sp === f) || (f === 'aucun' || f === 'aucune' || f === 'non' || f === 'false' ? null : dflt);
  };
  const SPECIES_LIST_FR = 'cheval, vache, lion, girafe ou dragon';

  /** Animal posé dans le repère courant en (x, z), tête vers −X (rot 0) ou +X (rot 180). */
  function placeAnimal(b, x, z, sp, taille, rot, name) {
    b.at({ x, z, rot: rot || 0, w: 5, d: 1 }, () => animal(b, sp, taille, name, false));
  }

  MT.registerModule({
    id: 'animal',
    label: 'Animal',
    description:
      'Animal stylisé (emprise 5×1, tête vers l’ouest −x), ≈ 25 pièces : corps de carrés sur 4 pattes (taille 1 : demi-rectangles, 2 : carrés) ; ' +
      'cheval, vache tachetée, lion à crinière, girafe au long cou, dragon à ailes de grands triangles.',
    params: {
      taille: { type: 'int', min: 1, max: 2, default: 1, label: 'Taille (hauteur des pattes)' },
      espece: { type: 'espece', values: SPECIES, default: 'cheval', label: `Espèce : ${SPECIES_LIST_FR}` },
    },
    footprint: () => ({ w: 5, d: 1 }),
    build(b, p) {
      animal(b, speciesOf(p.espece, 'cheval') || 'cheval', p.taille, '', true);
    },
  });

  // ------------------------------------------------------- modules de la ferme
  MT.registerModule({
    id: 'grange',
    label: 'Grange',
    description:
      'Grange (emprise 2 × longueur ; 3 de large avec appentis à l’est) : grandes portes doubles en arche au sud, toit à deux pans ' +
      'en carrés (4 par case de profondeur), pignons de 4 triangles, fenil à l’étage.',
    params: {
      longueur: { type: 'int', min: 2, max: 4, default: 3, label: 'Profondeur (cases)' },
      etages: { type: 'int', min: 1, max: 2, default: 1, label: 'Niveaux' },
      appentis: { type: 'bool', default: false, label: 'Appentis' },
    },
    footprint: (p) => ({ w: p.appentis ? 3 : 2, d: p.longueur }),
    build(b, p, { rng }) {
      barn(b, 0, 0, p.longueur, p.etages, { name: '', backDoor: rng.int(-1, 1), loft: rng.int(0, 1) });
      if (p.appentis && !attempt(b, 0, () => b.at({ x: 0, z: 0, rot: 270, w: p.longueur, d: 2 }, () => barnLeanTo(b, p.longueur, 'E', '')))) {
        b.note('appentis omis, faute de pièces');
      }
    },
  });

  MT.registerModule({
    id: 'silo',
    label: 'Silo',
    description: 'Silo à grain 1×1 (emprise 1×1) : tour de carrés de 2 à 5 niveaux, lucarne en haut au sud, toit pointu (4 triangles) ou en flèche (4 grands triangles).',
    params: {
      etages: { type: 'int', min: 2, max: 5, default: 3, label: 'Niveaux' },
      toit: { type: 'enum', values: ['pyramide', 'fleche'], default: 'pyramide', label: 'Toit' },
    },
    footprint: () => ({ w: 1, d: 1 }),
    build(b, p) {
      silo(b, 0, 0, p.etages, p.toit, '', true);
    },
  });

  const PEN_ANIMALS = ['aucun', ...SPECIES];
  MT.registerModule({
    id: 'enclos',
    label: 'Enclos',
    description:
      'Enclos (emprise largeur × profondeur ; largeur 6 au moins avec un animal) : clôture de demi-rectangles (rares), de triangles ' +
      'rectangles (2 par case) ou de cadres ; portillon au sud ; animal (≈ 25 pièces) ou abri en A.',
    params: {
      largeur: { type: 'int', min: 2, max: 6, default: 3, label: 'Largeur (cases)' },
      profondeur: { type: 'int', min: 2, max: 4, default: 2, label: 'Profondeur (cases)' },
      cloture: { type: 'enum', values: ['demi', 'triangles', 'cadres'], default: 'demi', label: 'Clôture' },
      abri: { type: 'bool', default: true, label: 'Abri' },
      portillon: { type: 'bool', default: true, label: 'Portillon' },
      animal: { type: 'espece', values: PEN_ANIMALS, default: 'aucun', label: `Animal dans l’enclos : aucun, ${SPECIES_LIST_FR}` },
    },
    footprint: (p) => ({ w: speciesOf(p.animal, null) ? Math.max(6, p.largeur) : p.largeur, d: p.profondeur }),
    build(b, p) {
      const sp = speciesOf(p.animal, null);
      const beast = !!sp;
      const W = beast ? Math.max(6, p.largeur) : p.largeur, D = p.profondeur;
      let shelterAt = p.abri ? 'centre' : false;
      if (p.abri && beast) shelterAt = D >= 4 ? 'fond' : false; // l'animal prend la place de l'abri
      pen(b, 0, 0, W, D, { name: '', gate: p.portillon ? Math.floor((W - 1) / 2) : -1, fence: p.cloture, shelter: false });
      if (shelterAt && !attempt(b, 0, () => shelter(b, (W - 1) / 2, shelterAt === 'fond' ? 0.3 : (D - Math.SQRT2) / 2, 'Abri des animaux'))) {
        b.note('abri omis, faute de pièces');
      }
      if (beast) {
        const az = shelterAt === 'fond' ? D - 1.5 : (D - 1) / 2;
        b.at({ x: (W - 5) / 2, z: az, w: 5, d: 1 }, () => animal(b, sp, 1, SPECIES_FR[sp], true));
      }
    },
  });

  MT.registerModule({
    id: 'tracteur',
    label: 'Tracteur',
    description:
      'Tracteur sur un plateau à roues (emprise 2×1, 5×1 avec remorque) : capot bas à l’ouest, cabine vitrée ; remorque ' +
      '(second plateau à roues) attelée à l’est, chargée de ridelles en demi-rectangles ou de foin (8 triangles).',
    params: {
      remorque: { type: 'bool', default: true, label: 'Remorque' },
      chargement: { type: 'enum', values: ['ridelles', 'foin'], default: 'ridelles', label: 'Chargement de la remorque' },
    },
    footprint: (p) => ({ w: p.remorque ? 5 : 2, d: 1 }),
    build(b, p) {
      tractor(b, 0, 0, { name: '' });
      if (p.remorque && !attempt(b, 0, () => trailer(b, 0, 0, '', p.chargement))) {
        const alt = p.chargement === 'foin' ? 'ridelles' : 'foin';
        if (attempt(b, 0, () => trailer(b, 0, 0, '', alt))) b.note(`remorque chargée de ${alt === 'foin' ? 'foin' : 'ridelles'}, faute de pièces`);
        else b.note('remorque omise, faute de pièces');
      }
    },
  });

  MT.registerModule({
    id: 'moulin',
    label: 'Moulin à vent',
    description:
      'Moulin à vent (emprise 5 × 2) : tour 1×1 de 3 à 5 niveaux au toit pointu, porte en arche à l’ouest ; devant (sud), un caisson ' +
      'en saillie tient le moyeu et 4 grandes ailes en grands triangles (les ailes débordent de part et d’autre de la tour).',
    params: { etages: { type: 'int', min: 3, max: 5, default: 3, label: 'Niveaux' } },
    footprint: () => ({ w: 5, d: 2 }),
    build(b, p) {
      windmill(b, 0, 0, p.etages, '', 'W');
    },
  });

  // ------------------------------------------------------------ thème Ferme
  /**
   * Scène de ferme, dans le repère de la grange : [0, 2] × [0, L], portes au sud.
   * Miroir est-ouest (sc.m) autour de x = 1 : silos d'un côté, appentis et
   * enclos de l'autre, moulin loin du côté des silos ou derrière la grange.
   * sc : { m, len, floors, leanTo, siloPos: 'side'|'back', silos: [{ levels, roof }], tractor, load,
   *        pen: { w, d, fence, shelter, animals: [] }, windmill, millPos: 'far'|'back', house,
   *        meadow: [] (animaux au pré), extras: ['meules', 'poulailler'], trees, core: [..] }
   */
  function farmScene(b, rng, cap, sc) {
    const m = !!sc.m;
    const X = (x, w) => (m ? 2 - x - (w || 1) : x);
    const rot = m ? 180 : 0;
    const lot = makeLot();
    const L = sc.len;
    const core = new Set(sc.core || []);
    const run = (key, fn) => (core.has(key) ? (fn(), true) : attempt(b, cap, fn));
    const out = { silos: 0, pen: false, shelter: false, tractor: false, trailer: null, windmill: false, house: null, trees: { sapins: 0, buissons: 0 }, leanTo: false, animals: [], penAnimals: [], meadowAnimals: [], meules: 0, poulailler: false };

    // maison de la ferme : devant, du côté des silos
    if (sc.house) {
      const T = HOUSE_TYPES[sc.house];
      const hx = X(-2 - T.len, T.len), hz = L + 1;
      const make = (dense) => house(b, hx, hz, T.len, T.wid, T.floors, Object.assign({ name: 'Maison de la ferme', dense }, houseStyle(rng)));
      if (core.has('house') ? (make(false), true) : tryHouse(b, cap, make)) {
        lot.mark(hx, hz, T.len, T.wid);
        out.house = sc.house;
      }
    }
    // grange
    barn(b, 0, 0, L, sc.floors, {
      name: 'Grange', win: rng.pick(['window2', 'frame']), loft: rng.int(0, 1), backDoor: sc.siloPos === 'back' ? -1 : rng.int(-1, 1),
    });
    lot.mark(0, 0, 2, L);
    // silos : contre le flanc de la grange, ou jumeaux derrière elle
    const siloCells = sc.siloPos === 'back' ? [[0, -2], [1, -2]] : [[X(-1), L - 1], [X(-1), 0]];
    sc.silos.forEach((s, i) => {
      const [sx, sz] = siloCells[i];
      if (run(i ? 'silo2' : 'silo', () => silo(b, sx, sz, s.levels, s.roof, i ? 'Second silo' : 'Silo'))) {
        lot.mark(sx, sz, 1, 1);
        out.silos++;
      }
    });
    // tracteur garé devant les portes, remorque attelée tout de suite après
    if (sc.tractor) {
      const tx = X(0, 5);
      const inCar = (fn) => b.at({ x: tx, z: L + 1, rot, w: 5, d: 1 }, fn);
      out.tractor = run('tractor', () => inCar(() => tractor(b, 0, 0, { name: 'Tracteur' })));
      if (out.tractor) {
        lot.mark(m ? tx + 3 : tx, L + 1, 2, 1);
        if (sc.load) {
          for (const load of [sc.load, sc.load === 'foin' ? 'ridelles' : 'foin']) {
            if (attempt(b, cap, () => inCar(() => trailer(b, 0, 0, 'Tracteur', load)))) {
              out.trailer = load;
              lot.mark(tx, L + 1, 5, 1);
              break;
            }
          }
        }
      }
    }
    // moulin à vent
    if (sc.windmill) {
      const back = sc.millPos === 'back';
      const mx = back ? X(-1, 5) : X(-7, 5), mz = back ? -3 : 0;
      const door = back ? (m ? 'E' : 'W') : m ? 'W' : 'E';
      out.windmill = run('mill', () => windmill(b, mx, mz, sc.windmill, 'Moulin', door));
      if (out.windmill) lot.mark(mx, mz, 5, 2);
    }
    // appentis contre la grange, du côté de l'enclos
    if (sc.leanTo) {
      out.leanTo = attempt(b, cap, () => b.at({ x: 0, z: 0, rot: 270, w: L, d: 2 }, () => barnLeanTo(b, L, m ? 'W' : 'E', 'Grange')));
      if (out.leanTo) lot.mark(X(2), 0, 1, L);
    }
    // enclos, avec ses animaux (enclos d'au moins 6 cases) ou son abri
    let px = 0;
    if (sc.pen) {
      const { w, d } = sc.pen;
      px = X(sc.leanTo ? 4 : 3, w);
      const gate = rng.int(1, w - 2);
      for (const fence of [sc.pen.fence, 'triangles', 'demi']) {
        if (attempt(b, cap, () => pen(b, px, 0, w, d, { name: 'Enclos', gate, fence }))) {
          out.pen = fence;
          break;
        }
      }
      if (out.pen) {
        lot.mark(px, 0, w, d);
        const beasts = (sc.pen.animals || []).slice(0, d >= 4 ? 2 : 1);
        if (w >= 6 && beasts.length) {
          const rows = beasts.length > 1 ? [0.5, d - 1.5] : [(d - 1) / 2];
          beasts.forEach((sp, i) => {
            if (attempt(b, cap, () => placeAnimal(b, px + (w - 5) / 2, rows[i], sp, 1, rot, `${SPECIES_FR[sp]} de l’enclos`))) {
              out.animals.push(sp);
              out.penAnimals.push(sp);
            }
          });
        } else if (sc.pen.shelter) {
          out.shelter = attempt(b, cap, () => shelter(b, px + (w - 1) / 2, (d - Math.SQRT2) / 2, 'Enclos — abri des animaux'));
        }
      }
    }
    // animaux au pré
    if (sc.meadow && sc.meadow.length) {
      const pw = sc.pen ? sc.pen.w : 0, pd = sc.pen ? sc.pen.d : 0;
      const east = sc.leanTo ? 4 : 3;
      const spots = [[east + pw + 1, 0], [east + pw + 1, 2], [east, pd + 1], [6, L + 1], [east + pw + 1, 4], [-7, L + 1], [3, -3]]
        .map(([x, z]) => [X(x, 5), z]);
      for (const sp of sc.meadow) {
        for (const [ax, az] of spots) {
          if (!lot.free(ax, az, 5, 1, 1)) continue;
          if (attempt(b, cap, () => placeAnimal(b, ax, az, sp, rng.int(1, 2), rot, `${SPECIES_FR[sp]} au pré`))) {
            lot.mark(ax, az, 5, 1);
            out.animals.push(sp);
            out.meadowAnimals.push(sp);
          }
          break;
        }
      }
    }
    // meules de foin et poulailler
    for (const ex of sc.extras || []) {
      if (ex === 'meules') {
        const rows = [[X(-2, 3), L + 1], [X(3, 3), L + 3], [X(-4, 3), 3], [X(-2, 3), -3]];
        for (const [x, z] of rows) {
          if (!lot.free(x, z, 3, 1, 1)) continue;
          let n = 0;
          for (let i = 0; i < 3; i += 2) {
            if (attempt(b, cap, () => {
              b.step(n ? 'Seconde meule de foin' : 'Meule de foin');
              b.pyramidRoof(x + i, 0, z, 'EQ');
            })) n++;
          }
          if (n) {
            lot.mark(x, z, 3, 1);
            out.meules = n;
            break;
          }
        }
      } else if (ex === 'poulailler') {
        const spots = [[X(-3, 2), -3], [X(4, 2), L + 3], [X(-3, 2), L + 3], [X(8, 2), 0]];
        for (const [x, z] of spots) {
          if (!lot.free(x, z, 2, 2, 1)) continue;
          if (attempt(b, cap, () => shelter(b, x + 0.5, z + 0.3, 'Poulailler'))) {
            lot.mark(x, z, 2, 2);
            out.poulailler = true;
          }
          break;
        }
      }
    }
    // arbres autour
    if (sc.trees) {
      const spots = rng.shuffle([
        [-2, L + 1], [3, L + 3], [-1, L + 3], [1, -2], [-2, -1], [6, L + 1], [8, 1], [4, -2], [-3, L + 2], [7, -1], [2, L + 4],
        [-4, -1], [9, -1], [-5, L + 2], [10, 2], [5, L + 4],
      ].map(([x, z]) => [X(x), z]));
      out.trees = plantTrees(b, rng, cap, lot, spots, sc.trees, 0.65);
    }
    return out;
  }

  /** Version un cran plus modeste du cœur d'une ferme (null : plus rien à réduire). */
  function shrinkFarm(sc) {
    const n = clone(sc);
    const s2 = n.silos[1], s1 = n.silos[0];
    if (s2 && s2.levels > 2) {
      s2.levels--;
      return n;
    }
    if (s1 && s1.levels > 3) {
      s1.levels--;
      return n;
    }
    if (n.floors > 1) {
      n.floors = 1;
      return n;
    }
    if (s2) {
      n.silos.pop();
      return n;
    }
    if (n.house && n.house !== 'maison') {
      n.house = 'maison';
      return n;
    }
    if (n.windmill > 3) {
      n.windmill--;
      return n;
    }
    if (n.len > 2) {
      n.len--;
      if (n.pen) n.pen.d = Math.min(n.pen.d, n.len);
      return n;
    }
    if (s1 && s1.levels > 2) {
      s1.levels--;
      return n;
    }
    return null;
  }

  /** « son cheval », « sa vache », « ses chevaux », « ses animaux ». */
  function possessive(list) {
    if (list.length === 1) return list[0] === 'vache' || list[0] === 'girafe' ? `sa ${list[0]}` : `son ${list[0]}`;
    if (list.every((s) => s === list[0])) return list[0] === 'cheval' ? 'ses chevaux' : `ses ${list[0]}s`;
    return 'ses animaux';
  }

  MT.registerTheme({
    id: 'ferme',
    name: 'Ferme',
    emoji: '🚜',
    tagline: 'Grange à grandes portes, silo, tracteur, enclos, animaux et moulin',
    keywords: [
      'ferme', 'fermier', 'fermiere', 'grange', 'etable', 'ecurie', 'poulailler', 'silo', 'tracteur', 'remorque', 'moissonneuse',
      'champ', 'campagne', 'moulin', 'moulin a vent', 'enclos', 'cloture', 'animal', 'animaux', 'vache', 'cochon', 'poule',
      'mouton', 'cheval', 'chevaux', 'poney', 'chevre', 'lapin', 'canard', 'ane', 'oie', 'dindon', 'foin', 'ble', 'verger',
      'agriculteur', 'recolte', 'pre', 'prairie', 'basse cour', 'bergerie', 'etang', 'zoo', 'girafe', 'lion', 'mathurin',
      'tchoupi a la ferme', 'la ferme de zenon',
    ],
    generate(b, { size, packs, rng }) {
      const cap = CAPS[size];
      warmUp(rng);
      const m = rng.chance(0.5);
      let sc;
      if (size === 1) {
        const v = rng.pick(['grange', 'silo', 'tracteur', 'pre']);
        if (v === 'tracteur' || v === 'pre') {
          const lot = makeLot();
          const bits = [];
          let title;
          if (v === 'tracteur') {
            // tracteur, remorque et petit enclos
            const shel = rng.chance(0.5);
            tractor(b, 0, 3, { name: 'Tracteur' });
            const load = rng.pick(['ridelles', 'foin']);
            const tr = attempt(b, cap, () => trailer(b, 0, 3, 'Tracteur', load)) ? load : null;
            const w = rng.int(2, 3);
            const gate = rng.int(0, w - 1);
            const f0 = rng.pick(['demi', 'triangles']);
            const pn = [f0, f0 === 'demi' ? 'triangles' : 'demi'].some((fence) =>
              attempt(b, cap, () => pen(b, 0, 0, w, 2, { name: 'Enclos', gate, shelter: shel ? 'centre' : false, fence })));
            lot.mark(0, 0, w, 2);
            lot.mark(0, 3, 5, 1);
            bits.push(`un tracteur${tr ? ` avec sa remorque${tr === 'foin' ? ' de foin' : ''}` : ''}`);
            if (pn) bits.push(`un enclos${shel ? ' avec son abri' : ''}`);
            title = tr ? 'Tracteur et remorque' : 'Tracteur de la ferme';
          } else {
            // un animal au pré, son abri et une meule de foin
            const sp = rng.pick(['cheval', 'vache', 'vache']);
            placeAnimal(b, 0, 2, sp, rng.int(1, 2), m ? 180 : 0, SPECIES_FR[sp]);
            lot.mark(0, 2, 5, 1);
            const sh = attempt(b, cap, () => shelter(b, 1.5, 0, 'Abri'));
            if (sh) lot.mark(1, 0, 2, 1);
            const hay = attempt(b, cap, () => {
              b.step('Meule de foin');
              b.pyramidRoof(4, 0, 0, 'EQ');
            });
            if (hay) lot.mark(4, 0, 1, 1);
            bits.push(`${SPECIES_ART[sp]} au pré`);
            if (sh) bits.push('son abri');
            if (hay) bits.push('une meule de foin');
            title = `${SPECIES_FR[sp]} au pré`;
          }
          const t = plantTrees(b, rng, cap, lot, rng.shuffle([[4, 0], [4, 1], [-2, 1], [-2, 3], [6, 2], [-2, 0]]), 1, 0.7);
          bits.push(...treeText(t));
          return { title, summary: sentence(bits) };
        }
        sc = {
          m, len: 2, floors: 1, silos: v === 'silo' ? [{ levels: rng.int(2, 3) }] : [], core: ['silo'],
          tractor: v === 'grange', trees: 1,
        };
      } else if (size === 2) {
        const mill = rng.chance(0.35);
        sc = {
          m, len: rng.int(2, 3), floors: 1, siloPos: 'side',
          silos: mill ? [] : [{ levels: 3, roof: rng.pick(['pyramide', 'pyramide', 'fleche']) }],
          windmill: mill ? 3 : 0, millPos: 'far', tractor: true, load: rng.chance(0.6) ? rng.pick(['ridelles', 'foin']) : null,
          pen: { w: rng.int(2, 3), d: 2, shelter: rng.chance(0.6), fence: rng.pick(['demi', 'triangles']) },
          leanTo: rng.chance(0.4), trees: 2, extras: rng.chance(0.5) ? ['meules'] : [], core: ['silo', 'tractor', 'mill'],
        };
      } else if (size === 3) {
        const L = 3;
        const siloPos = rng.pick(['side', 'side', 'back']);
        sc = {
          m, len: L, floors: rng.int(1, 2), siloPos,
          silos: [{ levels: rng.int(3, 4), roof: rng.pick(['pyramide', 'fleche']) }],
          tractor: true, load: rng.pick(['ridelles', 'foin']),
          pen: { w: rng.int(3, 4), d: 2, shelter: true, fence: rng.pick(['demi', 'triangles', 'triangles']) },
          leanTo: rng.chance(0.5), windmill: rng.chance(0.6) ? rng.pick([3, 3, 4]) : 0,
          millPos: siloPos === 'back' ? 'far' : rng.pick(['far', 'back']),
          meadow: [rng.pick(['cheval', 'vache'])], extras: [rng.pick(['meules', 'poulailler'])], trees: 3, core: ['silo', 'tractor', 'mill'],
        };
        if (rng.chance(0.5)) sc.silos.push({ levels: rng.int(2, 3) });
      } else {
        const L = 4;
        const siloPos = rng.pick(['side', 'back']);
        sc = {
          m, len: L, floors: 2, house: rng.pick(['grande', 'maison', 'chaumiere']), siloPos,
          silos: [{ levels: 4 }, { levels: 3, roof: 'fleche' }],
          tractor: true, load: rng.pick(['ridelles', 'foin']),
          pen: { w: 6, d: 4, fence: rng.pick(['triangles', 'demi']), animals: rng.shuffle(['cheval', 'vache', 'vache', 'cheval']).slice(0, 2) },
          leanTo: true, windmill: rng.int(4, 5), millPos: siloPos === 'back' ? 'far' : rng.pick(['far', 'back']),
          meadow: [], extras: ['meules', 'poulailler'], trees: 6, core: ['house', 'silo', 'silo2', 'tractor', 'mill'],
        };
      }
      const { cfg, st: r } = buildPlanned(b, cap, sc, (bb, c) => farmScene(bb, rng, cap, c), shrinkFarm, size === 4 && packs === 1);
      sc = cfg;
      const bits = [`une grange ${sc.floors > 1 ? 'à fenil ' : ''}aux grandes portes en arche${r.leanTo ? ' avec son appentis' : ''}`];
      if (r.silos) bits.push(r.silos === 1 ? 'un silo' : 'deux silos');
      if (r.house) bits.push('la maison de la ferme');
      if (r.tractor) bits.push(`un tracteur${r.trailer ? ` et sa remorque${r.trailer === 'foin' ? ' de foin' : ''}` : ''}`);
      if (r.pen) {
        const inPen = r.penAnimals.length ? ` où ${r.penAnimals.length > 1 ? 'broutent' : 'broute'} ${animalsText(r.penAnimals)}` : '';
        bits.push(`un enclos${r.pen === 'triangles' ? ' à clôture de triangles' : ''}${r.shelter ? ' avec abri' : ''}${inPen}`);
      }
      for (const sp of r.meadowAnimals) bits.push(`${SPECIES_ART[sp]} au pré`);
      if (r.windmill) bits.push('un moulin à vent');
      if (r.meules) bits.push(r.meules === 1 ? 'une meule de foin' : `${numF(r.meules)} meules de foin`);
      if (r.poulailler) bits.push('un poulailler');
      bits.push(...treeText(r.trees));
      let title;
      if (r.house) title = r.animals.length ? `Grande ferme et ${possessive(r.animals)}` : r.windmill ? 'Grande ferme et son moulin' : 'Grande ferme';
      else if (r.windmill) title = r.animals.length ? `Ferme du moulin et ${possessive(r.animals)}` : 'Ferme et moulin à vent';
      else if (r.animals.length) title = `La ferme et ${possessive(r.animals)}`;
      else if (r.silos && r.tractor) title = `Grange, ${r.silos > 1 ? 'silos' : 'silo'} et tracteur`;
      else if (r.silos) title = r.silos > 1 ? 'Grange et silos' : 'Grange et silo';
      else if (r.tractor) title = 'Grange et tracteur';
      else title = 'Grange';
      return { title, summary: sentence(bits) };
    },
  });

  // ------------------------------------------------------- modules composés
  const VILLAGE_NORTH = ['grande', 'maison', 'longere', 'chaumiere', 'haute'];
  const VILLAGE_SOUTH = ['maison', 'maisonnette', 'longere', 'tourelle'];
  function villagePlan(p) {
    const nN = Math.ceil(p.maisons / 2), nS = p.maisons - nN;
    const north = range(0, nN).map((i) => VILLAGE_NORTH[i % VILLAGE_NORTH.length]);
    const south = range(0, nS).map((i) => VILLAGE_SOUTH[i % VILLAGE_SOUTH.length]);
    let cx = p.eglise ? 5 : 0;
    for (const t of north) cx += HOUSE_TYPES[t].len + 1;
    let sx = 1;
    for (const t of south) sx += HOUSE_TYPES[t].len + 1;
    const maxX = Math.max(cx - 1, sx - 1, 2);
    return { north, south, maxX };
  }
  MT.registerModule({
    id: 'a-village',
    label: 'Village',
    description:
      'Village (emprise ≈ (1,5 × maisons + 10) × 8, +5 en x avec l’église) : rue est-ouest bordée de maisons au nord et au sud, église ' +
      'à clocher optionnelle, puits, sapins, buissons, potager clôturé. Maisons omises si les pièces manquent.',
    params: {
      maisons: { type: 'int', min: 2, max: 7, default: 4, label: 'Maisons' },
      eglise: { type: 'bool', default: false, label: 'Église' },
      puits: { type: 'bool', default: true, label: 'Puits' },
      arbres: { type: 'int', min: 0, max: 6, default: 3, label: 'Arbres' },
      potager: { type: 'bool', default: true, label: 'Potager' },
    },
    footprint: (p) => ({ w: villagePlan(p).maxX + 10, d: 8 }),
    build(b, p, { rng }) {
      const plan = villagePlan(p);
      const v = b.at({ x: 5, z: 1 }, () =>
        buildVillage(b, rng, 0, {
          north: plan.north, south: plan.south, church: p.eglise, churchAt: 0, southStart: 1,
          trees: p.arbres, wells: p.puits ? 1 : 0, potager: p.potager, core: 1,
          reserve: p.arbres ? { TT: 4, EQ: 4 * Math.min(2, p.arbres) } : {},
        }));
      const miss = p.maisons - v.houses.length;
      if (miss > 0) b.note(miss === 1 ? 'une maison omise, faute de pièces' : `${numF(miss)} maisons omises, faute de pièces`);
      const nt = v.trees.sapins + v.trees.buissons;
      if (nt < p.arbres) b.note(`${nt ? `${numM(nt)} arbre${nt > 1 ? 's' : ''} sur ${numM(p.arbres)}` : 'aucun arbre'}, faute de pièces ou de place`);
      if (p.puits && !v.wells) b.note('puits omis, faute de pièces');
      if (p.potager && !v.potager) b.note('potager omis, faute de pièces');
    },
  });

  function farmBox(p) {
    let xmin = 0;
    if (p.silo) xmin = -1;
    if (p.maison) xmin = -4;
    if (p.moulin) xmin = -7;
    const east = p.appentis ? 4 : 3;
    let xmax = p.appentis ? 3 : 2;
    if (p.enclos) xmax = Math.max(xmax, east + (speciesOf(p.animal, null) ? 6 : 3));
    if (p.tracteur) xmax = Math.max(xmax, 5);
    let zmax = p.longueur;
    if (p.tracteur) zmax = Math.max(zmax, p.longueur + 2);
    if (p.maison) zmax = Math.max(zmax, p.longueur + 3);
    if (p.moulin || p.enclos) zmax = Math.max(zmax, 2);
    return { xmin, w: xmax - xmin, d: zmax };
  }
  MT.registerModule({
    id: 'a-ferme',
    label: 'Ferme',
    description:
      'Ferme (emprise ≈ 10 × 6) : grange aux portes en arche au sud, silo contre la grange, tracteur et remorque devant, enclos à l’est ' +
      '(animal dedans en option), moulin et maison optionnels à l’ouest. Éléments omis si les pièces manquent (notes).',
    params: {
      longueur: { type: 'int', min: 2, max: 4, default: 3, label: 'Profondeur de la grange' },
      etages: { type: 'int', min: 1, max: 2, default: 1, label: 'Niveaux de la grange' },
      appentis: { type: 'bool', default: false, label: 'Appentis' },
      silo: { type: 'bool', default: true, label: 'Silo' },
      tracteur: { type: 'bool', default: true, label: 'Tracteur et remorque' },
      enclos: { type: 'bool', default: true, label: 'Enclos' },
      animal: { type: 'espece', values: PEN_ANIMALS, default: 'aucun', label: `Animal dans l’enclos : aucun, ${SPECIES_LIST_FR}` },
      moulin: { type: 'bool', default: false, label: 'Moulin à vent' },
      maison: { type: 'bool', default: false, label: 'Maison de la ferme' },
    },
    footprint: (p) => {
      const f = farmBox(p);
      return { w: f.w, d: f.d };
    },
    build(b, p, { rng }) {
      const f = farmBox(p);
      const sp = speciesOf(p.animal, null);
      const beast = p.enclos && !!sp;
      const r = b.at({ x: -f.xmin, z: 0 }, () =>
        farmScene(b, rng, 0, {
          m: false, len: p.longueur, floors: p.etages, leanTo: p.appentis, house: p.maison ? 'grande' : null, siloPos: 'side',
          silos: p.silo ? [{ levels: 3 }] : [], tractor: p.tracteur, load: p.tracteur ? 'ridelles' : null,
          pen: p.enclos ? { w: beast ? 6 : 3, d: 2, shelter: !beast, fence: 'demi', animals: beast ? [sp] : [] } : null,
          windmill: p.moulin ? 4 : 0, millPos: 'far', trees: 0, core: [],
        }));
      const miss = [];
      if (p.maison && !r.house) miss.push('maison');
      if (p.silo && !r.silos) miss.push('silo');
      if (p.tracteur && !r.tractor) miss.push('tracteur');
      if (p.tracteur && r.tractor && !r.trailer) miss.push('remorque');
      if (p.enclos && !r.pen) miss.push('enclos');
      if (beast && !r.animals.length) miss.push(SPECIES_FR[sp].toLowerCase());
      if (p.moulin && !r.windmill) miss.push('moulin');
      if (p.appentis && !r.leanTo) miss.push('appentis');
      if (miss.length) b.note(`omis faute de pièces : ${miss.join(', ')}`);
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
