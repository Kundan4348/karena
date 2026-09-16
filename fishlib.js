/* Lumina — shared fish library for the 3D aquarium faces.
   Parametric bodies, shaped fins that ride the spine, painted skins, and a Swimmer with mass, spring-damped turning
   (fish slow into a turn, bend through it, and ease out — no constant-rate "box" turns) plus a jump state machine. */
import * as THREE from 'three';

/* ---------- helpers ---------- */
export const h1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const n1 = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return h1(i) * (1 - u) + h1(i + 1) * u; };
export function pink(t, seed = 0) { let v = 0, a = 0.5, f = 0.6; for (let i = 0; i < 5; i++) { v += a * n1(t * f + i * 17.3 + seed); a *= 0.55; f *= 2.1; } return v; }
export const rnd = (a, b) => a + Math.random() * (b - a);
export const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const hump = (u, peak, sharp) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(u, Math.log(0.5) / Math.log(peak)))), sharp);
export function vivid(hex) { const c = new THREE.Color(hex), h = {}; c.getHSL(h); c.setHSL(h.h, Math.min(0.9, h.s * 1.05 + 0.2), clamp(h.l * 0.85, 0.34, 0.5)); return '#' + c.getHexString(); }
export function mixHex(a, b, t) { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t); return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join(''); }
export const GLSL_NOISE = `
float hash3(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm3(vec3 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*noise3(p); p=p*2.02+vec3(1.7,9.2,3.1); a*=.5; } return v; }`;

/* ---------- body flex (shared uniform time) ---------- */
export const uT = { value: 0 };
const FLEX_GLSL = `
uniform float uT, uAmp, uFreq, uPhase, uBend, uLen, uRootX, uFlut;
float spineZ(float x){
  float s = clamp(0.5 - x / uLen, 0.0, 1.0);
  float env = 0.03 + 0.97 * s * s;
  return uLen * (sin(s * 5.0 - uT * uFreq + uPhase) * uAmp * 0.05 * env + uBend * 0.11 * s * s);
}`;
export function flexInject(mat, kind, ctrl, extra) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uT, uAmp: ctrl.amp, uFreq: ctrl.freq, uBend: ctrl.bend, uLen: ctrl.len, uFlut: ctrl.flut, uPhase: { value: extra.phase || 0 }, uRootX: { value: extra.rootX || 0 } });
    const code = kind === 'body'
      ? `transformed.z += spineZ(position.x);`
      : kind === 'fin'
        ? `transformed.z += spineZ(uRootX + position.x)
                        + sin(uv.x * 7.0 + uv.y * 5.0 - uT * uFreq * 0.9 + uPhase) * uv.y * uv.y * uLen * 0.02 * uFlut;`
        : `transformed.z += sin(uv.y * 4.0 - uT * (uFreq * 0.6 + 4.0) + uPhase) * uv.y * uv.y * uLen * 0.05 * uFlut;
           transformed.y += sin(uv.x * 3.0 - uT * (uFreq * 0.6 + 4.0) + uPhase + 1.0) * uv.y * uLen * 0.01 * uFlut;`;
    sh.vertexShader = FLEX_GLSL + '\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + code);
  };
  mat.customProgramCacheKey = () => 'flex-' + kind;
}
export function makeCtrl(L) { return { amp: { value: 0.5 }, freq: { value: 6 }, bend: { value: 0 }, len: { value: L }, flut: { value: 0.6 } }; }

