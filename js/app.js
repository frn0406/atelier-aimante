/*
 * Atelier Aimanté — interface.
 *
 * Choix du thème (cartes avec vignettes), thème libre (composition par
 * Claude via la capacité « sample », sinon rapprochement par mots-clés),
 * taille, double pack, variante, couleurs, vue 3D (MT.createViewer ; aperçu
 * 2D pendant le chargement de Three.js ou sans WebGL), nomenclature, étapes
 * de montage, code de construction (copier / charger) et fiche de montage.
 *
 * Script classique : les fonctions pures sont exposées sur MT.appUtil (elles
 * tournent aussi sous Node), l'interface sur MT.app.
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});

  const SIZE_NAMES = ['', 'Petite', 'Moyenne', 'Grande', 'Géante'];
  const COLOR_MODES = ['rainbow', 'type', 'step'];
  const DEFAULTS = { themeId: 'chateau', size: 2, packs: 1, seed: 1, colorMode: 'rainbow' };
  const STORE_KEY = 'atelier-aimante:reglages';
  const PLANS_KEY = 'atelier-aimante:plans';
  const STEP_MS = 2800; // aperçu animé : le temps de repérer les pièces de chaque étape
  const MAX_PROMPT = 60000; // octets ; « sample » accepte 64 Kio

  // ================================================================ utilitaires
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

  // Hasard de l'interface (graines, « Surprise ») : crypto, sinon horloge brassée.
  let clockState = 0x9e3779b9;
  function randInt(n) {
    try {
      const a = new Uint32Array(1);
      root.crypto.getRandomValues(a);
      return a[0] % n;
    } catch (e) {
      const t = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
      clockState = (Math.imul(clockState ^ (Date.now() + t * 1000), 2654435761) + 0x6d2b79f5) >>> 0;
      clockState ^= clockState >>> 15;
      return (clockState >>> 0) % n;
    }
  }
  const randSeed = () => 1 + randInt(9999);

  /** Minuscules, sans accents ni ponctuation. */
  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
  const stem = (w) => (w.length > 3 ? w.replace(/[sx]$/, '') : w);
  // Mots vides : jamais comptés comme mots-clés (« de », « la »… ne désignent aucun thème).
  const STOP = new Set('a au aux avec ce ces dans de des du en et il je la le les leur mon ma mes ou par pour sa se ses son sur ta te tes ton tu un une une vers'.split(' '));

  function listThemes() {
    return (MT.themeList || []).filter((t) => t && t.id !== 'selftest' && typeof t.generate === 'function');
  }

  /**
   * Thème le plus proche d'un texte libre : score = nombre de mots-clés du
   * thème trouvés dans le texte (singulier/pluriel confondus). Les mots d'un
   * ou deux caractères et les mots vides sont ignorés des deux côtés.
   */
  function matchTheme(text, themes) {
    const q = normalize(text);
    if (!q) return null;
    const words = q.split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
    const stems = new Set(words.map(stem));
    const padded = ` ${q} `;
    let best = null;
    for (const t of themes) {
      const kws = new Set([...(t.keywords || []), t.id, t.name].map(normalize).filter(Boolean));
      let score = 0;
      for (const kw of kws) {
        let hit;
        if (kw.includes(' ')) hit = padded.includes(` ${kw} `);
        else hit = kw.length >= 3 && !STOP.has(kw) && stems.has(stem(kw));
        if (hit) score++;
      }
      // À égalité, le thème dont l'identifiant est cité l'emporte (« un pont pour les voitures » → pont).
      if (score && stems.has(stem(normalize(t.id)))) score += 0.5;
      if (score > (best ? best.score : 0)) best = { theme: t, score };
    }
    return best;
  }
  /** Le texte est-il exactement le nom ou l'identifiant d'un thème ? */
  function exactTheme(text, themes) {
    const q = normalize(text);
    if (!q) return null;
    return themes.find((t) => normalize(t.id) === q || normalize(t.name) === q || normalize(String(t.name).replace(/&.*$/, '')) === q) || null;
  }

  /**
   * Accroche courte d'une carte : on s'arrête sur une fin d'élément
   * d'énumération (« , » ou « et ») pour ne jamais couper au milieu.
   */
  function shortTagline(s, max) {
    const lim = max || 40;
    s = String(s || '').trim();
    if (s.length <= lim) return s;
    let cut = -1;
    const re = /,\s|\s+et\s|\s+:\s|\s+—\s/g;
    let m;
    while ((m = re.exec(s))) {
      if (m.index <= lim) cut = m.index;
      else break;
    }
    if (cut > 8) return s.slice(0, cut).replace(/\s*[:—]$/, '');
    const sp = s.lastIndexOf(' ', lim - 1);
    return s.slice(0, sp > 8 ? sp : lim - 1) + '…';
  }

  /** « 2,95 × 2,95 in » → « 7,5 × 7,5 cm » (1 pouce = 2,54 cm). */
  function inchesToCm(dims) {
    const s = String(dims || '');
    if (!/\bin\b/.test(s)) return s;
    const fmt = (x) => {
      const v = (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
      return v.endsWith(',0') ? v.slice(0, -2) : v;
    };
    return s.replace(/(\d+(?:,\d+)?)/g, (n) => fmt(parseFloat(n.replace(',', '.')) * 2.54)).replace(/\s*\bin\b/, ' cm');
  }

  // ------------------------------------------------------------------ couleurs
  function hslHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const hx = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
    return '#' + hx(f(0)) + hx(f(8)) + hx(f(4));
  }
  /** Dégradé des étapes : bleu → violet → rose → orange. */
  const stepColor = (t) => hslHex(200 + Math.max(0, Math.min(1, t)) * 185, 74, 54);

  /**
   * Couleur de chaque pièce (tableau indexé par id de placement).
   * rainbow : couleurs du jeu, tirées par graine, jamais deux pièces
   * consécutives de la même couleur ; type : couleur catalogue ; step : dégradé.
   */
  function colorsFor(result, mode) {
    const pl = result.placements;
    const out = [];
    if (mode === 'type') {
      for (const p of pl) out[p.id] = MT.PIECES[p.type].color;
      return out;
    }
    if (mode === 'step') {
      const n = Math.max(1, result.steps.length - 1);
      for (const p of pl) out[p.id] = stepColor(p.step / n);
      return out;
    }
    const pal = MT.RAINBOW;
    const rng = MT.makeRng((Math.imul((result.seed >>> 0) || 1, 2654435761) ^ 0x5bd1e995) >>> 0);
    let prev = -1;
    for (const p of pl) {
      if (p.type === 'CAR') {
        out[p.id] = MT.PIECES.CAR.color;
        continue;
      }
      let i;
      if (prev < 0) i = Math.floor(rng() * pal.length);
      else {
        i = Math.floor(rng() * (pal.length - 1));
        if (i >= prev) i++;
      }
      prev = i;
      out[p.id] = pal[i];
    }
    return out;
  }

  // Nom de couleur accordé au nom de la pièce (« Carré rouge », « Fenêtre double verte »).
  const COLOR_WORDS = {
    red: ['rouge', 'rouge'], orange: ['orange', 'orange'], yellow: ['jaune', 'jaune'], green: ['vert', 'verte'],
    blue: ['bleu', 'bleue'], purple: ['violet', 'violette'], pink: ['rose', 'rose'], navy: ['bleu foncé', 'bleu foncé'],
  };
  const FEMININE = { WIN2: true, ARCH: true, WIN4: true };
  function colorWord(hex, type) {
    const h = String(hex || '').toLowerCase();
    const key = Object.keys(MT.COLORS || {}).find((k) => String(MT.COLORS[k]).toLowerCase() === h);
    const w = key && COLOR_WORDS[key];
    if (!w) return '';
    if (type === 'CR') return /\s|^orange$/.test(w[0]) ? w[0] : w[0] + 's';
    return FEMININE[type] ? w[1] : w[0];
  }

  // ------------------------------------------------------ code de construction
  function makeCode(s) {
    return [s.themeId, s.themeId === 'libre' ? 0 : s.size, s.packs, s.seed].join('-');
  }
  function parseCode(str) {
    const m = /^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)-([0-4])-([12])-([0-9]{1,9})$/.exec(String(str || '').trim().toLowerCase());
    if (!m) return null;
    return { themeId: m[1], size: Number(m[2]), packs: Number(m[3]), seed: Number(m[4]) >>> 0 };
  }

  // ------------------------------------------------------- pièces d'une étape
  const idxCache = new WeakMap();
  function placementIndex(result) {
    let m = idxCache.get(result);
    if (!m) {
      m = new Map(result.placements.map((p) => [p.id, p]));
      idxCache.set(result, m);
    }
    return m;
  }
  function countTypes(result, ids) {
    const byId = placementIndex(result);
    const c = {};
    for (const id of ids) {
      const p = byId.get(id);
      if (p) c[p.type] = (c[p.type] || 0) + 1;
    }
    return MT.PIECE_ORDER.filter((t) => c[t]).map((t) => [t, c[t]]);
  }
  /** Pièces d'une étape regroupées par type et par couleur affichée. */
  function stepGroups(result, ids, colors) {
    const byId = placementIndex(result);
    const map = new Map();
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) continue;
      const color = (colors && colors[p.id]) || MT.PIECES[p.type].color;
      const key = p.type + '|' + color;
      const g = map.get(key) || { type: p.type, color, count: 0 };
      g.count++;
      map.set(key, g);
    }
    const order = (t) => MT.PIECE_ORDER.indexOf(t);
    return [...map.values()].sort((a, b) => order(a.type) - order(b.type) || b.count - a.count);
  }
  const fitsOnePack = (r) => MT.PIECE_ORDER.every((t) => (r.used[t] || 0) <= MT.PACK[t]);
  const totalOf = (inv) => MT.PIECE_ORDER.reduce((s, t) => s + (inv[t] || 0), 0);

  // ===================================================== catalogue pour Claude
  // Familles de pièces interchangeables (même contour) : chacune est un plafond séparé.
  const FAMS = ['carre', 'EQ', 'RT', 'TT', 'demi', 'CAR'];
  const FAM_CODE = { carre: 'carrés', EQ: 'EQ', RT: 'RT', TT: 'TT', demi: 'demi', CAR: 'roues' };
  const famLabel = (f) => (MT.FAMILY_LABEL && MT.FAMILY_LABEL[f]) || FAM_CODE[f] || String(f);
  const famCaps = (packs) => MT.familyCount(MT.inventoryFor(packs === 2 ? 2 : 1));

  /** Pièces demandées par un module (par famille), ou null si le module ne se construit pas. */
  function demandOf(id, params) {
    try {
      const d = MT.moduleDemand(id, params);
      return d && !d.error && d.total ? d : null;
    } catch (e) {
      return null;
    }
  }
  const demandText = (d) => FAMS.filter((f) => d[f]).map((f) => `${FAM_CODE[f]} ${d[f]}`).join(' + ') || '0';
  function deltaText(a, b) {
    if (!a || !b) return '?';
    return FAMS.map((f) => [f, (b[f] || 0) - (a[f] || 0)])
      .filter(([, x]) => x)
      .map(([f, x]) => `${x > 0 ? '+' : '−'}${Math.abs(x)} ${FAM_CODE[f]}`)
      .join(', ');
  }
  function footprintOf(mod, params) {
    const f = mod.footprint(MT.normalizeParams(mod, params));
    return { w: Math.ceil(f.w), d: Math.ceil(f.d) };
  }
  function fpDelta(a, b) {
    const bits = [];
    const dw = b.w - a.w, dd = b.d - a.d;
    if (dw) bits.push(`${dw > 0 ? '+' : '−'}${Math.abs(dw)} x`);
    if (dd) bits.push(`${dd > 0 ? '+' : '−'}${Math.abs(dd)} z`);
    return bits.length ? 'emprise ' + bits.join(' ') : '';
  }
  const joinBits = (...b) => b.filter(Boolean).join(', ');

  /** Un paramètre : bornes, défaut et effet mesuré sur les pièces et l'emprise. */
  function describeParam(mod, k, s, def, c0, fp0) {
    const lbl = s.label && MT.fold(s.label) !== MT.fold(k) ? ` (${s.label})` : '';
    const with_ = (v) => Object.assign({}, def, { [k]: v });
    if (s.type === 'int' || s.type === 'number') {
      const up = def[k] < s.max;
      const other = up ? def[k] + 1 : def[k] - 1;
      let eff = '';
      if (s.max > s.min) {
        const c1 = demandOf(mod.id, with_(other));
        const fp1 = footprintOf(mod, with_(other));
        const [lo, hi, flo, fhi] = up ? [c0, c1, fp0, fp1] : [c1, c0, fp1, fp0];
        eff = ` : ${joinBits(deltaText(lo, hi) || 'même coût', fpDelta(flo, fhi))} par cran`;
      }
      return `${k}${lbl} ${s.min}–${s.max} (défaut ${def[k]})${eff}`;
    }
    if (s.type === 'bool') {
      const alt = !def[k];
      const c1 = demandOf(mod.id, with_(alt));
      const fp1 = footprintOf(mod, with_(alt));
      return `${k}${lbl} true|false (défaut ${def[k]}) ; ${alt} : ${joinBits(deltaText(c0, c1) || 'même coût', fpDelta(fp0, fp1))}`;
    }
    if (s.type === 'enum') {
      const vals = s.values.map((v) => {
        if (v === def[k]) return `"${v}" (défaut)`;
        const c1 = demandOf(mod.id, with_(v));
        const d = joinBits(deltaText(c0, c1), fpDelta(fp0, footprintOf(mod, with_(v))));
        return d ? `"${v}" (${d})` : `"${v}"`;
      });
      return `${k}${lbl} : ${vals.join(' | ')}`;
    }
    return `${k}${lbl} (défaut ${JSON.stringify(def[k])})`;
  }

  let catalogCache = null;
  /**
   * Catalogue des modules (calculé une fois, indépendant du nombre de packs) :
   * description complète, paramètres avec leur effet, emprise et pièces par
   * famille pour les paramètres par défaut et pour une variante réduite.
   */
  function buildCatalog() {
    const mods = MT.moduleList || [];
    if (catalogCache && catalogCache.n === mods.length) return catalogCache.list;
    const list = [];
    for (const mod of mods) {
      try {
        const def = MT.normalizeParams(mod, {});
        const cost = demandOf(mod.id, def);
        if (!cost) continue; // module qui ne construit rien : pas proposé
        const fp = footprintOf(mod, def);
        // Variante réduite : paramètres entiers au minimum, options et styles inchangés
        // (le module reste reconnaissable).
        const small = {};
        for (const [k, s] of Object.entries(mod.params || {})) {
          if ((s.type === 'int' || s.type === 'number') && def[k] > s.min) small[k] = s.min;
        }
        let reduced = null;
        if (Object.keys(small).length) {
          const p = Object.assign({}, def, small);
          const c = demandOf(mod.id, p);
          if (c && c.total < cost.total) reduced = { params: small, cost: c, fp: footprintOf(mod, p) };
        }
        list.push({
          id: mod.id,
          label: mod.label,
          description: String(mod.description || '').trim(),
          params: mod.params || {},
          defaults: def,
          fp,
          cost,
          reduced,
          paramText: Object.entries(mod.params || {}).map(([k, s]) => describeParam(mod, k, s, def, cost, fp)),
        });
      } catch (e) {
        /* module défectueux : ignoré */
      }
    }
    catalogCache = { n: mods.length, list };
    return list;
  }

  /** Coupe un texte à une fin de phrase (ou de mot) sous la limite. */
  function clip(s, n) {
    s = String(s || '');
    if (s.length <= n) return s;
    const cut = s.slice(0, n);
    const dot = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' ; '));
    if (dot > n * 0.5) return cut.slice(0, dot + 1);
    return cut.slice(0, Math.max(cut.lastIndexOf(' '), n * 0.6)) + '…';
  }

  /*
   * Idées de détournement pour le paragraphe CRÉATIVITÉ. Chaque case propose
   * des alternatives ; seules celles dont le module (et la valeur de
   * paramètre) existent dans le catalogue réel sont citées.
   */
  const IDEAS = [
    { theme: 'dragon', slots: [
      [['animal', { espece: 'dragon' }, 'Dragon'], ['c-sphinx', null, 'Dragon endormi']],
      [['donjon', null, 'Donjon du roi'], ['tour', null, 'Tour de guet']],
      [['rempart', null, 'Rempart']],
    ] },
    { theme: 'cirque', slots: [
      [['chapiteau', null, 'Grand chapiteau'], ['donjon', { toit: 'pyramide' }, 'Grand chapiteau']],
      [['c-camping-car', null, 'Roulotte'], ['voiture', null, 'Roulotte']],
      [['animal', { espece: 'lion' }, 'Lion savant'], ['ziggourat', null, 'Gradins']],
    ] },
    { theme: 'pirates', slots: [
      [['bateau', null, 'Bateau pirate']],
      [['tour', { toit: 'creneaux' }, 'Fort des pirates'], ['porte-fortifiee', null, 'Fort des pirates']],
      [['arbre', null, 'Palmier']],
    ] },
    { theme: 'fête foraine', slots: [
      [['grande-roue', null, 'Grande roue'], ['moulin', null, 'Grande roue']],
      [['manege', null, 'Manège'], ['tour', { toit: 'fleche' }, 'Tour de chute libre']],
      [['train', null, 'Petit train']],
    ] },
  ];
  function ideaText(idea, catalog) {
    const byId = new Map(catalog.map((m) => [m.id, m]));
    const bits = [];
    for (const slot of idea.slots) {
      for (const [id, params, label] of slot) {
        const m = byId.get(id);
        if (!m) continue;
        const ok = !params || Object.entries(params).every(([k, v]) => {
          const s = m.params[k];
          return s && (s.type !== 'enum' || s.values.includes(v));
        });
        if (!ok) continue;
        const ps = params ? ' avec ' + Object.entries(params).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(', ') : '';
        bits.push(`"${id}"${ps} = « ${label} »`);
        break;
      }
    }
    return bits.length >= 2 ? `${idea.theme} → ${bits.join(' ; ')}` : '';
  }

  function examplePlan(catalog) {
    const small = catalog.filter((m) => m.fp.w <= 3 && m.fp.d <= 3);
    const pool = small.length >= 2 ? small : catalog;
    const a = pool[Math.floor(pool.length / 3)] || pool[0];
    const b = pool[Math.floor((pool.length * 2) / 3)] || pool[1] || a;
    const items = [];
    if (a) items.push({ module: a.id, x: 2, z: 2, rot: 0, params: a.defaults, label: 'Libellé court' });
    if (b) items.push({ module: b.id, x: 2 + (a ? a.fp.w : 1) + 2, z: 4, rot: 0, params: b.defaults, label: 'Autre libellé' });
    return { title: 'Titre court', summary: 'Une ou deux phrases simples.', items };
  }

  /** Consigne envoyée à Claude pour composer un plan de modules. */
  function buildPrompt(text, packs, catalog, variation, compact) {
    const caps = famCaps(packs);
    const L = [];
    L.push('Tu composes une scène en tuiles magnétiques, un jeu de construction aimanté pour enfants : des pièces plates en plastique (carrés, triangles, demi-rectangles, créneaux, plateaux à roues) qui se collent par leurs bords aimantés.');
    L.push(`Thème demandé : « ${String(text).slice(0, 120)} ».`);
    L.push('La scène est assemblée automatiquement à partir de modules prédéfinis posés sur une grille au sol. Tu choisis les modules, leurs paramètres, leur position, leur orientation et leur ordre.');
    L.push('');
    L.push(`BUDGET (${packs === 2 ? 'double pack, 272 pièces' : '1 pack, 136 pièces'}) — chaque famille est un plafond séparé ; les pièces d’une même famille se remplacent entre elles :`);
    for (const f of FAMS) {
      const name = FAM_CODE[f] === famLabel(f) ? FAM_CODE[f] : `${FAM_CODE[f]} = ${famLabel(f)}`;
      L.push(`- ${name}${f === 'carre' ? ' (pleins, fenêtres, cadres, portes en arche)' : ''} : ${caps[f]}`);
    }
    L.push('Les carrés manquent presque toujours en premier, puis les grands triangles (TT) et les demi. Avant de répondre, additionne les coûts famille par famille avec les paramètres choisis et reste sous chaque plafond ; vise 75 à 95 % des carrés. Si une famille dépasse, baisse un paramètre entier, prends la variante réduite ou retire un module secondaire.');
    L.push('');
    L.push('ORDRE = PRIORITÉ : les items sont construits dans l’ordre de la liste. Quand les pièces manquent, les derniers sont réduits puis supprimés. Mets en premier le module qui porte le thème, puis les éléments secondaires, les décors à la fin.');
    L.push('');
    L.push('REPÈRE ET ORIENTATION :');
    L.push('- x va vers l’est, z vers le sud, c’est-à-dire vers le spectateur. La vue 3D regarde la scène depuis le sud-est, un peu en hauteur.');
    L.push('- Un item occupe [x, x + largeur] × [z, z + profondeur] : x et z (entiers ≥ 0) désignent le coin nord-ouest de son emprise. La scène tient dans un carré de 24 × 24 cases ; reste compact.');
    L.push('- rot vaut 0, 90, 180 ou 270 (quart de tour). À rot 0, portes et façades regardent le sud (+z), vers le spectateur ; à 90 l’est (+x) ; à 180 le nord (dos au spectateur) ; à 270 l’ouest. À 90 et 270, largeur et profondeur s’échangent. Garde rot 0 pour tout ce qui a une façade, sauf raison précise.');
    L.push('- Mets les modules hauts au nord (petits z) et les petits devant (grands z), pour que tout reste visible.');
    L.push('- Laisse au moins 1 case vide entre deux emprises : elles ne doivent ni se chevaucher ni se toucher.');
    L.push('');
    L.push('CATALOGUE DES MODULES (seuls ces identifiants existent). Coûts mesurés en pièces par famille ; « par cran » = effet d’un paramètre entier augmenté de 1 ; emprise = largeur x × profondeur z à rot 0.');
    for (const m of catalog) {
      L.push(`- "${m.id}" — ${m.label} : ${compact ? clip(m.description, 150) : m.description}`);
      if (m.paramText.length) L.push('  Paramètres : ' + m.paramText.join(' ; '));
      const over = FAMS.filter((f) => (m.cost[f] || 0) > caps[f]);
      L.push(`  Par défaut : emprise ${m.fp.w} × ${m.fp.d}, ${plural(m.cost.total, 'pièce', 'pièces')} = ${demandText(m.cost)}.` +
        (over.length ? ` NE TIENT PAS seul dans ${packs === 2 ? 'le double pack' : '1 pack'} (${over.map((f) => `${FAM_CODE[f]} ${m.cost[f]} pour ${caps[f]}`).join(', ')}) : baisse ses paramètres.` : ''));
      if (m.reduced && !compact) {
        L.push(`  Variante réduite (params ${JSON.stringify(m.reduced.params)}) : emprise ${m.reduced.fp.w} × ${m.reduced.fp.d}, ${plural(m.reduced.cost.total, 'pièce', 'pièces')} = ${demandText(m.reduced.cost)}.`);
      }
    }
    L.push('');
    const ideas = IDEAS.map((i) => ideaText(i, catalog)).filter(Boolean).slice(0, 4);
    L.push('CRÉATIVITÉ : choisis et règle les modules pour que la scène évoque clairement le thème. Compose une scène : un élément principal, des éléments secondaires autour. Si aucun module ne porte le nom de ton thème, détourne un module existant et raconte-le par son libellé ; n’invente jamais d’identifiant.' +
      (ideas.length ? ' Exemples tirés de ce catalogue : ' + ideas.join(' · ') + '.' : ''));
    L.push('Donne à chaque module un libellé court et évocateur en français (label, 40 caractères au plus). Le titre est court et joyeux ; le résumé tient en une ou deux phrases simples, pour un enfant.');
    L.push(`Entre 4 et 8 modules${packs === 2 ? ' (jusqu’à 10 en double pack)' : ''}.`);
    if (variation) L.push(`VARIANTE n° ${variation} : propose une composition nettement différente d’une réponse habituelle (autres modules, autre disposition ou autres paramètres).`);
    L.push('');
    L.push('FORMAT DE RÉPONSE : réponds UNIQUEMENT avec un objet JSON, sans texte avant ni après. Recopie les identifiants de modules, les noms de paramètres et les valeurs exactement comme dans le catalogue, sans accent. Les booléens s’écrivent true ou false, sans guillemets ; x, z et rot sont des nombres.');
    L.push('{ "title": "…", "summary": "…", "items": [{ "module": "id", "x": 0, "z": 0, "rot": 0, "params": { … }, "label": "…" }] }');
    L.push('Exemple de forme seulement, pas de contenu à reprendre : ' + JSON.stringify(examplePlan(catalog)));
    return L.join('\n');
  }

  function utf8Length(str) {
    try {
      return new TextEncoder().encode(str).length;
    } catch (e) {
      return str.length * 2;
    }
  }

  /**
   * Plan renvoyé par Claude → plan propre pour MT.compose : rot en nombre,
   * x/z numériques, textes bornés (MT.compose tolère déjà accents et casse).
   */
  function sanitizePlan(plan) {
    const items = (Array.isArray(plan.items) ? plan.items : [])
      .filter((it) => it && typeof it === 'object' && typeof it.module === 'string' && it.module.trim())
      .slice(0, 16)
      .map((it) => {
        const rot = ((Math.round((Number(it.rot) || 0) / 90) * 90) % 360 + 360) % 360;
        return {
          module: it.module.trim(),
          x: Math.max(0, Math.min(30, Math.round(Number(it.x) || 0))),
          z: Math.max(0, Math.min(30, Math.round(Number(it.z) || 0))),
          rot,
          params: it.params && typeof it.params === 'object' && !Array.isArray(it.params) ? it.params : {},
          label: typeof it.label === 'string' ? it.label.trim().slice(0, 40) : undefined,
        };
      });
    return {
      title: typeof plan.title === 'string' ? plan.title.trim().slice(0, 80) : '',
      summary: typeof plan.summary === 'string' ? plan.summary.trim().slice(0, 300) : '',
      items,
    };
  }

  /** Rapport de MT.compose en phrases pour un enfant (libellés, familles manquantes, adaptations). */
  function reportLines(report) {
    if (!report || !report.length) return [];
    const L = [];
    const lab = (x) => `« ${x.label || x.module} »`;
    const byFam = new Map();
    const noRoom = [];
    for (const x of report) {
      if (x.status !== 'skipped') continue;
      const fams = (x.missing || []).filter(Boolean);
      if (!fams.length) {
        noRoom.push(x);
        continue;
      }
      const key = fams.map(famLabel).join(' ni de ');
      if (!byFam.has(key)) byFam.set(key, []);
      byFam.get(key).push(x);
    }
    for (const [fam, xs] of byFam) L.push(`Pas assez de ${fam} pour ${xs.map(lab).join(', ')} : mis de côté.`);
    if (noRoom.length) L.push(`Pas pu poser ${noRoom.map(lab).join(', ')}.`);
    const reduced = report.filter((x) => x.status === 'reduced');
    if (reduced.length) L.push(`${reduced.map(lab).join(', ')} : en plus petit, pour tenir dans la boîte.`);
    for (const x of report) {
      if (x.status === 'skipped' || !x.notes || !x.notes.length) continue;
      L.push(`${lab(x)} : ${x.notes.join(' ; ')}.`);
    }
    const unknown = report.filter((x) => x.status === 'unknown');
    if (unknown.length) L.push(`${plural(unknown.length, 'module inconnu ignoré', 'modules inconnus ignorés')} : ${unknown.map(lab).join(', ')}.`);
    return L;
  }
  /** Résumé d'une ligne (compatibilité, fiche de montage). */
  function reportText(report) {
    if (!report || !report.length) return '';
    const L = reportLines(report);
    return L.length ? L.join(' ') : 'Tous les modules sont posés comme prévu.';
  }

  /** Fiche de montage en Markdown. */
  function ficheMarkdown(r, code) {
    const L = [];
    const total = totalOf(r.available);
    L.push(`# ${r.title}`);
    L.push('');
    const meta = [`Code : \`${code}\``];
    if (r.size) meta.push(`taille ${SIZE_NAMES[r.size]}`);
    meta.push(r.packs === 2 ? 'double pack' : '1 pack');
    meta.push(`${r.pieceCount} pièces sur ${total}`);
    L.push(meta.join(' · '));
    if (r.summary) {
      L.push('');
      L.push(r.summary);
    }
    if (r.themeId === 'libre' && r.report) {
      const rep = reportLines(r.report);
      if (rep.length) {
        L.push('');
        for (const x of rep) L.push(`- ${x}`);
      }
    }
    L.push('');
    L.push('## Pièces');
    L.push('');
    L.push('| Pièce | Dimensions | Utilisées | Disponibles | Reste |');
    L.push('|---|---|--:|--:|--:|');
    for (const t of MT.PIECE_ORDER) {
      const P = MT.PIECES[t];
      const used = r.used[t] || 0;
      L.push(`| ${P.name} | ${inchesToCm(P.dims)} | ${used} | ${r.available[t]} | ${r.available[t] - used} |`);
    }
    L.push('');
    L.push('## Étapes de montage');
    const n = r.steps.length;
    r.steps.forEach((s, k) => {
      L.push('');
      L.push(`### Étape ${k + 1} / ${n} — ${s.label}`);
      L.push('');
      for (const [t, q] of countTypes(r, s.ids)) L.push(`- ${q} × ${MT.PIECES[t].name}`);
    });
    L.push('');
    L.push('_Fiche préparée avec Atelier Aimanté._');
    L.push('');
    return L.join('\n');
  }

  // ============================================================ rendu isométrique
  // Sert aux vignettes des thèmes et à l'aperçu 2D (chargement, ou sans WebGL).
  const V = MT.vec;
  function isoCamera(az, el) {
    const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
    const eye = [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
    const d = [-eye[0], -eye[1], -eye[2]];
    let right = V.norm(V.cross(d, [0, 1, 0]));
    if (V.len(right) < 0.5) right = [1, 0, 0];
    const up = V.cross(right, d);
    return { eye, right, up };
  }
  function prepare(result) {
    return result.placements.map((p) => {
      const sh = MT.PIECES[p.type];
      const ring = (r) => r.map(([x, y]) => MT.worldPoint(p, x, y));
      const it = { p, rings: [ring(sh.outline), ...sh.holes.map(ring)], c: MT.worldCentroid(p) };
      if (p.type === 'CAR') {
        it.wheels = [[0.4, -0.02], [1.6, -0.02], [0.4, 1.02], [1.6, 1.02]].map(([x, y]) => {
          const w = MT.worldPoint(p, x, y);
          w[1] = MT.CAR.wheelR;
          return w;
        });
      }
      return it;
    });
  }
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  /**
   * Dessine une construction en projection orthographique, polygones triés
   * par profondeur. o : { az, el, colors, visible(p) → 1|0.5|0, highlight,
   * current, explode, grid, dark, pad, padTop, padBottom, maxScale }.
   * Renvoie les polygones dessinés (coordonnées écran) pour le survol.
   */
  function drawIso(ctx, W, H, prep, o) {
    if (!prep.length) return [];
    const cam = isoCamera(o.az, o.el);
    const ex = o.explode || 0;
    let cx = 0, cz = 0;
    for (const it of prep) {
      cx += it.c[0];
      cz += it.c[2];
    }
    cx /= prep.length;
    cz /= prep.length;
    const offOf = (it) => (ex ? [(it.c[0] - cx) * ex * 0.6, it.c[1] * ex * 0.45, (it.c[2] - cz) * ex * 0.6] : null);
    const proj = (q) => [V.dot(q, cam.right), -V.dot(q, cam.up)];
    const items = prep.map((it) => {
      const d = offOf(it);
      const mv = d ? (q) => [q[0] + d[0], q[1] + d[1], q[2] + d[2]] : (q) => q;
      return { it, rings: it.rings.map((r) => r.map(mv)), wheels: it.wheels ? it.wheels.map(mv) : null };
    });
    // Cadrage sur toute la construction (stable d'une étape à l'autre).
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let gx0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gz1 = -Infinity;
    for (const m of items) {
      for (const q of m.rings[0]) {
        const [sx, sy] = proj(q);
        x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
        gx0 = Math.min(gx0, q[0]); gz0 = Math.min(gz0, q[2]); gx1 = Math.max(gx1, q[0]); gz1 = Math.max(gz1, q[2]);
      }
    }
    const pad = o.pad == null ? 8 : o.pad;
    const pt = o.padTop == null ? pad : o.padTop, pb = o.padBottom == null ? pad : o.padBottom;
    let s = Math.min((W - 2 * pad) / Math.max(x1 - x0, 0.5), (H - pt - pb) / Math.max(y1 - y0, 0.5));
    if (o.maxScale) s = Math.min(s, o.maxScale);
    s = Math.max(s, 1);
    const ox = W / 2 - ((x0 + x1) / 2) * s, oy = pt + (H - pt - pb) / 2 - ((y0 + y1) / 2) * s;
    const T = (q) => {
      const [sx, sy] = proj(q);
      return [ox + sx * s, oy + sy * s];
    };
    const ink = o.dark ? '230,236,245' : '20,26,38';
    if (o.grid) {
      const a = Math.floor(gx0) - 1, b = Math.ceil(gx1) + 1, c = Math.floor(gz0) - 1, d = Math.ceil(gz1) + 1;
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${ink},${o.dark ? 0.08 : 0.1})`;
      ctx.beginPath();
      for (let i = a; i <= b; i++) {
        const p0 = T([i, 0, c]), p1 = T([i, 0, d]);
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
      }
      for (let j = c; j <= d; j++) {
        const p0 = T([a, 0, j]), p1 = T([b, 0, j]);
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
      }
      ctx.stroke();
    }
    const polys = [];
    for (const m of items) {
      const vis = o.visible ? o.visible(m.it.p) : 1;
      if (!vis) continue;
      const depth = m.rings[0].reduce((acc, q) => acc + V.dot(q, cam.eye), 0) / m.rings[0].length;
      polys.push({ p: m.it.p, rings: m.rings.map((r) => r.map(T)), depth, vis });
      if (m.wheels) for (const w of m.wheels) polys.push({ p: m.it.p, wheel: T(w), depth: V.dot(w, cam.eye) - 0.01, vis });
    }
    polys.sort((a, b) => a.depth - b.depth);
    const hl = o.highlight || null;
    const lw = Math.max(0.8, Math.min(1.6, s / 40));
    for (const pl of polys) {
      const ghost = pl.vis < 1;
      const dim = hl && pl.p.type !== hl;
      const past = o.current != null && pl.p.step < o.current && !ghost;
      if (pl.wheel) {
        ctx.globalAlpha = ghost ? 0.12 : dim ? 0.2 : 1;
        ctx.fillStyle = o.dark ? '#0b0e13' : '#23262d';
        ctx.beginPath();
        ctx.arc(pl.wheel[0], pl.wheel[1], Math.max(2, MT.CAR.wheelR * s * 0.9), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.beginPath();
      for (const ring of pl.rings) {
        ring.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.closePath();
      }
      ctx.fillStyle = (o.colors && o.colors[pl.p.id]) || MT.PIECES[pl.p.type].color;
      ctx.globalAlpha = ghost ? 0.08 : dim ? 0.1 : past ? 0.45 : o.fillAlpha || 0.8;
      ctx.fill('evenodd');
      ctx.globalAlpha = 1;
      if (ghost) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = `rgba(${ink},0.28)`;
        ctx.lineWidth = 1;
      } else if (o.current != null && pl.p.step === o.current && !hl) {
        ctx.strokeStyle = o.accent || '#F2641D';
        ctx.lineWidth = lw + 1.6;
      } else {
        ctx.strokeStyle = `rgba(${ink},${dim ? 0.18 : past ? 0.4 : 0.72})`;
        ctx.lineWidth = lw;
      }
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.setLineDash([]);
    }
    return polys;
  }

  // ------------------------------------------------------------ exports purs
  MT.appUtil = {
    normalize, matchTheme, exactTheme, listThemes, colorsFor, stepColor, colorWord, makeCode, parseCode,
    countTypes, stepGroups, buildCatalog, buildPrompt, sanitizePlan, reportLines, reportText, ficheMarkdown,
    fitsOnePack, drawIso, prepare, shortTagline, inchesToCm, randSeed,
  };

  const doc = root.document;
  if (!doc || typeof doc.getElementById !== 'function') return;

  // ============================================================== interface
  const $ = (id) => doc.getElementById(id);
  const S = {
    themeId: DEFAULTS.themeId,
    size: DEFAULTS.size,
    packs: DEFAULTS.packs,
    seed: DEFAULTS.seed,
    colorMode: DEFAULTS.colorMode,
    plan: null,
    planText: '',
    result: null,
    code: '',
    colors: [],
    step: null,
    playing: false,
    timer: 0,
    ghost: true,
    explode: 0,
    autoRotate: false,
    viewer: null,
    viewerKind: 'none',
    sample: null,
    aiOn: false,
    aiCtl: null,
    aiAbortWhy: '',
    aiTick: 0,
    downloads: null,
    dark: false,
    mouse: null,
  };

  const store = {
    get(key, def) {
      try {
        const v = root.localStorage.getItem(key);
        return v ? JSON.parse(v) : def;
      } catch (e) {
        return def;
      }
    },
    set(key, v) {
      try {
        root.localStorage.setItem(key, JSON.stringify(v));
      } catch (e) {
        /* stockage indisponible : sans conséquence */
      }
    },
  };
  function logErr(e) {
    try {
      root.console && root.console.error('[Atelier Aimanté]', e);
    } catch (x) {
      /* rien */
    }
  }
  function cssVar(name) {
    try {
      return getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
    } catch (e) {
      return '';
    }
  }
  const narrow = () => {
    try {
      return root.matchMedia('(max-width: 699px)').matches;
    } catch (e) {
      return false;
    }
  };

  // ------------------------------------------------------------ thème sombre
  function computeDark() {
    const t = doc.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    try {
      return !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) {
      return false;
    }
  }
  function watchDark() {
    const update = () => {
      const d = computeDark();
      if (d === S.dark) return;
      S.dark = d;
      if (S.viewer) S.viewer.setDark(d);
      paintAllThumbs();
    };
    try {
      const mq = root.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', update);
      else if (mq.addListener) mq.addListener(update);
    } catch (e) {
      /* rien */
    }
    try {
      new MutationObserver(update).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    } catch (e) {
      /* rien */
    }
  }

  // ================================================================ la vue
  /**
   * Enveloppe le viewer Three.js (js/viewer.js) : une méthode absente ou qui
   * lève une exception ne casse jamais l'interface.
   */
  function adaptViewer(v) {
    const call = (name, ...args) => {
      if (!v || typeof v[name] !== 'function') return undefined;
      try {
        return v[name](...args);
      } catch (e) {
        logErr(e);
        return undefined;
      }
    };
    return {
      kind: '3d',
      raw: v,
      setResult: (r, colors) => call('setBuild', r, { colors }),
      setColors: (c) => call('setColors', c),
      setStep: (k) => call('setStep', k),
      setGhost: (b) => call('setGhost', b),
      setExplode: (t) => call('setExplode', t),
      setAutoRotate: (b) => call('setAutoRotate', b),
      resetView: () => call('resetView'),
      highlightType: (t) => call('highlightType', t),
      setDark: (b) => call('setDark', b),
      screenshot: () => call('screenshot'),
      dispose: () => call('dispose'),
    };
  }

  /** Aperçu 2D : pendant le chargement de Three.js, ou à la place de la 3D sans WebGL. */
  function createFallbackViewer(host, opts) {
    const cv = doc.createElement('canvas');
    cv.setAttribute('aria-label', 'Aperçu 2D de la construction');
    cv.setAttribute('role', 'img');
    host.appendChild(cv);
    const ctx = cv.getContext('2d');
    const st = { az: -45, el: 30, prep: [], colors: [], step: null, ghost: true, hl: null, explode: 0, auto: false, dark: !!opts.dark, polys: [], dpr: 1, raf: 0, drag: null, dead: false };
    const draw = () => {
      if (!ctx || st.dead) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      const W = cv.width / st.dpr, H = cv.height / st.dpr;
      st.polys = drawIso(ctx, W, H, st.prep, {
        az: st.az, el: st.el, colors: st.colors, explode: st.explode, grid: true, dark: st.dark,
        pad: 28, padTop: 60, padBottom: 64, maxScale: 90, highlight: st.hl, current: st.step,
        accent: cssVar('--accent') || '#F2641D',
        visible: (p) => (st.step == null || p.step <= st.step ? 1 : st.ghost ? 0.5 : 0),
      });
    };
    const resize = () => {
      if (st.dead) return;
      const r = host.getBoundingClientRect();
      st.dpr = Math.min(2, root.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * st.dpr));
      cv.height = Math.max(1, Math.round(r.height * st.dpr));
      draw();
    };
    let ro = null;
    try {
      ro = new ResizeObserver(resize);
      ro.observe(host);
    } catch (e) {
      root.addEventListener('resize', resize);
    }
    const loop = () => {
      if (!st.auto || st.dead) {
        st.raf = 0;
        return;
      }
      st.az += 0.35;
      draw();
      st.raf = root.requestAnimationFrame(loop);
    };
    const hit = (ev) => {
      const r = cv.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      for (let i = st.polys.length - 1; i >= 0; i--) {
        const pl = st.polys[i];
        if (pl.wheel || pl.vis < 1) continue;
        if (pointInPoly(x, y, pl.rings[0])) return pl.p;
      }
      return null;
    };
    cv.addEventListener('pointerdown', (ev) => {
      st.drag = { x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY };
    });
    cv.addEventListener('pointermove', (ev) => {
      if (st.drag) {
        st.az += (ev.clientX - st.drag.x) * 0.5;
        st.el = Math.max(6, Math.min(80, st.el + (ev.clientY - st.drag.y) * 0.3));
        st.drag.x = ev.clientX;
        st.drag.y = ev.clientY;
        draw();
        return;
      }
      const p = hit(ev);
      if (opts.onHover) opts.onHover(p, { clientX: ev.clientX, clientY: ev.clientY });
    });
    cv.addEventListener('pointerup', (ev) => {
      const d = st.drag;
      st.drag = null;
      if (d && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 5 && opts.onPick) {
        const p = hit(ev);
        if (p) opts.onPick(p);
      }
    });
    cv.addEventListener('pointercancel', () => {
      st.drag = null;
    });
    cv.addEventListener('pointerleave', () => {
      st.drag = null;
      if (opts.onHover) opts.onHover(null, null);
    });
    resize();
    return {
      kind: '2d',
      setResult(r, colors) {
        st.prep = r ? prepare(r) : [];
        st.colors = colors || [];
        st.step = null;
        draw();
      },
      setColors(c) {
        st.colors = c || [];
        draw();
      },
      setStep(k) {
        st.step = k == null ? null : k;
        draw();
      },
      setGhost(b) {
        st.ghost = !!b;
        draw();
      },
      setExplode(t) {
        st.explode = +t || 0;
        draw();
      },
      setAutoRotate(b) {
        st.auto = !!b;
        if (st.auto && !st.raf) st.raf = root.requestAnimationFrame(loop);
      },
      resetView() {
        st.az = -45;
        st.el = 30;
        draw();
      },
      highlightType(t) {
        st.hl = t || null;
        draw();
      },
      setDark(b) {
        st.dark = !!b;
        draw();
      },
      screenshot() {
        return new Promise((res) => {
          try {
            cv.toBlob((b) => res(b), 'image/png');
          } catch (e) {
            res(null);
          }
        });
      },
      dispose() {
        st.dead = true;
        if (st.raf) root.cancelAnimationFrame(st.raf);
        if (ro) ro.disconnect();
        else root.removeEventListener('resize', resize);
        if (cv.parentNode) cv.parentNode.removeChild(cv);
      },
      resize,
    };
  }

  function setStageNote(text, soft) {
    const n = $('stage-note');
    n.textContent = text || '';
    n.hidden = !text;
    n.classList.toggle('is-soft', !!soft);
  }

  /** Réapplique l'état courant (construction, couleurs, étape…) au viewer. */
  function syncViewer() {
    const v = S.viewer;
    if (!v) return;
    v.setDark(S.dark);
    v.setResult(S.result || { placements: [], steps: [] }, S.colors);
    v.setColors(S.colors);
    v.setGhost(S.ghost);
    v.setExplode(S.explode);
    v.setAutoRotate(S.autoRotate);
    v.highlightType(null);
    v.setStep(S.result ? S.step : null);
  }
  function disposeViewer() {
    const v = S.viewer;
    S.viewer = null;
    if (!v) return;
    try {
      if (v.dispose) v.dispose();
      else if (v.raw && typeof v.raw.dispose === 'function') v.raw.dispose();
    } catch (e) {
      logErr(e);
    }
    $('viewer-host').textContent = '';
  }
  function useFallback(note, soft) {
    disposeViewer();
    $('viewer-host').textContent = '';
    S.viewer = createFallbackViewer($('viewer-host'), { dark: S.dark, onHover: onViewerHover, onPick: onViewerPick });
    S.viewerKind = '2d';
    setStageNote(note || '', soft);
    $('tool-recenter').title = 'Revenir à la vue de départ';
    syncViewer();
  }

  const threeReady = () => !!(root.THREE && root.THREE.WebGLRenderer && root.THREE.OrbitControls);
  /** Tente la vue 3D ; renvoie un message d'échec (vide si la 3D tourne). */
  function tryViewer3d() {
    if (!root.THREE || !root.THREE.WebGLRenderer) return 'La vue 3D n’a pas pu se charger (bibliothèque Three.js indisponible).';
    if (!root.THREE.OrbitControls) return 'Les contrôles de la vue 3D n’ont pas pu se charger.';
    if (typeof MT.createViewer !== 'function') return 'La vue 3D n’est pas disponible.';
    let v = null;
    try {
      v = MT.createViewer({ container: $('viewer-host'), THREE: root.THREE, onHover: onViewerHover, onPick: onViewerPick });
    } catch (e) {
      try {
        root.console && root.console.warn('[Atelier Aimanté] vue 3D indisponible :', e && e.message);
      } catch (x) {
        /* rien */
      }
      v = null;
    }
    if (!v) return 'La vue 3D n’a pas démarré : WebGL semble désactivé sur cet appareil.';
    S.viewer = adaptViewer(v);
    S.viewerKind = '3d';
    $('tool-recenter').title = 'Recentrer la vue';
    setStageNote('');
    syncViewer();
    return '';
  }
  const FALLBACK_TAIL = ' Aperçu 2D à la place : fais-le tourner en glissant. La liste des pièces et les étapes fonctionnent normalement.';
  /**
   * Three.js arrive en différé (scripts defer) : l'interface démarre avec
   * l'aperçu 2D, puis passe en 3D dès que la bibliothèque est prête.
   */
  function setupViewer() {
    if (threeReady()) {
      $('viewer-host').textContent = '';
      const why = tryViewer3d();
      if (why) useFallback(why + FALLBACK_TAIL);
      return;
    }
    useFallback('Chargement de la vue 3D…', true);
    let done = false;
    // RoomEnvironment (reflets) est attendu aussi, sauf au dernier essai (script en échec).
    const attempt = (final) => {
      if (done) return;
      if (threeReady() && (final || root.THREE.RoomEnvironment)) {
        done = true;
        disposeViewer();
        const why = tryViewer3d();
        if (why) useFallback(why + FALLBACK_TAIL);
      } else if (final) {
        done = true;
        setStageNote((tryViewerReason() || 'La vue 3D n’a pas pu se charger.') + FALLBACK_TAIL);
      }
    };
    for (const s of doc.querySelectorAll('script[src]')) {
      if (/three/i.test(s.getAttribute('src') || '')) {
        s.addEventListener('load', () => attempt(false));
        s.addEventListener('error', () => attempt(false));
      }
    }
    doc.addEventListener('DOMContentLoaded', () => attempt(false));
    if (doc.readyState === 'complete') setTimeout(() => attempt(true), 0);
    else root.addEventListener('load', () => attempt(true));
  }
  function tryViewerReason() {
    if (!root.THREE || !root.THREE.WebGLRenderer) return 'La vue 3D n’a pas pu se charger (bibliothèque Three.js indisponible).';
    if (!root.THREE.OrbitControls) return 'Les contrôles de la vue 3D n’ont pas pu se charger.';
    return '';
  }

  // ------------------------------------------------------------- info-bulle
  /** Survol d'une pièce : onHover(placement | null, { clientX, clientY }). */
  function onViewerHover(p, pos) {
    const tip = $('tip');
    const r = S.result;
    if (p && typeof p.id === 'number' && !p.type && r) p = placementIndex(r).get(p.id);
    if (!p || !r || !MT.PIECES[p.type]) {
      tip.hidden = true;
      return;
    }
    const st = r.steps[p.step];
    tip.innerHTML = `<b>${esc(MT.PIECES[p.type].name)}</b><span>Étape ${p.step + 1}${st ? ' · ' + esc(st.label) : ''}</span>`;
    tip.hidden = false;
    const stage = $('stage').getBoundingClientRect();
    const mx = pos && pos.clientX ? pos.clientX : S.mouse ? S.mouse.x : stage.left + stage.width / 2;
    const my = pos && pos.clientY ? pos.clientY : S.mouse ? S.mouse.y : stage.top + stage.height / 2;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = mx - stage.left + 14, y = my - stage.top + 16;
    if (x + tw > stage.width - 6) x = mx - stage.left - tw - 12;
    if (y + th > stage.height - 6) y = my - stage.top - th - 12;
    tip.style.left = Math.max(6, x) + 'px';
    tip.style.top = Math.max(6, y) + 'px';
  }

  /** Clic sur une pièce : la notice saute à l'étape où on la pose. */
  function onViewerPick(p) {
    if (!p || !S.result || typeof p.step !== 'number') return;
    stopPlay();
    setStep(p.step);
  }

  // ============================================================== vignettes
  const thumbCache = new Map();
  function paintThumb(cv, entry) {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawIso(ctx, w, h, entry.prep, { az: -40, el: 26, colors: entry.colors, pad: 6, dark: S.dark, fillAlpha: 0.84 });
  }
  function paintAllThumbs() {
    for (const [id, entry] of thumbCache) {
      const card = $('theme-' + id);
      const cv = card && card.querySelector('canvas');
      if (cv) paintThumb(cv, entry);
    }
  }
  /** Calcule les vignettes une par une, sans bloquer l'affichage. */
  function buildThumbs() {
    const queue = listThemes().filter((t) => !thumbCache.has(t.id));
    const next = () => {
      const t = queue.shift();
      if (!t) {
        warmCatalog();
        return;
      }
      let entry;
      try {
        const r = MT.generate(t.id, { size: 1, packs: 1, seed: 1 });
        entry = { prep: prepare(r), colors: colorsFor(r, 'rainbow') };
      } catch (e) {
        logErr(e);
        entry = { prep: [], colors: [] };
      }
      thumbCache.set(t.id, entry);
      const card = $('theme-' + t.id);
      const cv = card && card.querySelector('canvas');
      if (cv) paintThumb(cv, entry);
      setTimeout(next, 16);
    };
    setTimeout(next, 30);
  }

  // =========================================================== grille de thèmes
  function renderThemeGrid() {
    const grid = $('theme-grid');
    grid.textContent = '';
    const themes = listThemes();
    for (const t of themes) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'theme-card';
      b.id = 'theme-' + t.id;
      b.setAttribute('aria-pressed', 'false');
      const tag = t.short || shortTagline(t.tagline, 40);
      if (t.tagline) {
        b.title = `${t.name} : ${t.tagline}`;
        b.setAttribute('aria-label', `${t.name} : ${t.tagline}`);
      }
      b.innerHTML =
        `<canvas class="thumb" aria-hidden="true"></canvas>` +
        `<span class="name">${esc(t.name)}</span>` +
        `<span class="tag">${esc(tag)}</span>`;
      b.addEventListener('click', () => pickTheme(t.id));
      grid.appendChild(b);
    }
    const s = doc.createElement('button');
    s.type = 'button';
    s.className = 'theme-card surprise';
    s.id = 'theme-surprise';
    const icons = [['SQ', MT.COLORS.red], ['EQ', MT.COLORS.yellow], ['TT', MT.COLORS.blue], ['RT', MT.COLORS.green]];
    s.innerHTML =
      `<span class="thumb" aria-hidden="true">${icons.map(([t, c]) => MT.pieceIconSVG(t, { size: 26, color: c })).join('')}</span>` +
      `<span class="name">Surprise</span><span class="tag">Un thème et une variante au hasard</span>`;
    s.addEventListener('click', surprise);
    grid.appendChild(s);
    if (!themes.length) {
      const p = doc.createElement('p');
      p.className = 'hint';
      p.textContent = 'Aucun thème n’est chargé.';
      grid.prepend(p);
    }
  }
  function markSelectedTheme() {
    for (const b of $('theme-grid').querySelectorAll('.theme-card')) {
      b.setAttribute('aria-pressed', String(b.id === 'theme-' + S.themeId));
    }
  }

  // ============================================================== génération
  function currentThemeValid() {
    return S.themeId !== 'selftest' && !!MT.themes && !!MT.themes[S.themeId];
  }
  function regenerate() {
    stopPlay();
    let r;
    try {
      if (S.themeId === 'libre' && S.plan) {
        // Idée toute prête : on prend le plan prévu pour le nombre de packs choisi.
        const pre = (MT.PRESET_PLANS || []).find((p) => p.plans[1] === S.plan || p.plans[2] === S.plan);
        if (pre) S.plan = pre.plans[S.packs] || S.plan;
        r = MT.compose(S.plan, { packs: S.packs, seed: S.seed });
      } else {
        if (!currentThemeValid()) {
          const themes = listThemes();
          const pick = themes.find((t) => t.id === DEFAULTS.themeId) || themes[0];
          if (!pick) {
            showNothing('Aucun thème n’est chargé : impossible de proposer une construction.');
            return false;
          }
          S.themeId = pick.id;
          S.plan = null;
        }
        r = MT.generate(S.themeId, { size: S.size, packs: S.packs, seed: S.seed });
      }
    } catch (e) {
      logErr(e);
      showNothing('Cette construction n’a pas pu être générée. Essaie une autre variante ou un autre thème.');
      return false;
    }
    showResult(r);
    return true;
  }

  /** Aucune construction : tout ce qui décrivait l'ancienne est vidé. */
  function showNothing(msg) {
    stopPlay();
    S.result = null;
    S.step = null;
    S.code = '';
    S.colors = [];
    if (S.viewer) S.viewer.setResult({ placements: [], steps: [] }, []);
    $('res-title').textContent = 'Pas de construction';
    $('res-summary').textContent = msg;
    $('res-summary').hidden = false;
    $('res-eyebrow').textContent = '';
    $('res-count').textContent = '';
    $('res-badge').hidden = true;
    $('res-solid').hidden = true;
    $('res-downsized').hidden = true;
    $('res-report').hidden = true;
    $('head-start').hidden = true;
    $('parts').textContent = '';
    $('parts-total').textContent = '';
    $('checks').textContent = '';
    $('solid-sum').textContent = '';
    $('build-code').textContent = '—';
    $('dl-row').hidden = true;
    $('tool-shot').hidden = true;
    renderStep();
  }

  /** Affiche un résultat (de MT.generate ou MT.compose). */
  function showResult(r) {
    stopPlay();
    S.result = r;
    S.step = null;
    S.colors = colorsFor(r, S.colorMode);
    if (r.themeId && r.themeId !== 'libre') {
      S.themeId = r.themeId;
      if (r.requestedSize) S.size = r.requestedSize;
    }
    S.packs = r.packs;
    S.seed = r.seed >>> 0;
    S.code = makeCode(S);
    if (S.viewer) {
      S.viewer.setResult(r, S.colors);
      S.viewer.setColors(S.colors);
      S.viewer.setGhost(S.ghost);
      S.viewer.setExplode(S.explode);
      S.viewer.setStep(null);
      S.viewer.highlightType(null);
    }
    $('tip').hidden = true;
    renderHead();
    renderChecks();
    renderParts();
    renderStep();
    syncControls();
    markSelectedTheme();
    if (S.downloads) {
      $('dl-row').hidden = false;
      $('tool-shot').hidden = false;
    }
    saveState();
    try {
      if (root.history && root.history.replaceState) root.history.replaceState(null, '', '#' + S.code);
    } catch (e) {
      /* ancre non modifiable ici */
    }
  }

  function saveState() {
    store.set(STORE_KEY, {
      themeId: S.themeId,
      size: S.size,
      packs: S.packs,
      seed: S.seed,
      colorMode: S.colorMode,
      freeText: $('free-text').value || '',
      ghost: S.ghost,
    });
    if (S.themeId === 'libre' && S.plan && S.code) {
      const plans = store.get(PLANS_KEY, {}) || {};
      plans[S.code] = { plan: S.plan, text: S.planText, t: Date.now() };
      const keys = Object.keys(plans).sort((a, b) => (plans[b].t || 0) - (plans[a].t || 0));
      for (const k of keys.slice(12)) delete plans[k];
      store.set(PLANS_KEY, plans);
    }
  }

  // ---------------------------------------------------------- en-tête résultat
  function renderHead() {
    const r = S.result;
    const libre = r.themeId === 'libre';
    const theme = MT.themes && MT.themes[r.themeId];
    const eyebrow = libre
      ? `Thème libre · « ${S.planText || 'idée'} »`
      : `${theme ? theme.name : r.themeId} · taille ${SIZE_NAMES[r.size] || '?'}`;
    $('res-eyebrow').textContent = eyebrow;
    $('res-title').textContent = r.title || (theme ? theme.name : 'Construction');
    $('res-summary').textContent = r.summary || '';
    $('res-summary').hidden = !r.summary;
    const total = totalOf(r.available);
    $('res-count').innerHTML = `<b>${r.pieceCount}</b> pièces sur ${total}`;
    const one = fitsOnePack(r);
    const badge = $('res-badge');
    badge.hidden = false;
    badge.className = 'badge ' + (one ? 'is-one' : 'is-two');
    badge.textContent = one ? '1 pack suffit' : 'Double pack requis';

    const box = $('res-downsized');
    const toDouble = $('to-double');
    box.hidden = true;
    toDouble.hidden = true;
    if (!libre && r.downsized) {
      $('res-downsized-text').textContent =
        r.packs === 1
          ? `Réduite à la taille ${SIZE_NAMES[r.size]} pour tenir dans un pack.${r.doubleFits ? ' Avec le double pack, la taille demandée tiendrait.' : ''}`
          : `Réduite à la taille ${SIZE_NAMES[r.size]} pour tenir dans les deux packs.`;
      toDouble.hidden = !(r.packs === 1 && r.doubleFits);
      box.hidden = false;
    } else if (libre && r.packs === 1 && r.doubleFits) {
      $('res-downsized-text').textContent = 'Avec le double pack, tous les modules prévus par Claude tiendraient en entier.';
      toDouble.hidden = false;
      box.hidden = false;
    }

    const rep = $('res-report');
    if (libre) {
      const lines = reportLines(r.report);
      const placed = (r.report || []).filter((x) => x.status !== 'skipped' && x.status !== 'unknown').length;
      rep.innerHTML =
        `<p class="is-lead">Composée par Claude avec ${plural(placed, 'module', 'modules')}${lines.length ? ' :' : ', tous posés comme prévu.'}</p>` +
        lines.map((l) => `<p>${esc(l)}</p>`).join('');
      rep.hidden = false;
    } else {
      rep.hidden = true;
      rep.textContent = '';
    }
    $('build-code').textContent = S.code;
    $('seed-value').textContent = String(S.seed);
    $('size-hint').hidden = !libre;
    $('size-hint').textContent = libre ? 'La taille ne s’applique pas à une construction composée par Claude. Le double pack, si : il recompose le même plan.' : '';
  }

  // --------------------------------------------------------------- solidité
  const ICONS = {
    ok: '<svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="8" fill="currentColor"/><path d="M5 9.3l2.6 2.6L13 6.6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1.5L17 16H1z" fill="currentColor"/><path d="M9 6.5v4.3" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="13.3" r="1.1" fill="#fff"/></svg>',
    bad: '<svg viewBox="0 0 18 18" aria-hidden="true"><rect x="1" y="1" width="16" height="16" rx="3" fill="currentColor"/><path d="M6 6l6 6M12 6l-6 6" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
    info: '<svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="9" r="2.6" fill="currentColor"/></svg>',
  };
  const STATE_WORD = { ok: 'OK', warn: 'Attention', bad: 'Problème', info: 'Info' };
  /** Solidité : un résumé d'une ligne (en-tête et titre repliable), le détail replié. */
  function renderChecks() {
    const r = S.result;
    const v = r.validation || { errors: [], isolated: [], floating: [], overlaps: [], crossings: [], components: 1, mateCount: 0 };
    const byId = placementIndex(r);
    const loners = (v.isolated || []).filter((i) => {
      const p = r.placements[i] || byId.get(i);
      return p && p.type !== 'CAR';
    }).length;
    const below = (v.errors || []).some((e) => /sous le sol/.test(e));
    const floating = (v.floating || []).length;
    const cross = (v.overlaps || []).length + (v.crossings || []).length;
    const rows = [];
    rows.push(loners
      ? ['warn', `${plural(loners, 'pièce n’est tenue', 'pièces ne sont tenues')} par aucun aimant`, 'Pose-les simplement à leur place.']
      : ['ok', `Chaque pièce tient par ses aimants (${v.mateCount} contacts)`]);
    rows.push(!floating && !below ? ['ok', 'Rien ne flotte : tout repose sur le sol'] : ['bad', floating ? `${plural(floating, 'pièce flotte', 'pièces flottent')} sans appui` : 'Une pièce passe sous le sol']);
    rows.push(!cross ? ['ok', 'Aucune pièce ne se croise'] : ['bad', `${plural(cross, 'croisement', 'croisements')} de pièces`]);
    rows.push(v.components <= 1 ? ['ok', 'Un seul bloc : tout se tient'] : ['info', `${v.components} parties séparées`, 'Chacune tient toute seule sur le sol.']);
    $('checks').innerHTML = rows
      .map(
        ([st, text, sub]) =>
          `<li><span class="is-${st}" role="img" aria-label="${STATE_WORD[st]}">${ICONS[st]}</span><span>${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></li>`
      )
      .join('');
    const good = !loners && !floating && !below && !cross;
    const sum = good ? 'Tout tient bien' : 'Un point à vérifier';
    const el = $('solid-sum');
    el.textContent = sum;
    el.className = 'solid-sum ' + (good ? 'is-ok' : 'is-warn');
    const b = $('res-solid');
    b.hidden = false;
    b.className = 'badge ' + (good ? 'is-ok' : 'is-warn');
    b.textContent = good ? 'Solide' : 'À vérifier';
    b.setAttribute('aria-label', `Solidité : ${sum}. Voir le détail`);
    if (!good) $('solid').open = true;
  }

  // ------------------------------------------------------------ nomenclature
  function renderParts() {
    const r = S.result;
    const ul = $('parts');
    ul.textContent = '';
    for (const t of MT.PIECE_ORDER) {
      const P = MT.PIECES[t];
      const used = r.used[t] || 0, avail = r.available[t] || 0, rest = avail - used;
      const li = doc.createElement('li');
      li.className = 'part' + (used ? '' : ' is-zero');
      li.dataset.type = t;
      li.setAttribute('aria-label', `${P.name} : ${used} utilisées sur ${avail}, reste ${rest}`);
      const pct = avail ? Math.min(100, (used / avail) * 100) : 0;
      li.innerHTML =
        `<span class="ico">${MT.pieceIconSVG(t, { size: 32 })}</span>` +
        `<span class="nm">${esc(P.name)}</span>` +
        `<span class="qty" aria-hidden="true"><b>${used}</b><span> / ${avail}</span></span>` +
        `<span class="meta" aria-hidden="true"><span class="dims">${esc(inchesToCm(P.dims))}</span>` +
        `<span class="bar"><i style="width:${pct.toFixed(1)}%"></i>${r.packs === 2 ? '<u title="Contenu d’un pack"></u>' : ''}</span>` +
        `<span class="rest">reste ${rest}</span></span>`;
      li.addEventListener('mouseenter', () => S.viewer && S.viewer.highlightType(t));
      li.addEventListener('mouseleave', () => S.viewer && S.viewer.highlightType(null));
      ul.appendChild(li);
    }
    const total = totalOf(r.available);
    $('parts-total').innerHTML = `<span>Total <b>${r.pieceCount}</b> / ${total}</span><span>reste <b>${total - r.pieceCount}</b></span>`;
  }

  // ----------------------------------------------------------------- étapes
  /** Pièces d'une étape : icône à la couleur affichée dans la vue, nombre, nom. */
  function stepPartsHtml(r, k, size, withName) {
    const groups = stepGroups(r, r.steps[k].ids, S.colors);
    const rainbow = S.colorMode === 'rainbow';
    return groups
      .map((g) => {
        const P = MT.PIECES[g.type];
        const cw = rainbow && g.type !== 'CAR' ? colorWord(g.color, g.type) : '';
        const name = cw ? `${P.short} ${cw}` : P.short;
        const icon = MT.pieceIconSVG(g.type, { size, color: g.color });
        return withName
          ? `<span class="sp" title="${esc(P.name)}">${icon}<span class="sp-txt"><b>× ${g.count}</b><span>${esc(name)}</span></span></span>`
          : `<span class="ss-part" title="${esc(name)}">${icon}<b>×${g.count}</b></span>`;
      })
      .join('');
  }
  function renderStep() {
    const r = S.result;
    const n = r ? r.steps.length : 0;
    const k = r ? S.step : null;
    const range = $('step-range');
    range.max = String(Math.max(2, n + 1));
    range.value = String(k == null ? n + 1 : k + 1);
    range.disabled = n < 1;
    range.setAttribute('aria-valuetext', k == null ? `Vue complète, ${plural(n, 'étape', 'étapes')}` : `Étape ${k + 1} sur ${n}`);
    $('step-all').hidden = k == null;
    $('step-prev').disabled = n < 1 || k == null || k === 0;
    $('sb-prev').disabled = n < 1 || k === 0;
    $('sb-next').disabled = n < 1 || (k != null && k >= n - 1);
    $('sb-play').disabled = n < 1;
    $('step-play').disabled = n < 1;
    const next = $('step-next');
    next.disabled = n < 1;
    $('head-start').hidden = !r || k != null || n < 1;
    $('stepbar').hidden = !r;
    $('ghost-row').hidden = k == null;
    $('step-ghost').checked = S.ghost;
    const box = $('step-box');
    const parts = $('step-parts');
    const ss = $('stage-step');
    if (!r) {
      $('step-word').textContent = '';
      $('step-num').textContent = '0';
      $('step-of').textContent = 'étape';
      $('step-label').textContent = '';
      $('step-box-title').textContent = 'Sommaire';
      box.classList.remove('is-step');
      parts.textContent = '';
      next.textContent = 'Commencer le montage';
      ss.hidden = true;
      $('step-live').textContent = '';
      return;
    }
    if (k == null) {
      $('step-word').textContent = '';
      $('step-num').textContent = String(n);
      $('step-of').textContent = n > 1 ? 'étapes' : 'étape';
      $('step-label').textContent = 'Du bas vers le haut. Choisis une étape dans le sommaire, ou commence au début.';
      $('step-box-title').textContent = 'Sommaire';
      box.classList.remove('is-step');
      parts.innerHTML =
        '<ol class="step-toc">' +
        r.steps
          .map((s, i) => `<li><button type="button" data-step="${i}"><span class="mono">${i + 1}</span>${esc(s.label)}<em class="mono">${s.ids.length}</em></button></li>`)
          .join('') +
        '</ol>';
      next.textContent = 'Commencer le montage ▶';
      $('sb-label').innerHTML = `Vue complète · <b>${n}</b> ${n > 1 ? 'étapes' : 'étape'}`;
      ss.hidden = true;
      $('step-live').textContent = `Vue complète : ${plural(n, 'étape', 'étapes')}.`;
    } else {
      const s = r.steps[k];
      $('step-word').textContent = 'Étape';
      $('step-num').textContent = String(k + 1);
      $('step-of').textContent = `/ ${n}`;
      $('step-label').textContent = s.label;
      $('step-box-title').textContent = `Pièces à ajouter · ${s.ids.length}`;
      box.classList.add('is-step');
      parts.innerHTML = stepPartsHtml(r, k, 44, true);
      next.textContent = k >= n - 1 ? 'Terminé ✓ Tout voir' : 'J’ai fini ✓ Étape suivante';
      $('sb-label').innerHTML = `Étape <b>${k + 1}</b> / ${n}`;
      $('stage-step-parts').innerHTML = stepPartsHtml(r, k, 30, false);
      ss.hidden = false;
      $('step-live').textContent = `Étape ${k + 1} sur ${n} : ${s.label}, ${plural(s.ids.length, 'pièce', 'pièces')}.`;
    }
    const playing = S.playing;
    $('step-play').setAttribute('aria-pressed', String(playing));
    $('step-play').textContent = playing ? 'Pause' : 'Aperçu animé';
    $('sb-play').setAttribute('aria-pressed', String(playing));
    $('sb-play').setAttribute('aria-label', playing ? 'Mettre en pause' : 'Aperçu animé des étapes');
    // Éléments SVG : pas de propriété .hidden, on passe par l'attribut.
    $('sb-play').querySelector('.i-play').toggleAttribute('hidden', playing);
    $('sb-play').querySelector('.i-pause').toggleAttribute('hidden', !playing);
  }
  function setStep(k) {
    const r = S.result;
    if (!r) return;
    const n = r.steps.length;
    S.step = k == null || !n ? null : Math.max(0, Math.min(n - 1, k));
    if (S.viewer) S.viewer.setStep(S.step);
    renderStep();
  }
  function nextStep() {
    const n = S.result ? S.result.steps.length : 0;
    if (!n) return;
    setStep(S.step == null ? 0 : Math.min(n - 1, S.step + 1));
  }
  function prevStep() {
    const n = S.result ? S.result.steps.length : 0;
    if (!n) return;
    setStep(S.step == null ? n - 1 : Math.max(0, S.step - 1));
  }
  /** Gros bouton du montage : commencer, étape suivante, puis revenir à la vue complète. */
  function stepGo() {
    const n = S.result ? S.result.steps.length : 0;
    if (!n) return;
    if (S.step != null && S.step >= n - 1) setStep(null);
    else nextStep();
  }
  function stopPlay() {
    if (S.timer) clearInterval(S.timer);
    S.timer = 0;
    if (S.playing) {
      S.playing = false;
      renderStep();
    }
  }
  function togglePlay() {
    if (S.playing) {
      stopPlay();
      return;
    }
    const n = S.result ? S.result.steps.length : 0;
    if (!n) return;
    S.playing = true;
    if (S.step == null || S.step >= n - 1) setStep(0);
    else renderStep();
    S.timer = setInterval(() => {
      if (!S.result || S.step == null || S.step >= S.result.steps.length - 1) {
        stopPlay();
        return;
      }
      setStep(S.step + 1);
    }, STEP_MS);
  }
  /** Sur téléphone, le montage se suit dans la vue : on la ramène à l'écran. */
  function revealStage() {
    if (!narrow()) return;
    try {
      $('stage').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) {
      /* rien */
    }
  }

  // ------------------------------------------------------------- contrôles
  function syncControls() {
    for (let i = 1; i <= 4; i++) $('size-' + i).checked = S.size === i;
    $('double-pack').checked = S.packs === 2;
    $('seed-value').textContent = String(S.seed);
    for (const m of COLOR_MODES) $('color-' + m).checked = S.colorMode === m;
    $('step-ghost').checked = S.ghost;
    $('tool-rotate').setAttribute('aria-pressed', String(S.autoRotate));
  }

  function pickTheme(id) {
    abortAi('');
    S.themeId = id;
    S.plan = null;
    setFreeStatus('');
    regenerate();
  }
  function surprise() {
    abortAi('');
    const themes = listThemes();
    if (!themes.length) return;
    const others = themes.length > 1 ? themes.filter((t) => t.id !== S.themeId) : themes;
    S.themeId = others[randInt(others.length)].id;
    S.plan = null;
    S.seed = randSeed();
    setFreeStatus('');
    regenerate();
  }

  /** Message sous « Ton thème », avec un bouton d'action facultatif. */
  function setFreeStatus(text, level, action) {
    const el = $('free-status');
    el.textContent = text || '';
    el.className = 'status' + (level ? ' is-' + level : '');
    if (text && action) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'link-btn';
      b.textContent = action.label;
      b.addEventListener('click', action.run);
      el.append(' ', b);
    }
  }
  function setResStatus(text, level) {
    const el = $('res-status');
    el.textContent = text || '';
    el.className = 'mini-status' + (level ? ' is-' + level : '');
  }

  // ======================================================= codes de construction
  /**
   * Applique un code (ancre, champ « Charger », champ libre). Renvoie un
   * message d'avertissement (vide si tout est chargé tel quel).
   */
  function applyCode(c) {
    const warn = [];
    if (c.packs === 1 || c.packs === 2) S.packs = c.packs;
    if (c.seed > 0) S.seed = c.seed >>> 0;
    else warn.push('la variante 0 n’existe pas');
    if (c.themeId === 'libre') {
      const code = makeCode({ themeId: 'libre', size: 0, packs: c.packs, seed: c.seed });
      const plans = store.get(PLANS_KEY, {}) || {};
      const entry = plans[code] || plans[makeCode({ themeId: 'libre', size: 0, packs: 3 - c.packs, seed: c.seed })];
      if (entry && entry.plan) {
        S.themeId = 'libre';
        S.plan = entry.plan;
        S.planText = entry.text || '';
        return warn.length ? `Code corrigé : ${warn.join(', ')}.` : '';
      }
      S.plan = null;
      if (!currentThemeValid()) S.themeId = DEFAULTS.themeId;
      return 'Cette construction composée par Claude n’est pas enregistrée sur cet appareil : voici un thème à la place.';
    }
    S.plan = null;
    if (!(MT.themes && MT.themes[c.themeId]) || c.themeId === 'selftest') {
      S.themeId = DEFAULTS.themeId;
      const fb = MT.themes && MT.themes[DEFAULTS.themeId];
      return `Le thème « ${c.themeId} » n’existe pas ici : voici ${fb ? fb.name : 'un autre thème'}.`;
    }
    S.themeId = c.themeId;
    if (c.size >= 1 && c.size <= 4) S.size = c.size;
    else warn.push(`la taille ${c.size} n’existe pas (taille ${SIZE_NAMES[S.size]} gardée)`);
    return warn.length ? `Code corrigé : ${warn.join(', ')}.` : '';
  }
  function loadCode(c, where) {
    abortAi('');
    const msg = applyCode(c);
    const ok = regenerate();
    const say = where === 'free' ? setFreeStatus : setResStatus;
    if (!ok) return;
    if (msg) say(msg, 'warn');
    else say(`Construction ${S.code} chargée.`);
  }
  function onCodeSubmit(ev) {
    ev.preventDefault();
    const raw = $('code-input').value.trim();
    const c = parseCode(raw.replace(/^#/, ''));
    if (!c) {
      setResStatus(raw ? `« ${raw.slice(0, 40)} » n’est pas un code : il ressemble à chateau-3-1-5 (thème, taille, packs, variante).` : 'Colle d’abord un code, par exemple chateau-3-1-5.', 'warn');
      return;
    }
    loadCode(c, 'code');
    $('code-input').value = '';
  }

  // ======================================================= thème libre, IA
  function aiReady() {
    return !!(S.aiOn && S.sample && typeof S.sample.json === 'function' && buildCatalog().length >= 2);
  }
  function enableAi() {
    S.aiOn = true;
    $('ai-chip').hidden = false;
    $('free-hint').textContent = 'Claude compose une construction sur mesure avec les pièces de ta boîte. Compte de 30 secondes à une minute et demie. Tu peux aussi coller un code.';
  }
  function disableAi() {
    S.aiOn = false;
    S.sample = null;
    $('ai-chip').hidden = true;
    $('free-hint').textContent = 'Écris une idée : je choisis le thème le plus proche. Tu peux aussi coller un code de construction.';
  }
  /** Catalogue calculé à l'avance (après les vignettes) pour que « Construire » réponde vite. */
  function warmCatalog() {
    if (!S.aiOn) return;
    setTimeout(() => {
      try {
        buildCatalog();
      } catch (e) {
        logErr(e);
      }
    }, 50);
  }
  function setBusy(on) {
    $('ai-busy').hidden = !on;
    $('free-go').disabled = on;
    $('new-seed').disabled = on;
    if (S.aiTick) clearInterval(S.aiTick);
    S.aiTick = 0;
    if (on) {
      const t0 = Date.now();
      const tick = () => {
        const s = Math.round((Date.now() - t0) / 1000);
        $('ai-busy-time').textContent = `${s} s · compte de 30 s à 1 min 30`;
      };
      tick();
      S.aiTick = setInterval(tick, 1000);
    }
  }
  function setBusyText(text) {
    $('ai-busy-text').textContent = text;
  }
  /** Arrête la composition en cours ; why = message affiché ensuite (vide : rien). */
  function abortAi(why) {
    if (!S.aiCtl) return;
    S.aiAbortWhy = why == null ? '' : why;
    try {
      S.aiCtl.abort();
    } catch (e) {
      /* rien */
    }
  }

  /** Repli sans IA : thème au plus grand nombre de mots-clés communs. */
  function keywordFallback(text, prefix) {
    const themes = listThemes();
    if (!themes.length) {
      setFreeStatus((prefix || '') + 'Aucun thème n’est chargé.', 'warn');
      return;
    }
    const m = matchTheme(text, themes);
    // Idée toute prête (cirque, pirates, Noël…) quand elle colle mieux qu'un thème.
    const pm = MT.PRESET_PLANS ? matchTheme(text, MT.PRESET_PLANS) : null;
    if (pm && (!m || pm.score >= m.score)) {
      S.themeId = 'libre';
      S.plan = pm.theme.plans[S.packs] || pm.theme.plans[1];
      S.planText = text;
      S.seed = randSeed();
      regenerate();
      setFreeStatus(`${prefix || ''}Idée toute prête de l’atelier : ${pm.theme.name}.`);
      return;
    }
    S.plan = null;
    if (m) {
      // Même thème qu'à l'écran : une autre variante, pour que le bouton change quelque chose.
      if (m.theme.id === S.themeId) S.seed = randSeed();
      S.themeId = m.theme.id;
      regenerate();
      setFreeStatus(`${prefix || ''}Thème le plus proche : ${m.theme.name}.`);
    } else {
      const t = themes[randInt(themes.length)];
      S.themeId = t.id;
      S.seed = randSeed();
      regenerate();
      setFreeStatus(`${prefix || ''}Aucun thème ne ressemble à « ${text} » : voici ${t.name}, choisi au hasard.`, 'warn');
    }
  }

  /**
   * Composition par Claude. variant = true : « Autre variante » d'une
   * construction Claude affichée, qui ne doit jamais être détruite par un
   * échec. La graine n'est adoptée qu'en cas de succès.
   */
  async function composeWithClaude(text, variant) {
    if (S.aiCtl) return;
    const sample = S.sample;
    const seed = randSeed();
    const packs = S.packs;
    const catalog = buildCatalog();
    let prompt = buildPrompt(text, packs, catalog, variant ? seed : 0);
    // Limite de 64 Kio pour « sample » : version abrégée si le catalogue grossit.
    if (utf8Length(prompt) > MAX_PROMPT) prompt = buildPrompt(text, packs, catalog, variant ? seed : 0, true);
    const ctl = new AbortController();
    S.aiCtl = ctl;
    S.aiAbortWhy = '';
    setBusy(true);
    setBusyText(variant ? 'Claude cherche une autre variante…' : 'Claude réfléchit à ta construction…');
    setFreeStatus('');
    let plan;
    try {
      const opts = {
        signal: ctl.signal,
        modelTier: 'default',
        onText: ({ text: t }) => {
          if (S.aiCtl !== ctl) return;
          const k = (String(t).match(/"module"\s*:/g) || []).length;
          setBusyText(k ? `Claude choisit les modules… ${plural(k, 'module choisi', 'modules choisis')}` : 'Claude écrit le plan…');
        },
      };
      if (variant) opts.cache = false;
      plan = await sample.json(prompt, opts);
    } catch (e) {
      if (S.aiCtl === ctl) {
        S.aiCtl = null;
        setBusy(false);
      }
      handleAiError(e, text, variant);
      return;
    }
    if (ctl.signal.aborted || S.aiCtl !== ctl) {
      // Arrêtée entre-temps (réglages changés, autre thème) : réponse ignorée.
      if (S.aiCtl === ctl) {
        S.aiCtl = null;
        setBusy(false);
      }
      return;
    }
    S.aiCtl = null;
    setBusy(false);
    if (!plan || typeof plan !== 'object' || !Array.isArray(plan.items) || !plan.items.length) {
      failOrFallback(text, variant, 'La réponse de Claude était inutilisable. ');
      return;
    }
    plan = sanitizePlan(plan);
    let r;
    try {
      r = MT.compose(plan, { packs, seed });
    } catch (e) {
      logErr(e);
      r = null;
    }
    if (!r || !r.pieceCount) {
      failOrFallback(text, variant, 'Claude a proposé des modules impossibles à construire. ');
      return;
    }
    S.themeId = 'libre';
    S.plan = plan;
    S.planText = text;
    showResult(r);
    setFreeStatus(variant ? `Nouvelle variante composée par Claude pour « ${text} ».` : `Construction composée par Claude pour « ${text} ».`);
  }

  /** Première composition : repli par mots-clés. Variante : on garde la construction affichée. */
  function failOrFallback(text, variant, prefix) {
    if (variant) setFreeStatus(prefix + 'Ta construction reste affichée ; réessaie « Autre variante » dans un instant.', 'warn');
    else keywordFallback(text, prefix);
  }

  function handleAiError(e, text, variant) {
    const code = e && typeof e === 'object' ? e.code : '';
    switch (code) {
      case 'cancelled': {
        const why = S.aiAbortWhy;
        S.aiAbortWhy = '';
        setFreeStatus(why || '');
        return;
      }
      case 'not_granted':
      case 'sampling_disabled':
      case 'not_declared':
      case 'capability_disabled':
      case 'capability_removed':
        disableAi();
        if (variant && S.plan) {
          // Sans Claude, une autre variante du même plan reste possible.
          S.seed = randSeed();
          regenerate();
          setFreeStatus('Claude n’est pas disponible ici : autre variante du même plan, assemblée sur place.', 'warn');
        } else keywordFallback(text, 'Claude n’est pas disponible ici. ');
        return;
      case 'rate_limited':
        setFreeStatus('Trop de demandes à Claude pour l’instant : réessaie dans un moment.', 'warn');
        return;
      case 'session_expired':
        setFreeStatus('Ta session Claude a expiré : reconnecte-toi, puis réessaie.', 'warn');
        return;
      case 'invalid_json':
      case 'empty_completion':
        failOrFallback(text, variant, 'La réponse de Claude était illisible. ');
        return;
      case 'refused':
        failOrFallback(text, variant, 'Claude n’a pas voulu composer ce thème. ');
        return;
      case 'invalid_request':
      case 'prompt_too_large':
      case 'transform_error':
      case 'queue_overflow':
        logErr(e);
        failOrFallback(text, variant, 'Claude n’a pas pu traiter la demande. ');
        return;
      case 'upstream_error':
      default:
        if (code !== 'upstream_error') logErr(e);
        // Transitoire : la construction affichée reste, l'utilisateur relance quand il veut.
        setFreeStatus('Claude n’a pas répondu. Réessaie dans un instant.', 'warn');
    }
  }

  function onFreeSubmit(ev) {
    ev.preventDefault();
    const text = $('free-text').value.trim().slice(0, 80);
    if (!text) {
      setFreeStatus('Écris une idée de thème, par exemple « dragon » ou « base sur Mars ».', 'warn');
      $('free-text').focus();
      return;
    }
    // Un code collé ici : on le charge, sans appeler Claude.
    const c = parseCode(text.replace(/^#/, ''));
    if (c) {
      loadCode(c, 'free');
      return;
    }
    saveState();
    // Nom exact d'un thème : pas besoin de Claude.
    const exact = exactTheme(text, listThemes());
    if (exact) {
      pickTheme(exact.id);
      if (aiReady()) {
        setFreeStatus(`C’est un thème de l’atelier : voici ${exact.name}.`, '', {
          label: 'Composer quand même avec Claude',
          run: () => composeWithClaude(text, false),
        });
      } else setFreeStatus(`Voici le thème ${exact.name}.`);
      return;
    }
    if (aiReady()) composeWithClaude(text, false);
    else keywordFallback(text, '');
  }

  function onNewSeed() {
    if (S.aiCtl) return;
    if (S.themeId === 'libre' && S.plan && aiReady() && S.planText) {
      composeWithClaude(S.planText, true);
      return;
    }
    S.seed = randSeed();
    regenerate();
  }

  /** Taille ou double pack changés : une composition en cours devient caduque. */
  function settingsChanged() {
    if (S.aiCtl) abortAi('Composition arrêtée : les réglages ont changé. Relance-la quand tu veux.');
    else setFreeStatus('');
  }

  // ======================================================= fichiers à enregistrer
  function dataUrlToBlob(url) {
    const i = url.indexOf(',');
    const meta = url.slice(5, i);
    const b64 = /;base64/i.test(meta);
    const body = url.slice(i + 1);
    const bin = b64 ? atob(body) : decodeURIComponent(body);
    const u8 = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
    return new Blob([u8], { type: meta.split(';')[0] || 'image/png' });
  }
  async function toPng(x) {
    x = await x;
    if (!x) return null;
    if (typeof Blob !== 'undefined' && x instanceof Blob) return x;
    if (typeof x === 'string' && x.startsWith('data:')) return dataUrlToBlob(x);
    if (x instanceof ArrayBuffer || ArrayBuffer.isView(x)) return x;
    if (typeof x.toBlob === 'function') return new Promise((res) => x.toBlob(res, 'image/png'));
    return null;
  }
  async function screenshotBlob() {
    let data = null;
    try {
      data = await toPng(S.viewer && S.viewer.screenshot());
    } catch (e) {
      logErr(e);
    }
    if (!data) {
      const cv = $('viewer-host').querySelector('canvas');
      if (cv) data = await toPng(cv);
    }
    return data;
  }
  function hideDownloads() {
    S.downloads = null;
    $('dl-row').hidden = true;
    $('tool-shot').hidden = true;
  }
  function onDownloadError(e) {
    const code = e && e.code;
    if (code === 'declined') return;
    if (code === 'rate_limited') setResStatus('Une demande d’enregistrement est déjà ouverte.');
    else if (['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(code)) {
      hideDownloads();
      setResStatus('L’enregistrement de fichiers n’est pas disponible ici.');
    } else {
      logErr(e);
      setResStatus('Le fichier n’a pas pu être enregistré.');
    }
  }
  async function savePng() {
    const dl = S.downloads;
    if (!dl || !S.result) return;
    const data = await screenshotBlob();
    if (!data) {
      setResStatus('La capture n’a pas pu être préparée.');
      return;
    }
    try {
      const res = await dl.save({ filename: `atelier-aimante-${S.code}.png`, data });
      if (res && res.status === 'saved') setResStatus('Capture enregistrée.');
    } catch (e) {
      onDownloadError(e);
    }
  }
  async function saveMd() {
    const dl = S.downloads;
    if (!dl || !S.result) return;
    try {
      const res = await dl.save({ filename: `atelier-aimante-${S.code}.md`, data: ficheMarkdown(S.result, S.code) });
      if (res && res.status === 'saved') setResStatus('Fiche de montage enregistrée.');
    } catch (e) {
      onDownloadError(e);
    }
  }

  function copyCode() {
    const code = S.code;
    if (!code) return;
    const fallback = () => {
      try {
        const range = doc.createRange();
        range.selectNodeContents($('build-code'));
        const sel = root.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) {
        /* rien */
      }
      setResStatus('Code sélectionné : copie-le avec Ctrl+C.');
    };
    let p;
    try {
      p = root.navigator.clipboard.writeText(code);
    } catch (e) {
      fallback();
      return;
    }
    Promise.resolve(p).then(() => setResStatus('Code copié.'), fallback);
  }

  // ================================================================== câblage
  function wire() {
    $('free-form').addEventListener('submit', onFreeSubmit);
    $('code-form').addEventListener('submit', onCodeSubmit);
    $('ai-stop').addEventListener('click', () => abortAi('Composition arrêtée.'));
    for (let i = 1; i <= 4; i++) {
      $('size-' + i).addEventListener('change', () => {
        settingsChanged();
        S.size = i;
        if (S.themeId === 'libre' && S.plan) {
          saveState();
          return;
        }
        regenerate();
      });
    }
    $('double-pack').addEventListener('change', (e) => {
      settingsChanged();
      S.packs = e.target.checked ? 2 : 1;
      regenerate();
    });
    $('to-double').addEventListener('click', () => {
      settingsChanged();
      S.packs = 2;
      if (S.result && S.result.requestedSize) S.size = S.result.requestedSize;
      regenerate();
    });
    $('new-seed').addEventListener('click', onNewSeed);
    for (const m of COLOR_MODES) {
      $('color-' + m).addEventListener('change', () => {
        S.colorMode = m;
        if (!S.result) return;
        S.colors = colorsFor(S.result, m);
        if (S.viewer) S.viewer.setColors(S.colors);
        renderStep();
        saveState();
      });
    }
    // barre d'outils de la vue
    $('tool-rotate').addEventListener('click', () => {
      S.autoRotate = !S.autoRotate;
      if (S.viewer) S.viewer.setAutoRotate(S.autoRotate);
      syncControls();
    });
    $('tool-recenter').addEventListener('click', () => S.viewer && S.viewer.resetView());
    $('tool-explode').addEventListener('input', (e) => {
      S.explode = Number(e.target.value) / 100;
      if (S.viewer) S.viewer.setExplode(S.explode);
    });
    $('step-ghost').addEventListener('change', (e) => {
      S.ghost = !!e.target.checked;
      if (S.viewer) S.viewer.setGhost(S.ghost);
      saveState();
    });
    $('tool-shot').addEventListener('click', savePng);
    $('dl-md').addEventListener('click', saveMd);
    $('dl-png').addEventListener('click', savePng);
    $('copy-code').addEventListener('click', copyCode);
    $('res-solid').addEventListener('click', () => {
      const d = $('solid');
      d.open = true;
      try {
        d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (e) {
        /* rien */
      }
    });
    // étapes
    const manual = (fn) => () => {
      stopPlay();
      fn();
    };
    $('step-prev').addEventListener('click', manual(prevStep));
    $('step-next').addEventListener('click', manual(stepGo));
    $('head-start').addEventListener('click', manual(() => {
      setStep(0);
      revealStage();
    }));
    $('sb-prev').addEventListener('click', manual(prevStep));
    $('sb-next').addEventListener('click', manual(nextStep));
    $('step-all').addEventListener('click', manual(() => setStep(null)));
    $('step-play').addEventListener('click', togglePlay);
    $('sb-play').addEventListener('click', togglePlay);
    $('step-range').addEventListener('input', (e) => {
      stopPlay();
      const n = S.result ? S.result.steps.length : 0;
      const v = Number(e.target.value);
      setStep(v > n ? null : v - 1);
    });
    $('step-parts').addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button[data-step]');
      if (!b) return;
      stopPlay();
      setStep(Number(b.dataset.step));
      // Le sommaire disparaît : le focus passe au bouton « étape suivante ».
      try {
        $('step-next').focus({ preventScroll: true });
      } catch (x) {
        /* rien */
      }
    });
    doc.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .seg')) return;
      e.preventDefault();
      stopPlay();
      if (e.key === 'ArrowLeft') prevStep();
      else nextStep();
    });
    // position de la souris pour l'info-bulle
    const stage = $('stage');
    stage.addEventListener('pointermove', (e) => {
      S.mouse = { x: e.clientX, y: e.clientY };
    });
    stage.addEventListener('pointerleave', () => {
      S.mouse = null;
      $('tip').hidden = true;
    });
    let rt = 0;
    root.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(paintAllThumbs, 150);
    });
    // Code saisi dans l'ancre (lien partagé, retour arrière).
    root.addEventListener('hashchange', () => {
      const c = readHash();
      if (c && makeCode(c) !== S.code) loadCode(c, 'code');
    });
  }

  // ------------------------------------------------------------ capacités
  function probeCapabilities() {
    const use = (name) =>
      Promise.resolve()
        .then(() => (root.claude && typeof root.claude.use === 'function' ? root.claude.use(name) : null))
        .catch(() => null);
    use('sample').then((s) => {
      if (!s || typeof s.json !== 'function') return;
      S.sample = s;
      if (buildCatalog().length >= 2) enableAi();
    });
    use('downloads').then((d) => {
      if (!d || typeof d.save !== 'function') return;
      S.downloads = d;
      if (S.result) {
        $('dl-row').hidden = false;
        $('tool-shot').hidden = false;
      }
    });
  }

  // ------------------------------------------------------------ démarrage
  /** Lit l'ancre : code de construction, et « dark » / « light » (paramètre de test). */
  function readHash() {
    let raw = '';
    try {
      raw = decodeURIComponent((root.location.hash || '').replace(/^#/, ''));
    } catch (e) {
      raw = '';
    }
    raw = raw.trim().toLowerCase();
    const tm = /(^|-)(dark|light)$/.exec(raw);
    if (tm) {
      doc.documentElement.setAttribute('data-theme', tm[2]);
      raw = raw.slice(0, tm.index);
    }
    return parseCode(raw);
  }

  function restoreInitial() {
    const saved = store.get(STORE_KEY, null);
    if (saved && typeof saved === 'object') {
      if (COLOR_MODES.includes(saved.colorMode)) S.colorMode = saved.colorMode;
      if (typeof saved.freeText === 'string') $('free-text').value = saved.freeText.slice(0, 80);
      if (typeof saved.ghost === 'boolean') S.ghost = saved.ghost;
    }
    const fromHash = readHash();
    if (fromHash) {
      const msg = applyCode(fromHash);
      if (msg) setFreeStatus(msg, 'warn');
      return;
    }
    if (!saved || typeof saved !== 'object') return;
    if (saved.size >= 1 && saved.size <= 4) S.size = saved.size | 0;
    if (saved.packs === 1 || saved.packs === 2) S.packs = saved.packs;
    if (Number.isFinite(saved.seed) && saved.seed > 0) S.seed = saved.seed >>> 0;
    if (saved.themeId === 'libre') {
      const plans = store.get(PLANS_KEY, {}) || {};
      const entry = plans[makeCode({ themeId: 'libre', size: 0, packs: S.packs, seed: S.seed })] || latestPlan(plans);
      if (entry && entry.plan) {
        S.themeId = 'libre';
        S.plan = entry.plan;
        S.planText = entry.text || '';
      } else S.themeId = DEFAULTS.themeId;
    } else if (typeof saved.themeId === 'string' && MT.themes && MT.themes[saved.themeId]) {
      S.themeId = saved.themeId;
    }
  }
  function latestPlan(plans) {
    let best = null;
    for (const k of Object.keys(plans)) if (!best || (plans[k].t || 0) > (best.t || 0)) best = plans[k];
    return best;
  }

  let started = false;
  function start() {
    if (started) return;
    started = true;
    S.dark = computeDark();
    renderThemeGrid();
    restoreInitial();
    S.dark = computeDark();
    syncControls();
    wire();
    watchDark();
    setupViewer();
    regenerate();
    buildThumbs();
    probeCapabilities();
  }

  MT.app = {
    state: S,
    regenerate,
    showResult,
    setStep,
    pickTheme,
    loadCode: (code) => {
      const c = parseCode(code);
      if (c) loadCode(c, 'code');
      return !!c;
    },
    /** Pour les essais : simule le survol d'une pièce (placement, { clientX, clientY }). */
    hover: (p, pos) => onViewerHover(p, pos),
    /** Pour les essais : remplace le viewer par l'aperçu 2D. */
    useFallbackViewer() {
      useFallback('');
    },
  };

  // Script placé en fin de page : l'interface démarre tout de suite, sans
  // attendre Three.js (chargé en différé, il retarderait DOMContentLoaded).
  if (doc.getElementById('app')) start();
  else doc.addEventListener('DOMContentLoaded', start);
})(typeof window !== 'undefined' ? window : globalThis);
