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
    x.strokeStyle = `rgba(255,255,255,${0.10 + Math.random() * 0.18})`; x.lineWidth = 1.2; x.beginPath(); x.moveTo(N / 2, N); x.lineTo(fx, 0); x.stroke();
    ax.strokeStyle = `rgba(255,255,255,${0.25})`; ax.lineWidth = 1; ax.beginPath(); ax.moveTo(N / 2, N); ax.lineTo(fx, 0); ax.stroke(); }
  // soft side edges + ragged outer edge
  const sg = ax.createLinearGradient(0, 0, N, 0); sg.addColorStop(0, 'rgba(0,0,0,1)'); sg.addColorStop(0.3, 'rgba(0,0,0,0)'); sg.addColorStop(0.7, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,1)'); ax.globalCompositeOperation = 'multiply'; ax.fillStyle = sg; ax.fillRect(0, 0, N, N);
  ax.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 40; i++) { ax.beginPath(); ax.arc(Math.random() * N, Math.random() * 10, 4 + Math.random() * 9, 0, 6.29); ax.fill(); }
  const map = new THREE.CanvasTexture(c), alpha = new THREE.CanvasTexture(a); map.colorSpace = THREE.SRGBColorSpace; return { map, alpha };
}
function mixHex(a, b, t) { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t); return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join(''); }

