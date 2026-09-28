/*
 * Atelier Aimanté — catalogue des pièces du pack de 136 pièces.
 *
 * Unité : 1 = côté d'un carré (2,95 in ≈ 7,5 cm). Toutes les pièces plates
 * sont décrites dans leur repère local 2D : x le long du bord de base, y vers
 * le haut de la pièce. Le bord de base va de (0,0) à (w,0).
 *
 * Script classique (pas de module ES) : il s'attache à l'objet global MT pour
 * fonctionner aussi bien en file:// qu'en artefact ou sous Node.
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});

  const EQ_H = Math.sqrt(3) / 2; // hauteur du triangle équilatéral de côté 1
  const TT_H = 5.4 / 2.95; // hauteur du grand triangle (≈ 1,83)
  const HR_H = 1.95 / 2.95; // hauteur du demi-rectangle et des créneaux (≈ 0,66)
  const T = 0.075; // épaisseur d'une tuile
  // Plateau à roues : 7,7 in hors tout = 2 carrés + 2 attelages de 0,3.
  const CAR = { length: 2, width: 1, top: 0.36, plate: 0.1, hitch: 0.3, wheelR: 0.18 };

  function rect(x, y, w, h) {
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }

  function archHole() {
    const pts = [[0.22, 0.1], [0.78, 0.1], [0.78, 0.6]];
    for (let i = 1; i < 16; i++) {
      const a = (Math.PI * i) / 16;
      pts.push([0.5 + 0.28 * Math.cos(a), 0.6 + 0.28 * Math.sin(a)]);
    }
    pts.push([0.22, 0.6]);
    return pts;
  }

  const CRENEL = [
    [0, 0], [1, 0], [1, HR_H], [0.82, HR_H], [0.82, 0.3], [0.6, 0.3],
    [0.6, HR_H], [0.4, HR_H], [0.4, 0.3], [0.18, 0.3], [0.18, HR_H], [0, HR_H],
  ];

  const SQ_RIBS = [
    [[0, 0], [1, 1]], [[1, 0], [0, 1]],
    [[0.5, 0], [1, 0.5]], [[1, 0.5], [0.5, 1]], [[0.5, 1], [0, 0.5]], [[0, 0.5], [0.5, 0]],
  ];
  const EQ_C = [0.5, EQ_H / 3];

  /*
   * Chaque pièce :
   *  - outline : contour 2D local (sens trigonométrique)
   *  - holes   : ouvertures (fenêtres, arche, cadre)
   *  - magnets : indices des bords aimantés (bord i = outline[i] → outline[i+1])
   *  - ribs    : nervures décoratives (segments 2D) pour le rendu
   *  - family  : les pièces d'une même famille ont exactement le même contour
   *  - color   : couleur du visuel catalogue (mode « par type »)
   */
  const PIECES = {
    SQ: {
      name: 'Carré plein', short: 'Carré', count: 40, family: 'square',
      outline: rect(0, 0, 1, 1), holes: [], magnets: [0, 1, 2, 3], ribs: SQ_RIBS,
      color: '#35C35A', dims: '2,95 × 2,95 in',
    },
    WIN2: {
      name: 'Carré fenêtre double', short: 'Fenêtre double', count: 8, family: 'square',
      outline: rect(0, 0, 1, 1),
      holes: [rect(0.17, 0.12, 0.29, 0.76), rect(0.54, 0.12, 0.29, 0.76)],
      magnets: [0, 1, 2, 3], ribs: [], color: '#26C2D9', dims: '2,95 × 2,95 in',
    },
    FRAME: {
      name: 'Cadre carré', short: 'Cadre', count: 8, family: 'square',
      outline: rect(0, 0, 1, 1), holes: [rect(0.2, 0.2, 0.6, 0.6)],
      magnets: [0, 1, 2, 3], ribs: [], color: '#E0369A', dims: '2,95 × 2,95 in',
    },
    ARCH: {
      name: 'Carré porte en arche', short: 'Porte arche', count: 8, family: 'square',
      outline: rect(0, 0, 1, 1), holes: [archHole()],
      magnets: [0, 1, 2, 3], ribs: [], color: '#86D23A', dims: '2,95 × 2,95 in',
    },
    WIN4: {
      name: 'Carré fenêtre 4 carreaux', short: 'Fenêtre 4 carreaux', count: 8, family: 'square',
      outline: rect(0, 0, 1, 1),
      holes: [
        rect(0.15, 0.15, 0.32, 0.32), rect(0.53, 0.15, 0.32, 0.32),
        rect(0.15, 0.53, 0.32, 0.32), rect(0.53, 0.53, 0.32, 0.32),
      ],
      magnets: [0, 1, 2, 3], ribs: [], color: '#3C8CF0', dims: '2,95 × 2,95 in',
    },
    EQ: {
      name: 'Triangle équilatéral', short: 'Triangle', count: 24, family: 'eq',
      outline: [[0, 0], [1, 0], [0.5, EQ_H]], holes: [], magnets: [0, 1, 2],
      ribs: [[[0.5, 0], EQ_C], [[0.75, EQ_H / 2], EQ_C], [[0.25, EQ_H / 2], EQ_C]],
      color: '#FFC61A', dims: 'côtés 2,8 in',
    },
    RT: {
      name: 'Triangle rectangle', short: 'Triangle rectangle', count: 14, family: 'rt',
      outline: [[0, 0], [1, 0], [0, 1]], holes: [], magnets: [0, 1, 2],
      ribs: [[[0, 0], [0.5, 0.5]]], color: '#FF8A1F', dims: '2,8 × 2,8 × 3,8 in',
    },
    TT: {
      name: 'Grand triangle isocèle', short: 'Grand triangle', count: 8, family: 'tt',
      outline: [[0, 0], [1, 0], [0.5, TT_H]], holes: [], magnets: [0, 1, 2],
      ribs: [[[0.5, 0], [0.5, TT_H * 0.82]], [[0.2, 0.55], [0.5, 1.1]], [[0.8, 0.55], [0.5, 1.1]]],
      color: '#2FB3EA', dims: 'base 2,85 × haut. 5,4 in',
    },
    HR: {
      name: 'Demi-rectangle', short: 'Demi-rectangle', count: 8, family: 'half',
      outline: rect(0, 0, 1, HR_H), holes: [], magnets: [0, 1, 2, 3],
      ribs: [[[0, 0], [1, HR_H]], [[1, 0], [0, HR_H]]], color: '#F0449A', dims: '2,95 × 1,95 in',
    },
    CR: {
      name: 'Créneaux', short: 'Créneaux', count: 8, family: 'half',
      outline: CRENEL, holes: [], magnets: [0, 1, 11], ribs: [],
      color: '#9A5CEB', dims: '2,95 × 1,95 in',
    },
    CAR: {
      name: 'Plateau à roues', short: 'Plateau à roues', count: 2, family: 'car',
      outline: rect(0, 0, CAR.length, CAR.width), holes: [], magnets: [0, 1, 2, 3],
      ribs: [[[1, 0], [1, 1]]], color: '#2F5BE0', dims: '7,7 × 2,95 in',
    },
  };

  const PIECE_ORDER = ['SQ', 'WIN2', 'FRAME', 'ARCH', 'WIN4', 'EQ', 'RT', 'TT', 'HR', 'CR', 'CAR'];

  // Boîte englobante, centre de boîte et aire (sans les trous) de chaque contour.
  for (const type of PIECE_ORDER) {
    const p = PIECES[type];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p.outline) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    p.type = type;
    p.w = x1 - x0;
    p.h = y1 - y0;
    p.center = [(x0 + x1) / 2, (y0 + y1) / 2];
    let a = 0, cx = 0, cy = 0;
    const o = p.outline;
    for (let i = 0; i < o.length; i++) {
      const [xa, ya] = o[i];
      const [xb, yb] = o[(i + 1) % o.length];
      const c = xa * yb - xb * ya;
      a += c; cx += (xa + xb) * c; cy += (ya + yb) * c;
    }
    p.area = Math.abs(a / 2);
    p.centroid = [cx / (3 * a), cy / (3 * a)];
  }

  const PACK = {};
  for (const t of PIECE_ORDER) PACK[t] = PIECES[t].count;

  function inventoryFor(packs) {
    const k = packs === 2 ? 2 : 1;
    const inv = {};
    for (const t of PIECE_ORDER) inv[t] = PACK[t] * k;
    return inv;
  }

  // Bords aimantés en coordonnées locales 2D : [[x0,y0],[x1,y1]].
  function magnetEdges(type) {
    const p = PIECES[type];
    const o = p.outline;
    return p.magnets.map((i) => [o[i], o[(i + 1) % o.length]]);
  }

  // Palette du jeu (plastique translucide).
  const COLORS = {
    red: '#E8403A', orange: '#FF8A1F', yellow: '#FFC61A', green: '#35C35A',
    blue: '#2FA4F0', purple: '#9A5CEB', pink: '#F0449A', navy: '#2F5BE0',
  };
  const RAINBOW = [COLORS.red, COLORS.orange, COLORS.yellow, COLORS.green, COLORS.blue, COLORS.purple];

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /*
   * Icône SVG d'une pièce (vue de face, aimants en gris foncé).
   * opts : { size = 40, color = couleur catalogue, stroke }
   */
  function pieceIconSVG(type, opts) {
    const o = opts || {};
    const p = PIECES[type];
    const size = o.size || 40;
    const color = o.color || p.color;
    if (type === 'CAR') {
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.35 -0.25 2.7 1.2" width="${size}" height="${size}" aria-hidden="true">` +
        `<rect x="-0.3" y="0.05" width="2.6" height="0.22" rx="0.08" fill="${esc(color)}" fill-opacity="0.85" stroke="${esc(color)}" stroke-width="0.04"/>` +
        `<rect x="0" y="0.02" width="2" height="0.09" rx="0.03" fill="#2b2f36" fill-opacity="0.55"/>` +
        `<circle cx="0.45" cy="0.55" r="0.3" fill="#23262d"/><circle cx="0.45" cy="0.55" r="0.1" fill="#8a93a3"/>` +
        `<circle cx="1.55" cy="0.55" r="0.3" fill="#23262d"/><circle cx="1.55" cy="0.55" r="0.1" fill="#8a93a3"/>` +
        `</svg>`
      );
    }
    const pad = 0.08;
    const vb = [-pad, -pad, p.w + 2 * pad, p.h + 2 * pad];
    const fy = (y) => (p.h - y).toFixed(3);
    const ring = (pts) => 'M' + pts.map(([x, y]) => `${x.toFixed(3)} ${fy(y)}`).join('L') + 'Z';
    const d = ring(p.outline) + p.holes.map(ring).join('');
    let mags = '';
    for (const [[xa, ya], [xb, yb]] of magnetEdges(type)) {
      const len = Math.hypot(xb - xa, yb - ya);
      const n = Math.max(1, Math.round(len / 0.5));
      const ux = (xb - xa) / len, uy = (yb - ya) / len;
      // normale intérieure (contour trigonométrique : intérieur à gauche)
      const nx = -uy, ny = ux;
      const segLen = Math.min(0.26, (len / n) * 0.6);
      for (let k = 0; k < n; k++) {
        const t = ((k + 0.5) / n) * len;
        const cx = xa + ux * t + nx * 0.07, cy = ya + uy * t + ny * 0.07;
        const x0 = cx - ux * segLen / 2, y0 = cy - uy * segLen / 2;
        const x1 = cx + ux * segLen / 2, y1 = cy + uy * segLen / 2;
        mags += `<line x1="${x0.toFixed(3)}" y1="${fy(y0)}" x2="${x1.toFixed(3)}" y2="${fy(y1)}"/>`;
      }
    }
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${size}" height="${size}" aria-hidden="true">` +
      `<path d="${d}" fill="${esc(color)}" fill-opacity="0.72" fill-rule="evenodd" stroke="${esc(o.stroke || color)}" stroke-width="0.045" stroke-linejoin="round"/>` +
      `<g stroke="#262a31" stroke-opacity="0.8" stroke-width="0.07" stroke-linecap="round">${mags}</g>` +
      `</svg>`
    );
  }

  MT.EQ_H = EQ_H;
  MT.TT_H = TT_H;
  MT.HR_H = HR_H;
  MT.T = T;
  MT.CAR = CAR;
  MT.PIECES = PIECES;
  MT.PIECE_ORDER = PIECE_ORDER;
  MT.PACK = PACK;
  MT.PACK_TOTAL = PIECE_ORDER.reduce((s, t) => s + PACK[t], 0);
  MT.inventoryFor = inventoryFor;
  MT.magnetEdges = magnetEdges;
  MT.COLORS = COLORS;
  MT.RAINBOW = RAINBOW;
  MT.pieceIconSVG = pieceIconSVG;
})(typeof window !== 'undefined' ? window : globalThis);
