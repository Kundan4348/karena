/* Lumina — Aquarium 3D: a desktop betta tank on a side table (Three.js + pmndrs/postprocessing).
   Same API as HearthGL: init / resize / setColors / render / motion / tilt / setView / getView. Exposes window.TankGL. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, NoiseEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode, BlendFunction } from 'postprocessing';

/* ---------- 1/f noise + helpers ---------- */
const h1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const n1 = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return h1(i) * (1 - u) + h1(i + 1) * u; };
function pink(t, seed = 0) { let v = 0, a = 0.5, f = 0.6; for (let i = 0; i < 5; i++) { v += a * n1(t * f + i * 17.3 + seed); a *= 0.55; f *= 2.1; } return v; }
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const GLSL_NOISE = `
float hash3(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm3(vec3 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*noise3(p); p=p*2.02+vec3(1.7,9.2,3.1); a*=.5; } return v; }`;

/* ---------- dimensions (metres, from the product photo: 11.8 x 17.7 x 11.8 cm) ---------- */
const TANK = { W: 0.118, H: 0.177, D: 0.118, wall: 0.003, baseH: 0.03, baseW: 0.136, fill: 0.88 };
const T0 = { y: 0 };                                   // table-top height (world y)

/* ---------- procedural textures ---------- */
function woodTexture() {
  const N = 1024, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
  x.fillStyle = '#4a3527'; x.fillRect(0, 0, N, N);
  for (let i = 0; i < 260; i++) { const y = Math.random() * N; x.strokeStyle = `rgba(${30 + Math.random() * 40 | 0},${18 + Math.random() * 22 | 0},${10 + Math.random() * 12 | 0},${0.1 + Math.random() * 0.3})`; x.lineWidth = 1 + Math.random() * 6;
    x.beginPath(); x.moveTo(0, y); for (let k = 1; k <= 8; k++) x.lineTo(k * N / 8, y + Math.sin(k * 1.3 + i) * 9 + (Math.random() - 0.5) * 6); x.stroke(); }
  for (let i = 0; i < 26000; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.16})`; x.fillRect(Math.random() * N, Math.random() * N, 1, 1 + Math.random() * 3); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
function finTextures(edgeHex, bodyHex) {
  const N = 256, c = document.createElement('canvas'), a = document.createElement('canvas'); c.width = a.width = N; c.height = a.height = N;
  const x = c.getContext('2d'), ax = a.getContext('2d');
  const g = x.createLinearGradient(0, N, 0, 0); g.addColorStop(0, bodyHex); g.addColorStop(0.45, mixHex(bodyHex, edgeHex, 0.5)); g.addColorStop(1, edgeHex); x.fillStyle = g; x.fillRect(0, 0, N, N);
  const ag = ax.createLinearGradient(0, N, 0, 0); ag.addColorStop(0, '#f0f0f0'); ag.addColorStop(0.5, '#a8a8a8'); ag.addColorStop(0.85, '#606060'); ag.addColorStop(1, '#000000'); ax.fillStyle = ag; ax.fillRect(0, 0, N, N);
  for (let i = 0; i < 46; i++) { const fx = (i + 0.5) / 46 * N + (Math.random() - 0.5) * 3;                     // fin rays
    x.strokeStyle = `rgba(255,255,255,${0.16 + Math.random() * 0.22})`; x.lineWidth = 1.4; x.beginPath(); x.moveTo(N / 2, N); x.lineTo(fx, 0); x.stroke();
    ax.strokeStyle = `rgba(255,255,255,${0.25})`; ax.lineWidth = 1; ax.beginPath(); ax.moveTo(N / 2, N); ax.lineTo(fx, 0); ax.stroke(); }
  // soft side edges + ragged outer edge
  const sg = ax.createLinearGradient(0, 0, N, 0); sg.addColorStop(0, 'rgba(0,0,0,1)'); sg.addColorStop(0.3, 'rgba(0,0,0,0)'); sg.addColorStop(0.7, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,1)'); ax.globalCompositeOperation = 'multiply'; ax.fillStyle = sg; ax.fillRect(0, 0, N, N);
  ax.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 40; i++) { ax.beginPath(); ax.arc(Math.random() * N, Math.random() * 10, 4 + Math.random() * 9, 0, 6.29); ax.fill(); }
  const map = new THREE.CanvasTexture(c), alpha = new THREE.CanvasTexture(a); map.colorSpace = THREE.SRGBColorSpace; return { map, alpha };
}
function vivid(hex) { const c = new THREE.Color(hex), h = {}; c.getHSL(h); c.setHSL(h.h, Math.min(0.9, h.s * 1.05 + 0.2), clamp(h.l * 0.85, 0.34, 0.5)); return '#' + c.getHexString(); }
function mixHex(a, b, t) { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t); return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join(''); }

/* ---------- environment for reflections: dark room, one warm lamp, one cool window, faint ceiling ---------- */
function livingRoomEnv() {
  const sc = new THREE.Scene(); const box = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 6), new THREE.MeshStandardMaterial({ color: 0x2a231e, roughness: 1, side: THREE.BackSide })); box.position.y = 1.2; sc.add(box);
  const em = (c, i) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i) });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), em(0xffc688, 14)); lamp.position.set(-1.6, 1.6, 0.9); sc.add(lamp);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.6), em(0x8fb0d8, 1.6)); win.position.set(1.8, 1.5, -2.9); sc.add(win);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), em(0x7a6a5c, 0.5)); ceil.rotation.x = Math.PI / 2; ceil.position.y = 2.79; sc.add(ceil);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), em(0x3a2c22, 0.6)); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.39; sc.add(floor);
  return sc;
}

/* ---------- the room: round wooden side table, wall, lamp glow ---------- */
function buildRoom(scene) {
  const wood = woodTexture(); wood.repeat.set(1, 1);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.022, 64), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0 })); top.position.y = -0.011; top.receiveShadow = true; scene.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.5, 24), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.6 })); leg.position.y = -0.27; scene.add(leg);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.4), new THREE.MeshStandardMaterial({ color: 0x6b5f55, roughness: 1 })); wall.position.set(0, 0.9, -0.55); scene.add(wall);
  const shadow = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); const g = x.createRadialGradient(128, 128, 30, 128, 128, 128); g.addColorStop(0, 'rgba(0,0,0,.7)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); })();
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(TANK.baseW * 1.9, TANK.baseW * 1.9), new THREE.MeshBasicMaterial({ map: shadow, transparent: true, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.0004; scene.add(sh);
}

/* ---------- the tank: base with LED clock, acrylic body, lid light, water, gravel, caustics, decor, bubbles ---------- */
function buildTank(scene) {
  const g = new THREE.Group(); const { W, H, D, baseH, baseW, fill } = TANK;
  const plastic = new THREE.MeshPhysicalMaterial({ color: 0xb9babe, roughness: 0.55, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.35 });
  const base = new THREE.Mesh(new RoundedBoxGeometry(baseW, baseH, baseW, 4, 0.006), plastic); base.position.y = baseH / 2; base.castShadow = true; base.receiveShadow = true; g.add(base);
  const lip = new THREE.Mesh(new RoundedBoxGeometry(W + 0.006, 0.006, D + 0.006, 3, 0.002), plastic); lip.position.y = baseH + 0.003; g.add(lip);
  const y0 = baseH + 0.006;                                                                     // tank floor (world)
  // acrylic body: near faces only (reflective, mostly clear) + faint water tint inside
  const glass = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 6, 0.008), new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.04, metalness: 0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, envMapIntensity: 2.4, specularIntensity: 1, ior: 1.49, depthWrite: false }));
  glass.position.y = y0 + H / 2; glass.renderOrder = 30; g.add(glass);
  const wallFill = new THREE.Mesh(new RoundedBoxGeometry(W - 0.001, H - 0.001, D - 0.001, 6, 0.0075), new THREE.MeshBasicMaterial({ color: 0xbfd2e0, transparent: true, opacity: 0.045, depthWrite: false })); wallFill.position.y = y0 + H / 2; wallFill.renderOrder = 29; g.add(wallFill);
  // acrylic edges catch the light: 4 corner seams + top rim
  const seamMat = new THREE.MeshPhysicalMaterial({ color: 0xdfe9f2, roughness: 0.2, transparent: true, opacity: 0.22, envMapIntensity: 1.2, depthWrite: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const seam = new THREE.Mesh(new THREE.CylinderGeometry(0.0011, 0.0011, H - 0.004, 8), seamMat); seam.position.set(sx * (W / 2 - 0.0035), y0 + H / 2, sz * (D / 2 - 0.0035)); seam.renderOrder = 31; g.add(seam); }
  const rim = new THREE.Mesh(new THREE.BoxGeometry(W - 0.002, 0.0022, D - 0.002), seamMat); rim.position.y = y0 + H - 0.0011; rim.renderOrder = 31; g.add(rim);
  const rimIn = new THREE.Mesh(new THREE.BoxGeometry(W - 0.008, 0.0024, D - 0.008), new THREE.MeshBasicMaterial({ color: 0x0c0a09 })); rimIn.position.y = y0 + H - 0.0011; g.add(rimIn);
  const waterH = H * fill;
  const tintBack = new THREE.Mesh(new THREE.BoxGeometry(W - 0.007, waterH, D - 0.007), new THREE.MeshBasicMaterial({ color: 0x1a5f80, transparent: true, opacity: 0.16, side: THREE.BackSide, depthWrite: false }));
  tintBack.position.y = y0 + waterH / 2; tintBack.renderOrder = 2; g.add(tintBack);
  // lid: white translucent with an LED strip lighting straight down
  const lid = new THREE.Mesh(new RoundedBoxGeometry(W + 0.004, 0.012, D + 0.004, 3, 0.004), new THREE.MeshPhysicalMaterial({ color: 0xd4d5d8, roughness: 0.5, clearcoat: 0.3 })); lid.position.y = y0 + H + 0.005; lid.castShadow = true; g.add(lid);
  const ledStrip = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.7, 0.012), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.7, 2.0) })); ledStrip.rotation.x = Math.PI / 2; ledStrip.position.y = y0 + H - 0.0015; g.add(ledStrip);
  const lidLight = new THREE.PointLight(0xdff2ff, 0.22, 0.6, 2); lidLight.position.set(0, y0 + H - 0.01, 0); g.add(lidLight);
  const beam = new THREE.SpotLight(0xe6f4ff, 0.42, 0.5, 0.75, 0.7, 2); beam.position.set(0, y0 + H - 0.005, 0); beam.target.position.set(0, y0, 0); beam.castShadow = true; beam.shadow.mapSize.set(1024, 1024); beam.shadow.camera.near = 0.01; beam.shadow.camera.far = 0.4; beam.shadow.bias = -0.00015; beam.shadow.normalBias = 0.0006; beam.shadow.radius = 3; g.add(beam); g.add(beam.target);
  // water surface: rippling, refractive
  const surfGeo = new THREE.PlaneGeometry(W - 0.008, D - 0.008, 26, 26); surfGeo.rotateX(-Math.PI / 2);
  const surfMat = new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.03, metalness: 0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, envMapIntensity: 1.2, specularIntensity: 1, ior: 1.33, depthWrite: false });
  const surface = new THREE.Mesh(surfGeo, surfMat); surface.position.y = y0 + waterH; surface.renderOrder = 25; g.add(surface);
  const surfBase = surfGeo.attributes.position.array.slice();
  // gravel: blue glass pebbles + white stones
  const pebGeo = new THREE.IcosahedronGeometry(0.0036, 0); const pebN = 460;
  const pebbles = new THREE.InstancedMesh(pebGeo, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.12, envMapIntensity: 0.5 }), pebN);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), col = new THREE.Color();
  const pal = [0x1f5fd6, 0x2f86e8, 0x4fb3ff, 0x9fd8ff, 0xcfd8e2, 0xdde4ec, 0x1541a8];
  for (let i = 0; i < pebN; i++) { const px = (Math.random() - 0.5) * (W - 0.012), pz = (Math.random() - 0.5) * (D - 0.012), py = y0 + 0.002 + Math.random() * 0.007 + 0.004 * Math.max(0, 1 - Math.hypot(px, pz) / 0.05);
    e.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); q.setFromEuler(e); const s = 0.7 + Math.random() * 0.8; sc.set(s, s * 0.75, s);
    m4.compose(new THREE.Vector3(px, py, pz), q, sc); pebbles.setMatrixAt(i, m4); pebbles.setColorAt(i, col.setHex(pal[Math.random() * pal.length | 0])); }
  pebbles.instanceMatrix.needsUpdate = true; pebbles.receiveShadow = true; g.add(pebbles);
  // caustics: additive light dance on the gravel
  const causMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uTint: { value: new THREE.Color(0.55, 0.8, 1.0) }, uAmt: { value: 0.4 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `${GLSL_NOISE} uniform float uT, uAmt; uniform vec3 uTint; varying vec2 vUv;
      void main(){ vec2 p=vUv*6.0; float a=fbm3(vec3(p, uT*0.35)), b=fbm3(vec3(p*1.7+3.1, -uT*0.28));
        float c=pow(1.0-abs(a-0.5)*2.0, 6.0)*0.8+pow(1.0-abs(b-0.5)*2.0, 8.0)*0.6;
        float edge=smoothstep(0.0,0.08,vUv.x)*smoothstep(1.0,0.92,vUv.x)*smoothstep(0.0,0.08,vUv.y)*smoothstep(1.0,0.92,vUv.y);
        gl_FragColor=vec4(uTint*c*uAmt*edge, c*uAmt*edge); }` });
  const caustics = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.01, D - 0.01), causMat); caustics.rotation.x = -Math.PI / 2; caustics.position.y = y0 + 0.0115; caustics.renderOrder = 3; g.add(caustics);
  // decor: branching blue-green plant, purple vase, snail shell, a few big gems
  const plant = new THREE.Group(); const plantMat = new THREE.MeshStandardMaterial({ color: 0x3c8f86, roughness: 0.7 });
  const branch = (parent, len, r, tilt, spin, depth) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r, len, 7), plantMat); m.position.y = len / 2; m.castShadow = true; const piv = new THREE.Group(); piv.rotation.set(tilt, spin, 0); piv.add(m); parent.add(piv);
    if (depth > 0) for (let k = 0; k < 2 + (Math.random() < 0.5 ? 1 : 0); k++) { const sub = new THREE.Group(); sub.position.y = len * (0.55 + Math.random() * 0.4); piv.add(sub); branch(sub, len * 0.62, r * 0.7, rnd(0.35, 0.8), rnd(0, 6.28), depth - 1); } return piv; };
  for (let k = 0; k < 4; k++) branch(plant, rnd(0.03, 0.05), 0.0028, rnd(0.1, 0.4), k * 1.6 + rnd(0, 0.5), 2);
  plant.position.set(-0.03, y0 + 0.009, -0.01); g.add(plant);
  const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.0075, 0.03, 16), new THREE.MeshPhysicalMaterial({ color: 0x9a5fd8, roughness: 0.25, clearcoat: 0.8 })); vase.position.set(0.012, y0 + 0.024, -0.02); vase.castShadow = true; vase.receiveShadow = true; g.add(vase);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 20, 14), new THREE.MeshStandardMaterial({ color: 0xf0e6d8, roughness: 0.5 })); shell.scale.set(1, 0.75, 0.9); shell.position.set(0.026, y0 + 0.015, 0.012); shell.castShadow = true; g.add(shell);
  const gemMat = new THREE.MeshPhysicalMaterial({ color: 0x2f6fe8, roughness: 0.05, transmission: 0.6, thickness: 0.01, ior: 1.5, clearcoat: 1 });
  for (let i = 0; i < 6; i++) { const gm = new THREE.Mesh(new THREE.IcosahedronGeometry(0.004 + Math.random() * 0.003, 0), gemMat); gm.position.set((Math.random() - 0.5) * (W - 0.03), y0 + 0.012, (Math.random() - 0.5) * (D - 0.03)); gm.rotation.set(Math.random() * 3, Math.random() * 3, 0); g.add(gm); }
  // bubbles from an air stone in the back-right corner
  const bubN = 22; const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, envMapIntensity: 1.0, depthWrite: false }), bubN);
  bubbles.renderOrder = 20; const bub = []; for (let i = 0; i < bubN; i++) bub.push({ x: 0, y: y0 + Math.random() * waterH, z: 0, r: rnd(0.0005, 0.0012), ph: Math.random() * 6.28, v: rnd(0.045, 0.08) }); g.add(bubbles);
  g.userData = { y0, waterH, surface, surfBase, lidLight, caustics, plant, bubbles, bub, glass, tintBack, baseH, baseW };
  scene.add(g); return g;
}
function buildClock(group, baseW, baseH) {
  /* Gingko-style: LED dots shining through the white shell. No window — the digits appear out of the plastic and vanish when off.
     5x7 dot glyphs, each dot drawn sharp with a diffusion halo; the material is additive + HDR so the bloom pass adds the soft physical glow. */
  const c = document.createElement('canvas'); c.width = 2048; c.height = 512; const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const h = baseH * 0.8, w = h * (2048 / 512);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(2.6, 2.4, 2.1) });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); mesh.position.set(0, baseH * 0.5, baseW / 2 + 0.0006); mesh.renderOrder = 40; group.add(mesh);
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
  return { set, mat };
}

/* ---------- fish: parametric bodies, shaped fins that follow the spine, lateral flex + turn bend in the vertex stage ---------- */
const uT = { value: 0 };
const FLEX_GLSL = `
uniform float uT, uAmp, uFreq, uPhase, uBend, uLen, uRootX, uFlut;
// lateral spine offset at body coordinate x (nose = +uLen/2, tail = -uLen/2): travelling wave + a static bend into the turn
float spineZ(float x){
  float s = clamp(0.5 - x / uLen, 0.0, 1.0);
  float env = 0.03 + 0.97 * s * s;
  return uLen * (sin(s * 5.0 - uT * uFreq + uPhase) * uAmp * 0.05 * env + uBend * 0.11 * s * s);
}`;
function flexInject(mat, kind, ctrl, extra) {          // kind: 'body' | 'fin' (planar, rides the spine) | 'pec' (flutters only)
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
const hump = (u, peak, sharp) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(u, Math.log(0.5) / Math.log(peak)))), sharp);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function fishBody(L, prof) {                          // prof.top/bot/wid(u) in fractions of L; u: 0 nose -> 1 peduncle end; uv = (u, around)
  const NU = 40, NA = 22, pos = [], uvs = [], idx = [];
  for (let i = 0; i <= NU; i++) { const u = i / NU, x = (0.5 - u) * L, top = prof.top(u) * L, bot = prof.bot(u) * L, w = prof.wid(u) * L;
    for (let j = 0; j <= NA; j++) { const a = j / NA * Math.PI * 2, cy = Math.cos(a), sz = Math.sin(a);
      const y = cy > 0 ? Math.pow(cy, 0.8) * top : -Math.pow(-cy, 0.9) * bot; pos.push(x, y, sz * w * (1 - 0.2 * cy * cy)); uvs.push(u, j / NA); } }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + NA + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function finGeo(w, h, th0, th1, radial, spokes = 26, rings = 7) {   // fan fin with a shaped free edge; uv.x across the fan, uv.y root(0) -> edge(1)
  const pos = [], uvs = [], idx = [];
  for (let r = 0; r <= rings; r++) for (let s = 0; s <= spokes; s++) { const t = s / spokes, th = th0 + (th1 - th0) * t, rad = (r / rings) * radial(t);
    pos.push(Math.cos(th) * w * rad, Math.sin(th) * h * rad, 0); uvs.push(t, r / rings); }
  for (let r = 0; r < rings; r++) for (let s = 0; s < spokes; s++) { const a = r * (spokes + 1) + s, b = a + spokes + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const ROUND = (t) => 0.86 + 0.14 * Math.sin(Math.PI * t), FORK = (t) => 1 - 0.42 * Math.pow(1 - Math.abs(2 * t - 1), 1.6), SAIL = (t) => 0.55 + 0.45 * Math.pow(t, 0.7);
function bodyTexture(kind, hexBody, hexEdge) {        // painted skin: countershading, lateral line, eye, gill; neon tetra stripe + red flank
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const dorsal = (v) => Math.pow(Math.abs(Math.cos(v * Math.PI)), 3);            // 1 at back (v=0,1), 0 at belly (v=.5)
  const img = x.createImageData(W, H), d = img.data, base = new THREE.Color(hexBody || 0xffffff), dark = new THREE.Color(hexBody || 0xffffff).multiplyScalar(0.35), belly = new THREE.Color(0xf2f4f6), col = new THREE.Color();
  const edgeC = new THREE.Color(hexEdge || hexBody || 0xffffff);
  const C_SIL = new THREE.Color(0xc9d4dc), C_BACK = new THREE.Color(0x5b6b74), C_NEON = new THREE.Color(0x35d8ff), C_RED = new THREE.Color(0xe8281c);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const u = i / W, v = j / H, dz = dorsal(v), flank = Math.pow(Math.abs(Math.sin(v * Math.PI)), 1.5);
    if (kind === 'tetra') { col.copy(C_SIL).lerp(C_BACK, dz * 0.9); const stripe = Math.exp(-Math.pow((Math.abs(v - 0.5) - 0.27) / 0.045, 2)) * sstep(0.08, 0.2, u) * (1 - sstep(0.88, 0.98, u));
      col.lerp(C_NEON, stripe); const red = sstep(0.42, 0.6, u) * (1 - sstep(0.9, 1, u)) * Math.max(0, 1 - Math.abs(Math.abs(v - 0.5) - 0.13) / 0.12); col.lerp(C_RED, red * 0.9); }
    else { col.copy(base).lerp(edgeC, sstep(0.45, 0.95, u) * 0.7 * (1 - dz * 0.5)).lerp(dark, dz * 0.6 + (1 - sstep(0.05, 0.3, u)) * 0.3).lerp(belly, Math.pow(flank, 4) * 0.2);
      const sc = 0.5 + 0.5 * Math.sin(u * 90 + Math.sin(v * 60) * 2) * Math.sin(v * 70 + u * 30); col.multiplyScalar(0.94 + 0.12 * sc); }
    // eye (both flanks) and gill line
    for (const ev of [0.26, 0.74]) { const de = Math.hypot((u - 0.13) * 2, (v - ev) * 1.0); if (de < 0.028) col.set(0x0a0a0c); else if (de < 0.04) col.set(0xd7b46a).lerp(col, (de - 0.028) / 0.012); }
    const gill = Math.exp(-Math.pow((u - 0.22 - Math.abs(v - 0.5) * 0.06) / 0.008, 2)) * flank; col.multiplyScalar(1 - gill * 0.35);
    const k = (j * W + i) * 4; d[k] = col.r * 255; d[k + 1] = col.g * 255; d[k + 2] = col.b * 255; d[k + 3] = 255; }
  x.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function makeCtrl(L) { return { amp: { value: 0.5 }, freq: { value: 6 }, bend: { value: 0 }, len: { value: L }, flut: { value: 0.6 } }; }
function finMesh(grp, geo, mat, x, y, z, rz, ry, kind, ctrl, phase) {
  flexInject(mat, kind, ctrl, { phase, rootX: x }); const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(0, ry, rz); m.renderOrder = 15; grp.add(m); grp.userData.mats.push(mat); return m;
}
function makeBetta(L, colBody, colEdge) {
  const grp = new THREE.Group(); grp.userData.mats = []; const ctrl = makeCtrl(L); grp.userData.ctrl = ctrl;
  const prof = { top: (u) => Math.max(0.15 * hump(u, 0.38, 0.8), 0.03 * sstep(0.5, 0.85, u)), bot: (u) => Math.max(0.12 * hump(u, 0.42, 0.9), 0.028 * sstep(0.5, 0.85, u)), wid: (u) => Math.max(0.07 * hump(u, 0.33, 1.0), 0.014 * sstep(0.5, 0.85, u)) };
  const bodyMat = new THREE.MeshPhysicalMaterial({ map: bodyTexture('betta', colBody, colEdge), roughness: 0.3, metalness: 0.05, clearcoat: 0.9, clearcoatRoughness: 0.18, sheen: 1, sheenColor: new THREE.Color(colEdge), sheenRoughness: 0.4, iridescence: 0.6, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 500] });
  flexInject(bodyMat, 'body', ctrl, {}); const bodyMesh = new THREE.Mesh(fishBody(L, prof), bodyMat); bodyMesh.castShadow = true; grp.add(bodyMesh); grp.userData.mats.push(bodyMat);
  const tex = finTextures(colEdge, colBody);
  // fins are translucent tissue: lit by the LED from above AND glowing softly with transmitted light (emissive = the fin colour)
  const fm = (op) => new THREE.MeshPhysicalMaterial({ map: tex.map, alphaMap: tex.alpha, emissive: 0xffffff, emissiveMap: tex.map, emissiveIntensity: 0.55, transparent: true, side: THREE.DoubleSide, roughness: 0.45, metalness: 0, depthWrite: false, opacity: op + 0.08, sheen: 0.6, sheenColor: new THREE.Color(colEdge), iridescence: 0.4, iridescenceIOR: 1.4 });
  finMesh(grp, finGeo(L * 0.78, L * 0.62, Math.PI * 0.58, Math.PI * 1.42, ROUND), fm(0.6), -L * 0.46, 0, 0, 0, 0, 'fin', ctrl, 0.0);        // caudal: veil tail
  finMesh(grp, finGeo(L * 0.55, L * 0.42, Math.PI * 0.3, Math.PI * 1.02, SAIL), fm(0.6), -L * 0.1, L * 0.04, 0, 0, 0, 'fin', ctrl, 1.3);      // dorsal
  finMesh(grp, finGeo(L * 0.68, L * 0.46, Math.PI * 1.02, Math.PI * 1.72, SAIL), fm(0.6), -L * 0.08, -L * 0.03, 0, 0, 0, 'fin', ctrl, 2.1);   // anal
  finMesh(grp, finGeo(L * 0.3, L * 0.32, Math.PI * 1.2, Math.PI * 1.45, ROUND), fm(0.55), L * 0.1, -L * 0.07, 0, 0, 0, 'fin', ctrl, 0.7);    // pelvic
  for (const sg of [-1, 1]) finMesh(grp, finGeo(L * 0.2, L * 0.15, -Math.PI * 0.45, Math.PI * 0.45, ROUND), fm(0.5), L * 0.2, -L * 0.03, sg * L * 0.055, -0.5, sg * 1.25, 'pec', ctrl, 1.9 + sg);
  grp.userData.tex = tex; grp.userData.bodyMat = bodyMat; return grp;
}
let _tetraTex, _tetraFin;
function makeTetra(L) {
  const grp = new THREE.Group(); grp.userData.mats = []; const ctrl = makeCtrl(L); grp.userData.ctrl = ctrl;
  const prof = { top: (u) => Math.max(0.11 * hump(u, 0.4, 0.9), 0.022 * sstep(0.55, 0.9, u)), bot: (u) => Math.max(0.095 * hump(u, 0.45, 0.9), 0.02 * sstep(0.55, 0.9, u)), wid: (u) => Math.max(0.05 * hump(u, 0.36, 1.0), 0.01 * sstep(0.55, 0.9, u)) };
  _tetraTex = _tetraTex || bodyTexture('tetra'); const bodyMat = new THREE.MeshPhysicalMaterial({ map: _tetraTex, roughness: 0.3, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.2, iridescence: 0.3 });
  flexInject(bodyMat, 'body', ctrl, {}); const bodyMesh = new THREE.Mesh(fishBody(L, prof), bodyMat); bodyMesh.castShadow = true; grp.add(bodyMesh); grp.userData.mats.push(bodyMat);
  if (!_tetraFin) { const a = document.createElement('canvas'); a.width = a.height = 64; const ax = a.getContext('2d'); const g = ax.createLinearGradient(0, 64, 0, 0); g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#8c8c8c'); g.addColorStop(1, '#000000'); ax.fillStyle = g; ax.fillRect(0, 0, 64, 64); _tetraFin = new THREE.CanvasTexture(a); }
  const fm = (op) => new THREE.MeshStandardMaterial({ color: 0xb8c8d6, emissive: 0x8fa4b4, emissiveIntensity: 0.35, alphaMap: _tetraFin, transparent: true, side: THREE.DoubleSide, roughness: 0.5, depthWrite: false, opacity: op });
  finMesh(grp, finGeo(L * 0.3, L * 0.24, Math.PI * 0.62, Math.PI * 1.38, FORK), fm(0.4), -L * 0.48, 0, 0, 0, 0, 'fin', ctrl, 0);
  finMesh(grp, finGeo(L * 0.16, L * 0.14, Math.PI * 0.35, Math.PI * 0.9, SAIL), fm(0.35), -L * 0.04, L * 0.06, 0, 0, 0, 'fin', ctrl, 1.1);
  finMesh(grp, finGeo(L * 0.18, L * 0.11, Math.PI * 1.1, Math.PI * 1.7, SAIL), fm(0.35), -L * 0.14, -L * 0.05, 0, 0, 0, 'fin', ctrl, 2.0);
  for (const sg of [-1, 1]) finMesh(grp, finGeo(L * 0.12, L * 0.08, -Math.PI * 0.4, Math.PI * 0.4, ROUND), fm(0.35), L * 0.16, -L * 0.03, sg * L * 0.04, -0.4, sg * 1.2, 'pec', ctrl, 1.5 + sg);
  return grp;
}
/* swimmer: steering forces -> velocity with mass; heading turns toward the velocity with a rate limit; the body bends into turns and the
   tail beat follows effort (burst-and-glide), so nothing slides sideways or twitches. No per-frame allocations. */
const _to = new THREE.Vector3(), _des = new THREE.Vector3(), _f = new THREE.Vector3(), _e = new THREE.Euler();
class Swimmer {
  constructor(grp, bounds, o) { this.m = grp; this.b = bounds; this.o = o; this.ctrl = grp.userData.ctrl;
    this.pos = new THREE.Vector3(rnd(bounds.min.x, bounds.max.x), rnd(bounds.min.y, bounds.max.y), rnd(bounds.min.z, bounds.max.z)); this.vel = new THREE.Vector3(); this.fwd = new THREE.Vector3(1, 0, 0);
    this.yaw = Math.random() * 6.28; this.pitch = 0; this.roll = 0; this.bend = 0; this.effort = 0; this.timer = 0; this.dart = 0; this.target = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.pick(); }
  pick() { const b = this.b, m = 0.01; this.target.set(rnd(b.min.x + m, b.max.x - m), rnd(b.min.y + m, b.max.y - m), rnd(b.min.z + m, b.max.z - m)); this.timer = rnd(3, 8);
    const r = Math.random(); this.tSpeed = r < this.o.hoverP ? this.o.cruise * 0.08 : rnd(this.o.cruise * 0.55, this.o.cruise * 1.3); }
  update(dt, t, flow, others) {
    const o = this.o, b = this.b; this.timer -= dt; _to.subVectors(this.target, this.pos); if (_to.length() < 0.01 || this.timer < 0) this.pick();
    if (o.dartP && Math.random() < o.dartP * dt) this.dart = 0.35; this.dart = Math.max(0, this.dart - dt);
    const sp = this.tSpeed * (this.dart > 0 ? 3 : 1);
    _des.copy(_to).normalize().multiplyScalar(sp);
    // walls: soft repulsion that grows quadratically inside a 14 mm margin
    const mg = 0.014, W = (d) => d < mg ? Math.pow(1 - d / mg, 2) * o.cruise * 3 : 0;
    _des.x += W(this.pos.x - b.min.x) - W(b.max.x - this.pos.x); _des.y += W(this.pos.y - b.min.y) - W(b.max.y - this.pos.y); _des.z += W(this.pos.z - b.min.z) - W(b.max.z - this.pos.z);
    // shoal: separation + loose cohesion with the others in the same school
    if (others) { let cx = 0, cy = 0, cz = 0, n = 0; for (const s of others) { if (s === this) continue; _f.subVectors(this.pos, s.pos); const d = _f.length(); if (d < 0.013 && d > 1e-5) _des.addScaledVector(_f, (0.013 - d) / d * o.cruise * 6); cx += s.pos.x; cy += s.pos.y; cz += s.pos.z; n++; }
      if (n) { _f.set(cx / n, cy / n, cz / n).sub(this.pos); const d = _f.length(); if (d > 0.03) _des.addScaledVector(_f, o.cruise * 0.4 / d); } }
    // mass: velocity chases the desired velocity; effort = how hard the tail is working
    _f.subVectors(_des, this.vel).multiplyScalar(o.accel); this.vel.addScaledVector(_f, dt);
    const speed = Math.min(this.vel.length(), o.cruise * 3.2); if (speed > 1e-6) this.vel.setLength(speed);
    const thrust = Math.max(0, _f.dot(this.fwd)) / (o.accel * o.cruise); this.effort += (Math.min(1.5, thrust) - this.effort) * Math.min(1, dt * 4);
    // heading follows the velocity direction with a turn-rate limit; body bends into the turn
    if (speed > o.cruise * 0.05) { const wy = Math.atan2(-this.vel.z, this.vel.x); let dy = wy - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const rate = clamp(dy * 3.5, -o.turn, o.turn); this.yaw += rate * dt; this.bend += (rate / o.turn - this.bend) * Math.min(1, dt * 5); this.roll += (-rate * o.bank - this.roll) * Math.min(1, dt * 3);
      const wp = clamp(Math.asin(clamp(this.vel.y / speed, -1, 1)), -0.45, 0.45); this.pitch += (wp - this.pitch) * Math.min(1, dt * 2.5); }
    else { this.bend *= Math.exp(-dt * 3); this.roll *= Math.exp(-dt * 3); this.pitch *= Math.exp(-dt); }
    _e.set(this.roll, this.yaw, this.pitch, 'YZX'); this.q.setFromEuler(_e); this.fwd.set(1, 0, 0).applyQuaternion(this.q);
    // the fish moves along its heading (no side-slip); a little of the water flow carries it
    this.pos.addScaledVector(this.fwd, speed * dt); if (flow) this.pos.addScaledVector(flow, dt);
    this.pos.x = clamp(this.pos.x, b.min.x, b.max.x); this.pos.y = clamp(this.pos.y, b.min.y, b.max.y); this.pos.z = clamp(this.pos.z, b.min.z, b.max.z);
    this.m.position.copy(this.pos); this.m.quaternion.copy(this.q);
    const k = speed / o.cruise, c = this.ctrl;
    c.freq.value = o.beat * (0.35 + 0.65 * Math.min(k, 1.6) + this.effort * 0.5); c.amp.value = clamp(0.15 + k * 0.45 + this.effort * 0.9, 0.12, 1.3); c.bend.value = this.bend; c.flut.value = 0.5 + (1 - Math.min(k, 1)) * 0.8;
  }
}

/* ---------- scene / renderer / post ---------- */
export const TankGL = (() => {
  const view = { zoom: 1, px: 0, py: 0 }; let lastW = 0, lastH = 0, land = false;
  let renderer, scene, camera, composer, bloom, tank, clock, betta, tetras = [], swimmers = [], school = [], ready = false, tSim = 0;
  const wind = { x: 0, z: 0, vx: 0, vz: 0, tx: 0, tz: 0, slosh: 0 }; const tiltBase = { g: null, b: null };
  function init(el) {
    renderer = new THREE.WebGLRenderer({ canvas: el, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x0c0a09);
    const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(livingRoomEnv(), 0.04).texture; scene.environmentIntensity = 0.55; pmrem.dispose();
    camera = new THREE.PerspectiveCamera(30, 1, 0.02, 20);
    buildRoom(scene); tank = buildTank(scene); clock = buildClock(tank, tank.userData.baseW, tank.userData.baseH);
    scene.add(new THREE.AmbientLight(0xffe9d2, 0.05)); scene.add(new THREE.HemisphereLight(0x9fb8d0, 0x3a2c22, 0.22));
    const lamp = new THREE.SpotLight(0xffdcb8, 1.7, 5, 0.55, 0.7, 2); lamp.position.set(-0.9, 1.05, 0.55); lamp.target.position.set(0.05, 0.05, 0); lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.camera.near = 0.3; lamp.shadow.camera.far = 3; lamp.shadow.bias = -0.0004; lamp.shadow.normalBias = 0.002; lamp.shadow.radius = 4; scene.add(lamp); scene.add(lamp.target);      // warm floor lamp, like the photo
    const fill = new THREE.PointLight(0x9fb8ff, 0.18, 3, 2); fill.position.set(0.7, 0.4, 0.5); scene.add(fill);
    // fish
    const { y0, waterH } = tank.userData; const W = TANK.W, D = TANK.D;
    const bounds = new THREE.Box3(new THREE.Vector3(-W / 2 + 0.04, y0 + 0.04, -D / 2 + 0.04), new THREE.Vector3(W / 2 - 0.04, y0 + waterH - 0.03, D / 2 - 0.04));
    betta = makeBetta(0.046, vivid('#4f8cff'), vivid('#ff5fb0')); tank.add(betta);
    swimmers.push(new Swimmer(betta, bounds, { cruise: 0.024, turn: 1.7, accel: 0.9, bank: 0.3, beat: 5.5, hoverP: 0.25 }));
    const tb = new THREE.Box3(new THREE.Vector3(-W / 2 + 0.014, y0 + 0.02, -D / 2 + 0.014), new THREE.Vector3(W / 2 - 0.014, y0 + waterH - 0.015, D / 2 - 0.014));
    for (let i = 0; i < 6; i++) { const tt = makeTetra(0.019); tank.add(tt); tetras.push(tt); school.push(new Swimmer(tt, tb, { cruise: 0.04, turn: 5, accel: 3, bank: 0.3, beat: 13, hoverP: 0.08, dartP: 0.12 })); }
    composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(scene, camera));
    bloom = new BloomEffect({ luminanceThreshold: 1.0, luminanceSmoothing: 0.15, intensity: 0.3, mipmapBlur: true, radius: 0.5, levels: 5, resolutionScale: 0.5 });
    const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.OVERLAY }); grain.blendMode.opacity.value = 0.04;
    composer.addPass(new EffectPass(camera, bloom, grain, new VignetteEffect({ offset: 0.3, darkness: 0.5 }), new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));
    ready = true; return true;
  }
  function setView(zoom, px, py) { view.zoom = clamp(zoom, 0.5, 3); view.px = clamp(px, -1, 1); view.py = clamp(py, -1, 1); if (ready) frame(); return { ...view }; }
  let qScale = 1, slowFrames = 0, fastFrames = 0;
  function applySize() { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * qScale); renderer.setSize(lastW, lastH, false); composer.setSize(lastW, lastH); }
  function resize(w, h) { if (!ready) return; lastW = w; lastH = h; applySize(); frame(); }
  // adaptive quality: if the GPU cannot hold ~40 fps (thermal throttling on phones), step the internal resolution down, and back up when it recovers
  function adapt(dt) { if (dt > 1 / 40) { slowFrames++; fastFrames = 0; } else if (dt < 1 / 58) { fastFrames++; slowFrames = 0; } else { slowFrames = Math.max(0, slowFrames - 1); }
    if (slowFrames > 45 && qScale > 0.6) { qScale = Math.max(0.6, qScale - 0.15); slowFrames = 0; applySize(); }
    else if (fastFrames > 600 && qScale < 1) { qScale = Math.min(1, qScale + 0.15); fastFrames = 0; applySize(); } }
  function frame() {
    const w = lastW, h = lastH; camera.aspect = w / h; land = w > h;
    const totalH = TANK.baseH + TANK.H + 0.02, totalW = TANK.baseW;
    const vf = THREE.MathUtils.degToRad(camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const dist = TANK.D / 2 + Math.max(totalW * 1.15 / 2 / Math.tan(hf / 2), totalH * 1.08 / 2 / Math.tan(vf / 2)) / view.zoom;
    const cy = totalH * 0.5, halfH = Math.tan(vf / 2) * dist, halfW = halfH * camera.aspect, ox = -view.px * halfW, oy = -view.py * halfH;
    camera.position.set(dist * 0.18 + ox, cy + dist * 0.16 + oy, dist * 0.98); camera.lookAt(0.002 + ox, cy - 0.005 + oy, 0); camera.updateProjectionMatrix(); camera.userData.dx = camera.userData.dy = 0;
  }
  function setColors(hexA, hexB) {
    // accent = betta body tint, accent2 = fin edge colour
    hexA = vivid(hexA); hexB = vivid(hexB); const tex = finTextures(hexB, hexA);
    for (const m of betta.userData.mats) { if (m.alphaMap) { m.map = tex.map; m.emissiveMap = tex.map; m.alphaMap = tex.alpha; m.needsUpdate = true; } }
    const bm = betta.userData.bodyMat; if (bm.map) bm.map.dispose(); bm.map = bodyTexture('betta', hexA, hexB); bm.sheenColor.set(hexB); bm.needsUpdate = true; for (const m of betta.userData.mats) if (m.alphaMap) m.sheenColor.set(hexB);
    { const c = new THREE.Color(hexA), warm = new THREE.Color(0xffe6c4); c.lerp(warm, 0.6).multiplyScalar(2.6); clock.mat.color.copy(c); }
  }
  function motion(ax, ay, az) { wind.vx -= ax * 0.05; wind.vz -= az * 0.03; wind.slosh = Math.min(1, wind.slosh + Math.hypot(ax, ay, az) / 12); }
  function tilt(g, b) { if (tiltBase.g === null) { tiltBase.g = g || 0; tiltBase.b = b || 0; } tiltBase.g += ((g || 0) - tiltBase.g) * 0.03; tiltBase.b += ((b || 0) - tiltBase.b) * 0.03;
    wind.tx = -Math.sin(THREE.MathUtils.degToRad(clamp((g || 0) - tiltBase.g, -45, 45))) * 0.6; wind.tz = Math.sin(THREE.MathUtils.degToRad(clamp((b || 0) - tiltBase.b, -45, 45))) * 0.4; }
  const flowV = new THREE.Vector3();
  function render(dt, timeText, suffix, mo = 1, bass = 0) {
    if (!ready) return; const sdt = dt * (0.4 + 0.6 * mo); tSim += sdt; const t = tSim; uT.value = t;
    // water slosh: a spring-damped surface tilt + ripple energy that decays
    wind.vx += ((wind.tx - wind.x) * 9 - wind.vx * 3.2) * dt; wind.vz += ((wind.tz - wind.z) * 9 - wind.vz * 3.2) * dt; wind.x += wind.vx * dt; wind.z += wind.vz * dt; wind.slosh *= Math.exp(-dt * 1.2);
    const U = tank.userData, sp = U.surface.geometry.attributes.position, base = U.surfBase, amp = 0.0006 + wind.slosh * 0.004;
    for (let i = 0; i < sp.count; i++) { const x = base[i * 3], z = base[i * 3 + 2];
      const y = Math.sin(x * 140 + t * 2.1) * amp * 0.6 + Math.sin(z * 120 - t * 1.7 + x * 40) * amp * 0.5 + Math.sin((x + z) * 90 + t * 3.1) * amp * 0.35 + (x * wind.x + z * wind.z) * 0.25;
      sp.setY(i, y); }
    sp.needsUpdate = true; U.surface.geometry.computeVertexNormals();
    // lid light breathes very slightly (LED driver), caustics follow
    U.lidLight.intensity = 0.22 * (0.96 + 0.04 * pink(t * 0.5, 3)) * (1 + bass * 0.25); U.caustics.material.uniforms.uT.value = t; U.caustics.material.uniforms.uAmt.value = 0.38 + wind.slosh * 0.6 + bass * 0.2;
    U.plant.rotation.z = 0.04 * Math.sin(t * 0.7) + wind.x * 0.15; U.plant.rotation.x = 0.03 * Math.sin(t * 0.55 + 1) + wind.z * 0.15;
    // fish
    flowV.set(wind.x * 0.02, 0, wind.z * 0.02);
    for (const s of swimmers) s.update(sdt, t, flowV, null); for (const s of school) s.update(sdt, t, flowV, school);
    // bubbles
    const B = U.bub, m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (let i = 0; i < B.length; i++) { const b = B[i]; b.y += b.v * sdt * (1 + b.r * 300); if (b.y > U.y0 + U.waterH - 0.002) { b.y = U.y0 + 0.012; b.ph = Math.random() * 6.28; }
      const k = (b.y - U.y0) / U.waterH; pos.set(TANK.W / 2 - 0.02 + Math.sin(t * 3 + b.ph) * 0.003 + wind.x * 0.01 * k, b.y, -TANK.D / 2 + 0.02 + Math.cos(t * 2.3 + b.ph) * 0.003);
      sc.setScalar(b.r * (1 + k * 0.3)); m4.compose(pos, q, sc); U.bubbles.setMatrixAt(i, m4); }
    U.bubbles.instanceMatrix.needsUpdate = true;
    // slow camera drift
    if (mo > 0) { camera.position.x += 0.004 * Math.sin(t * 2 * Math.PI / 43) - (camera.userData.dx || 0); camera.userData.dx = 0.004 * Math.sin(t * 2 * Math.PI / 43);
      camera.position.y += 0.003 * Math.sin(t * 2 * Math.PI / 61) - (camera.userData.dy || 0); camera.userData.dy = 0.003 * Math.sin(t * 2 * Math.PI / 61); }
    clock.set(timeText, suffix);
    adapt(dt);
    composer.render(dt);
  }
  return { init, resize, setColors, render, motion, tilt, setView, getView: () => ({ ...view }), get ready() { return ready; } };
})();
window.TankGL = TankGL;