/* ---------- the room: round wooden side table, wall, lamp glow ---------- */
function buildRoom(scene) {
  const wood = woodTexture(); wood.repeat.set(1, 1);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.022, 64), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0 })); top.position.y = -0.011; scene.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.5, 24), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.6 })); leg.position.y = -0.27; scene.add(leg);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.4), new THREE.MeshStandardMaterial({ color: 0x6b5f55, roughness: 1 })); wall.position.set(0, 0.9, -0.55); scene.add(wall);
  const shadow = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); const g = x.createRadialGradient(128, 128, 30, 128, 128, 128); g.addColorStop(0, 'rgba(0,0,0,.7)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); })();
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(TANK.baseW * 1.9, TANK.baseW * 1.9), new THREE.MeshBasicMaterial({ map: shadow, transparent: true, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.0004; scene.add(sh);
}

/* ---------- the tank: base with LED clock, acrylic body, lid light, water, gravel, caustics, decor, bubbles ---------- */
function buildTank(scene) {
  const g = new THREE.Group(); const { W, H, D, baseH, baseW, fill } = TANK;
  const plastic = new THREE.MeshPhysicalMaterial({ color: 0xe9e9ec, roughness: 0.45, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4 });
  const base = new THREE.Mesh(new RoundedBoxGeometry(baseW, baseH, baseW, 4, 0.006), plastic); base.position.y = baseH / 2; g.add(base);
  const lip = new THREE.Mesh(new RoundedBoxGeometry(W + 0.006, 0.006, D + 0.006, 3, 0.002), plastic); lip.position.y = baseH + 0.003; g.add(lip);
  const y0 = baseH + 0.006;                                                                     // tank floor (world)
  // acrylic body: near faces only (reflective, mostly clear) + faint water tint inside
  const glass = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 6, 0.008), new THREE.MeshPhysicalMaterial({ color: 0xe8f2f8, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.07, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.1, specularIntensity: 0.9, depthWrite: false }));
  glass.position.y = y0 + H / 2; glass.renderOrder = 30; g.add(glass);
  const glassBack = new THREE.Mesh(new THREE.BoxGeometry(W - 0.004, H - 0.004, D - 0.004), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.025, side: THREE.BackSide, envMapIntensity: 0.6, depthWrite: false }));
  glassBack.position.y = y0 + H / 2; glassBack.renderOrder = 1; g.add(glassBack);
  const waterH = H * fill;
  const tintBack = new THREE.Mesh(new THREE.BoxGeometry(W - 0.007, waterH, D - 0.007), new THREE.MeshBasicMaterial({ color: 0x1c6b8c, transparent: true, opacity: 0.2, side: THREE.BackSide, depthWrite: false }));
  tintBack.position.y = y0 + waterH / 2; tintBack.renderOrder = 2; g.add(tintBack);
  // lid: white translucent with an LED strip lighting straight down
  const lid = new THREE.Mesh(new RoundedBoxGeometry(W + 0.004, 0.012, D + 0.004, 3, 0.004), new THREE.MeshPhysicalMaterial({ color: 0xf2f2f4, roughness: 0.5, clearcoat: 0.4 })); lid.position.y = y0 + H + 0.005; g.add(lid);
  const ledStrip = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.7, 0.012), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.4, 2.8) })); ledStrip.rotation.x = Math.PI / 2; ledStrip.position.y = y0 + H - 0.0015; g.add(ledStrip);
  const lidLight = new THREE.PointLight(0xdff2ff, 0.22, 0.6, 2); lidLight.position.set(0, y0 + H - 0.01, 0); g.add(lidLight);
  const beam = new THREE.SpotLight(0xe6f4ff, 0.7, 0.5, 0.75, 0.7, 2); beam.position.set(0, y0 + H - 0.005, 0); beam.target.position.set(0, y0, 0); g.add(beam); g.add(beam.target);
  // water surface: rippling, refractive
  const surfGeo = new THREE.PlaneGeometry(W - 0.008, D - 0.008, 40, 40); surfGeo.rotateX(-Math.PI / 2);
  const surfMat = new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, envMapIntensity: 0.9, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, depthWrite: false });
  const surface = new THREE.Mesh(surfGeo, surfMat); surface.position.y = y0 + waterH; surface.renderOrder = 25; g.add(surface);
  const surfBase = surfGeo.attributes.position.array.slice();
  // gravel: blue glass pebbles + white stones
  const pebGeo = new THREE.IcosahedronGeometry(0.0034, 0); const pebN = 720;
  const pebbles = new THREE.InstancedMesh(pebGeo, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.08, envMapIntensity: 0.7 }), pebN);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), col = new THREE.Color();
  const pal = [0x1f5fd6, 0x2f86e8, 0x4fb3ff, 0x9fd8ff, 0xeef4ff, 0xffffff, 0x1541a8];
  for (let i = 0; i < pebN; i++) { const px = (Math.random() - 0.5) * (W - 0.012), pz = (Math.random() - 0.5) * (D - 0.012), py = y0 + 0.002 + Math.random() * 0.007 + 0.004 * Math.max(0, 1 - Math.hypot(px, pz) / 0.05);
    e.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); q.setFromEuler(e); const s = 0.7 + Math.random() * 0.8; sc.set(s, s * 0.75, s);
    m4.compose(new THREE.Vector3(px, py, pz), q, sc); pebbles.setMatrixAt(i, m4); pebbles.setColorAt(i, col.setHex(pal[Math.random() * pal.length | 0])); }
  pebbles.instanceMatrix.needsUpdate = true; g.add(pebbles);
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
  const branch = (parent, len, r, tilt, spin, depth) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r, len, 7), plantMat); m.position.y = len / 2; const piv = new THREE.Group(); piv.rotation.set(tilt, spin, 0); piv.add(m); parent.add(piv);
    if (depth > 0) for (let k = 0; k < 2 + (Math.random() < 0.5 ? 1 : 0); k++) { const sub = new THREE.Group(); sub.position.y = len * (0.55 + Math.random() * 0.4); piv.add(sub); branch(sub, len * 0.62, r * 0.7, rnd(0.35, 0.8), rnd(0, 6.28), depth - 1); } return piv; };
  for (let k = 0; k < 4; k++) branch(plant, rnd(0.03, 0.05), 0.0028, rnd(0.1, 0.4), k * 1.6 + rnd(0, 0.5), 2);
  plant.position.set(-0.03, y0 + 0.009, -0.01); g.add(plant);
  const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.0075, 0.03, 16), new THREE.MeshPhysicalMaterial({ color: 0x9a5fd8, roughness: 0.25, clearcoat: 0.8 })); vase.position.set(0.012, y0 + 0.024, -0.02); g.add(vase);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 20, 14), new THREE.MeshStandardMaterial({ color: 0xf0e6d8, roughness: 0.5 })); shell.scale.set(1, 0.75, 0.9); shell.position.set(0.026, y0 + 0.015, 0.012); g.add(shell);
  const gemMat = new THREE.MeshPhysicalMaterial({ color: 0x2f6fe8, roughness: 0.05, transmission: 0.6, thickness: 0.01, ior: 1.5, clearcoat: 1 });
  for (let i = 0; i < 6; i++) { const gm = new THREE.Mesh(new THREE.IcosahedronGeometry(0.004 + Math.random() * 0.003, 0), gemMat); gm.position.set((Math.random() - 0.5) * (W - 0.03), y0 + 0.012, (Math.random() - 0.5) * (D - 0.03)); gm.rotation.set(Math.random() * 3, Math.random() * 3, 0); g.add(gm); }
  // bubbles from an air stone in the back-right corner
  const bubN = 22; const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, envMapIntensity: 1.0, depthWrite: false }), bubN);
  bubbles.renderOrder = 20; const bub = []; for (let i = 0; i < bubN; i++) bub.push({ x: 0, y: y0 + Math.random() * waterH, z: 0, r: rnd(0.0005, 0.0012), ph: Math.random() * 6.28, v: rnd(0.045, 0.08) }); g.add(bubbles);
  g.userData = { y0, waterH, surface, surfBase, lidLight, caustics, plant, bubbles, bub, glass, tintBack, baseH, baseW };
  scene.add(g); return g;
}
function buildClock(group, baseW, baseH) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 640; const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const h = baseH * 0.78, w = h * (2048 / 640);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(1.6, 1.9, 2.2) });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); mesh.position.set(0, baseH * 0.5, baseW / 2 + 0.0006); mesh.renderOrder = 40; group.add(mesh);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.06, h * 1.25), new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.3, metalness: 0.1 })); panel.position.set(0, baseH * 0.5, baseW / 2 + 0.0003); group.add(panel);
  let last = '';
  function set(text, suffix) { const key = text + '|' + suffix; if (key === last) return; last = key;
    x.clearRect(0, 0, c.width, c.height); x.textAlign = 'center'; x.textBaseline = 'middle';
    const FONT = (px) => `700 ${px}px 'DSEG7 Classic','DSEG7Classic','Share Tech Mono',monospace`; let fs = 540; x.font = FONT(fs); const maxW = suffix ? 1560 : 1900;
    while (x.measureText(text).width > maxW && fs > 200) { fs -= 20; x.font = FONT(fs); }
    const tw = x.measureText(text).width, cx0 = suffix ? 1024 - 130 : 1024; x.fillStyle = '#ffffff'; x.fillText(text, cx0, 330);
    if (suffix) { x.font = `600 120px 'Share Tech Mono','Sora',monospace`; x.textAlign = 'left'; x.fillText(suffix, cx0 + tw / 2 + 40, 330 - fs * 0.28); }
    tex.needsUpdate = true; }
  return { set, mat };
}

