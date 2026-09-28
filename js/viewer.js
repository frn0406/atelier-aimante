/*
 * Atelier Aimanté — rendu 3D des constructions (Three.js r147, global THREE).
 *
 *   const viewer = MT.createViewer({ container, THREE, onHover, onPick });
 *
 *   viewer.setBuild(result, { colors, keepCamera })  // sortie de MT.generate / MT.compose
 *                                                    // (remet à zéro étape, surlignage et survol)
 *   viewer.setColors(colors)       // tableau de couleurs hex indexé par placement.id
 *   viewer.setStep(k | null)       // null = tout ; k = étapes 0..k, étape k mise en valeur
 *   viewer.setGhost(bool)          // étapes futures en « fantôme » (défaut true)
 *   viewer.setExplode(f)           // 0..1, vue éclatée
 *   viewer.highlightType(type)     // les autres types s'estompent (null = aucun)
 *   viewer.setAutoRotate(bool)
 *   viewer.resetView()
 *   viewer.setDark(bool)           // sol, grille, lumière pour le thème sombre
 *   viewer.screenshot()            // Promise<Blob> PNG, fond opaque
 *   viewer.dispose()
 *
 * Extras (facultatifs) : viewer.setView({ azimuth, elevation, distance }) en degrés,
 * distance relative au cadrage automatique ; viewer.requestRender() ; accès en
 * lecture à viewer.camera / controls / renderer / scene.
 *
 * onHover(placement | null, { clientX, clientY }) est rappelé quand la pièce
 * survolée change, et à chaque déplacement (≤ 30 fois/s) tant qu'une pièce est
 * survolée (pour qu'une infobulle suive le pointeur). onPick(placement) sur un
 * clic (sans glisser) sur une pièce.
 *
 * Choix de rendu : chaque pièce plate = un rebord épais (bord extérieur et
 * pourtour des ouvertures) et une vitre plus fine, fusionnés dans une seule
 * géométrie par type. Le plastique teinté est rendu en deux passes :
 *   1. un filtre multiplicatif (le fond et les pièces derrière sont teintés,
 *      comme à travers un vitrail ; plus dense sur le rebord et en incidence
 *      rasante) : c'est lui qui donne des couleurs franches et saturées ;
 *   2. une couche éclairée peu opaque (lumière diffusée, reflets, aimants vus
 *      à travers).
 * La multiplication est commutative : l'ordre de tri n'y change rien. Les
 * pièces translucides n'écrivent pas dans le tampon de profondeur : aucune
 * pièce ne peut en masquer une autre à cause d'un tri imparfait.
 * Le filtre a besoin d'un fond dans le canevas : la vue peint donc son propre
 * dégradé, lu dans les variables CSS --stage-top / --stage-bottom du
 * conteneur (repli sur les couleurs du thème) ; le canevas est opaque.
 *
 * Cadrage : la caméra est calée sur les sommets réels des pièces (et non sur
 * les 8 coins de la boîte englobante), en tenant compte du rapport largeur /
 * hauteur de la vue, pour remplir ~80 % de la largeur ou de la hauteur ;
 * l'angle (3/4 surélevé) s'adapte à la forme de la construction.
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});

  // ---------------------------------------------------------------- réglages
  const LOOK = {
    paneAlpha: 0.62, // facteur d'opacité de la couche éclairée sur la vitre (fine)
    rimAlpha: 1.3, // facteur d'opacité de la couche éclairée sur le rebord (épais)
    paneDensity: 0.74, // densité du filtre coloré de la vitre (1 = teinte pleine)
    rimDensity: 1, // densité du filtre coloré du rebord
    grazing: 0.65, // renforcement du filtre en incidence rasante (0 = aucun)
    rimWidth: 0.058, // largeur du rebord extérieur
    holeRim: 0.024, // largeur du rebord autour des ouvertures
    paneThick: 0.5, // épaisseur de la vitre (fraction de MT.T)
    bevel: 0.011,
    ghostOpacity: 0.05, // couche éclairée des pièces « fantôme » (étapes futures)
    ghostFilter: 0.08, // filtre coloré des pièces fantôme
    ghostLine: 0.16,
    dimOpacity: 0.07,
    dimFilter: 0.1,
    dimLine: 0.16,
    lineOpacity: 0.9,
    ribAlpha: 0.22,
    hoverGlow: 0.45,
    stepGlow: 0.42,
    pastOpacity: 0.6, // étapes déjà posées quand une étape est affichée (facteur)
    pastFilter: 0.42,
    pastLine: 0.45,
    typeGlow: 0.12,
    magnetPitch: 0.45,
    dropHeight: 0.4,
    dropMs: 250,
    explodeScale: 0.9,
    fillX: 0.84, // part de la largeur occupée par la construction au cadrage
    fillY: 0.78, // part de la hauteur (outils en haut et en bas de la vue)
  };

  const THEMES = {
    light: {
      exposure: 1,
      hemi: 0.78, hemiSky: 0xffffff, hemiGround: 0xd2d8e2,
      dir: 0.92,
      env: 0.28,
      clearcoat: 0.25,
      opacity: 0.34, // couche éclairée (le filtre donne l'essentiel de la couleur)
      emissive: 0.14, // lueur propre du plastique (teinte pure, sans blanchir)
      shadow: 0.13,
      grid: [0.2, 0.3, 0.46], gridAlpha: 0.11,
      background: '#f3f5f9',
      stageTop: '#F8FAFD', stageBottom: '#DFE6EF',
      line: { l: 0.34, s: 1 }, // liseré : même teinte, plus sombre
    },
    dark: {
      exposure: 1,
      hemi: 0.78, hemiSky: 0xe6ebff, hemiGround: 0x2a3142,
      dir: 1.05,
      env: 0.22,
      clearcoat: 0.2,
      opacity: 0.6, // sur fond sombre, la lumière diffusée porte la couleur
      emissive: 0.2,
      shadow: 0.3,
      grid: [0.72, 0.8, 0.95], gridAlpha: 0.08,
      background: '#121722',
      stageTop: '#1A2331', stageBottom: '#0D1219',
      line: { l: 0.6, s: 1 }, // liseré : même teinte, plus claire
    },
  };

  // --------------------------------------------------------- géométrie 2D
  function signedArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  /** Décale un polygone simple de d (d > 0 : vers l'extérieur), sommets en onglet. */
  function offsetPolygon(pts, d) {
    const n = pts.length;
    const s = signedArea(pts) > 0 ? 1 : -1;
    const lines = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      dx /= L;
      dy /= L;
      const nx = s * dy, ny = -s * dx; // normale extérieure
      lines.push({ p: [a[0] + nx * d, a[1] + ny * d], d: [dx, dy] });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const l0 = lines[(i - 1 + n) % n], l1 = lines[i];
      const den = l0.d[0] * l1.d[1] - l0.d[1] * l1.d[0];
      if (Math.abs(den) < 1e-6) {
        out.push(l1.p.slice());
      } else {
        const t = ((l1.p[0] - l0.p[0]) * l1.d[1] - (l1.p[1] - l0.p[1]) * l1.d[0]) / den;
        out.push([l0.p[0] + l0.d[0] * t, l0.p[1] + l0.d[1] * t]);
      }
    }
    return out;
  }

  function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** Portion d'un segment contenue dans un polygone (on garde le premier et le dernier point intérieurs). */
  function clipSegment(a, b, poly) {
    const N = 96;
    let t0 = -1, t1 = -1;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      if (pointInPoly([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], poly)) {
        if (t0 < 0) t0 = t;
        t1 = t;
      }
    }
    if (t0 < 0 || t1 - t0 < 0.02) return null;
    const P = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return [P(t0), P(t1)];
  }

  const hexOf = (c, fallback) => {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string' && /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c.trim())) return c.trim().startsWith('#') ? c.trim() : '#' + c.trim();
    return fallback;
  };

  // ------------------------------------------------------------ fabrique
  MT.createViewer = function createViewer(opts) {
    const o = opts || {};
    const THREE = o.THREE || root.THREE;
    if (!THREE || !THREE.WebGLRenderer) throw new Error('Three.js (global THREE) est indisponible : impossible d’afficher la vue 3D.');
    if (!THREE.OrbitControls) throw new Error('THREE.OrbitControls est indisponible : charger examples/js/controls/OrbitControls.js.');
    const container = o.container;
    if (!container || typeof container.appendChild !== 'function') throw new Error('createViewer : conteneur DOM manquant.');
    const onHover = typeof o.onHover === 'function' ? o.onHover : null;
    const onPick = typeof o.onPick === 'function' ? o.onPick : null;
    const T = MT.T, CAR = MT.CAR;

    // ----- moteur de rendu
    let renderer;
    try {
      if (!root.WebGLRenderingContext) throw new Error('API WebGL absente');
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) {
      throw new Error('WebGL est indisponible sur ce navigateur ou cet appareil : la vue 3D ne peut pas s’afficher. (' + (e && e.message) + ')');
    }
    renderer.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
    renderer.setClearColor(0xf3f5f9, 1);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.sortObjects = true;
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.outline = 'none';
    canvas.setAttribute('aria-label', 'Vue 3D de la construction');
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1.5, 0.05, 500);
    camera.position.set(6, 5, 9);

    // Environnement : reflets du plastique.
    let envTex = null;
    if (THREE.RoomEnvironment && THREE.PMREMGenerator) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new THREE.RoomEnvironment();
      envTex = pmrem.fromScene(room, 0.04).texture;
      room.traverse((m) => {
        if (m.geometry) m.geometry.dispose();
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
      });
      pmrem.dispose();
      scene.environment = envTex;
    }

    // ----- lumières
    const hemi = new THREE.HemisphereLight(0xffffff, 0xc4ccd8, 0.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.015;
    sun.shadow.radius = 3;
    scene.add(sun);
    scene.add(sun.target);
    const SUN_DIR = new THREE.Vector3(-0.55, 1.25, 0.75).normalize();

    // ----- sol : ombres + grille (1 case = 1 carré)
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.17, transparent: true, depthWrite: false });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.renderOrder = -2;
    scene.add(ground);

    const gridMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      extensions: { derivatives: true },
      uniforms: {
        uColor: { value: new THREE.Vector3(0.16, 0.26, 0.42) },
        uOpacity: { value: 0.2 },
        uCenter: { value: new THREE.Vector2(0, 0) },
        uRadius: { value: 10 },
      },
      vertexShader: [
        'varying vec3 vWorld;',
        'void main() {',
        '  vec4 w = modelMatrix * vec4(position, 1.0);',
        '  vWorld = w.xyz;',
        '  gl_Position = projectionMatrix * viewMatrix * w;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor; uniform float uOpacity; uniform vec2 uCenter; uniform float uRadius;',
        'varying vec3 vWorld;',
        'void main() {',
        '  vec2 c = vWorld.xz;',
        '  vec2 fw = max(fwidth(c), vec2(1e-4));',
        '  vec2 g = abs(fract(c - 0.5) - 0.5) / fw;',
        '  float line = 1.0 - min(min(g.x, g.y), 1.0);',
        '  float d = length(c - uCenter) / uRadius;',
        '  float fade = 1.0 - smoothstep(0.45, 1.0, d);',
        // atténue la grille quand les lignes deviennent plus fines qu’un pixel (moiré au loin)
        '  float far = clamp(1.0 - (max(fw.x, fw.y) - 0.18) * 3.0, 0.0, 1.0);',
        '  float a = line * uOpacity * fade * far;',
        '  if (a < 0.003) discard;',
        '  gl_FragColor = vec4(uColor, a);',
        '}',
      ].join('\n'),
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), gridMat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = 0.0015;
    grid.renderOrder = -3;
    scene.add(grid);

    // ----- fond : dégradé vertical peint dans le canevas (le filtre coloré des
    // pièces doit avoir un fond à teinter). Couleurs sRGB écrites telles quelles,
    // comme le dégradé CSS qu'il remplace.
    const bgGeo = new THREE.BufferGeometry();
    bgGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const bgMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uTop: { value: new THREE.Color(0xf8fafd) },
        uBottom: { value: new THREE.Color(0xdfe6ef) },
      },
      vertexShader: [
        'varying float vY;',
        'void main() {',
        '  vY = position.y * 0.5 + 0.5;',
        '  gl_Position = vec4(position.xy, 0.9999, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uTop; uniform vec3 uBottom;',
        'varying float vY;',
        'void main() {',
        '  gl_FragColor = vec4(mix(uBottom, uTop, clamp(vY, 0.0, 1.0)), 1.0);',
        '}',
      ].join('\n'),
    });
    const background = new THREE.Mesh(bgGeo, bgMat);
    background.frustumCulled = false;
    background.renderOrder = -100;
    scene.add(background);

    /** Couleur CSS (hex, rgb()) lue sur le conteneur ; null si absente ou illisible. */
    function cssColor(name) {
      try {
        const v = root.getComputedStyle ? root.getComputedStyle(container).getPropertyValue(name).trim() : '';
        if (!v || /gradient|url|var\(/i.test(v)) return null;
        const c = new THREE.Color();
        c.setStyle(v);
        return c;
      } catch (e) {
        return null;
      }
    }

    // ----- contrôles
    const controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.8;
    controls.screenSpacePanning = true;
    controls.minPolarAngle = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.035;
    controls.autoRotateSpeed = 1.1;

    // ----- état
    const state = {
      build: null,
      pieces: [],
      colors: [],
      step: null,
      ghost: true,
      explode: 0,
      highlight: null,
      hovered: null,
      dark: false,
      autoRotate: false,
      bounds: { center: new THREE.Vector3(), radius: 3, min: new THREE.Vector3(), max: new THREE.Vector3() },
      framed: null, // dernier cadrage automatique { az, el, dist } tant que l'utilisateur n'a pas bougé la vue
    };
    const reducedMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let disposed = false;
    let pickables = [];
    let lastHover = 0, hoverTimer = 0, lastPointer = null, pointerDown = null, dragging = false;
    let magnets = null;
    const tmpM = new THREE.Matrix4();
    const tmpV = new THREE.Vector3();
    const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

    // ----- matériaux partagés
    // Couleur réelle portée par instanceColor (gris très foncé teinté par la pièce).
    const magnetMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.25, envMapIntensity: 0.25 });
    const MAGNET_DARK = new THREE.Color(0x2a2e36).convertSRGBToLinear();
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x1d2026, roughness: 0.82, metalness: 0.02 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b1, roughness: 0.32, metalness: 0.65 });
    const axleMat = new THREE.MeshStandardMaterial({ color: 0x3b4049, roughness: 0.5, metalness: 0.4 });
    const fadedDarkMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.6, transparent: true, opacity: 0.12, depthWrite: false });
    for (const m of [tireMat, hubMat, axleMat]) m.color.convertSRGBToLinear();

    // ---------------------------------------------------- géométries (cache)
    const geoCache = new Map();

    function toShape(ring, holes) {
      const shape = new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const h of holes || []) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
      return shape;
    }

    /** Extrusion centrée en épaisseur ; bevel sans agrandir le contour (bevelOffset = -bevel). */
    function extrude(shape, depth, bevel, curveSegments) {
      const b = bevel > 0 ? Math.min(bevel, depth * 0.3) : 0;
      const inner = depth - 2 * b;
      const g = new THREE.ExtrudeGeometry(shape, b > 0
        ? { depth: inner, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: curveSegments || 1 }
        : { depth, bevelEnabled: false, curveSegments: curveSegments || 1 });
      // z ∈ [−b, inner + b] avec biseau, [0, depth] sans : on recentre sur z = 0.
      g.translate(0, 0, b > 0 ? -inner / 2 : -depth / 2);
      return g;
    }

    /**
     * Fusionne des géométries non indexées. Par partie : alpha de sommet (opacité
     * relative de la couche éclairée, couleur RGBA) et densité du filtre coloré.
     */
    function mergeParts(parts) {
      let n = 0;
      const geos = parts.map((pt) => {
        const g = pt.geo.index ? pt.geo.toNonIndexed() : pt.geo;
        n += g.attributes.position.count;
        return g;
      });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 4), den = new Float32Array(n);
      let off = 0;
      geos.forEach((g, i) => {
        const c = g.attributes.position.count;
        pos.set(g.attributes.position.array, off * 3);
        nor.set(g.attributes.normal.array, off * 3);
        const t = parts[i].tint == null ? 1 : parts[i].tint;
        const d = parts[i].density == null ? 1 : parts[i].density;
        for (let k = 0; k < c; k++) {
          col[(off + k) * 4] = t;
          col[(off + k) * 4 + 1] = t;
          col[(off + k) * 4 + 2] = t;
          col[(off + k) * 4 + 3] = parts[i].alpha;
          den[off + k] = d;
        }
        off += c;
        g.dispose();
        if (g !== parts[i].geo) parts[i].geo.dispose();
      });
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      out.setAttribute('color', new THREE.BufferAttribute(col, 4));
      out.setAttribute('density', new THREE.BufferAttribute(den, 1));
      return out;
    }

    /** Attributs couleur RGBA et densité uniformes (matériaux des pièces). */
    function withColor(geo, alpha, density) {
      const n = geo.attributes.position.count;
      const col = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) col.set([1, 1, 1, alpha], i * 4);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
      geo.setAttribute('density', new THREE.BufferAttribute(new Float32Array(n).fill(density == null ? 1 : density), 1));
      return geo;
    }

    function lineGeometry(segs) {
      // segs : [{ a:[x,y,z], b:[x,y,z], alpha }]
      const pos = new Float32Array(segs.length * 6), col = new Float32Array(segs.length * 8);
      segs.forEach((s, i) => {
        pos.set(s.a, i * 6);
        pos.set(s.b, i * 6 + 3);
        col.set([1, 1, 1, s.alpha, 1, 1, 1, s.alpha], i * 8);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 4));
      return g;
    }

    /** Barrettes d'aimant le long d'un bord [a, b] ; inward = normale intérieure 2D. */
    function magnetBars(a, b, inward, z, thick, out) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy);
      const ux = dx / L, uy = dy / L;
      const n = Math.max(1, Math.round(L / LOOK.magnetPitch));
      const barLen = Math.min(0.2, (L / n) * 0.52);
      const inset = LOOK.rimWidth * 0.5;
      for (let k = 0; k < n; k++) {
        const t = ((k + 0.5) / n) * L;
        out.push({
          center: [a[0] + ux * t + inward[0] * inset, a[1] + uy * t + inward[1] * inset, z],
          dir: [ux, uy, 0],
          side: [inward[0], inward[1], 0],
          size: [barLen, 0.022, thick],
        });
      }
    }

    function barMatrix(bar, shift) {
      const X = new THREE.Vector3(...bar.dir), Y = new THREE.Vector3(...bar.side);
      const Z = new THREE.Vector3().crossVectors(X, Y);
      const m = new THREE.Matrix4().makeBasis(X, Y, Z);
      m.scale(new THREE.Vector3(...bar.size));
      m.setPosition(bar.center[0] - shift[0], bar.center[1] - shift[1], bar.center[2] - shift[2]);
      return m;
    }

    /** Géométrie, contours et aimants d'un type de pièce plate (repère local centré sur le centroïde). */
    function flatAsset(type) {
      if (geoCache.has(type)) return geoCache.get(type);
      const P = MT.PIECES[type];
      const c = P.centroid;
      const outline = P.outline;
      const holes = P.holes || [];
      const inner = offsetPolygon(outline, -LOOK.rimWidth);
      const holeOuter = holes.map((h) => offsetPolygon(h, LOOK.holeRim));
      const paneT = T * LOOK.paneThick;
      const parts = [];
      parts.push({ geo: extrude(toShape(inner, holeOuter), paneT, 0), alpha: LOOK.paneAlpha, density: LOOK.paneDensity });
      parts.push({ geo: extrude(toShape(outline, [inner]), T, LOOK.bevel), alpha: LOOK.rimAlpha, density: LOOK.rimDensity });
      holes.forEach((h, i) => {
        parts.push({ geo: extrude(toShape(holeOuter[i], [h]), T, LOOK.holeRim * 0.22), alpha: LOOK.rimAlpha, density: LOOK.rimDensity });
      });
      const body = mergeParts(parts);
      body.translate(-c[0], -c[1], 0);
      body.computeBoundingSphere();
      body.computeBoundingBox();

      // Liseré : contour extérieur et ouvertures sur les deux faces ; nervures sur la vitre.
      const segs = [];
      const zr = T / 2 - LOOK.bevel * 0.6;
      const ring = (pts, alpha, z) => {
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i], q = pts[(i + 1) % pts.length];
          segs.push({ a: [p[0] - c[0], p[1] - c[1], z], b: [q[0] - c[0], q[1] - c[1], z], alpha });
        }
      };
      for (const z of [zr, -zr]) {
        ring(outline, 1, z);
        for (const h of holes) ring(h, 0.8, T / 2 * (z > 0 ? 1 : -1) * 0.94);
      }
      // Nervures dans le plan médian de la vitre (vues à travers le plastique des deux côtés).
      for (const [a, b] of P.ribs || []) {
        const s = clipSegment(a, b, inner);
        if (!s) continue;
        segs.push({ a: [s[0][0] - c[0], s[0][1] - c[1], 0], b: [s[1][0] - c[0], s[1][1] - c[1], 0], alpha: LOOK.ribAlpha });
      }
      const lines = lineGeometry(segs);
      lines.computeBoundingSphere();

      // Aimants : normale intérieure = gauche du bord pour un contour trigonométrique.
      const ccw = signedArea(outline) > 0 ? 1 : -1;
      const bars = [];
      for (const [a, b] of MT.magnetEdges(type)) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy);
        // Barrettes affleurant les faces du rebord : lisibles à travers le plastique teinté.
        magnetBars(a, b, [(-dy / L) * ccw, (dx / L) * ccw], 0, T + 0.004, bars);
      }
      const magnetsLocal = bars.map((bar) => barMatrix(bar, [c[0], c[1], 0]));
      const asset = { body, lines, magnetsLocal };
      geoCache.set(type, asset);
      return asset;
    }

    /** Plateau à roues : repère local X = longueur (−1..1), Z = largeur (−0,5..0,5), Y = haut, dessus à y = 0. */
    function carAsset() {
      if (geoCache.has('CAR')) return geoCache.get('CAR');
      const L = CAR.length, W = CAR.width, H = CAR.plate;
      const r = 0.07;
      const hx = L / 2, hz = W / 2;
      const s = new THREE.Shape();
      s.moveTo(-hx + r, -hz);
      s.lineTo(hx - r, -hz);
      s.quadraticCurveTo(hx, -hz, hx, -hz + r);
      s.lineTo(hx, hz - r);
      s.quadraticCurveTo(hx, hz, hx - r, hz);
      s.lineTo(-hx + r, hz);
      s.quadraticCurveTo(-hx, hz, -hx, hz - r);
      s.lineTo(-hx, -hz + r);
      s.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
      // Plaque : shape (x, z) extrudée vers le bas.
      const toPlate = (shape, depth, bevel, yTop) => {
        const g = extrude(shape, depth, bevel, 6);
        // extrusion centrée en z → on la place entre yTop − depth et yTop, largeur sur Z
        g.rotateX(Math.PI / 2); // (x, y, z) → (x, −z, y)
        g.translate(0, yTop - depth / 2, 0);
        return g;
      };
      const parts = [{ geo: toPlate(s, H, 0.016, 0), alpha: LOOK.rimAlpha }];
      // Attelages : anneau côté x = 0 (local −1), crochet côté x = 2 (local +1).
      const ringC = -hx - CAR.hitch * 0.58;
      const ringShape = new THREE.Shape();
      ringShape.absarc(ringC, 0, 0.115, 0, Math.PI * 2, false);
      const ringHole = new THREE.Path();
      ringHole.absarc(ringC, 0, 0.058, 0, Math.PI * 2, true);
      ringShape.holes.push(ringHole);
      parts.push({ geo: toPlate(ringShape, 0.05, 0.008, -0.025), alpha: LOOK.rimAlpha });
      parts.push({ geo: toPlate(toShape([[-hx - 0.08, -0.05], [-hx + 0.02, -0.05], [-hx + 0.02, 0.05], [-hx - 0.08, 0.05]], []), 0.05, 0.008, -0.025), alpha: LOOK.rimAlpha });
      parts.push({ geo: toPlate(toShape([[hx - 0.02, -0.045], [hx + CAR.hitch * 0.72, -0.045], [hx + CAR.hitch * 0.72, 0.045], [hx - 0.02, 0.045]], []), 0.05, 0.008, -0.025), alpha: LOOK.rimAlpha });
      const plate = mergeParts(parts);
      plate.computeBoundingSphere();
      const peg = new THREE.CylinderGeometry(0.04, 0.04, 0.12, 20).toNonIndexed();
      peg.translate(hx + CAR.hitch * 0.72 - 0.03, -0.075, 0);
      withColor(peg, LOOK.rimAlpha);

      // Contours et nervure centrale.
      const segs = [];
      const pts = s.getPoints(6);
      for (const y of [-0.004, -H + 0.006]) {
        for (let i = 0; i < pts.length - 1; i++) segs.push({ a: [pts[i].x, y, pts[i].y], b: [pts[i + 1].x, y, pts[i + 1].y], alpha: 1 });
      }
      segs.push({ a: [0, 0.0015, -hz + 0.06], b: [0, 0.0015, hz - 0.06], alpha: LOOK.ribAlpha * 1.4 });
      const lines = lineGeometry(segs);

      // Roues, moyeux, essieux et boîtiers sous le plateau.
      const tire = new THREE.CylinderGeometry(CAR.wheelR, CAR.wheelR, 0.085, 28);
      tire.rotateX(Math.PI / 2);
      const hub = new THREE.CylinderGeometry(0.07, 0.07, 0.095, 20);
      hub.rotateX(Math.PI / 2);
      const axle = new THREE.CylinderGeometry(0.022, 0.022, W + 0.1, 12);
      axle.rotateX(Math.PI / 2);
      const housing = new THREE.BoxGeometry(0.2, 0.07, W * 0.86);
      const wheelX = [-hx + 0.4, hx - 0.4];
      const wheelZ = hz + 0.055;

      // Aimants le long des 4 bords du dessus.
      const bars = [];
      const edge = (a, b, inward) => magnetBars(a, b, inward, 0, 0.03, bars);
      edge([-hx, -hz], [hx, -hz], [0, 1]);
      edge([hx, -hz], [hx, hz], [-1, 0]);
      edge([hx, hz], [-hx, hz], [0, -1]);
      edge([-hx, hz], [-hx, -hz], [1, 0]);
      // Barrettes dans le plan du dessus : (x, z) du plan → (x, −0,013, z) local, affleurant le dessus.
      const flip = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, -0.013, 0, 1, 0, 0, 0, 0, 0, 1);
      const magnetsLocal = bars.map((bar) => new THREE.Matrix4().multiplyMatrices(flip, barMatrix(bar, [0, 0, 0])));
      const asset = { plate, peg, lines, tire, hub, axle, housing, wheelX, wheelZ, magnetsLocal };
      geoCache.set('CAR', asset);
      return asset;
    }

    // ------------------------------------------------------- couleurs
    // Tableau indexé par placement.id (ou objet { id: couleur }) ; manquant = couleur du catalogue.
    function colorList(c) {
      if (Array.isArray(c)) return c.slice();
      return c && typeof c === 'object' ? Object.assign({}, c) : [];
    }
    function pieceColorHex(p) {
      const c = state.colors && state.colors[p.id];
      return hexOf(c, MT.PIECES[p.type].color);
    }
    /** Liseré : même teinte, saturée, plus sombre (thème clair) ou plus claire (sombre). */
    const hsl = { h: 0, s: 0, l: 0 };
    function lineColorFor(srgb, strong) {
      const pal = THEMES[state.dark ? 'dark' : 'light'];
      srgb.getHSL(hsl);
      let l = pal.line.l;
      if (strong) l = state.dark ? 0.8 : 0.22;
      return new THREE.Color().setHSL(hsl.h, Math.max(hsl.s, 0.35) * pal.line.s, l).convertSRGBToLinear();
    }

    function makePieceMaterial(color) {
      return new THREE.MeshPhysicalMaterial({
        color,
        transparent: true,
        opacity: THEMES.light.opacity,
        depthWrite: false,
        side: THREE.FrontSide,
        vertexColors: true,
        roughness: 0.28,
        metalness: 0,
        clearcoat: 0.25,
        clearcoatRoughness: 0.12,
        ior: 1.49,
        specularIntensity: 0.8,
        envMapIntensity: 0.3,
        emissive: color.clone(),
        emissiveIntensity: 0,
      });
    }

    /*
     * Filtre coloré (1re passe) : destination × transmission. La transmission
     * vaut mix(1, couleur, densité), renforcée en incidence rasante (trajet plus
     * long dans le plastique, loi de Beer-Lambert). Les valeurs restent en sRGB,
     * comme le tampon d'image : multiplier en sRGB ≈ multiplier en linéaire.
     */
    const FILTER_VERT = [
      'attribute float density;',
      'varying float vDensity;',
      'varying vec3 vNormal;',
      'varying vec3 vView;',
      'void main() {',
      '  vDensity = density;',
      '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
      '  vNormal = normalMatrix * normal;',
      '  vView = -mv.xyz;',
      '  gl_Position = projectionMatrix * mv;',
      '}',
    ].join('\n');
    const FILTER_FRAG = [
      'uniform vec3 uColor;',
      'uniform float uStrength;',
      'uniform float uGrazing;',
      'varying float vDensity;',
      'varying vec3 vNormal;',
      'varying vec3 vView;',
      'void main() {',
      '  float c = abs(dot(normalize(vNormal), normalize(vView)));',
      '  float path = mix(1.0, 1.0 / max(c, 0.3), uGrazing);',
      '  vec3 t = mix(vec3(1.0), uColor, clamp(vDensity * uStrength, 0.0, 1.0));',
      '  gl_FragColor = vec4(pow(max(t, vec3(0.002)), vec3(path)), 1.0);',
      '}',
    ].join('\n');
    function makeFilterMaterial(srgb) {
      return new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: filterColor(srgb, new THREE.Color()) },
          uStrength: { value: 1 },
          uGrazing: { value: LOOK.grazing },
        },
        vertexShader: FILTER_VERT,
        fragmentShader: FILTER_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.ZeroFactor,
        blendDst: THREE.SrcColorFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
        toneMapped: false,
      });
    }
    /**
     * Transmission d'une teinte : la couleur sRGB, un peu plus saturée (un
     * plastique teinté laisse passer très peu des autres composantes).
     */
    function filterColor(srgb, out) {
      srgb.getHSL(hsl);
      out.setHSL(hsl.h, Math.min(1, hsl.s * 1.08), Math.min(0.62, Math.max(0.42, hsl.l)));
      return out;
    }
    function makeLineMaterial(color) {
      return new THREE.LineBasicMaterial({
        color,
        vertexColors: true,
        transparent: true,
        opacity: LOOK.lineOpacity,
        depthWrite: false,
        toneMapped: false,
      });
    }

    // -------------------------------------------------------- construction
    function clearBuild() {
      for (const pc of state.pieces) {
        pc.mat.dispose();
        pc.filterMat.dispose();
        pc.lineMat.dispose();
        scene.remove(pc.obj);
      }
      state.pieces = [];
      pickables = [];
      if (magnets) {
        scene.remove(magnets);
        magnets.dispose();
        magnets = null;
      }
    }
    const magnetGeo = new THREE.BoxGeometry(1, 1, 1);

    function basisQuaternion(u, v) {
      const U = new THREE.Vector3(...u).normalize();
      const V = new THREE.Vector3(...v).normalize();
      const N = new THREE.Vector3().crossVectors(U, V).normalize();
      return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(U, V, N));
    }

    /**
     * Maillage d'une pièce translucide : le filtre coloré est créé AVANT la
     * couche éclairée (id plus petit, même profondeur de tri) pour être dessiné
     * juste avant elle ; il ne projette pas d'ombre et n'est pas « cliquable ».
     */
    function tintedMesh(geo, pc) {
      const filter = new THREE.Mesh(geo, pc.filterMat);
      filter.castShadow = false;
      filter.raycast = () => {};
      const mesh = new THREE.Mesh(geo, pc.mat);
      mesh.add(filter);
      return mesh;
    }

    /** Points d'échantillon (monde, sans éclaté) : sommets du contour, ou coins du plateau à roues. */
    function samplePoints(p) {
      const pts = [];
      if (p.type === 'CAR') {
        for (const [x, y] of [[-CAR.hitch, -0.1], [CAR.length + CAR.hitch, -0.1], [-CAR.hitch, CAR.width + 0.1], [CAR.length + CAR.hitch, CAR.width + 0.1]]) {
          const w = MT.worldPoint(p, x, y);
          pts.push([w[0], p.pos[1], w[2]], [w[0], 0, w[2]]);
        }
      } else {
        for (const [x, y] of MT.PIECES[p.type].outline) pts.push(MT.worldPoint(p, x, y));
      }
      return pts;
    }

    function buildPiece(p) {
      const srgb = new THREE.Color(pieceColorHex(p));
      const color = srgb.clone().convertSRGBToLinear();
      const mat = makePieceMaterial(color);
      const filterMat = makeFilterMaterial(srgb);
      const lineMat = makeLineMaterial(lineColorFor(srgb));
      const pc = { p, mat, filterMat, lineMat, color, srgb, base: new THREE.Vector3(), off: new THREE.Vector3(), anim: null, mode: 'normal', pts: samplePoints(p) };
      if (p.type === 'CAR') {
        const A = carAsset();
        const U = new THREE.Vector3(...p.u).setY(0).normalize();
        const Y = new THREE.Vector3(0, 1, 0);
        const Z = new THREE.Vector3().crossVectors(U, Y);
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(U, Y, Z));
        const center = MT.worldPoint(p, CAR.length / 2, CAR.width / 2);
        const g = new THREE.Group();
        g.quaternion.copy(q);
        pc.base.set(center[0], p.pos[1], center[2]);
        const plate = tintedMesh(A.plate, pc);
        plate.castShadow = true;
        const lines = new THREE.LineSegments(A.lines, lineMat);
        const peg = tintedMesh(A.peg, pc);
        peg.castShadow = true;
        g.add(plate, lines, peg);
        const yw = CAR.wheelR - p.pos[1];
        pc.dark = [];
        const part = (geo, m, x, y, z, cast) => {
          const mesh = new THREE.Mesh(geo, m);
          mesh.position.set(x, y, z);
          mesh.userData.normalMat = m;
          mesh.userData.cast = cast;
          mesh.castShadow = cast;
          g.add(mesh);
          pc.dark.push(mesh);
          return mesh;
        };
        const tires = [];
        for (const x of A.wheelX) {
          for (const z of [-A.wheelZ, A.wheelZ]) {
            tires.push(part(A.tire, tireMat, x, yw, z, true));
            part(A.hub, hubMat, x, yw, z, false);
          }
          part(A.axle, axleMat, x, yw, 0, false);
          part(A.housing, axleMat, x, -CAR.plate - 0.035, 0, true);
        }
        pc.extraCast = [peg];
        pc.obj = g;
        pc.body = plate;
        pc.pickMeshes = [plate, ...tires];
        pc.magnetsLocal = A.magnetsLocal;
        pc.lines = lines;
      } else {
        const A = flatAsset(p.type);
        const mesh = tintedMesh(A.body, pc);
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        const c = MT.worldCentroid(p);
        pc.base.set(c[0], c[1], c[2]);
        mesh.quaternion.copy(basisQuaternion(p.u, p.v));
        const lines = new THREE.LineSegments(A.lines, lineMat);
        mesh.add(lines);
        pc.obj = mesh;
        pc.body = mesh;
        pc.pickMeshes = [mesh];
        pc.magnetsLocal = A.magnetsLocal;
        pc.lines = lines;
      }
      for (const m of pc.pickMeshes) m.userData.piece = pc;
      pc.obj.position.copy(pc.base);
      pc.obj.updateMatrix();
      scene.add(pc.obj);
      return pc;
    }

    function computeBounds() {
      const b = state.bounds;
      const box = new THREE.Box3();
      for (const pc of state.pieces) {
        for (const w of pc.pts) box.expandByPoint(tmpV.set(w[0], w[1], w[2]));
      }
      if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
      b.min.copy(box.min);
      b.max.copy(box.max);
      box.getCenter(b.center);
      b.radius = Math.max(1, box.getSize(tmpV).length() / 2);
      // Sol, grille et ombres adaptés à la construction.
      const R = b.radius;
      const size = Math.max(24, R * 7);
      ground.scale.set(size, size, 1);
      ground.position.set(b.center.x, 0, b.center.z);
      grid.scale.set(size, size, 1);
      grid.position.set(b.center.x, 0.0015, b.center.z);
      gridMat.uniforms.uCenter.value.set(b.center.x, b.center.z);
      gridMat.uniforms.uRadius.value = Math.max(5, R * 1.7);
      const sc = sun.shadow.camera;
      const ext = R * 1.9 + 1;
      sc.left = -ext;
      sc.right = ext;
      sc.top = ext;
      sc.bottom = -ext;
      sc.near = 0.1;
      sc.far = R * 8 + 20;
      sc.updateProjectionMatrix();
      sun.target.position.copy(b.center);
      sun.position.copy(b.center).addScaledVector(SUN_DIR, R * 3 + 8);
      sun.target.updateMatrixWorld();
      controls.maxDistance = R * 7 + 12;
      controls.minDistance = Math.max(0.9, R * 0.28);
    }

    function buildMagnets() {
      let count = 0;
      for (const pc of state.pieces) {
        pc.magStart = count;
        count += pc.magnetsLocal.length;
      }
      if (!count) return;
      magnets = new THREE.InstancedMesh(magnetGeo, magnetMat, count);
      magnets.frustumCulled = false;
      magnets.castShadow = false;
      magnets.receiveShadow = false;
      magnets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      updateMagnetColors();
      scene.add(magnets);
    }

    function updateMagnetColors() {
      if (!magnets) return;
      const c = new THREE.Color();
      for (const pc of state.pieces) {
        c.copy(pc.color).lerp(MAGNET_DARK, 0.87);
        for (let i = 0; i < pc.magnetsLocal.length; i++) magnets.setColorAt(pc.magStart + i, c);
      }
      if (magnets.instanceColor) magnets.instanceColor.needsUpdate = true;
    }

    /** Position de chaque pièce : base + éclaté + animation de pose ; aimants suivent. */
    function updateTransforms(list) {
      for (const pc of list || state.pieces) {
        const drop = pc.anim ? pc.anim.y : 0;
        pc.obj.position.set(pc.base.x + pc.off.x, pc.base.y + pc.off.y + drop, pc.base.z + pc.off.z);
        pc.obj.updateMatrix();
        pc.obj.updateMatrixWorld(true);
        if (!magnets) continue;
        const show = pc.mode === 'normal' && pc.obj.visible;
        for (let i = 0; i < pc.magnetsLocal.length; i++) {
          if (show) {
            tmpM.multiplyMatrices(pc.obj.matrixWorld, pc.magnetsLocal[i]);
            magnets.setMatrixAt(pc.magStart + i, tmpM);
          } else {
            magnets.setMatrixAt(pc.magStart + i, HIDDEN);
          }
        }
      }
      if (magnets) magnets.instanceMatrix.needsUpdate = true;
    }

    function computeExplode() {
      const C = state.bounds.center;
      // Écartement proportionnel à la distance au centre (sol fixe en y = 0) ; plus doux
      // pour les grandes scènes afin que l'ensemble reste dans le cadre.
      const k = Math.max(0.35, Math.min(LOOK.explodeScale, 2.6 / state.bounds.radius));
      const f = state.explode * k;
      for (const pc of state.pieces) pc.off.set((pc.base.x - C.x) * f, pc.base.y * f, (pc.base.z - C.z) * f);
    }

    // ------------------------------------------------ états visuels
    function modeOf(pc) {
      if (state.step != null && pc.p.step > state.step) return state.ghost ? 'ghost' : 'hidden';
      if (state.highlight && pc.p.type !== state.highlight) return 'dim';
      return 'normal';
    }

    function applyStates() {
      const pal = THEMES[state.dark ? 'dark' : 'light'];
      pickables = [];
      for (const pc of state.pieces) {
        const mode = modeOf(pc);
        pc.mode = mode;
        pc.obj.visible = mode !== 'hidden';
        const fade = pc.anim ? pc.anim.fade : 1;
        let op = pal.opacity, fil = 1, lop = LOOK.lineOpacity;
        if (mode === 'ghost') {
          op = LOOK.ghostOpacity;
          fil = LOOK.ghostFilter;
          lop = LOOK.ghostLine;
        } else if (mode === 'dim') {
          op = LOOK.dimOpacity;
          fil = LOOK.dimFilter;
          lop = LOOK.dimLine;
        }
        if (mode === 'normal' && state.step != null && pc.p.step < state.step) {
          // Étapes précédentes un peu en retrait : l'œil va à l'étape courante.
          op *= LOOK.pastOpacity;
          fil *= LOOK.pastFilter;
          lop *= LOOK.pastLine;
        }
        const hovered = state.hovered === pc && mode === 'normal';
        // Étape en cours : liseré contrasté et plein, en plus de la lueur.
        const current = mode === 'normal' && state.step != null && pc.p.step === state.step;
        if (hovered) op = Math.min(0.85, op * 1.35); // pièce survolée : plus dense et lumineuse
        pc.mat.opacity = op * fade;
        pc.filterMat.uniforms.uStrength.value = fil * fade;
        pc.lineMat.opacity = (hovered || current ? 1 : lop) * fade;
        pc.lineMat.color.copy(lineColorFor(pc.srgb, hovered || current));
        let glow = 0;
        if (mode === 'normal') {
          glow = pal.emissive;
          if (state.step != null && pc.p.step === state.step) glow = Math.max(glow, LOOK.stepGlow);
          if (state.highlight && pc.p.type === state.highlight) glow = Math.max(glow, LOOK.typeGlow);
          if (hovered) glow = LOOK.hoverGlow;
        }
        pc.mat.emissiveIntensity = glow;
        pc.mat.envMapIntensity = pal.env;
        pc.mat.clearcoat = pal.clearcoat;
        const cast = mode === 'normal';
        pc.body.castShadow = cast;
        if (pc.dark) {
          for (const d of pc.dark) {
            d.visible = mode !== 'ghost';
            d.material = mode === 'dim' ? fadedDarkMat : d.userData.normalMat;
            d.castShadow = cast && d.userData.cast;
          }
        }
        if (pc.extraCast) for (const m of pc.extraCast) m.castShadow = cast;
        if (mode === 'normal' && pc.obj.visible) pickables.push(...pc.pickMeshes);
      }
      updateTransforms();
      requestRender();
      if (state.hovered && state.hovered.mode !== 'normal') {
        // La pièce survolée devient fantôme ou cachée : on prévient l'interface.
        state.hovered = null;
        canvas.style.cursor = '';
        if (onHover) onHover(null, lastPointer ? { clientX: lastPointer.clientX, clientY: lastPointer.clientY } : { clientX: 0, clientY: 0 });
      }
    }

    // ---------------------------------------------------- animation de pose
    let animating = false;
    function startDrop(list) {
      if (reducedMotion || !list.length) return;
      const t0 = performance.now();
      for (const pc of list) pc.anim = { t0, y: LOOK.dropHeight, fade: 0 };
      animating = true;
      applyStates();
    }
    function stepAnimations(now) {
      if (!animating) return false;
      let any = false;
      const done = [];
      for (const pc of state.pieces) {
        if (!pc.anim) continue;
        const t = Math.max(0, Math.min(1, (now - pc.anim.t0) / LOOK.dropMs));
        const e = 1 - Math.pow(1 - t, 3);
        pc.anim.y = LOOK.dropHeight * (1 - e);
        pc.anim.fade = Math.min(1, t * 1.8);
        if (t >= 1) done.push(pc);
        else any = true;
      }
      for (const pc of done) pc.anim = null;
      applyStates();
      animating = any;
      return any;
    }

    // ---------------------------------------------------------- rendu
    let frameReq = 0;
    function requestRender() {
      if (!frameReq && !disposed) frameReq = root.requestAnimationFrame(frame);
    }
    function renderNow() {
      renderer.render(scene, camera);
    }
    function frame() {
      frameReq = 0;
      if (disposed) return;
      api.frames++;
      // Horloge unique (performance.now) : l'horodatage de rAF n'est pas toujours sur la même base.
      const more = stepAnimations(performance.now());
      controls.update(); // rappelle requestRender tant que l'amortissement bouge la caméra
      renderNow();
      if (more || state.autoRotate) requestRender();
    }
    controls.addEventListener('change', () => {
      clampTarget();
      requestRender();
    });
    // L'utilisateur prend la main : l'éclaté ne recadre plus automatiquement.
    controls.addEventListener('start', () => {
      state.framed = null;
    });

    function clampTarget() {
      const b = state.bounds;
      const t = controls.target;
      const m = b.radius * 0.8 + 1;
      const x = Math.min(b.max.x + m, Math.max(b.min.x - m, t.x));
      const y = Math.min(b.max.y + 1, Math.max(0, t.y));
      const z = Math.min(b.max.z + m, Math.max(b.min.z - m, t.z));
      if (x !== t.x || y !== t.y || z !== t.z) {
        const dx = x - t.x, dy = y - t.y, dz = z - t.z;
        t.set(x, y, z);
        camera.position.x += dx;
        camera.position.y += dy;
        camera.position.z += dz;
      }
    }

    // ----------------------------------------------------------- caméra
    /**
     * Angle de départ adapté à la forme : construction haute → vue plus basse
     * (on voit les façades et les flèches), construction étalée → vue plus
     * plongeante (on voit l'agencement) ; long côté face à la caméra.
     */
    function autoView() {
      const b = state.bounds;
      const w = b.max.x - b.min.x, d = b.max.z - b.min.z, h = b.max.y - b.min.y;
      const r = h / Math.max(1, w, d);
      const el = Math.max(22, Math.min(36, 38 - 13 * r));
      const az = d > w * 1.3 ? 58 : 32;
      return { az, el };
    }

    /**
     * Cadrage exact d'une caméra perspective sur les sommets des pièces (éclaté
     * compris), vue depuis (az, el) : pour chaque axe de l'écran, la distance
     * minimale et le décalage latéral qui centrent l'ensemble en occupant la
     * fraction LOOK.fillX / fillY de la vue. Résolution directe (pas d'itération) :
     * un point (x, y, z) du repère caméra est dans le cadre si
     * |x − sx| ≤ kx·(D − z), avec kx = fillX·tan(fov_h / 2).
     */
    function placeCamera(az, el, distFactor) {
      const b = state.bounds;
      const O = b.center;
      const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
      const fwd = new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)); // cible → caméra
      const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      const up = new THREE.Vector3().crossVectors(fwd, right);
      const tanV = Math.tan((camera.fov * Math.PI) / 360);
      const kx = LOOK.fillX * tanV * camera.aspect, ky = LOOK.fillY * tanV;
      let ax1 = -Infinity, ax2 = -Infinity, ay1 = -Infinity, ay2 = -Infinity, zMax = -Infinity;
      const visit = (x, y, z) => {
        tmpV.set(x - O.x, y - O.y, z - O.z);
        const px = tmpV.dot(right), py = tmpV.dot(up), pz = tmpV.dot(fwd);
        ax1 = Math.max(ax1, px + kx * pz);
        ax2 = Math.max(ax2, -px + kx * pz);
        ay1 = Math.max(ay1, py + ky * pz);
        ay2 = Math.max(ay2, -py + ky * pz);
        zMax = Math.max(zMax, pz);
      };
      for (const pc of state.pieces) {
        for (const w of pc.pts) visit(w[0] + pc.off.x, w[1] + pc.off.y, w[2] + pc.off.z);
      }
      if (!Number.isFinite(zMax)) {
        // Scène vide : cadre la boîte par défaut.
        for (let i = 0; i < 8; i++) visit(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      }
      const D0 = Math.max((ax1 + ax2) / (2 * kx), (ay1 + ay2) / (2 * ky), zMax + 0.5, 1.5);
      const d = D0 * (distFactor || 1);
      const target = O.clone().addScaledVector(right, (ax1 - ax2) / 2).addScaledVector(up, (ay1 - ay2) / 2);
      const pos = target.clone().addScaledVector(fwd, d);
      // Pivot de rotation sur l'axe de visée, jamais sous le sol (même image).
      if (target.y < 0.05) target.addScaledVector(fwd, Math.min(d * 0.8, (0.05 - target.y) / Math.max(0.05, fwd.y)));
      controls.target.copy(target);
      camera.position.copy(pos);
      camera.near = Math.max(0.02, d / 200);
      camera.far = d * 12 + 50;
      camera.updateProjectionMatrix();
      camera.lookAt(target);
      controls.update();
      state.framed = { az, el, dist: distFactor || 1 };
      requestRender();
    }

    // ------------------------------------------------------ redimension
    function resize() {
      const w = Math.max(1, container.clientWidth || 300);
      const h = Math.max(1, container.clientHeight || 200);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Vue encore au cadrage automatique : on recadre pour le nouveau format (rotation d'un mobile…).
      if (state.framed) placeCamera(state.framed.az, state.framed.el, state.framed.dist);
      renderNow();
      requestRender();
    }
    let ro = null;
    if (root.ResizeObserver) {
      ro = new root.ResizeObserver(() => resize());
      ro.observe(container);
    } else {
      root.addEventListener('resize', resize);
    }

    // --------------------------------------------------- survol et clic
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    function pickAt(clientX, clientY) {
      if (!pickables.length) return null;
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(pickables, false);
      return hits.length ? hits[0].object.userData.piece : null;
    }
    function setHovered(pc) {
      if (state.hovered === pc) return false;
      state.hovered = pc;
      applyStates();
      return true;
    }

    function doHover() {
      hoverTimer = 0;
      lastHover = performance.now();
      if (!lastPointer || disposed) return;
      const pc = dragging ? null : pickAt(lastPointer.clientX, lastPointer.clientY);
      const changed = setHovered(pc);
      canvas.style.cursor = pc ? 'pointer' : '';
      if (onHover && (changed || pc)) {
        try {
          onHover(pc ? pc.p : null, { clientX: lastPointer.clientX, clientY: lastPointer.clientY });
        } catch (e) {
          setTimeout(() => { throw e; });
        }
      }
    }
    function onPointerMove(ev) {
      lastPointer = { clientX: ev.clientX, clientY: ev.clientY };
      if (pointerDown && Math.hypot(ev.clientX - pointerDown.x, ev.clientY - pointerDown.y) > 5) dragging = true;
      if (hoverTimer) return;
      const wait = 33 - (performance.now() - lastHover);
      if (wait <= 0) doHover();
      else hoverTimer = setTimeout(doHover, wait);
    }
    function onPointerLeave() {
      lastPointer = null;
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = 0;
      }
      canvas.style.cursor = '';
      if (setHovered(null) && onHover) onHover(null, { clientX: 0, clientY: 0 });
    }
    function onPointerDown(ev) {
      pointerDown = { x: ev.clientX, y: ev.clientY, t: performance.now() };
      dragging = false;
    }
    function onPointerUp(ev) {
      const d = pointerDown;
      pointerDown = null;
      const wasDrag = dragging;
      dragging = false;
      if (!d || wasDrag || ev.button > 0) return;
      if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 5 || performance.now() - d.t > 700) return;
      const pc = pickAt(ev.clientX, ev.clientY);
      if (pc && onPick) onPick(pc.p);
    }
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    function onContextLost(e) {
      e.preventDefault();
    }
    function onContextRestored() {
      applyStates();
    }
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    // --------------------------------------------------------- thème
    function applyTheme() {
      const pal = THEMES[state.dark ? 'dark' : 'light'];
      renderer.toneMappingExposure = pal.exposure;
      hemi.intensity = pal.hemi;
      hemi.color.setHex(pal.hemiSky).convertSRGBToLinear();
      hemi.groundColor.setHex(pal.hemiGround).convertSRGBToLinear();
      sun.intensity = pal.dir;
      shadowMat.opacity = pal.shadow;
      gridMat.uniforms.uColor.value.set(...pal.grid);
      gridMat.uniforms.uOpacity.value = pal.gridAlpha;
      syncBackground();
      applyStates();
    }
    /** Dégradé du fond : variables CSS de la page si présentes, sinon couleurs du thème. */
    function syncBackground() {
      const pal = THEMES[state.dark ? 'dark' : 'light'];
      const top = cssColor('--stage-top') || new THREE.Color(pal.stageTop);
      const bottom = cssColor('--stage-bottom') || new THREE.Color(pal.stageBottom);
      bgMat.uniforms.uTop.value.copy(top);
      bgMat.uniforms.uBottom.value.copy(bottom);
      renderer.setClearColor(bottom, 1);
    }

    // ------------------------------------------------------------- API
    const api = {
      frames: 0,
      camera,
      controls,
      renderer,
      scene,
      requestRender,

      setBuild(result, opt) {
        if (disposed) return api;
        const op = opt || {};
        if (state.hovered && onHover) onHover(null, { clientX: 0, clientY: 0 });
        clearBuild();
        state.build = result || null;
        state.step = null;
        state.highlight = null;
        state.hovered = null;
        state.colors = colorList(op.colors);
        const list = (result && Array.isArray(result.placements)) ? result.placements : [];
        for (const p of list) {
          if (!MT.PIECES[p.type]) continue;
          state.pieces.push(buildPiece(p));
        }
        computeBounds();
        buildMagnets();
        computeExplode();
        if (!op.keepCamera) {
          const v = autoView();
          placeCamera(v.az, v.el, 1);
        } else {
          state.framed = null;
        }
        applyStates();
        return api;
      },

      setColors(colors) {
        state.colors = colorList(colors);
        for (const pc of state.pieces) {
          pc.srgb = new THREE.Color(pieceColorHex(pc.p));
          pc.color = pc.srgb.clone().convertSRGBToLinear();
          pc.mat.color.copy(pc.color);
          pc.mat.emissive.copy(pc.color);
          filterColor(pc.srgb, pc.filterMat.uniforms.uColor.value);
        }
        updateMagnetColors();
        applyStates();
        return api;
      },

      setStep(k) {
        const prev = state.step;
        const nSteps = state.build && state.build.steps ? state.build.steps.length : 0;
        let next = k == null || k === '' ? null : Math.round(Number(k));
        if (next != null && !Number.isFinite(next)) next = null;
        if (next != null) next = Math.max(0, Math.min(Math.max(0, nSteps - 1), next));
        state.step = next;
        for (const pc of state.pieces) pc.anim = null;
        animating = false;
        let fresh = [];
        if (next != null) {
          fresh = state.pieces.filter((pc) => (prev == null ? pc.p.step === next : pc.p.step > prev && pc.p.step <= next));
        }
        applyStates();
        startDrop(fresh);
        return api;
      },

      setGhost(on) {
        state.ghost = on !== false;
        applyStates();
        return api;
      },

      setExplode(f) {
        const v = Number(f);
        state.explode = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
        computeExplode();
        updateTransforms();
        // Tant que la vue est celle du cadrage automatique, elle suit l'éclaté (rien n'est coupé).
        if (state.framed) placeCamera(state.framed.az, state.framed.el, state.framed.dist);
        requestRender();
        return api;
      },

      highlightType(type) {
        state.highlight = type && MT.PIECES[type] ? type : null;
        applyStates();
        return api;
      },

      setAutoRotate(on) {
        state.autoRotate = !!on;
        controls.autoRotate = state.autoRotate;
        if (state.autoRotate) state.framed = null;
        requestRender();
        return api;
      },

      resetView() {
        const v = autoView();
        placeCamera(v.az, v.el, 1);
        return api;
      },

      /** Extra : angle de vue en degrés (azimut 0 = depuis +Z, sens vers +X ; élévation au-dessus du sol). */
      setView(v) {
        const x = v || {};
        const auto = autoView();
        const az = Number.isFinite(x.azimuth) ? x.azimuth : auto.az;
        const el = Number.isFinite(x.elevation) ? Math.max(2, Math.min(88, x.elevation)) : auto.el;
        placeCamera(az, el, Number.isFinite(x.distance) ? x.distance : 1);
        return api;
      },

      setDark(on) {
        state.dark = !!on;
        applyTheme();
        return api;
      },

      /** Capture PNG du fond dégradé de la vue ; opt.background (couleur CSS) = fond uni. */
      screenshot(opt) {
        const flat = opt && opt.background;
        return new Promise((resolve, reject) => {
          if (disposed) {
            reject(new Error('vue 3D fermée'));
            return;
          }
          const hovered = state.hovered;
          state.hovered = null;
          applyStates();
          if (flat) {
            const c = new THREE.Color();
            try {
              c.setStyle(String(flat));
            } catch (e) {
              c.set(THEMES[state.dark ? 'dark' : 'light'].background);
            }
            bgMat.uniforms.uTop.value.copy(c);
            bgMat.uniforms.uBottom.value.copy(c);
          }
          renderNow();
          try {
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('capture impossible'))), 'image/png');
          } catch (e) {
            reject(e);
          } finally {
            if (flat) syncBackground();
            state.hovered = hovered;
            applyStates();
            renderNow();
          }
        });
      },

      dispose() {
        if (disposed) return;
        disposed = true;
        if (frameReq) root.cancelAnimationFrame(frameReq);
        frameReq = 0;
        if (hoverTimer) clearTimeout(hoverTimer);
        if (ro) ro.disconnect();
        else root.removeEventListener('resize', resize);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('webglcontextlost', onContextLost);
        canvas.removeEventListener('webglcontextrestored', onContextRestored);
        controls.dispose();
        clearBuild();
        for (const a of geoCache.values()) {
          for (const v of Object.values(a)) if (v && v.isBufferGeometry) v.dispose();
        }
        geoCache.clear();
        magnetGeo.dispose();
        ground.geometry.dispose();
        grid.geometry.dispose();
        bgGeo.dispose();
        for (const m of [shadowMat, gridMat, bgMat, magnetMat, tireMat, hubMat, axleMat, fadedDarkMat]) m.dispose();
        if (envTex) envTex.dispose();
        sun.shadow.map && sun.shadow.map.dispose();
        renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        state.pieces = [];
      },
    };

    resize();
    applyTheme();
    const v0 = autoView();
    placeCamera(v0.az, v0.el, 1);
    return api;
  };

  // Réglages exposés pour le banc d'essai (test/viewer-test.html#tune=…).
  MT.viewerLook = LOOK;
  MT.viewerThemes = THEMES;
})(typeof window !== 'undefined' ? window : globalThis);
