/* Lumina — Hearth 3D: a physically-based flame-diffuser scene (Three.js + pmndrs/postprocessing).
   Loaded lazily by index.html when the Hearth face is selected. Exposes window.HearthGL. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer, RenderPass, EffectPass, Effect, BloomEffect, NoiseEffect, VignetteEffect,
         ToneMappingEffect, ToneMappingMode, BlendFunction } from 'postprocessing';

/* ---------- 1/f ("pink") flicker: real flames dim and wander, they never blink or sine ---------- */
const h1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const n1 = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return h1(i) * (1 - u) + h1(i + 1) * u; };
function pink(t, seed = 0) { let v = 0, a = 0.5, f = 0.6; for (let i = 0; i < 5; i++) { v += a * n1(t * f + i * 17.3 + seed); a *= 0.55; f *= 2.1; } return v; }   // ~[0,1]

/* ---------- GLSL noise shared by the mist shaders ---------- */
const GLSL_NOISE = `
float hash3(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm3(vec3 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*noise3(p); p=p*2.02+vec3(1.7,9.2,3.1); a*=.5; } return v; }`;

/* ---------- procedural textures ---------- */
function speckleTextures() {
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
  x.fillStyle = '#161618'; x.fillRect(0, 0, N, N);
  for (let i = 0; i < 26000; i++) { const v = Math.random(); x.fillStyle = v < 0.55 ? `rgba(255,255,255,${0.04 + Math.random() * 0.12})` : `rgba(0,0,0,${0.2 + Math.random() * 0.4})`;
    const s = 0.7 + Math.random() * 1.6; x.fillRect(Math.random() * N, Math.random() * N, s, s); }
  const color = new THREE.CanvasTexture(c); color.wrapS = color.wrapT = THREE.RepeatWrapping; color.repeat.set(3, 3); color.colorSpace = THREE.SRGBColorSpace;
  const r = document.createElement('canvas'); r.width = r.height = N; const rx = r.getContext('2d');
  rx.fillStyle = '#9a9a9a'; rx.fillRect(0, 0, N, N);
  for (let i = 0; i < 40000; i++) { const g = 110 + Math.random() * 120 | 0; rx.fillStyle = `rgb(${g},${g},${g})`; rx.fillRect(Math.random() * N, Math.random() * N, 1.2, 1.2); }
  const rough = new THREE.CanvasTexture(r); rough.wrapS = rough.wrapT = THREE.RepeatWrapping; rough.repeat.set(3, 3);
  return { color, rough };
}
function noiseTexture(size = 256, lo = 90, hi = 160, blur = 0) {
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d');
  const img = x.createImageData(size, size); for (let i = 0; i < img.data.length; i += 4) { const g = lo + Math.random() * (hi - lo) | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0); if (blur) { x.filter = `blur(${blur}px)`; x.drawImage(c, 0, 0); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function softSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}
function barkTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#3a271a'; x.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 160; i++) { x.strokeStyle = `rgba(${10 + Math.random() * 30 | 0},${5 + Math.random() * 15 | 0},0,${0.25 + Math.random() * 0.5})`; x.lineWidth = 0.6 + Math.random() * 2.2;
    const y = Math.random() * 128; x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(170, y + (Math.random() - 0.5) * 18, 340, y + (Math.random() - 0.5) * 18, 512, y); x.stroke(); }
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${60 + Math.random() * 60 | 0},${40 + Math.random() * 30 | 0},${20 + Math.random() * 10 | 0},${Math.random() * 0.35})`; x.fillRect(Math.random() * 512, Math.random() * 128, 1 + Math.random() * 3, 1); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ---------- charred log textures: charcoal + ash on the colour map, glowing cracks on the emissive map (same crack paths) ---------- */
function charredTextures() {
  const W = 1024, H = 256, c = document.createElement('canvas'), e = document.createElement('canvas'); c.width = e.width = W; c.height = e.height = H;
  const x = c.getContext('2d'), ex = e.getContext('2d');
  x.fillStyle = '#1b1816'; x.fillRect(0, 0, W, H); ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) { const g = 14 + Math.random() * 40 | 0; x.fillStyle = `rgba(${g},${g - 2},${g - 4},${0.5 + Math.random() * 0.5})`; x.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 4, 1 + Math.random() * 2); }
  for (let i = 0; i < 70; i++) { const g = 70 + Math.random() * 60 | 0; x.fillStyle = `rgba(${g},${g - 4},${g - 8},${0.12 + Math.random() * 0.25})`;      // ash patches
    x.beginPath(); x.ellipse(Math.random() * W, Math.random() * H, 14 + Math.random() * 60, 6 + Math.random() * 16, Math.random() * 3, 0, Math.PI * 2); x.fill(); }
  // char-crack cells: dark grooves on the colour map, bright glow along the same grooves on the emissive map
  const crack = (x0, y0, len, ang, w) => { let px = x0, py = y0; x.beginPath(); ex.beginPath(); x.moveTo(px, py); ex.moveTo(px, py);
    for (let k = 0; k < 8; k++) { ang += (Math.random() - 0.5) * 0.9; px += Math.cos(ang) * len / 8; py += Math.sin(ang) * len / 8; x.lineTo(px, py); ex.lineTo(px, py); }
    x.strokeStyle = 'rgba(0,0,0,.9)'; x.lineWidth = w; x.stroke(); ex.strokeStyle = `rgba(255,${150 + Math.random() * 60 | 0},60,${0.7 + Math.random() * 0.3})`; ex.lineWidth = w * 1.0; ex.stroke(); };
  for (let i = 0; i < 64; i++) crack(Math.random() * W, Math.random() * H, 60 + Math.random() * 140, (Math.random() < 0.6 ? 0 : Math.PI / 2) + (Math.random() - 0.5) * 0.7, 1.5 + Math.random() * 2.5);
  for (let i = 0; i < 120; i++) crack(Math.random() * W, Math.random() * H, 15 + Math.random() * 30, Math.random() * Math.PI, 0.8 + Math.random());
  ex.filter = 'blur(2px)'; ex.drawImage(e, 0, 0); ex.filter = 'none';
  const map = new THREE.CanvasTexture(c), em = new THREE.CanvasTexture(e); map.colorSpace = em.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = em.wrapS = em.wrapT = THREE.RepeatWrapping; return { map, em };
}
/* a charred log: tapered cylinder, vertices pushed by noise (bumps, flats, splits), knots, glowing cracks */
function makeLog(len, r, tex, seed) {
  const g = new THREE.CylinderGeometry(r * 0.78, r, len, 22, 26, false); g.rotateZ(Math.PI / 2);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const ang = Math.atan2(v.z, v.y), u = v.x / len + 0.5;
    const rr = Math.hypot(v.y, v.z); if (rr < 1e-5) continue;
    const bump = 1 + 0.16 * (n1(ang * 1.6 + seed) - 0.5) + 0.12 * (n1(u * 9 + ang * 0.7 + seed * 3) - 0.5) + 0.06 * (n1(u * 31 + seed) - 0.5);
    const flat = 1 - 0.18 * Math.max(0, Math.cos(ang - 0.6 - seed)) ** 6;                          // one flattened, split-looking side
    const k = rr * bump * flat / rr; v.y *= k; v.z *= k; v.y += 0.003 * Math.sin(u * Math.PI) * (n1(seed) - 0.5);   // slight bow
    p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: tex.map, color: 0xd8d0c8, roughness: 0.94, metalness: 0, bumpMap: tex.map, bumpScale: 0.0025,
    emissiveMap: tex.em, emissive: new THREE.Color(0xff6a1a), emissiveIntensity: 1.2 });
  mat.map.repeat.set(1, 1);
  const mesh = new THREE.Mesh(g, mat); mesh.userData.ph = seed * 7.3;
  for (let i = 0; i < 2; i++) { const k = new THREE.Mesh(new THREE.SphereGeometry(r * (0.35 + Math.random() * 0.25), 10, 8), mat);
    k.scale.set(1, 0.7, 0.9); const a = Math.random() * Math.PI * 2; k.position.set((Math.random() - 0.5) * len * 0.7, Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85); mesh.add(k); }
  return mesh;
}

/* ---------- the device (real-world metres: 24 cm x 8 cm x 10 cm) ---------- */
const DEV = { W: 0.24, H: 0.08, D: 0.10 };
function buildDevice(scene, env) {
  const g = new THREE.Group(); const { W, H, D } = DEV;
  const sp = speckleTextures();
  const housingMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: sp.color, roughness: 0.62, roughnessMap: sp.rough, metalness: 0,
    clearcoat: 0.12, clearcoatRoughness: 0.5, sheen: 0.15, sheenColor: new THREE.Color(0x333333), sheenRoughness: 0.8, envMapIntensity: 0.9 });
  // housing = 5 slabs (bottom, top, left, right, back) so the front window is a REAL cavity you look into
  const wall = 0.011, pillar = 0.014, winBottom = 0.017, winTop = H - 0.013, winW = W - pillar * 2, winH = winTop - winBottom, winY = (winTop + winBottom) / 2;
  const slab = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, 0.0025), housingMat); m.position.set(x, y, z); g.add(m); return m; };
  slab(W, winBottom, D, 0, winBottom / 2, 0);                                  // base band
  slab(W, H - winTop, D, 0, (H + winTop) / 2, 0);                              // top band
  slab(pillar, winH + 0.004, D, -(W / 2 - pillar / 2), winY, 0);               // left pillar
  slab(pillar, winH + 0.004, D, (W / 2 - pillar / 2), winY, 0);                // right pillar
  slab(W, H, wall, 0, H / 2, -(D / 2 - wall / 2));                             // back
  // matte-black interior lining (real diffusers are black inside so the LED light reads)
  const lining = new THREE.MeshStandardMaterial({ color: 0x0b0606, roughness: 0.98, metalness: 0 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), lining); back.position.set(0, winY, -(D / 2 - wall) + 0.0005); g.add(back);
  for (const sx of [-1, 1]) { const side = new THREE.Mesh(new THREE.PlaneGeometry(D - wall, winH), lining); side.rotation.y = sx * Math.PI / 2; side.position.set(sx * (winW / 2 - 0.0005), winY, -wall / 2); g.add(side); }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(winW, D - wall), lining); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, winTop - 0.0005, -wall / 2); g.add(ceil);
  // glass front: mostly clear, env-reflective, sits a little inside the opening
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.08,
    envMapIntensity: 0.45, specularIntensity: 0.5, depthWrite: false });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), glassMat); glass.position.set(0, winY, D / 2 - 0.003); g.add(glass);
  // top slot for the mist
  const slot = new THREE.Mesh(new RoundedBoxGeometry(W * 0.80, 0.007, 0.018, 3, 0.0025), new THREE.MeshStandardMaterial({ color: 0x050303, roughness: 0.9 }));
  slot.position.set(0, H - 0.001, 0); g.add(slot);
  // logs: charred, cracked, glowing from within (what flame-diffuser inserts actually look like)
  const ctex = charredTextures(); const logMeshes = [];
  const logs = [ [0.084, 0.0115, -0.048, 0.013, -0.016, 0.05, 0.10], [0.076, 0.0108, 0.044, 0.012, 0.012, -0.06, 0.02],
                 [0.094, 0.0100, -0.004, 0.031, -0.008, 0.28, 0.18], [0.058, 0.0095, -0.060, 0.027, 0.014, 0.02, -0.14], [0.068, 0.0102, 0.058, 0.028, 0.012, -0.05, 0.12] ];
  const yBase = winBottom + 0.003; let li = 0;
  for (const [len, r, x, y, z, rz, ry] of logs) { const m = makeLog(len, r, ctex, ++li); m.rotation.set(0, ry, rz); m.position.set(x, yBase + y, z);
    m.userData.rest = { p: m.position.clone(), r: m.rotation.clone(), gain: 0.7 + Math.random() * 0.6, radius: r, dx: 0, dz: 0, dy: 0, vx: 0, vz: 0, vy: 0 }; g.add(m); logMeshes.push(m); }
  // ash & ember chunks on the bed
  const chunkMat = new THREE.MeshStandardMaterial({ map: ctex.map, color: 0xbdb5ad, roughness: 1, emissiveMap: ctex.em, emissive: new THREE.Color(0xff4a10), emissiveIntensity: 0.8 });
  for (let i = 0; i < 26; i++) { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.0025 + Math.random() * 0.0035, 0), chunkMat);
    m.position.set((Math.random() - 0.5) * winW * 0.86, yBase - 0.001 + Math.random() * 0.002, (Math.random() - 0.5) * 0.055); m.rotation.set(Math.random() * 3, Math.random() * 3, 0); m.scale.y = 0.6; g.add(m); }
  // embers: tiny emissive spheres under the logs (bloom picks these up)
  const embers = []; for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.0022 + Math.random() * 0.002, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x110302, emissive: new THREE.Color(0xff5a10), emissiveIntensity: 4, roughness: 1 }));
    m.position.set((Math.random() - 0.5) * winW * 0.8, yBase + 0.002 + Math.random() * 0.006, (Math.random() - 0.5) * 0.05); m.userData.ph = Math.random() * 100; g.add(m); embers.push(m); }
  // ember bed: the glowing floor of the cavity
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(winW * 0.98, D - wall - 0.002), new THREE.MeshStandardMaterial({ color: 0x0e0605, emissive: new THREE.Color(0x5a1a06), emissiveIntensity: 0.25, roughness: 1 }));
  bed.rotation.x = -Math.PI / 2; bed.position.set(0, winBottom + 0.0006, -wall / 2); g.add(bed);
  // LED status dots on the bezel
  const ledOn = new THREE.Mesh(new THREE.SphereGeometry(0.0012, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 0.7, 0.25) })); ledOn.position.set(0, 0.008, D / 2 + 0.0008); g.add(ledOn);
  for (const dx of [-0.006, 0.006]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.001, 8, 8), new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4 })); l.position.set(dx, 0.008, D / 2 + 0.0008); g.add(l); }
  // interior LED light (lights the logs from below) + the slot LED light (spills onto the top and the table)
  const innerLight = new THREE.PointLight(0xff7a1a, 0.55, 0.12, 2); innerLight.position.set(0, yBase + 0.014, 0.0);   // short range: stays inside the cavity (no shadow maps) g.add(innerLight);
  const slotLight = new THREE.PointLight(0xff8a2a, 0.7, 0.36, 2); slotLight.position.set(0, H + 0.04, 0.0); g.add(slotLight);
  g.userData = { embers, logMeshes, innerLight, slotLight, winW, winH, winY, yBase, glass };
  scene.add(g); return g;
}

/* ---------- the room: table + back wall, both dark and slightly imperfect ---------- */
function buildRoom(scene) {
  const bump = noiseTexture(256, 100, 156, 1); bump.repeat.set(6, 6);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.72, metalness: 0, bumpMap: bump, bumpScale: 0.0008 }));
  table.rotation.x = -Math.PI / 2; table.position.y = -0.0005; scene.add(table);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.MeshStandardMaterial({ color: 0x1a171d, roughness: 1, bumpMap: bump, bumpScale: 0.004 }));
  wall.position.set(0, 1.2, -0.42); scene.add(wall);
  // contact shadow under the device: soft radial gradient plane
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 20, 128, 128, 128); g.addColorStop(0, 'rgba(0,0,0,.85)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(DEV.W * 1.5, DEV.D * 2.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.0004; scene.add(sh);
  return { table, wall };
}

/* ---------- the LED-lit mist sheet (this is what a flame diffuser actually produces) ---------- */
function buildMist(group) {
  const geo = new THREE.PlaneGeometry(0.30, 0.30, 36, 72); geo.translate(0, 0.15, 0);   // pivot at the slot; wide enough for the ribbon to spread
  const uniforms = { uTime: { value: 0 }, uLed: { value: 1 }, uLift: { value: 1 }, uWind: { value: new THREE.Vector2(0, 0) }, uTurb: { value: 0 }, uBase: { value: new THREE.Color(1.0, 0.42, 0.08) }, uMid: { value: new THREE.Color(1.0, 0.72, 0.35) }, uVapor: { value: new THREE.Color(0.85, 0.85, 0.9) }, uAlpha: { value: 0.62 }, uGlow: { value: 1.0 } };
  const vert = `${GLSL_NOISE}
    uniform float uTime, uLift, uTurb; uniform vec2 uWind; varying vec2 vUv; varying vec3 vView;
    void main(){ vUv=uv; vec3 p=position; p.y*=uLift;
      float h=smoothstep(0.,1.,uv.y); float amp=1.0+uTurb*1.2;
      // one slow coherent sway travelling UP the column (a wave, not per-point jitter), plus a little large-scale drift
      p.x += sin(uTime*0.8 - uv.y*5.0)*0.010*h*h*amp + (noise3(vec3(uTime*0.18, uv.y*2.2, 1.7))-0.5)*0.05*h*amp;
      p.z += sin(uTime*0.6 - uv.y*4.0 + 1.3)*0.006*h*h + (noise3(vec3(uTime*0.15+7.0, uv.y*2.5, 3.1))-0.5)*0.03*h;
      p.x += uWind.x*h*h*0.22; p.z += uWind.y*h*h*0.22;                                    // inertia lean: the vapor lags behind the device
      vec4 mv=modelViewMatrix*vec4(p,1.); vView=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`;
  const frag = `${GLSL_NOISE}
    uniform float uTime, uLed, uAlpha, uGlow; uniform vec3 uBase, uMid, uVapor; varying vec2 vUv; varying vec3 vView;
    void main(){
      float h=vUv.y;
      float n=fbm3(vec3(vUv.x*4.5, vUv.y*2.6-uTime*0.55, uTime*0.16));                   // rising, vertically-stretched structure
      float n2=fbm3(vec3(vUv.x*11.0+3.0, vUv.y*5.5-uTime*1.1, uTime*0.28));              // fine ragged filaments
      float edge=abs(vUv.x-0.5)+(n-0.5)*0.22*(0.35+h)+(n2-0.5)*0.08*h;
      float widthMask=1.0-smoothstep(0.25+0.06*h, 0.36+0.08*h, edge);                     // base just inside the slot, spreading as it rises
      float body=pow(0.35+0.65*n,1.8)*(0.6+0.4*n2);
      float top=0.55+0.35*(n-0.5)+0.15*(n2-0.5);                                          // per-column ragged top, never a straight edge
      float density=widthMask*body*(1.0-smoothstep(top-0.35,top+0.12,h))*smoothstep(0.0,0.05,h);
      density=max(0.0, density - h*0.35*(1.0-n2));                                          // alpha erosion: torn, thinning top
      vec3 col=mix(uBase,uMid,smoothstep(0.0,0.30,h)); col=mix(col,uVapor,smoothstep(0.28,0.7,h));  // LED gradient, lit from below
      float glow=uLed*(2.6-2.2*h)*uGlow*exp(-h*1.3)*(0.85+0.3*n2);
      float scatter=pow(max(dot(vView,vec3(0.,-1.,0.)),0.0),3.0)*0.4;                     // forward scatter feel
      gl_FragColor=vec4(col*(glow+scatter), density*uAlpha); }`;
  const matA = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending });
  const matB = matA.clone(); matB.blending = THREE.AdditiveBlending; matB.uniforms = Object.assign({}, uniforms, { uAlpha: { value: 0.22 } });   // shares time/colour uniforms, own alpha
  const sheetA = new THREE.Mesh(geo, matA), sheetB = new THREE.Mesh(geo, matB);
  sheetA.position.y = sheetB.position.y = DEV.H - 0.002; sheetA.renderOrder = 10; sheetB.renderOrder = 11;
  group.add(sheetA, sheetB); return { uniforms, sheets: [sheetA, sheetB] };
}
/* ---------- loose white vapor drifting above the lit region ---------- */
function buildVapor(group) {
  const N = 110, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N), life = new Float32Array(N), dur = new Float32Array(N), vel = new Float32Array(N * 3);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.NormalBlending, uniforms: { uTex: { value: softSprite() }, uScale: { value: 1 } },
    vertexShader: `attribute float aSize; attribute vec3 color; varying vec3 vCol; varying float vA; uniform float uScale;
      void main(){ vCol=color; vA=aSize; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=aSize*uScale/-mv.z; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D uTex; varying vec3 vCol; varying float vA; void main(){ vec4 t=texture2D(uTex,gl_PointCoord); gl_FragColor=vec4(vCol, t.a*0.035); }` });
  const pts = new THREE.Points(geo, mat); pts.renderOrder = 12; pts.frustumCulled = false; group.add(pts);
  for (let i = 0; i < N; i++) life[i] = -Math.random() * 4;                              // staggered start
  return { pts, pos, col, sz, life, dur, vel, N };
}
/* ---------- the LED clock: rendered at device resolution into a texture, emissive so it blooms like a real display ---------- */
function buildClock(group, winW, winH, winY) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 640; const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  const h = winH * 0.84, w = h * (2048 / 640);                                            // digits span ~84% of the window height
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(1.55, 1.0, 0.5) });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); mesh.position.set(0, winY + winH * 0.02, DEV.D / 2 - 0.0015); mesh.renderOrder = 20; group.add(mesh);   // just in front of the glass: no reflections over the digits
  const bleed = { material: new THREE.MeshBasicMaterial() };                                   // (no duplicate glow plane: it doubled the edges)
  let last = '';
  function set(text, suffix, hex) {
    const key = text + '|' + suffix; if (key === last) return; last = key;
    x.clearRect(0, 0, c.width, c.height); x.textAlign = 'center'; x.textBaseline = 'middle';
    const FONT = (px) => `700 ${px}px 'DSEG7 Classic','DSEG7Classic','Share Tech Mono',monospace`;
    let fs = 540; x.font = FONT(fs); const maxW = suffix ? 1560 : 1900;                    // fit: shrink until the digits fit, leave room for AM/PM
    while (x.measureText(text).width > maxW && fs > 200) { fs -= 20; x.font = FONT(fs); }
    const tw = x.measureText(text).width, cx0 = suffix ? 1024 - 130 : 1024;
    x.fillStyle = '#ffffff'; x.fillText(text, cx0, 330);                                  // crisp: no baked blur, bloom supplies the halo
    if (suffix) { x.font = `600 120px 'Share Tech Mono','Sora',monospace`; x.textAlign = 'left'; x.fillText(suffix, cx0 + tw / 2 + 40, 330 - fs * 0.28); }
    tex.needsUpdate = true;
  }
  return { set, mesh, bleed, mat };
}

/* ---------- scene / renderer / post ---------- */
/* ---------- heat shimmer: refract the image in a soft band above the slot (hot vapor bends light) ---------- */
const HEAT_FRAG = `uniform float uTime; uniform vec4 uBand; uniform float uAmt;
  float hh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float nn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hh(i),hh(i+vec2(1.,0.)),f.x),mix(hh(i+vec2(0.,1.)),hh(i+vec2(1.,1.)),f.x),f.y); }
  float fb(vec2 p){ float v=0., a=.5; for(int i=0;i<3;i++){ v+=a*nn(p); p=p*2.03+1.7; a*=.5; } return v; }
  void mainUv(inout vec2 uv){
    float dx=abs(uv.x-uBand.x)/max(uBand.z,1e-4), dy=(uv.y-uBand.y)/max(uBand.w,1e-4);
    float mask=(1.-smoothstep(0.6,1.3,dx))*smoothstep(0.03,0.2,dy)*(1.-smoothstep(0.55,1.05,dy))*(1.-0.45*clamp(dy,0.,1.));
    if(mask<0.002) return;
    vec2 n=vec2(fb(uv*vec2(15.,7.)+vec2(0.,-uTime*1.5)), fb(uv*vec2(12.,6.)+vec2(5.3,-uTime*1.2)))-0.5;
    uv+=n*uAmt*mask; }`;
class HeatEffect extends Effect { constructor() { super('HeatEffect', HEAT_FRAG, { uniforms: new Map([['uTime', new THREE.Uniform(0)], ['uBand', new THREE.Uniform(new THREE.Vector4(0.5, 0.5, 0.1, 0.3))], ['uAmt', new THREE.Uniform(0.016)]]) }); } }
const RED = new THREE.Color(1, 0.22, 0.04);
const R_ = (L) => L.p;
export const HearthGL = (() => {
  const view = { zoom: 1, px: 0, py: 0 }; let lastW = 0, lastH = 0;
  let renderer, scene, camera, composer, bloom, heat, dev, mist, vapor, clock, room, canvas, ready = false, t0 = performance.now(), tPrev = 0, tSim = 0, land = false, plumeH = 0.22;
  function init(el) {
    canvas = el;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 3));   // native 3x on iPhone Pro -> crisp digits renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a080d);
    const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.25;
    camera = new THREE.PerspectiveCamera(32, 1, 0.02, 20);
    room = buildRoom(scene); dev = buildDevice(scene); mist = buildMist(dev); vapor = buildVapor(dev); clock = buildClock(dev, dev.userData.winW, dev.userData.winH, dev.userData.winY);
    scene.add(new THREE.AmbientLight(0x3a3450, 0.45));
    const key = new THREE.PointLight(0xfff1e0, 0.9, 3, 2); key.position.set(-0.5, 0.7, 0.55); scene.add(key);              // soft cool-ish room key from upper-left
    const fill = new THREE.PointLight(0x1a2233, 0.25, 3, 2); fill.position.set(0.6, 0.2, 0.3); scene.add(fill);               // faint cool fill from the far side
    composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(scene, camera));
    bloom = new BloomEffect({ luminanceThreshold: 0.82, luminanceSmoothing: 0.25, intensity: 1.1, mipmapBlur: true, radius: 0.7, levels: 6, resolutionScale: 0.5 });
    const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.OVERLAY }); grain.blendMode.opacity.value = 0.05;
    heat = new HeatEffect();
    composer.addPass(new EffectPass(camera, heat, bloom, grain, new VignetteEffect({ offset: 0.33, darkness: 0.58 }), new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));
    ready = true; return true;
  }
  function setView(zoom, px, py) { view.zoom = THREE.MathUtils.clamp(zoom, 0.5, 3); view.px = THREE.MathUtils.clamp(px, -1, 1); view.py = THREE.MathUtils.clamp(py, -1, 1); if (ready) frame(); return { ...view }; }
  function resize(w, h) { if (!ready) return; lastW = w; lastH = h; renderer.setSize(w, h, false); composer.setSize(w, h); frame(); }
  function frame() {
    const w = lastW, h = lastH; camera.aspect = w / h; land = w > h;
    plumeH = land ? 0.15 : 0.24; mist.uniforms.uLift.value = plumeH / 0.30;
    // frame: device width must fill ~88% of the view, AND device+plume must fit vertically -> take the farther distance
    const vf = THREE.MathUtils.degToRad(camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const needW = DEV.W * (land ? 0.98 : 1.05), needH = (DEV.H + plumeH) * 1.0;
    // fit is measured at the device's FRONT face (nearest point), not its centre, so nothing crops
    const dist = DEV.D / 2 + Math.max(needW / 2 / Math.tan(hf / 2), needH / 2 / Math.tan(vf / 2));
    const cy = (DEV.H + plumeH) * 0.46, d = dist / view.zoom;
    // pan: view.px/py are fractions of the visible half-extent at the device -> the box moves, the simulation does not
    const halfH = Math.tan(vf / 2) * d, halfW = halfH * camera.aspect, ox = -view.px * halfW, oy = -view.py * halfH;
    camera.position.set(0.012 + ox, cy + d * 0.07 + oy, d); camera.lookAt(0.004 + ox, cy - 0.004 + oy, 0); camera.updateProjectionMatrix(); camera.userData.dx = camera.userData.dy = 0;
    vapor.pts.material.uniforms.uScale.value = h * 0.9 * renderer.getPixelRatio();
  }
  function setColors(hexA, hexB) {
    const a = new THREE.Color(hexA), b = new THREE.Color(hexB);
    mist.uniforms.uBase.value.copy(b).multiplyScalar(1.1); mist.uniforms.uMid.value.copy(a).lerp(new THREE.Color(1, 1, 1), 0.25);
    dev.userData.slotBase = b.clone(); dev.userData.innerLight.color.copy(b).lerp(a, 0.5);
    for (const e of dev.userData.embers) e.material.emissive.copy(b);
    clock.mat.color.copy(a).multiplyScalar(2.2); clock.bleed.material.color.copy(a).multiplyScalar(1.4);
    clock.hex = hexA;
  }
  // device-motion model: a wind vector (x = screen right, z = toward viewer) with spring-damper dynamics
  const wind = { x: 0, z: 0, vx: 0, vz: 0, tx: 0, tz: 0, turb: 0 };
  function motion(ax, ay, az, rx, ry, rz) {            // accelerations in m/s^2 (screen-aligned, gravity removed), rotation rates deg/s
    const k = 0.09; wind.vx -= ax * k; wind.vz -= az * k * 0.6; wind.vx -= (rz || 0) * 0.0009;
    const j = Math.min(1, Math.hypot(ax, ay, az) / 6 + Math.hypot(rx || 0, ry || 0, rz || 0) / 400); wind.turb = Math.max(wind.turb, j);
    liftKick = Math.max(-0.35, Math.min(0.35, liftKick - ay * 0.02));
    for (const m of dev.userData.logMeshes) { const L = m.userData.rest; L.vx -= ax * 0.0022 * L.gain; L.vz -= az * 0.0014 * L.gain; L.vy += Math.max(0, -ay) * 0.0016 * L.gain; }   // impulse into each log's mass
  }
  const tiltBase = { g: null, b: null };
  function tilt(gammaDeg, betaDeg) {                    // react to CHANGES in tilt (high-passed): a swing leans the plume, holding still settles it upright
    if (tiltBase.g === null) { tiltBase.g = gammaDeg || 0; tiltBase.b = betaDeg || 0; }
    tiltBase.g += ((gammaDeg || 0) - tiltBase.g) * 0.03; tiltBase.b += ((betaDeg || 0) - tiltBase.b) * 0.03;
    wind.tx = -Math.sin(THREE.MathUtils.degToRad(Math.max(-60, Math.min(60, (gammaDeg || 0) - tiltBase.g)))) * 1.1;
    wind.tz = Math.sin(THREE.MathUtils.degToRad(Math.max(-60, Math.min(60, (betaDeg || 0) - tiltBase.b)))) * 0.4;
  }
  let liftKick = 0;
  function render(dt, timeText, ghost, motion = 1, bass = 0) {
    if (!ready) return; tSim += dt * (0.35 + 0.65 * motion); const t = tSim;
    // integrate the wind spring (stiffness 18, damping 5.5 -> settles in ~1 s like real vapor)
    wind.vx += ((wind.tx - wind.x) * 12 - wind.vx * 6.5) * dt; wind.vz += ((wind.tz - wind.z) * 12 - wind.vz * 6.5) * dt;   // slow, well-damped: vapor has inertia
    wind.x += wind.vx * dt; wind.z += wind.vz * dt; wind.turb *= Math.exp(-dt * 2.2); liftKick *= Math.exp(-dt * 3);
    mist.uniforms.uWind.value.set(wind.x, wind.z); mist.uniforms.uTurb.value = wind.turb; mist.uniforms.uLift.value = (plumeH / 0.30) * (1 + liftKick);
    // 1/f flicker drives the LED brightness, its colour (dimmer = redder), and the light's position wander
    const f = 0.78 + 0.22 * pink(t * 1.6), fslow = 0.85 + 0.15 * pink(t * 0.35, 9);
    const L = dev.userData.slotLight; L.intensity = 0.42 * f * (1 + bass * 0.4); L.position.x = 0.03 * (pink(t * 0.7, 3) - 0.5);
    L.color.copy(dev.userData.slotBase || L.color).lerp(RED, (1 - f) * 0.5);                 // dimmer moments are redder
    dev.userData.innerLight.intensity = 0.5 * (0.88 + 0.12 * pink(t * 2.1, 5));
    mist.uniforms.uTime.value = t; mist.uniforms.uLed.value = f * fslow; mist.uniforms.uGlow.value = 1 + bass * 0.5;
    bloom.intensity = 0.95 + 0.4 * (f - 0.78) / 0.22;
    for (const e of dev.userData.embers) e.material.emissiveIntensity = 1.4 + 2.2 * pink(t * 0.9 + e.userData.ph, 7);
    for (const m of dev.userData.logMeshes) m.material.emissiveIntensity = 2.6 + 3.4 * pink(t * 0.7 + m.userData.ph, 13);
    // loose logs = damped masses: an impulse sets them sliding, friction + the neighbours' resistance bring them back; they ROLL as they slide
    for (const m of dev.userData.logMeshes) { const L = m.userData.rest;
      L.vx += (-L.dx * 140 - L.vx * 9) * dt; L.vz += (-L.dz * 140 - L.vz * 9) * dt; L.vy += (-L.dy * 400 - L.vy * 14) * dt;   // ~2 Hz, a couple of wobbles then still
      L.dx += L.vx * dt; L.dz += L.vz * dt; L.dy = Math.max(0, L.dy + L.vy * dt);
      const lim = 0.006; L.dx = Math.max(-lim, Math.min(lim, L.dx)); L.dz = Math.max(-lim, Math.min(lim, L.dz));
      m.position.set(R_(L).x + L.dx, R_(L).y + L.dy, R_(L).z + L.dz);
      m.rotation.set(L.r.x + L.dz / L.radius * 0.35, L.r.y, L.r.z - L.dx / L.radius * 0.35); }
    // vapor particles: born at the slot, drift up slowly with lazy curl, fade out
    const V = vapor, base = mist.uniforms.uBase.value, vap = mist.uniforms.uVapor.value, tmp = new THREE.Color();
    for (let i = 0; i < V.N; i++) { V.life[i] += dt * (0.4 + 0.6 * motion);
      if (V.life[i] >= V.dur[i] || V.dur[i] === 0) { if (V.life[i] < 0) continue; V.life[i] = 0; V.dur[i] = 2.6 + Math.random() * 1.8;
        V.pos[i * 3] = (Math.random() - 0.5) * DEV.W * 0.7; V.pos[i * 3 + 1] = DEV.H + plumeH * (0.45 + Math.random() * 0.35); V.pos[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
        V.vel[i * 3] = (Math.random() - 0.5) * 0.01; V.vel[i * 3 + 1] = 0.05 + Math.random() * 0.04; V.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.006; }
      const k = V.life[i] / V.dur[i]; if (k < 0) continue;
      V.pos[i * 3] += (V.vel[i * 3] + 0.012 * (pink(t * 0.5 + i, 11) - 0.5) + wind.x * 0.06) * dt; V.pos[i * 3 + 1] += V.vel[i * 3 + 1] * dt; V.pos[i * 3 + 2] += (V.vel[i * 3 + 2] + wind.z * 0.06) * dt;
      const hgt = THREE.MathUtils.clamp((V.pos[i * 3 + 1] - DEV.H) / plumeH, 0, 1);
      tmp.copy(base).lerp(vap, THREE.MathUtils.smoothstep(hgt, 0.3, 0.9)).multiplyScalar(0.9 * f); V.col[i * 3] = tmp.r; V.col[i * 3 + 1] = tmp.g; V.col[i * 3 + 2] = tmp.b;
      V.sz[i] = 0.011 * (1 + 2.2 * k) * Math.sin(Math.PI * k); }
    V.pts.geometry.attributes.position.needsUpdate = V.pts.geometry.attributes.color.needsUpdate = V.pts.geometry.attributes.aSize.needsUpdate = true;
    // slow, never-repeating camera drift (irrational period ratio) so the frame is never dead still
    if (motion > 0) { camera.position.x += (0.006 * Math.sin(t * 2 * Math.PI / 41) - (camera.userData.dx || 0)); camera.userData.dx = 0.006 * Math.sin(t * 2 * Math.PI / 41);
      camera.position.y += (0.004 * Math.sin(t * 2 * Math.PI / 67) - (camera.userData.dy || 0)); camera.userData.dy = 0.004 * Math.sin(t * 2 * Math.PI / 67); }
    clock.set(timeText, ghost, clock.hex || '#ffb347');
    // heat band: project slot centre, slot half-width and plume top into screen uv
    const P = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(camera); return [v.x * 0.5 + 0.5, v.y * 0.5 + 0.5]; };
    const c0 = P(0, DEV.H, 0), c1 = P(DEV.W * 0.40, DEV.H, 0), c2 = P(0, DEV.H + plumeH * 1.05, 0);
    heat.uniforms.get('uBand').value.set(c0[0], c0[1], Math.abs(c1[0] - c0[0]), Math.max(0.01, c2[1] - c0[1]));
    heat.uniforms.get('uTime').value = t; heat.uniforms.get('uAmt').value = 0.012 + 0.007 * f;
    composer.render(dt);
  }
  return { init, resize, setColors, render, motion, tilt, setView, getView: () => ({ ...view }), get ready() { return ready; } };
})();
window.HearthGL = HearthGL;