/* ---------- fish: body undulation + fin waves injected into the PBR materials' vertex stage ---------- */
const uT = { value: 0 };
function swimInject(mat, kind, params) {           // kind: 'body' | 'fin'
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = uT; sh.uniforms.uAmp = params.amp; sh.uniforms.uFreq = params.freq; sh.uniforms.uPhase = { value: params.phase || 0 };
    sh.vertexShader = 'uniform float uT, uPhase; uniform float uAmp, uFreq;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      kind === 'body'
        ? `#include <begin_vertex>
           float tailW = smoothstep(0.25, -0.5, position.x);                       // more towards the tail (x<0)
           transformed.z += sin(position.x * 40.0 - uT * uFreq + uPhase) * uAmp * (0.15 + tailW) * 0.012;
           transformed.z += sin(uT * uFreq * 0.5 + uPhase) * uAmp * 0.002;`
        : `#include <begin_vertex>
           float fe = uv.y;                                                        // free edge of the fin
           transformed.z += sin(uv.x * 9.0 + fe * 5.0 - uT * uFreq * 0.7 + uPhase) * uAmp * fe * fe * 0.010
                          + sin(fe * 3.0 - uT * uFreq * 0.35 + uPhase * 1.7) * fe * 0.004;`);
  };
  mat.customProgramCacheKey = () => kind + (params.phase || 0).toFixed(3);
}
function bettaBody(L, colBody) {
  const pts = []; for (let i = 0; i <= 24; i++) { const u = i / 24; const r = Math.pow(Math.sin(Math.PI * u), 0.75) * 0.145 * (u < 0.35 ? 1 : 1 - (u - 0.35) * 0.35); pts.push(new THREE.Vector2(r * L, (u - 0.5) * L)); }
  const geo = new THREE.LatheGeometry(pts, 28); geo.rotateZ(-Math.PI / 2); geo.scale(1, 1.25, 0.62);   // +x = head, taller than wide
  const mat = new THREE.MeshPhysicalMaterial({ color: colBody, roughness: 0.38, metalness: 0.0, clearcoat: 0.5, clearcoatRoughness: 0.25, sheen: 0.7, sheenColor: new THREE.Color(0x9fd0ff), sheenRoughness: 0.4, iridescence: 0.5, iridescenceIOR: 1.6 });
  return { geo, mat };
}
function fin(w, h, theta0, theta1, segs = 22) {      // a fan-shaped fin in the xy plane: uv.y = 0 at the root, 1 at the free edge
  const geo = new THREE.CircleGeometry(1, segs, theta0, theta1 - theta0); const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), r = Math.hypot(x, y); uv.setXY(i, (Math.atan2(y, x) - theta0) / (theta1 - theta0), r); p.setXYZ(i, x * w, y * h, 0); }
  geo.computeVertexNormals(); return geo;
}
function makeBetta(L, colBody, colEdge) {
  const grp = new THREE.Group(); const B = bettaBody(L, colBody); swimInject(B.mat, 'body', { amp: { value: 1 }, freq: { value: 6 } });
  const body = new THREE.Mesh(B.geo, B.mat); grp.add(body);
  const tex = finTextures(colEdge, mixHex(colBody, '#ffffff', 0.35));
  const finMat = (phase) => { const m = new THREE.MeshPhysicalMaterial({ map: tex.map, alphaMap: tex.alpha, transparent: true, side: THREE.DoubleSide, roughness: 0.45, metalness: 0, sheen: 0.6, sheenColor: new THREE.Color(colEdge), clearcoat: 0.15, depthWrite: false, opacity: 0.62 }); swimInject(m, 'fin', { amp: { value: 1 }, freq: { value: 6 }, phase }); return m; };
  const add = (geo, x, y, rz, phase) => { const m = new THREE.Mesh(geo, finMat(phase)); m.position.set(x, y, 0); m.rotation.z = rz; m.renderOrder = 15; grp.add(m); return m; };
  add(fin(L * 0.8, L * 0.62, Math.PI * 0.55, Math.PI * 1.45), -L * 0.45, 0, 0, 0.0);              // caudal: huge veil tail
  add(fin(L * 0.55, L * 0.42, Math.PI * 0.05, Math.PI * 0.95), -L * 0.08, L * 0.09, 0, 1.3);       // dorsal
  add(fin(L * 0.7, L * 0.5, Math.PI * 1.05, Math.PI * 1.95), -L * 0.1, -L * 0.07, 0, 2.1);          // anal: long sail
  add(fin(L * 0.25, L * 0.35, Math.PI * 1.15, Math.PI * 1.85), L * 0.15, -L * 0.09, 0.3, 0.7);      // pelvic
  for (const sgn of [-1, 1]) { const pec = add(fin(L * 0.22, L * 0.18, -Math.PI * 0.4, Math.PI * 0.4), L * 0.22, -L * 0.02, 0, 1.9 + sgn); pec.position.z = sgn * L * 0.075; pec.rotation.y = sgn * 1.2; pec.rotation.z = -0.6; }
  for (const sgn of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(L * 0.028, 10, 8), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2 })); eye.position.set(L * 0.38, L * 0.03, sgn * L * 0.075); grp.add(eye); }
  grp.userData.mats = [B.mat, ...grp.children.filter(c => c.material && c.material.alphaMap).map(c => c.material)];
  return grp;
}
let _tetraAlpha; function tetraAlpha() { if (_tetraAlpha) return _tetraAlpha; const a = document.createElement('canvas'); a.width = a.height = 64; const ax = a.getContext('2d'); const g = ax.createLinearGradient(0, 64, 0, 0); g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#909090'); g.addColorStop(1, '#000000'); ax.fillStyle = g; ax.fillRect(0, 0, 64, 64); return _tetraAlpha = new THREE.CanvasTexture(a); }
function makeTetra(L) {
  const grp = new THREE.Group(); const geo = new THREE.SphereGeometry(1, 20, 12); geo.scale(L * 0.5, L * 0.17, L * 0.09);
  // neon tetra: silver body, electric blue stripe, red lower half towards the tail (baked into vertex colours)
  const p = geo.attributes.position, colors = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (L * 0.5), y = p.getY(i) / (L * 0.17); c.setHex(0xbfc8d2);
    if (Math.abs(y - 0.15) < 0.35) c.setHex(0x37c8ff); if (y < -0.1 && x < 0.2) c.setHex(0xff3a2a); if (y > 0.6) c.setHex(0x5a6a72); colors.set([c.r, c.g, c.b], i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.0, clearcoat: 0.6, iridescence: 0.25 }); swimInject(mat, 'body', { amp: { value: 1 }, freq: { value: 12 } });
  grp.add(new THREE.Mesh(geo, mat));
  const tail = new THREE.Mesh(fin(L * 0.16, L * 0.13, Math.PI * 0.7, Math.PI * 1.3), new THREE.MeshPhysicalMaterial({ color: 0x9fb4c4, alphaMap: tetraAlpha(), transparent: true, opacity: 0.35, side: THREE.DoubleSide, roughness: 0.5, depthWrite: false }));
  swimInject(tail.material, 'fin', { amp: { value: 1 }, freq: { value: 12 }, phase: 0.5 }); tail.position.x = -L * 0.5; grp.add(tail);
  grp.userData.mats = [mat, tail.material]; return grp;
}
/* swimmer controller: waypoints, turn-rate limits, banking, speed easing -> fish move with mass, not like sprites */
class Swimmer {
  constructor(mesh, bounds, o) { this.m = mesh; this.b = bounds; this.o = o; this.pos = new THREE.Vector3(rnd(bounds.min.x, bounds.max.x), rnd(bounds.min.y, bounds.max.y), rnd(bounds.min.z, bounds.max.z));
    this.yaw = Math.random() * 6.28; this.pitch = 0; this.roll = 0; this.speed = o.cruise; this.tSpeed = o.cruise; this.timer = 0; this.target = new THREE.Vector3(); this.pick(); this.q = new THREE.Quaternion(); this.fwd = new THREE.Vector3(); }
  pick() { const b = this.b; this.target.set(rnd(b.min.x, b.max.x), rnd(b.min.y, b.max.y), rnd(b.min.z, b.max.z)); this.timer = rnd(3, 9);
    const r = Math.random(); this.tSpeed = r < this.o.hoverP ? 0 : rnd(this.o.cruise * 0.5, this.o.cruise * 1.6); }
  update(dt, t, flow) {
    this.timer -= dt; const to = this.target.clone().sub(this.pos); if (to.length() < 0.012 || this.timer < 0) this.pick();
    // wall avoidance: steer away from any face closer than 15 mm
    const b = this.b, push = new THREE.Vector3(); const mgn = 0.015;
    if (this.pos.x - b.min.x < mgn) push.x += 1; if (b.max.x - this.pos.x < mgn) push.x -= 1; if (this.pos.z - b.min.z < mgn) push.z += 1; if (b.max.z - this.pos.z < mgn) push.z -= 1;
    if (this.pos.y - b.min.y < mgn) push.y += 1; if (b.max.y - this.pos.y < mgn) push.y -= 1;
    const want = to.normalize().add(push.multiplyScalar(2)).normalize();
    const wantYaw = Math.atan2(-want.z, want.x), wantPitch = clamp(Math.asin(clamp(want.y, -1, 1)), -0.5, 0.5);
    let dy = wantYaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const yawRate = clamp(dy * 2.2, -this.o.turn, this.o.turn) * (0.35 + this.speed / this.o.cruise); this.yaw += yawRate * dt;
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 2.5);
    this.speed += (this.tSpeed - this.speed) * Math.min(1, dt * this.o.accel);
    this.roll += ((-yawRate * this.o.bank) - this.roll) * Math.min(1, dt * 3);
    this.q.setFromEuler(new THREE.Euler(this.roll, this.yaw, this.pitch, 'YZX')); this.fwd.set(1, 0, 0).applyQuaternion(this.q);
    this.pos.addScaledVector(this.fwd, this.speed * dt); if (flow) this.pos.addScaledVector(flow, dt);
    this.pos.x = clamp(this.pos.x, b.min.x, b.max.x); this.pos.y = clamp(this.pos.y, b.min.y, b.max.y); this.pos.z = clamp(this.pos.z, b.min.z, b.max.z);
    this.m.position.copy(this.pos); this.m.quaternion.copy(this.q);
    const k = this.speed / this.o.cruise;                                    // tail beat follows effort
    for (const mat of this.m.userData.mats) { const u = mat.userData; if (!u.uni) continue; u.uni.uFreq.value = this.o.beat * (0.35 + k * 0.9); u.uni.uAmp.value = 0.35 + k * 0.9; }
  }
}
function hookUniforms(grp) { for (const mat of grp.userData.mats) { const prev = mat.onBeforeCompile; mat.onBeforeCompile = (sh) => { prev(sh); mat.userData.uni = sh.uniforms; }; } }