/* ---------- geometry ---------- */
export function fishBody(L, prof) {
  const NU = 40, NA = 22, pos = [], uvs = [], idx = [];
  for (let i = 0; i <= NU; i++) { const u = i / NU, x = (0.5 - u) * L, top = prof.top(u) * L, bot = prof.bot(u) * L, w = prof.wid(u) * L;
    for (let j = 0; j <= NA; j++) { const a = j / NA * Math.PI * 2, cy = Math.cos(a), sz = Math.sin(a);
      const y = cy > 0 ? Math.pow(cy, 0.8) * top : -Math.pow(-cy, 0.9) * bot; pos.push(x, y, sz * w * (1 - 0.2 * cy * cy)); uvs.push(u, j / NA); } }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + NA + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
export function finGeo(w, h, th0, th1, radial, spokes = 26, rings = 7) {
  const pos = [], uvs = [], idx = [];
  for (let r = 0; r <= rings; r++) for (let s = 0; s <= spokes; s++) { const t = s / spokes, th = th0 + (th1 - th0) * t, rad = (r / rings) * radial(t);
    pos.push(Math.cos(th) * w * rad, Math.sin(th) * h * rad, 0); uvs.push(t, r / rings); }
  for (let r = 0; r < rings; r++) for (let s = 0; s < spokes; s++) { const a = r * (spokes + 1) + s, b = a + spokes + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
export const ROUND = (t) => 0.86 + 0.14 * Math.sin(Math.PI * t), FORK = (t) => 1 - 0.42 * Math.pow(1 - Math.abs(2 * t - 1), 1.6), SAIL = (t) => 0.55 + 0.45 * Math.pow(t, 0.7), LUNATE = (t) => 1 - 0.25 * Math.pow(1 - Math.abs(2 * t - 1), 1.2);

/* ---------- textures ---------- */
export function finTextures(edgeHex, bodyHex) {
  const N = 256, c = document.createElement('canvas'), a = document.createElement('canvas'); c.width = a.width = N; c.height = a.height = N;
  const x = c.getContext('2d'), ax = a.getContext('2d');
  const g = x.createLinearGradient(0, N, 0, 0); g.addColorStop(0, bodyHex); g.addColorStop(0.45, mixHex(bodyHex, edgeHex, 0.5)); g.addColorStop(1, edgeHex); x.fillStyle = g; x.fillRect(0, 0, N, N);
  const ag = ax.createLinearGradient(0, N, 0, 0); ag.addColorStop(0, '#f0f0f0'); ag.addColorStop(0.5, '#a8a8a8'); ag.addColorStop(0.85, '#606060'); ag.addColorStop(1, '#000000'); ax.fillStyle = ag; ax.fillRect(0, 0, N, N);
  for (let i = 0; i < 46; i++) { const fx = (i + 0.5) / 46 * N + (Math.random() - 0.5) * 3;
    x.strokeStyle = `rgba(255,255,255,${0.16 + Math.random() * 0.22})`; x.lineWidth = 1.4; x.beginPath(); x.moveTo(N / 2, N); x.lineTo(fx, 0); x.stroke();
    ax.strokeStyle = `rgba(255,255,255,${0.25})`; ax.lineWidth = 1; ax.beginPath(); ax.moveTo(N / 2, N); ax.lineTo(fx, 0); ax.stroke(); }
  const sg = ax.createLinearGradient(0, 0, N, 0); sg.addColorStop(0, 'rgba(0,0,0,1)'); sg.addColorStop(0.3, 'rgba(0,0,0,0)'); sg.addColorStop(0.7, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,1)'); ax.globalCompositeOperation = 'multiply'; ax.fillStyle = sg; ax.fillRect(0, 0, N, N);
  ax.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 40; i++) { ax.beginPath(); ax.arc(Math.random() * N, Math.random() * 10, 4 + Math.random() * 9, 0, 6.29); ax.fill(); }
  const map = new THREE.CanvasTexture(c), alpha = new THREE.CanvasTexture(a); map.colorSpace = THREE.SRGBColorSpace; return { map, alpha };
}
let _plainFin;
export function plainFinAlpha() { if (_plainFin) return _plainFin; const a = document.createElement('canvas'); a.width = a.height = 64; const ax = a.getContext('2d'); const g = ax.createLinearGradient(0, 64, 0, 0); g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#8c8c8c'); g.addColorStop(1, '#000000'); ax.fillStyle = g; ax.fillRect(0, 0, 64, 64); return _plainFin = new THREE.CanvasTexture(a); }

/* skin painter: u along the body (0 nose -> 1 tail), v around (0/1 back, .5 belly). kinds: betta, tetra, clown, tang, chromis */
export function bodyTexture(kind, hexBody, hexEdge) {
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const dorsal = (v) => Math.pow(Math.abs(Math.cos(v * Math.PI)), 3);
  const img = x.createImageData(W, H), d = img.data, col = new THREE.Color();
  const base = new THREE.Color(hexBody || 0xffffff), dark = new THREE.Color(hexBody || 0xffffff).multiplyScalar(0.35), belly = new THREE.Color(0xf2f4f6), edgeC = new THREE.Color(hexEdge || hexBody || 0xffffff);
  const C_SIL = new THREE.Color(0xc9d4dc), C_BACK = new THREE.Color(0x5b6b74), C_NEON = new THREE.Color(0x35d8ff), C_RED = new THREE.Color(0xe8281c);
  const C_ORANGE = new THREE.Color(0xff7a1a), C_ORANGE_D = new THREE.Color(0xc2480a), C_WHITE = new THREE.Color(0xf6f6f2), C_BLACK = new THREE.Color(0x141210);
  const C_YEL = new THREE.Color(0xffd21f), C_YEL_D = new THREE.Color(0xd9a10a), C_CHR = new THREE.Color(0x3fd3c8), C_CHR_D = new THREE.Color(0x1a7f8c);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const u = i / W, v = j / H, dz = dorsal(v), flank = Math.pow(Math.abs(Math.sin(v * Math.PI)), 1.5);
    if (kind === 'tetra') { col.copy(C_SIL).lerp(C_BACK, dz * 0.9); const stripe = Math.exp(-Math.pow((Math.abs(v - 0.5) - 0.27) / 0.045, 2)) * sstep(0.08, 0.2, u) * (1 - sstep(0.88, 0.98, u));
      col.lerp(C_NEON, stripe); const red = sstep(0.42, 0.6, u) * (1 - sstep(0.9, 1, u)) * Math.max(0, 1 - Math.abs(Math.abs(v - 0.5) - 0.13) / 0.12); col.lerp(C_RED, red * 0.9); }
    else if (kind === 'clown') { col.copy(C_ORANGE).lerp(C_ORANGE_D, dz * 0.5);
      // three white bands with thin black outlines: head, mid (bulging forward), tail root
      const band = (cu, w) => { const dd = Math.abs(u - cu) / w; return { w: 1 - sstep(0.7, 1.0, dd), k: sstep(0.7, 1.0, dd) * (1 - sstep(1.0, 1.25, dd)) }; };
      const b1 = band(0.2, 0.05), b2 = band(0.5 + (1 - flank) * 0.04, 0.06), b3 = band(0.86, 0.04); const wsum = Math.min(1, b1.w + b2.w + b3.w), ksum = Math.min(1, b1.k + b2.k + b3.k);
      col.lerp(C_WHITE, wsum); col.lerp(C_BLACK, ksum * 0.85); }
    else if (kind === 'tang') { col.copy(C_YEL).lerp(C_YEL_D, dz * 0.55 + (1 - sstep(0.02, 0.2, u)) * 0.2); const sc = 0.5 + 0.5 * Math.sin(u * 120) * Math.sin(v * 80); col.multiplyScalar(0.96 + 0.06 * sc); }
    else if (kind === 'chromis') { col.copy(C_CHR).lerp(C_CHR_D, dz * 0.8).lerp(belly, Math.pow(flank, 5) * 0.25); const sc = 0.5 + 0.5 * Math.sin(u * 140) * Math.sin(v * 90); col.multiplyScalar(0.94 + 0.1 * sc); }
    else { col.copy(base).lerp(edgeC, sstep(0.45, 0.95, u) * 0.7 * (1 - dz * 0.5)).lerp(dark, dz * 0.6 + (1 - sstep(0.05, 0.3, u)) * 0.3).lerp(belly, Math.pow(flank, 4) * 0.2);
      const sc = 0.5 + 0.5 * Math.sin(u * 90 + Math.sin(v * 60) * 2) * Math.sin(v * 70 + u * 30); col.multiplyScalar(0.94 + 0.12 * sc); }
    for (const ev of [0.26, 0.74]) { const de = Math.hypot((u - 0.13) * 2, (v - ev) * 1.0); if (de < 0.028) col.set(0x0a0a0c); else if (de < 0.04) col.set(kind === 'clown' ? 0xffb066 : 0xd7b46a).lerp(col, (de - 0.028) / 0.012); }
    const gill = Math.exp(-Math.pow((u - 0.22 - Math.abs(v - 0.5) * 0.06) / 0.008, 2)) * flank; col.multiplyScalar(1 - gill * 0.35);
    const k = (j * W + i) * 4; d[k] = col.r * 255; d[k + 1] = col.g * 255; d[k + 2] = col.b * 255; d[k + 3] = 255; }
  x.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/* ---------- assembly ---------- */
function finMesh(grp, geo, mat, x, y, z, rz, ry, kind, ctrl, phase) {
  flexInject(mat, kind, ctrl, { phase, rootX: x }); const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(0, ry, rz); m.renderOrder = 15; grp.add(m); grp.userData.mats.push(mat); return m;
}
function bodyMesh(grp, L, prof, mat, ctrl) { flexInject(mat, 'body', ctrl, {}); const m = new THREE.Mesh(fishBody(L, prof), mat); m.castShadow = true; grp.add(m); grp.userData.mats.push(mat); grp.userData.bodyMat = mat; return m; }
const glowFin = (tex, colEdge, op) => new THREE.MeshPhysicalMaterial({ map: tex.map, alphaMap: tex.alpha, emissive: 0xffffff, emissiveMap: tex.map, emissiveIntensity: 0.55, transparent: true, side: THREE.DoubleSide, roughness: 0.45, metalness: 0, depthWrite: false, opacity: op + 0.08, sheen: 0.6, sheenColor: new THREE.Color(colEdge), iridescence: 0.4, iridescenceIOR: 1.4 });
const plainFin = (color, op, emis = 0.3) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: emis, alphaMap: plainFinAlpha(), transparent: true, side: THREE.DoubleSide, roughness: 0.5, depthWrite: false, opacity: op });

export function makeBetta(L, colBody, colEdge) {
  const grp = new THREE.Group(); grp.userData.mats = []; const ctrl = makeCtrl(L); grp.userData.ctrl = ctrl;
  const prof = { top: (u) => Math.max(0.15 * hump(u, 0.38, 0.8), 0.03 * sstep(0.5, 0.85, u)), bot: (u) => Math.max(0.12 * hump(u, 0.42, 0.9), 0.028 * sstep(0.5, 0.85, u)), wid: (u) => Math.max(0.07 * hump(u, 0.33, 1.0), 0.014 * sstep(0.5, 0.85, u)) };
  bodyMesh(grp, L, prof, new THREE.MeshPhysicalMaterial({ map: bodyTexture('betta', colBody, colEdge), roughness: 0.3, metalness: 0.05, clearcoat: 0.9, clearcoatRoughness: 0.18, sheen: 1, sheenColor: new THREE.Color(colEdge), sheenRoughness: 0.4, iridescence: 0.6, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 500] }), ctrl);
  const tex = finTextures(colEdge, colBody); const fm = (op) => glowFin(tex, colEdge, op);
  finMesh(grp, finGeo(L * 0.78, L * 0.62, Math.PI * 0.58, Math.PI * 1.42, ROUND), fm(0.6), -L * 0.46, 0, 0, 0, 0, 'fin', ctrl, 0.0);
  finMesh(grp, finGeo(L * 0.55, L * 0.42, Math.PI * 0.3, Math.PI * 1.02, SAIL), fm(0.6), -L * 0.1, L * 0.04, 0, 0, 0, 'fin', ctrl, 1.3);
  finMesh(grp, finGeo(L * 0.68, L * 0.46, Math.PI * 1.02, Math.PI * 1.72, SAIL), fm(0.6), -L * 0.08, -L * 0.03, 0, 0, 0, 'fin', ctrl, 2.1);
  finMesh(grp, finGeo(L * 0.3, L * 0.32, Math.PI * 1.2, Math.PI * 1.45, ROUND), fm(0.55), L * 0.1, -L * 0.07, 0, 0, 0, 'fin', ctrl, 0.7);
  for (const sg of [-1, 1]) finMesh(grp, finGeo(L * 0.2, L * 0.15, -Math.PI * 0.45, Math.PI * 0.45, ROUND), fm(0.5), L * 0.2, -L * 0.03, sg * L * 0.055, -0.5, sg * 1.25, 'pec', ctrl, 1.9 + sg);
  grp.userData.tex = tex; return grp;
}
let _tetraTex;
export function makeTetra(L) {
  const grp = new THREE.Group(); grp.userData.mats = []; const ctrl = makeCtrl(L); grp.userData.ctrl = ctrl;
  const prof = { top: (u) => Math.max(0.11 * hump(u, 0.4, 0.9), 0.022 * sstep(0.55, 0.9, u)), bot: (u) => Math.max(0.095 * hump(u, 0.45, 0.9), 0.02 * sstep(0.55, 0.9, u)), wid: (u) => Math.max(0.05 * hump(u, 0.36, 1.0), 0.01 * sstep(0.55, 0.9, u)) };
  _tetraTex = _tetraTex || bodyTexture('tetra');
  bodyMesh(grp, L, prof, new THREE.MeshPhysicalMaterial({ map: _tetraTex, roughness: 0.3, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.2, iridescence: 0.3 }), ctrl);
  const fm = (op) => plainFin(0xb8c8d6, op);
  finMesh(grp, finGeo(L * 0.3, L * 0.24, Math.PI * 0.62, Math.PI * 1.38, FORK), fm(0.4), -L * 0.48, 0, 0, 0, 0, 'fin', ctrl, 0);
  finMesh(grp, finGeo(L * 0.16, L * 0.14, Math.PI * 0.35, Math.PI * 0.9, SAIL), fm(0.35), -L * 0.04, L * 0.06, 0, 0, 0, 'fin', ctrl, 1.1);
  finMesh(grp, finGeo(L * 0.18, L * 0.11, Math.PI * 1.1, Math.PI * 1.7, SAIL), fm(0.35), -L * 0.14, -L * 0.05, 0, 0, 0, 'fin', ctrl, 2.0);
  for (const sg of [-1, 1]) finMesh(grp, finGeo(L * 0.12, L * 0.08, -Math.PI * 0.4, Math.PI * 0.4, ROUND), fm(0.35), L * 0.16, -L * 0.03, sg * L * 0.04, -0.4, sg * 1.2, 'pec', ctrl, 1.5 + sg);
  return grp;
}
let _clownTex;
export function makeClownfish(L) {          // ocellaris: chubby, rounded fins with black edges
  const grp = new THREE.Group(); grp.userData.mats = []; const ctrl = makeCtrl(L); grp.userData.ctrl = ctrl;
  const prof = { top: (u) => Math.max(0.17 * hump(u, 0.4, 0.75), 0.04 * sstep(0.5, 0.88, u)), bot: (u) => Math.max(0.15 * hump(u, 0.45, 0.8), 0.035 * sstep(0.5, 0.88, u)), wid: (u) => Math.max(0.075 * hump(u, 0.38, 1.0), 0.016 * sstep(0.5, 0.88, u)) };
  _clownTex = _clownTex || bodyTexture('clown');
  bodyMesh(grp, L, prof, new THREE.MeshPhysicalMaterial({ map: _clownTex, roughness: 0.4, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.3 }), ctrl);
  const fm = (op) => plainFin(0xff8a2a, op, 0.25);
  finMesh(grp, finGeo(L * 0.32, L * 0.3, Math.PI * 0.6, Math.PI * 1.4, ROUND), fm(0.85), -L * 0.47, 0, 0, 0, 0, 'fin', ctrl, 0);
  finMesh(grp, finGeo(L * 0.5, L * 0.2, Math.PI * 0.2, Math.PI * 0.98, SAIL), fm(0.8), -L * 0.05, L * 0.1, 0, 0, 0, 'fin', ctrl, 1.1);
  finMesh(grp, finGeo(L * 0.3, L * 0.16, Math.PI * 1.05, Math.PI * 1.75, SAIL), fm(0.8), -L * 0.15, -L * 0.09, 0, 0, 0, 'fin', ctrl, 2.0);
  finMesh(grp, finGeo(L * 0.18, L * 0.18, Math.PI * 1.15, Math.PI * 1.55, ROUND), fm(0.8), L * 0.05, -L * 0.1, 0, 0, 0, 'fin', ctrl, 0.7);
  for (const sg of [-1, 1]) finMesh(grp, finGeo(L * 0.2, L * 0.14, -Math.PI * 0.45, Math.PI * 0.45, ROUND), fm(0.8), L * 0.15, -L * 0.03, sg * L * 0.06, -0.4, sg * 1.2, 'pec', ctrl, 1.5 + sg);
  return grp;
}
let _tangTex;
export function makeTang(L) {               // yellow tang: tall disc body, long sail fins, lunate tail
  const grp = new THREE.Group(); grp.userData.mats = []; const ctrl = makeCtrl(L); grp.userData.ctrl = ctrl;
  const prof = { top: (u) => Math.max(0.24 * hump(u, 0.42, 0.7), 0.04 * sstep(0.55, 0.9, u)), bot: (u) => Math.max(0.22 * hump(u, 0.45, 0.75), 0.035 * sstep(0.55, 0.9, u)), wid: (u) => Math.max(0.055 * hump(u, 0.4, 1.0), 0.012 * sstep(0.55, 0.9, u)) };
  _tangTex = _tangTex || bodyTexture('tang');
  bodyMesh(grp, L, prof, new THREE.MeshPhysicalMaterial({ map: _tangTex, roughness: 0.42, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3 }), ctrl);
  const fm = (op) => plainFin(0xffd21f, op, 0.3);
  finMesh(grp, finGeo(L * 0.3, L * 0.34, Math.PI * 0.6, Math.PI * 1.4, LUNATE), fm(0.9), -L * 0.48, 0, 0, 0, 0, 'fin', ctrl, 0);
  finMesh(grp, finGeo(L * 0.62, L * 0.28, Math.PI * 0.15, Math.PI * 0.98, SAIL), fm(0.9), -L * 0.08, L * 0.14, 0, 0, 0, 'fin', ctrl, 1.1);
  finMesh(grp, finGeo(L * 0.5, L * 0.24, Math.PI * 1.02, Math.PI * 1.85, SAIL), fm(0.9), -L * 0.12, -L * 0.13, 0, 0, 0, 'fin', ctrl, 2.0);
  for (const sg of [-1, 1]) finMesh(grp, finGeo(L * 0.2, L * 0.12, -Math.PI * 0.45, Math.PI * 0.45, ROUND), fm(0.7), L * 0.12, -L * 0.02, sg * L * 0.05, -0.4, sg * 1.2, 'pec', ctrl, 1.5 + sg);
  return grp;
}
let _chromisTex;
export function makeChromis(L) {            // blue-green chromis: small, forked tail, schooling
  const grp = new THREE.Group(); grp.userData.mats = []; const ctrl = makeCtrl(L); grp.userData.ctrl = ctrl;
  const prof = { top: (u) => Math.max(0.15 * hump(u, 0.4, 0.8), 0.028 * sstep(0.55, 0.9, u)), bot: (u) => Math.max(0.13 * hump(u, 0.45, 0.85), 0.025 * sstep(0.55, 0.9, u)), wid: (u) => Math.max(0.05 * hump(u, 0.38, 1.0), 0.011 * sstep(0.55, 0.9, u)) };
  _chromisTex = _chromisTex || bodyTexture('chromis');
  bodyMesh(grp, L, prof, new THREE.MeshPhysicalMaterial({ map: _chromisTex, roughness: 0.3, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.2, iridescence: 0.5, iridescenceIOR: 1.5 }), ctrl);
  const fm = (op) => plainFin(0x9fe6df, op, 0.3);
  finMesh(grp, finGeo(L * 0.34, L * 0.26, Math.PI * 0.62, Math.PI * 1.38, FORK), fm(0.5), -L * 0.48, 0, 0, 0, 0, 'fin', ctrl, 0);
  finMesh(grp, finGeo(L * 0.4, L * 0.16, Math.PI * 0.25, Math.PI * 0.95, SAIL), fm(0.45), -L * 0.06, L * 0.09, 0, 0, 0, 'fin', ctrl, 1.1);
  finMesh(grp, finGeo(L * 0.26, L * 0.13, Math.PI * 1.05, Math.PI * 1.75, SAIL), fm(0.45), -L * 0.14, -L * 0.08, 0, 0, 0, 'fin', ctrl, 2.0);
  for (const sg of [-1, 1]) finMesh(grp, finGeo(L * 0.14, L * 0.09, -Math.PI * 0.45, Math.PI * 0.45, ROUND), fm(0.45), L * 0.15, -L * 0.02, sg * L * 0.045, -0.4, sg * 1.2, 'pec', ctrl, 1.5 + sg);
  return grp;
}

