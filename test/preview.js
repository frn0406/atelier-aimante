/*
 * Aperçu 2D (Canvas, sans WebGL) d'une construction : 4 vues pour contrôler
 * visuellement un thème en mode headless. Couleur = type de pièce ;
 * pièces en erreur (flottantes, superposées, croisées) cerclées de rouge.
 */
(function (root) {
  'use strict';
  const MT = root.MT;
  const P = MT.PIECES;
  const { sub, dot, cross, norm } = MT.vec;

  function camera(az, el) {
    const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
    const eye = [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
    const d = [-eye[0], -eye[1], -eye[2]];
    let right = norm(cross(d, [0, 1, 0]));
    if (!Number.isFinite(right[0]) || MT.vec.len(right) < 0.5) right = [1, 0, 0];
    const up = cross(right, d);
    return { eye, right, up };
  }

  function drawView(ctx, x0, y0, W, H, result, cam, title, bad) {
    const polys = [];
    for (const p of result.placements) {
      const shape = P[p.type];
      const rings = [shape.outline, ...shape.holes].map((ring) => ring.map(([x, y]) => MT.worldPoint(p, x, y)));
      const all = rings[0];
      const depth = all.reduce((s, q) => s + dot(q, cam.eye), 0) / all.length;
      polys.push({ p, rings, depth });
      if (p.type === 'CAR') {
        for (const [wx, wz] of [[0.4, -0.02], [1.6, -0.02], [0.4, 1.02], [1.6, 1.02]]) {
          const c = MT.worldPoint(p, wx, wz);
          c[1] = MT.CAR.wheelR;
          polys.push({ wheel: c, depth: dot(c, cam.eye) - 0.01 });
        }
      }
    }
    const proj = (q) => [dot(q, cam.right), -dot(q, cam.up)];
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const pl of polys) {
      for (const q of pl.rings ? pl.rings[0] : [pl.wheel]) {
        const [sx, sy] = proj(q);
        bx0 = Math.min(bx0, sx); by0 = Math.min(by0, sy); bx1 = Math.max(bx1, sx); by1 = Math.max(by1, sy);
      }
    }
    // sol
    const s = Math.min((W - 40) / Math.max(bx1 - bx0, 1), (H - 60) / Math.max(by1 - by0, 1));
    const ox = x0 + W / 2 - ((bx0 + bx1) / 2) * s, oy = y0 + 30 + (H - 40) / 2 - ((by0 + by1) / 2) * s;
    const T = (q) => {
      const [sx, sy] = proj(q);
      return [ox + sx * s, oy + sy * s];
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, W, H);
    ctx.clip();
    ctx.fillStyle = '#f4f6fa';
    ctx.fillRect(x0, y0, W, H);
    // grille au sol
    ctx.strokeStyle = 'rgba(40,60,90,0.12)';
    ctx.lineWidth = 1;
    const g0 = -2, g1 = 20;
    for (let i = g0; i <= g1; i++) {
      let a = T([i, 0, g0]), b = T([i, 0, g1]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      a = T([g0, 0, i]); b = T([g1, 0, i]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    polys.sort((a, b) => a.depth - b.depth);
    for (const pl of polys) {
      if (pl.wheel) {
        const [cx, cy] = T(pl.wheel);
        ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(3, MT.CAR.wheelR * s * 0.9), 0, Math.PI * 2); ctx.fill();
        continue;
      }
      ctx.beginPath();
      for (const ring of pl.rings) {
        ring.forEach((q, i) => {
          const [sx, sy] = T(q);
          if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
        });
        ctx.closePath();
      }
      ctx.fillStyle = P[pl.p.type].color;
      ctx.globalAlpha = 0.78;
      ctx.fill('evenodd');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = bad.has(pl.p.id) ? '#ff0000' : 'rgba(20,24,32,0.85)';
      ctx.lineWidth = bad.has(pl.p.id) ? 3 : 1.2;
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#1b2233';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(title, x0 + 10, y0 + 20);
    ctx.strokeStyle = '#c8d0dc';
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, W - 1, H - 1);
  }

  MT.renderPreview = function (canvas, result, heading) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const v = result.validation;
    const bad = new Set([...v.floating, ...v.overlaps.flat(), ...v.crossings.flat()]);
    const top = 70;
    const hw = W / 2, hh = (H - top) / 2;
    drawView(ctx, 0, top, hw, hh, result, camera(-45, 32), 'Vue 3/4 avant-gauche', bad);
    drawView(ctx, hw, top, hw, hh, result, camera(135, 32), 'Vue 3/4 arrière-droite', bad);
    drawView(ctx, 0, top + hh, hw, hh, result, camera(90, 0.01), 'Face (depuis +Z)', bad);
    drawView(ctx, hw, top + hh, hw, hh, result, camera(90, 89.9), 'Dessus (plan, X →, Z ↓)', bad);
    ctx.fillStyle = '#1b2233';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(heading, 12, 26);
    ctx.font = '14px sans-serif';
    const used = MT.PIECE_ORDER.filter((t) => result.used[t]).map((t) => `${t} ${result.used[t]}`).join(' · ');
    ctx.fillText(`${result.pieceCount} pièces (${used}) — ${result.steps.length} étapes — ${v.components} bloc(s)`, 12, 46);
    ctx.fillStyle = v.ok && !result.warnings.length ? '#1a7f37' : '#cf222e';
    ctx.fillText(v.ok && !result.warnings.length ? 'Validation OK' : 'ERREURS : ' + [...v.errors, ...result.warnings].join(' | ').slice(0, 180), 12, 64);
  };
})(typeof window !== 'undefined' ? window : globalThis);