/* ---------- scene / renderer / post ---------- */
export const TankGL = (() => {
  const view = { zoom: 1, px: 0, py: 0 }; let lastW = 0, lastH = 0, land = false;
  let renderer, scene, camera, composer, bloom, tank, clock, betta, tetras = [], swimmers = [], ready = false, tSim = 0;
  const wind = { x: 0, z: 0, vx: 0, vz: 0, tx: 0, tz: 0, slosh: 0 }; const tiltBase = { g: null, b: null };
  function init(el) {
    renderer = new THREE.WebGLRenderer({ canvas: el, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 3)); renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x0c0a09);
    const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.22;
    camera = new THREE.PerspectiveCamera(30, 1, 0.02, 20);
    buildRoom(scene); tank = buildTank(scene); clock = buildClock(tank, tank.userData.baseW, tank.userData.baseH);
    scene.add(new THREE.AmbientLight(0xffe9d2, 0.12));
    const lamp = new THREE.PointLight(0xffdcb8, 1.1, 4, 2); lamp.position.set(-0.9, 1.05, 0.55); scene.add(lamp);      // warm floor lamp, like the photo
    const fill = new THREE.PointLight(0x9fb8ff, 0.18, 3, 2); fill.position.set(0.7, 0.4, 0.5); scene.add(fill);
    // fish
    const { y0, waterH } = tank.userData; const W = TANK.W, D = TANK.D;
    const bounds = new THREE.Box3(new THREE.Vector3(-W / 2 + 0.034, y0 + 0.035, -D / 2 + 0.034), new THREE.Vector3(W / 2 - 0.034, y0 + waterH - 0.025, D / 2 - 0.034));
    betta = makeBetta(0.036, '#7fc8f4', '#ffb6d9'); hookUniforms(betta); tank.add(betta);
    swimmers.push(new Swimmer(betta, bounds, { cruise: 0.022, turn: 1.6, accel: 0.8, bank: 0.35, beat: 5.5, hoverP: 0.35 }));
    const tb = new THREE.Box3(new THREE.Vector3(-W / 2 + 0.014, y0 + 0.02, -D / 2 + 0.014), new THREE.Vector3(W / 2 - 0.014, y0 + waterH - 0.015, D / 2 - 0.014));
    for (let i = 0; i < 6; i++) { const tt = makeTetra(0.018); hookUniforms(tt); tank.add(tt); tetras.push(tt); swimmers.push(new Swimmer(tt, tb, { cruise: 0.05, turn: 4.5, accel: 3.5, bank: 0.25, beat: 14, hoverP: 0.1 })); }
    composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(scene, camera));
    bloom = new BloomEffect({ luminanceThreshold: 0.9, luminanceSmoothing: 0.2, intensity: 0.55, mipmapBlur: true, radius: 0.6, levels: 5, resolutionScale: 0.5 });
    const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.OVERLAY }); grain.blendMode.opacity.value = 0.04;
    composer.addPass(new EffectPass(camera, bloom, grain, new VignetteEffect({ offset: 0.3, darkness: 0.5 }), new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));
    ready = true; return true;
  }
  function setView(zoom, px, py) { view.zoom = clamp(zoom, 0.5, 3); view.px = clamp(px, -1, 1); view.py = clamp(py, -1, 1); if (ready) frame(); return { ...view }; }
  function resize(w, h) { if (!ready) return; lastW = w; lastH = h; renderer.setSize(w, h, false); composer.setSize(w, h); frame(); }
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
    const tex = finTextures(hexB, mixHex(hexA, '#ffffff', 0.35));
    for (const m of betta.userData.mats) { if (m.alphaMap) { m.map = tex.map; m.alphaMap = tex.alpha; m.sheenColor.set(hexB); m.needsUpdate = true; } else { m.color.set(mixHex(hexA, '#ffffff', 0.05)); } }
    clock.mat.color.set(hexA).multiplyScalar(1.9);
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
    for (const s of swimmers) s.update(sdt, t, flowV);
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
    composer.render(dt);
  }
  return { init, resize, setColors, render, motion, tilt, setView, getView: () => ({ ...view }), get ready() { return ready; } };
})();
window.TankGL = TankGL;