/* ---------- dot-matrix LED clock (Gingko-style: dots that shine through a shell) ---------- */
export function makeDotClock(h, color = new THREE.Color(2.6, 2.4, 2.1)) {
  /* Gingko-style: LED dots shining through the white shell. No window — the digits appear out of the plastic and vanish when off.
     5x7 dot glyphs, each dot drawn sharp with a diffusion halo; the material is additive + HDR so the bloom pass adds the soft physical glow. */
  const c = document.createElement('canvas'); c.width = 2048; c.height = 512; const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const w = h * (2048 / 512);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); mesh.renderOrder = 40;
  const G = { // 5 columns x 7 rows, row strings
    '0': ['01110','10001','10011','10101','11001','10001','01110'], '1': ['00100','01100','00100','00100','00100','00100','01110'],
    '2': ['01110','10001','00001','00010','00100','01000','11111'], '3': ['11111','00010','00100','00010','00001','10001','01110'],
    '4': ['00010','00110','01010','10010','11111','00010','00010'], '5': ['11111','10000','11110','00001','00001','10001','01110'],
    '6': ['00110','01000','10000','11110','10001','10001','01110'], '7': ['11111','00001','00010','00100','01000','01000','01000'],
    '8': ['01110','10001','10001','01110','10001','10001','01110'], '9': ['01110','10001','10001','01111','00001','00010','01100'],
    ':': ['0','0','1','0','1','0','0'], ' ': ['00','00','00','00','00','00','00'],
    'A': ['01110','10001','10001','11111','10001','10001','10001'], 'P': ['11110','10001','10001','11110','10000','10000','10000'], 'M': ['10001','11011','10101','10101','10001','10001','10001'] };
  let last = '';
  function set(text, suffix) { const key = text + '|' + suffix; if (key === last) return; last = key;
    x.clearRect(0, 0, c.width, c.height);
    const rows = 7, gap = 1.35;                                   // dot pitch as multiple of dot radius*2
    // measure: digits at full size; suffix at 55%
    const cols = (s) => [...s].reduce((n, ch) => n + (G[ch] || G[' '])[0].length + 1, 0) - 1;
    const bigCols = cols(text), smallCols = suffix ? cols(suffix) : 0;
    let d = 2 * Math.floor(Math.min(c.height / ((rows + 1) * gap * 2), c.width / ((bigCols + 2 + (suffix ? smallCols * 0.55 + 1.5 : 0)) * gap * 2)));  // dot diameter
    const pitch = d * gap, totalW = bigCols * pitch + (suffix ? (smallCols * 0.55 + 1.2) * pitch : 0);
    let ox = (c.width - totalW) / 2, cy = c.height / 2;
    const dot = (px, py, r, a) => { x.fillStyle = `rgba(255,255,255,${a})`; x.beginPath(); x.arc(px, py, r, 0, 6.2832); x.fill(); };
    const draw = (s, scale, x0, y0) => { let cx = x0; for (const ch of s) { const g = G[ch] || G[' ']; const cw = g[0].length;
        for (let r = 0; r < rows; r++) for (let k = 0; k < cw; k++) if (g[r][k] === '1') { const px = cx + k * pitch * scale + d * scale / 2, py = y0 + (r - 3) * pitch * scale;
          // diffusion through the shell: wide faint halo, mid halo, sharp core
          dot(px, py, d * scale * 1.35, 0.12); dot(px, py, d * scale * 0.8, 0.45); dot(px, py, d * scale * 0.5, 1.0); }
        cx += (cw + 1) * pitch * scale; } return cx; };
    const end = draw(text, 1, ox, cy);
    if (suffix) draw(suffix, 0.55, end + pitch * 0.2, cy + pitch * 3 - pitch * 0.55 * 3);   // AM/PM baseline-aligned, small
    tex.needsUpdate = true; }
  return { set, mat, mesh };
}


/* ---------- swimmer ----------
   o: cruise (m/s), turn (rad/s max), accel, bank, beat (Hz at cruise), hoverP, dartP, jumpP (jumps per second), surfaceY (for jumps)
   Turning is second order: the yaw *rate* is driven by a spring toward the desired rate, so a turn starts gently, peaks,
   and eases out; the fish slows into sharp turns and the body bend follows the actual yaw rate. Nothing steps. */
const _to = new THREE.Vector3(), _des = new THREE.Vector3(), _f = new THREE.Vector3(), _e = new THREE.Euler();
export class Swimmer {
  constructor(grp, bounds, o) { this.m = grp; this.b = bounds; this.o = o; this.ctrl = grp.userData.ctrl;
    this.pos = new THREE.Vector3(rnd(bounds.min.x, bounds.max.x), rnd(bounds.min.y, bounds.max.y), rnd(bounds.min.z, bounds.max.z)); this.vel = new THREE.Vector3(); this.fwd = new THREE.Vector3(1, 0, 0);
    this.yaw = Math.random() * 6.28; this.yawRate = 0; this.pitch = 0; this.roll = 0; this.bend = 0; this.effort = 0; this.timer = 0; this.dart = 0; this.state = 'swim'; this.jumpT = 0; this.air = new THREE.Vector3();
    this.target = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.pick(); }
  pick() { const b = this.b, m = 0.01; this.target.set(rnd(b.min.x + m, b.max.x - m), rnd(b.min.y + m, b.max.y - m), rnd(b.min.z + m, b.max.z - m)); this.timer = rnd(3, 8);
    const r = Math.random(); this.tSpeed = r < this.o.hoverP ? this.o.cruise * 0.08 : rnd(this.o.cruise * 0.55, this.o.cruise * 1.3); }
  /* ask for a jump: the fish first dives a little, then rushes up under the surface */
  startJump() { if (this.state !== 'swim' || !this.o.surfaceY) return; this.state = 'windup'; this.jumpT = 0; const b = this.b;
    this.target.set(clamp(this.pos.x, b.min.x + 0.02, b.max.x - 0.02), b.min.y + 0.01, clamp(this.pos.z, b.min.z + 0.02, b.max.z - 0.02)); this.tSpeed = this.o.cruise * 1.2; this.timer = 9; }
  update(dt, t, flow, others, fx) {
    const o = this.o, b = this.b, c = this.ctrl;
    if (this.state === 'air') {                                                        // ballistic flight above the surface
      this.air.y -= 9.81 * dt; this.pos.addScaledVector(this.air, dt); this.jumpT += dt;
      const sp = this.air.length(); if (sp > 1e-4) { const wy = Math.atan2(-this.air.z, this.air.x); this.yaw = wy; this.pitch += (clamp(Math.asin(clamp(this.air.y / sp, -1, 1)), -1.2, 1.2) - this.pitch) * Math.min(1, dt * 8); }
      this.roll *= Math.exp(-dt * 4); this.bend *= Math.exp(-dt * 6); c.freq.value = o.beat * 2.2; c.amp.value = 0.25; c.flut.value = 1.4; c.bend.value = this.bend;
      if (this.pos.y < o.surfaceY && this.air.y < 0) {                                  // splash down
        this.state = 'swim'; this.vel.copy(this.air).multiplyScalar(0.35); if (fx) fx.splash(this.pos.x, this.pos.z, 1.0); this.pick(); this.tSpeed = o.cruise * 0.9; this.timer = 4; }
      _e.set(this.roll, this.yaw, this.pitch, 'YZX'); this.q.setFromEuler(_e); this.fwd.set(1, 0, 0).applyQuaternion(this.q); this.m.position.copy(this.pos); this.m.quaternion.copy(this.q); return;
    }
    if (this.state === 'windup') { this.jumpT += dt; if (this.jumpT > 1.4 || this.pos.y < b.min.y + 0.02) { this.state = 'rush'; this.jumpT = 0; this.target.set(this.pos.x, o.surfaceY + 0.08, this.pos.z); this.tSpeed = o.cruise * 3.6; } }
    else if (this.state === 'rush') { this.jumpT += dt; if (this.pos.y > o.surfaceY - 0.006 && this.vel.y > 0) {   // break the surface
        this.state = 'air'; this.jumpT = 0; const up = clamp(this.vel.y * 2.6, 0.55, 0.95); this.air.set(this.vel.x * 0.9, up, this.vel.z * 0.9); if (fx) fx.splash(this.pos.x, this.pos.z, 0.55); }
      else if (this.jumpT > 7) { this.state = 'swim'; this.pick(); } }
    this.timer -= dt; _to.subVectors(this.target, this.pos); const dist = _to.length(); if (this.state === 'swim' && (dist < 0.01 || this.timer < 0)) this.pick();
    if (o.dartP && this.state === 'swim' && Math.random() < o.dartP * dt) this.dart = 0.35; this.dart = Math.max(0, this.dart - dt);
    // desired velocity: toward the target, slowed by how sharply we must turn (fish decelerate into turns)
    const wantYaw = Math.atan2(-_to.z, _to.x); let dyaw = wantYaw - this.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const turnSlow = this.state === 'rush' ? 1 : 1 - 0.55 * Math.min(1, Math.abs(dyaw) / 1.6);
    const sp = this.tSpeed * (this.dart > 0 ? 3 : 1) * turnSlow;
    _des.copy(_to).normalize().multiplyScalar(sp);
    const mg = 0.014, Wf = (d) => d < mg ? Math.pow(1 - d / mg, 2) * o.cruise * 3 : 0;
    _des.x += Wf(this.pos.x - b.min.x) - Wf(b.max.x - this.pos.x); _des.z += Wf(this.pos.z - b.min.z) - Wf(b.max.z - this.pos.z);
    if (this.state !== 'rush') _des.y += Wf(this.pos.y - b.min.y) - Wf(b.max.y - this.pos.y);
    if (others) { let cx = 0, cy = 0, cz = 0, n = 0; for (const s of others) { if (s === this || s.state === 'air') continue; _f.subVectors(this.pos, s.pos); const d = _f.length(); if (d < 0.013 && d > 1e-5) _des.addScaledVector(_f, (0.013 - d) / d * o.cruise * 6); cx += s.pos.x; cy += s.pos.y; cz += s.pos.z; n++; }
      if (n) { _f.set(cx / n, cy / n, cz / n).sub(this.pos); const d = _f.length(); if (d > 0.03) _des.addScaledVector(_f, o.cruise * 0.4 / d); } }
    _f.subVectors(_des, this.vel).multiplyScalar(o.accel); this.vel.addScaledVector(_f, dt);
    const speed = Math.min(this.vel.length(), o.cruise * (this.state === 'rush' ? 4 : 3.2)); if (speed > 1e-6) this.vel.setLength(speed);
    const thrust = Math.max(0, _f.dot(this.fwd)) / (o.accel * o.cruise); this.effort += (Math.min(1.5, thrust) - this.effort) * Math.min(1, dt * 4);
    // heading: second-order — the yaw RATE springs toward the wanted rate, so turns ramp in and ease out
    if (speed > o.cruise * 0.05) { const wy = Math.atan2(-this.vel.z, this.vel.x); let dy = wy - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const wantRate = clamp(dy * 3.0, -o.turn, o.turn) * (0.55 + 0.45 * Math.min(1, speed / o.cruise));
      this.yawRate += (wantRate - this.yawRate) * Math.min(1, dt * 4.5); this.yaw += this.yawRate * dt;
      const pmax = this.state === 'rush' ? 1.25 : 0.5; const wp = clamp(Math.asin(clamp(this.vel.y / speed, -1, 1)), -pmax, pmax); this.pitch += (wp - this.pitch) * Math.min(1, dt * (this.state === 'rush' ? 6 : 3)); }
    else { this.yawRate *= Math.exp(-dt * 3); this.pitch *= Math.exp(-dt); }
    const nr = this.yawRate / o.turn; this.bend += (nr - this.bend) * Math.min(1, dt * 6); this.roll += (-nr * o.bank * 1.2 - this.roll) * Math.min(1, dt * 3);
    _e.set(this.roll, this.yaw, this.pitch, 'YZX'); this.q.setFromEuler(_e); this.fwd.set(1, 0, 0).applyQuaternion(this.q);
    this.pos.addScaledVector(this.fwd, speed * dt); if (flow) this.pos.addScaledVector(flow, dt);
    this.pos.x = clamp(this.pos.x, b.min.x, b.max.x); this.pos.z = clamp(this.pos.z, b.min.z, b.max.z); this.pos.y = clamp(this.pos.y, b.min.y, this.state === 'rush' ? (o.surfaceY || b.max.y) + 0.01 : b.max.y);
    this.m.position.copy(this.pos); this.m.quaternion.copy(this.q);
    const k = speed / o.cruise;
    c.freq.value = o.beat * (0.35 + 0.65 * Math.min(k, 1.6) + this.effort * 0.5); c.amp.value = clamp(0.15 + k * 0.45 + this.effort * 0.9, 0.12, 1.3); c.bend.value = this.bend; c.flut.value = 0.5 + (1 - Math.min(k, 1)) * 0.8;
  }
}

/* ---------- splash FX: ring ripples on a surface mesh + droplets ---------- */
export class SplashFX {
  constructor(parent, surfaceY, count = 28) { this.y = surfaceY; this.rings = []; this.drops = [];
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshPhysicalMaterial({ color: 0xdff2ff, roughness: 0.05, transparent: true, opacity: 0.55, clearcoat: 1, envMapIntensity: 1.5, depthWrite: false }), count);
    this.mesh.renderOrder = 22; this.mesh.frustumCulled = false; parent.add(this.mesh); this.n = count; this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.p = new THREE.Vector3(); this.hide(); }
  hide() { this.s.setScalar(0); for (let i = 0; i < this.n; i++) { this.m4.compose(this.p.set(0, -1, 0), this.q, this.s); this.mesh.setMatrixAt(i, this.m4); } this.mesh.instanceMatrix.needsUpdate = true; }
  splash(x, z, power) { this.rings.push({ x, z, t: 0, a: power });
    const nd = Math.round(8 + power * 12); for (let i = 0; i < nd && this.drops.length < this.n; i++) { const a = Math.random() * 6.283, r = rnd(0.02, 0.09) * (0.6 + power);
      this.drops.push({ x, y: this.y, z, vx: Math.cos(a) * r, vy: rnd(0.35, 0.8) * (0.6 + power * 0.6), vz: Math.sin(a) * r, r: rnd(0.0005, 0.0012), t: 0 }); } }
  /* height contribution at (x,z) for the surface vertex loop */
  height(x, z) { let h = 0; for (const r of this.rings) { const d = Math.hypot(x - r.x, z - r.z), k = d - r.t * 0.26; h += r.a * 0.0045 * Math.exp(-r.t * 1.6) * Math.exp(-d * 24) * Math.sin(k * 260) * Math.exp(-Math.max(0, -k) * 90); } return h; }
  update(dt) { for (const r of this.rings) r.t += dt; this.rings = this.rings.filter(r => r.t < 3);
    let i = 0; for (const d of this.drops) { d.vy -= 9.81 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.t += dt; }
    this.drops = this.drops.filter(d => !(d.y < this.y && d.vy < 0) && d.t < 2);
    for (const d of this.drops) { this.s.setScalar(d.r); this.m4.compose(this.p.set(d.x, d.y, d.z), this.q, this.s); this.mesh.setMatrixAt(i++, this.m4); }
    this.s.setScalar(0); for (; i < this.n; i++) { this.m4.compose(this.p.set(0, -1, 0), this.q, this.s); this.mesh.setMatrixAt(i, this.m4); }
    this.mesh.instanceMatrix.needsUpdate = true; }
  get active() { return this.rings.length > 0 || this.drops.length > 0; }
}
