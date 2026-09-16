/* Lumina — Reef 3D: a long rimless marine tank on a black cabinet, moonlit room. Landscape-first.
   Same API as HearthGL / TankGL. Exposes window.ReefGL. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, NoiseEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode, BlendFunction } from 'postprocessing';
import { pink, rnd, clamp, GLSL_NOISE, uT, makeClownfish, makeTang, makeChromis, Swimmer, makeDotClock } from './fishlib.js';

/* 60 x 30 x 30 cm low-iron rimless tank on a 60 x 34 cabinet; all metres */
const R = { W: 0.60, H: 0.30, D: 0.30, fill: 0.9, cabH: 0.20, cabD: 0.34, glass: 0.008 };

/* ---------- environment: night room, moonlight through a window, faint TV glow ---------- */
function nightRoomEnv() {
  const sc = new THREE.Scene(); const box = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 6), new THREE.MeshStandardMaterial({ color: 0x151a22, roughness: 1, side: THREE.BackSide })); box.position.y = 1.2; sc.add(box);
  const em = (c, i) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i) });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.8), em(0x9fbfe8, 2.2)); win.position.set(-2.2, 1.5, -2.9); sc.add(win);
  const tv = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), em(0x6aa8ff, 0.9)); tv.position.set(2.2, 1.0, 2.9); tv.rotation.y = Math.PI; sc.add(tv);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), em(0x3c4653, 0.35)); ceil.rotation.x = Math.PI / 2; ceil.position.y = 2.79; sc.add(ceil);
  return sc;
}
/* ---------- textures ---------- */
function sandTexture() {
  const N = 1024, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'); x.fillStyle = '#8f8570'; x.fillRect(0, 0, N, N);
  for (let i = 0; i < 90000; i++) { const v = 95 + Math.random() * 80 | 0; x.fillStyle = `rgba(${v},${v - 6 | 0},${v - 18 | 0},${0.35 + Math.random() * 0.5})`; x.fillRect(Math.random() * N, Math.random() * N, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  for (let i = 0; i < 60; i++) { x.strokeStyle = `rgba(120,110,95,${0.05 + Math.random() * 0.08})`; x.lineWidth = 6 + Math.random() * 20; x.beginPath(); const y = Math.random() * N; x.moveTo(0, y); for (let k = 1; k <= 6; k++) x.lineTo(k * N / 6, y + Math.sin(k + i) * 30); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
const hsh = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
function rockGeo(r, seed) { const g0 = new THREE.IcosahedronGeometry(r, 5); g0.deleteAttribute('uv'); const g = mergeVertices(g0); const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = v.clone().normalize();
    const d = 1 + 0.26 * (Math.sin(n.x * 4.1 + seed) * Math.sin(n.y * 3.3 + seed * 2) + 0.7 * Math.sin(n.z * 6.7 + n.x * 3 + seed)) + 0.09 * Math.sin(n.x * 21 + seed) * Math.sin(n.z * 19 + n.y * 17) + 0.03 * (hsh(n.x + seed, n.y, n.z) - 0.5) - 0.25 * Math.max(0, -n.y);
    v.copy(n).multiplyScalar(r * d); v.y *= 0.7; p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g; }
function rockMat() { // live rock: grey-brown with purple coralline patches
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'); x.fillStyle = '#4e4a46'; x.fillRect(0, 0, N, N);
  for (let i = 0; i < 140; i++) { x.fillStyle = `rgba(${110 + Math.random() * 30 | 0},${60 + Math.random() * 25 | 0},${120 + Math.random() * 40 | 0},${0.15 + Math.random() * 0.3})`; x.beginPath(); x.arc(Math.random() * N, Math.random() * N, 3 + Math.random() * 10, 0, 6.29); x.fill(); }
  for (let i = 0; i < 6000; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.3})`; x.fillRect(Math.random() * N, Math.random() * N, 1, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshStandardMaterial({ color: 0x7a736c, roughness: 0.95, metalness: 0 }); }

/* ---------- the reef ---------- */
const sway = { value: 0 };
function swayInject(mat, amt) { mat.onBeforeCompile = (sh) => { sh.uniforms.uT = uT; sh.uniforms.uSway = sway;
  sh.vertexShader = 'uniform float uT, uSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float k = clamp(position.y / ${amt.toFixed(3)}, 0.0, 1.0); k *= k;
    transformed.x += (sin(uT * 1.3 + position.z * 60.0 + position.x * 30.0) * 0.004 + uSway * 0.02) * k;
    transformed.z += (cos(uT * 1.1 + position.x * 50.0) * 0.003) * k;`); }; mat.customProgramCacheKey = () => 'sway' + amt; }
function buildReef(scene) {
  const g = new THREE.Group(); const { W, H, D, fill, cabH, cabD } = R; const y0 = cabH; const waterH = H * fill;
  // cabinet: matte black, slightly rounded, with a shadow gap under the tank
  const cab = new THREE.Mesh(new RoundedBoxGeometry(W + 0.02, cabH, cabD, 3, 0.004), new THREE.MeshPhysicalMaterial({ color: 0x15161a, roughness: 0.6, metalness: 0.05, clearcoat: 0.15 })); cab.position.y = cabH / 2; cab.receiveShadow = true; cab.castShadow = true; g.add(cab);
  const mat = new THREE.Mesh(new THREE.BoxGeometry(W + 0.004, 0.006, D + 0.004), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9 })); mat.position.y = y0 + 0.003; g.add(mat);
  // glass: reflection-only faces + faint fill + edge seams (low-iron, so nearly colourless)
  const glass = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.03, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, envMapIntensity: 2.2, specularIntensity: 1, ior: 1.52, depthWrite: false })); glass.position.y = y0 + H / 2; glass.renderOrder = 30; g.add(glass);
  const fillM = new THREE.Mesh(new THREE.BoxGeometry(W - 0.001, H - 0.001, D - 0.001), new THREE.MeshBasicMaterial({ color: 0xa9c8dc, transparent: true, opacity: 0.03, depthWrite: false })); fillM.position.y = y0 + H / 2; fillM.renderOrder = 29; g.add(fillM);
  const seamMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe6f0, roughness: 0.2, transparent: true, opacity: 0.25, envMapIntensity: 1.2, depthWrite: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const seam = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, H, 8), seamMat); seam.position.set(sx * (W / 2 - 0.004), y0 + H / 2, sz * (D / 2 - 0.004)); seam.renderOrder = 31; g.add(seam); }
  const rim = new THREE.Mesh(new THREE.BoxGeometry(W, 0.003, D), seamMat); rim.position.y = y0 + H - 0.0015; rim.renderOrder = 31; g.add(rim);
  // water: deep blue tint + back wall painted black inside (looks like open ocean) + surface
  const tint = new THREE.Mesh(new THREE.BoxGeometry(W - 0.012, waterH, D - 0.012), new THREE.MeshBasicMaterial({ color: 0x0b3f66, transparent: true, opacity: 0.3, side: THREE.BackSide, depthWrite: false })); tint.position.y = y0 + waterH / 2; tint.renderOrder = 2; g.add(tint);
  const bgTex = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d'); const gr = x.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#2c6f9a'); gr.addColorStop(0.45, '#123e62'); gr.addColorStop(1, '#061524'); x.fillStyle = gr; x.fillRect(0, 0, 4, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.014, H - 0.01), new THREE.MeshStandardMaterial({ map: bgTex, roughness: 1 })); back.position.set(0, y0 + H / 2, -D / 2 + 0.008); back.receiveShadow = true; g.add(back);
  const surfGeo = new THREE.PlaneGeometry(W - 0.014, D - 0.014, 48, 24); surfGeo.rotateX(-Math.PI / 2);
  const surface = new THREE.Mesh(surfGeo, new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.03, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, envMapIntensity: 1.3, specularIntensity: 1, ior: 1.33, depthWrite: false })); surface.position.y = y0 + waterH; surface.renderOrder = 25; g.add(surface);
  const surfBase = surfGeo.attributes.position.array.slice();
  // sand bed
  const sandGeo = new THREE.PlaneGeometry(W - 0.014, D - 0.014, 60, 30); sandGeo.rotateX(-Math.PI / 2); { const p = sandGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, 0.004 * Math.sin(x * 40) * Math.cos(z * 55) + 0.003 * Math.sin(x * 90 + z * 70) + 0.012 * Math.max(0, 1 - Math.hypot(x + 0.1, z + 0.04) / 0.16)); } sandGeo.computeVertexNormals(); }
  const sandTex = sandTexture(); sandTex.repeat.set(3, 1.5);
  const sand = new THREE.Mesh(sandGeo, new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.95 })); sand.position.y = y0 + 0.012; sand.receiveShadow = true; g.add(sand);
  // caustics + light shafts
  const causMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uTint: { value: new THREE.Color(0.6, 0.85, 1.0) }, uAmt: { value: 0.45 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `${GLSL_NOISE} uniform float uT, uAmt; uniform vec3 uTint; varying vec2 vUv;
      void main(){ vec2 p=vec2(vUv.x*12.0, vUv.y*6.0); float a=fbm3(vec3(p, uT*0.3)), b=fbm3(vec3(p*1.6+2.0, -uT*0.25));
        float c=pow(1.0-abs(a-0.5)*2.0, 6.0)*0.8+pow(1.0-abs(b-0.5)*2.0, 8.0)*0.6;
        float edge=smoothstep(0.0,0.05,vUv.x)*smoothstep(1.0,0.95,vUv.x)*smoothstep(0.0,0.1,vUv.y)*smoothstep(1.0,0.9,vUv.y);
        gl_FragColor=vec4(uTint*c*uAmt*edge, c*uAmt*edge); }` });
  const caustics = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.02, D - 0.02), causMat); caustics.rotation.x = -Math.PI / 2; caustics.position.y = y0 + 0.0135; caustics.renderOrder = 3; g.add(caustics);
  const rayMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uT: { value: 0 }, uAmt: { value: 0.16 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `${GLSL_NOISE} uniform float uT, uAmt; varying vec2 vUv;
      void main(){ float x=vUv.x*9.0+uT*0.05; float r=pow(fbm3(vec3(x, vUv.y*0.6+uT*0.1, uT*0.07)),3.0)*2.2;
        float fade=pow(vUv.y,1.6)*smoothstep(0.0,0.08,vUv.x)*smoothstep(1.0,0.92,vUv.x); gl_FragColor=vec4(vec3(0.55,0.8,1.0)*r*uAmt*fade, r*uAmt*fade); }` });
  for (const z of [-0.06, 0.03]) { const rays = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.03, waterH - 0.02), rayMat); rays.position.set(0, y0 + waterH / 2 + 0.005, z); rays.renderOrder = 4; g.add(rays); }
  // live rock structure (left-centre), sand slope under it
  const rm = rockMat(); const rocks = [[-0.14, 0.05, -0.02, 0.075, 1], [-0.05, 0.035, -0.08, 0.055, 2], [-0.1, 0.1, -0.06, 0.045, 3], [0.16, 0.03, -0.09, 0.05, 4], [-0.2, 0.03, 0.06, 0.04, 5]];
  for (const [x, y, z, r, sd] of rocks) { const m = new THREE.Mesh(rockGeo(r, sd), rm); m.position.set(x, y0 + y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); }
  // corals: branching acropora (pink w/ white tips), brain coral (green), mushrooms, and the anemone
  const acro = (x, y, z, col, tip, s) => { const grp = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, emissive: col, emissiveIntensity: 0.05 }); const tipM = new THREE.MeshStandardMaterial({ color: tip, roughness: 0.8, emissive: tip, emissiveIntensity: 0.08 });
    const branch = (parent, len, r, tilt, spin, depth) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r, len, 7), depth === 0 ? tipM : mat); m.position.y = len / 2; m.castShadow = true; const piv = new THREE.Group(); piv.rotation.set(tilt, spin, 0); piv.add(m); parent.add(piv);
      if (depth > 0) for (let k = 0; k < 2 + (Math.random() < 0.6 ? 1 : 0); k++) { const sub = new THREE.Group(); sub.position.y = len * (0.5 + Math.random() * 0.45); piv.add(sub); branch(sub, len * 0.65, r * 0.72, rnd(0.4, 0.9), rnd(0, 6.28), depth - 1); } };
    for (let k = 0; k < 5; k++) branch(grp, rnd(0.035, 0.055) * s, 0.004 * s, rnd(0.15, 0.6), k * 1.25 + rnd(0, 0.4), 2); grp.position.set(x, y, z); g.add(grp); return grp; };
  acro(-0.1, y0 + 0.14, -0.06, 0xb84e84, 0xd99ab8, 1); acro(-0.17, y0 + 0.11, -0.03, 0x5c48a6, 0x9a8fd0, 0.8); acro(0.16, y0 + 0.07, -0.09, 0x358a98, 0x7fbcc6, 0.7);
  const brain = new THREE.Mesh((() => { const gg = new THREE.SphereGeometry(0.035, 48, 32); const p = gg.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = v.clone().normalize(); const w = 1 + 0.06 * Math.sin(n.x * 60 + n.z * 45) * Math.sin(n.y * 50); v.multiplyScalar(w); v.y = v.y * 0.6; p.setXYZ(i, v.x, v.y, v.z); } gg.computeVertexNormals(); return gg; })(),
    new THREE.MeshStandardMaterial({ color: 0x5fd06a, roughness: 0.7, emissive: 0x2f9a3a, emissiveIntensity: 0.08 })); brain.position.set(-0.03, y0 + 0.06, -0.07); brain.castShadow = true; g.add(brain);
  const mush = new THREE.MeshStandardMaterial({ color: 0xff6f3c, roughness: 0.8, emissive: 0xff4a1a, emissiveIntensity: 0.06, side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.CircleGeometry(rnd(0.008, 0.014), 18), mush); m.rotation.x = -Math.PI / 2 + rnd(-0.3, 0.3); m.position.set(-0.14 + rnd(-0.06, 0.06), y0 + 0.12 + rnd(0, 0.02), -0.02 + rnd(-0.03, 0.03)); g.add(m); }
  // anemone: 48 swaying tentacles (bubble tips) on a disc, next to the rock
  const anem = new THREE.Group(); const tentMat = new THREE.MeshPhysicalMaterial({ color: 0xd8b48a, roughness: 0.5, transmission: 0, transparent: true, opacity: 0.9, emissive: 0xffc07a, emissiveIntensity: 0.15, clearcoat: 0.3 }); swayInject(tentMat, 0.06);
  const tentGeo = new THREE.CylinderGeometry(0.0035, 0.0018, 0.06, 7, 8); tentGeo.translate(0, 0.03, 0); { const p = tentGeo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0.052) { const k = (y - 0.052) / 0.008; const sc = 1 + k * 1.2; p.setX(i, p.getX(i) * sc); p.setZ(i, p.getZ(i) * sc); } } tentGeo.computeVertexNormals(); }
  const tents = new THREE.InstancedMesh(tentGeo, tentMat, 48); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
  for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2 * 3.7, r = 0.006 + 0.028 * Math.sqrt(i / 48); e.set(rnd(-0.6, 0.6) + Math.sin(a) * 0.3, a, rnd(-0.5, 0.5) + Math.cos(a) * 0.3); q.setFromEuler(e); const s = rnd(0.7, 1.1); sc.set(s, s, s); m4.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q, sc); tents.setMatrixAt(i, m4); }
  const disc = new THREE.Mesh(new THREE.SphereGeometry(0.036, 24, 12, 0, 6.29, 0, 1.2), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.8 })); disc.scale.y = 0.35; anem.add(disc); anem.add(tents); anem.position.set(0.05, y0 + 0.02, 0.02); g.add(anem);
  // plankton motes: tiny drifting points give the water depth
  const moteN = 220, motePos = new Float32Array(moteN * 3); for (let i = 0; i < moteN; i++) { motePos[i * 3] = rnd(-W / 2 + 0.02, W / 2 - 0.02); motePos[i * 3 + 1] = y0 + rnd(0.02, waterH - 0.01); motePos[i * 3 + 2] = rnd(-D / 2 + 0.02, D / 2 - 0.02); }
  const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xbfe0ff, size: 0.0016, transparent: true, opacity: 0.5, depthWrite: false, sizeAttenuation: true })); motes.renderOrder = 5; g.add(motes);
  // light bar above (black, on two thin wires) — the marine LED
  const bar = new THREE.Mesh(new RoundedBoxGeometry(W * 0.9, 0.012, 0.05, 3, 0.003), new THREE.MeshPhysicalMaterial({ color: 0x141518, roughness: 0.45, metalness: 0.3, clearcoat: 0.4 })); bar.position.y = y0 + H + 0.11; bar.castShadow = true; g.add(bar);
  const wireM = new THREE.MeshStandardMaterial({ color: 0x333338, roughness: 0.6 }); for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.5, 6), wireM); w.position.set(sx * W * 0.38, y0 + H + 0.36, 0); g.add(w); }
  const led = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.82, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.5, 2.0) })); led.rotation.x = Math.PI / 2; led.position.y = y0 + H + 0.1035; g.add(led);
  const beam = new THREE.SpotLight(0xcfe8ff, 1.0, 0.9, 0.9, 0.6, 2); beam.position.set(0, y0 + H + 0.1, 0); beam.target.position.set(0, y0, 0); beam.castShadow = true; beam.shadow.mapSize.set(1024, 1024); beam.shadow.camera.near = 0.05; beam.shadow.camera.far = 0.8; beam.shadow.bias = -0.0002; beam.shadow.normalBias = 0.001; beam.shadow.radius = 3; g.add(beam); g.add(beam.target);
  const glow = new THREE.PointLight(0xbfe0ff, 0.5, 1.2, 2); glow.position.set(0, y0 + H + 0.09, 0); g.add(glow);
  g.userData = { y0, waterH, surface, surfBase, caustics, rayMat, beam, glow, tents, motes, motePos, anem };
  scene.add(g); return g;
}
function buildRoom(scene) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ color: 0x2b2a2e, roughness: 0.9 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.0005; floor.receiveShadow = true; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6), new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 1 })); wall.position.set(0, 1.0, -0.6); wall.receiveShadow = true; scene.add(wall);
}

/* ---------- scene / renderer / post ---------- */
export const ReefGL = (() => {
  const view = { zoom: 1, px: 0, py: 0 }; let lastW = 0, lastH = 0;
  let renderer, scene, camera, composer, reef, clock, swimmers = [], school = [], clowns = [], ready = false, tSim = 0;
  const wind = { x: 0, z: 0, vx: 0, vz: 0, tx: 0, tz: 0, slosh: 0 }; const tiltBase = { g: null, b: null };
  function init(el) {
    renderer = new THREE.WebGLRenderer({ canvas: el, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x07080b);
    const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(nightRoomEnv(), 0.04).texture; scene.environmentIntensity = 0.5; pmrem.dispose();
    camera = new THREE.PerspectiveCamera(28, 1, 0.05, 30);
    buildRoom(scene); reef = buildReef(scene);
    clock = makeDotClock(0.045, new THREE.Color(2.2, 2.6, 3.0)); clock.mesh.position.set(0, R.cabH * 0.5, R.cabD / 2 + 0.0008); reef.add(clock.mesh);
    scene.add(new THREE.AmbientLight(0x8fa8c8, 0.05)); scene.add(new THREE.HemisphereLight(0x6f8fb8, 0x14161a, 0.16));
    const moon = new THREE.SpotLight(0xa9c4ea, 1.2, 8, 0.5, 0.8, 2); moon.position.set(-1.6, 1.9, 0.9); moon.target.position.set(0.1, 0.2, 0); moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024); moon.shadow.camera.near = 0.5; moon.shadow.camera.far = 5; moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.003; moon.shadow.radius = 5; scene.add(moon); scene.add(moon.target);
    // fish
    const { y0, waterH } = reef.userData; const W = R.W, D = R.D;
    const full = new THREE.Box3(new THREE.Vector3(-W / 2 + 0.03, y0 + 0.05, -D / 2 + 0.03), new THREE.Vector3(W / 2 - 0.03, y0 + waterH - 0.025, D / 2 - 0.03));
    const upper = new THREE.Box3(new THREE.Vector3(-W / 2 + 0.03, y0 + 0.12, -D / 2 + 0.03), new THREE.Vector3(W / 2 - 0.03, y0 + waterH - 0.02, D / 2 - 0.03));
    const home = new THREE.Box3(new THREE.Vector3(0.0, y0 + 0.045, -0.04), new THREE.Vector3(0.12, y0 + 0.12, 0.09));   // clownfish stay by the anemone
    const tang = makeTang(0.075); reef.add(tang); swimmers.push(new Swimmer(tang, full, { cruise: 0.05, turn: 1.6, accel: 1.0, bank: 0.25, beat: 4.5, hoverP: 0.15 }));
    for (let i = 0; i < 2; i++) { const cf = makeClownfish(i ? 0.036 : 0.046); reef.add(cf); clowns.push(new Swimmer(cf, home, { cruise: 0.03, turn: 4.0, accel: 2.4, bank: 0.35, beat: 7, hoverP: 0.45 })); }
    for (let i = 0; i < 8; i++) { const ch = makeChromis(0.03); reef.add(ch); school.push(new Swimmer(ch, upper, { cruise: 0.06, turn: 4.5, accel: 2.8, bank: 0.3, beat: 9, hoverP: 0.05, dartP: 0.08 })); }
    composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new BloomEffect({ luminanceThreshold: 1.0, luminanceSmoothing: 0.15, intensity: 0.35, mipmapBlur: true, radius: 0.55, levels: 5, resolutionScale: 0.5 });
    const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.OVERLAY }); grain.blendMode.opacity.value = 0.04;
    composer.addPass(new EffectPass(camera, bloom, grain, new VignetteEffect({ offset: 0.28, darkness: 0.55 }), new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));
    ready = true; return true;
  }
  function setView(zoom, px, py) { view.zoom = clamp(zoom, 0.5, 3); view.px = clamp(px, -1, 1); view.py = clamp(py, -1, 1); if (ready) frame(); return { ...view }; }
  let qScale = 1, slowFrames = 0;
  function applySize() { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * qScale); renderer.setSize(lastW, lastH, false); composer.setSize(lastW, lastH); }
  function resize(w, h) { if (!ready) return; if (w !== lastW || h !== lastH) { qScale = 1; slowFrames = 0; } lastW = w; lastH = h; applySize(); frame(); }
  function adapt(dt) { if (dt > 1 / 36) slowFrames++; else slowFrames = Math.max(0, slowFrames - 2); if (slowFrames > 120 && qScale > 0.7) { qScale = Math.max(0.7, qScale - 0.15); slowFrames = 0; applySize(); } }
  function frame() {
    const w = lastW, h = lastH; camera.aspect = w / h; const land = w > h;
    const totalH = R.cabH + R.H + 0.14, totalW = R.W + 0.04;
    const vf = THREE.MathUtils.degToRad(camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    // landscape: fit the whole tank + light bar; portrait: fit the tank width (the cabinet with the clock sits below)
    const dist = R.D / 2 + Math.max(totalW * (land ? 1.06 : 1.02) / 2 / Math.tan(hf / 2), land ? totalH * 1.05 / 2 / Math.tan(vf / 2) : 0) / view.zoom;
    const cy = R.cabH + R.H * 0.45, halfH = Math.tan(vf / 2) * dist, halfW = halfH * camera.aspect, ox = -view.px * halfW, oy = -view.py * halfH;
    camera.position.set(dist * 0.12 + ox, cy + dist * 0.14 + oy, dist * 0.99); camera.lookAt(0.0 + ox, cy - 0.01 + oy, 0); camera.updateProjectionMatrix(); camera.userData.dx = camera.userData.dy = 0;
  }
  function setColors(hexA, hexB) { const c = new THREE.Color(hexA), cool = new THREE.Color(0xdff0ff); c.lerp(cool, 0.7).multiplyScalar(2.6); clock.mat.color.copy(c); }
  function motion(ax, ay, az) { wind.vx -= ax * 0.04; wind.vz -= az * 0.025; wind.slosh = Math.min(1, wind.slosh + Math.hypot(ax, ay, az) / 14); }
  function tilt(g, b) { if (tiltBase.g === null) { tiltBase.g = g || 0; tiltBase.b = b || 0; } tiltBase.g += ((g || 0) - tiltBase.g) * 0.03; tiltBase.b += ((b || 0) - tiltBase.b) * 0.03;
    wind.tx = -Math.sin(THREE.MathUtils.degToRad(clamp((g || 0) - tiltBase.g, -45, 45))) * 0.5; wind.tz = Math.sin(THREE.MathUtils.degToRad(clamp((b || 0) - tiltBase.b, -45, 45))) * 0.35; }
  const flowV = new THREE.Vector3();
  function render(dt, timeText, suffix, mo = 1, bass = 0) {
    if (!ready) return; const sdt = dt * (0.4 + 0.6 * mo); tSim += sdt; const t = tSim; uT.value = t;
    wind.vx += ((wind.tx - wind.x) * 8 - wind.vx * 3) * dt; wind.vz += ((wind.tz - wind.z) * 8 - wind.vz * 3) * dt; wind.x += wind.vx * dt; wind.z += wind.vz * dt; wind.slosh *= Math.exp(-dt * 1.1);
    const U = reef.userData, sp = U.surface.geometry.attributes.position, base = U.surfBase, amp = 0.0008 + wind.slosh * 0.005;
    for (let i = 0; i < sp.count; i++) { const x = base[i * 3], z = base[i * 3 + 2];
      sp.setY(i, Math.sin(x * 60 + t * 1.6) * amp * 0.6 + Math.sin(z * 90 - t * 1.3 + x * 20) * amp * 0.5 + Math.sin((x + z) * 45 + t * 2.4) * amp * 0.35 + (x * wind.x + z * wind.z) * 0.12); }
    sp.needsUpdate = true; U.surface.geometry.computeVertexNormals();
    // current: slow reversing flow (like a wavemaker), tilt adds to it; anemone leans with it
    const cur = Math.sin(t * 0.25) * 0.012 + wind.x * 0.02; sway.value = cur * 30 + Math.sin(t * 0.7) * 0.15; flowV.set(cur, 0, wind.z * 0.015);
    U.rayMat.uniforms.uT.value = t; U.caustics.material.uniforms.uT.value = t; U.caustics.material.uniforms.uAmt.value = 0.42 + wind.slosh * 0.5 + bass * 0.15;
    U.beam.intensity = 1.0 * (0.97 + 0.03 * pink(t * 0.4, 5)) * (1 + bass * 0.2); U.glow.intensity = 0.5 * (1 + bass * 0.3);
    for (const s of swimmers) s.update(sdt, t, flowV, null); for (const s of clowns) s.update(sdt, t, flowV, clowns); for (const s of school) s.update(sdt, t, flowV, school);
    // plankton drift
    const mp = U.motePos, y0 = U.y0, W = R.W, D = R.D; for (let i = 0; i < mp.length; i += 3) { mp[i] += (cur * 0.6 + Math.sin(t * 0.5 + i) * 0.002) * sdt; mp[i + 1] += Math.sin(t * 0.3 + i * 0.7) * 0.0015 * sdt; if (mp[i] > W / 2 - 0.02) mp[i] = -W / 2 + 0.02; if (mp[i] < -W / 2 + 0.02) mp[i] = W / 2 - 0.02; } U.motes.geometry.attributes.position.needsUpdate = true;
    if (mo > 0) { camera.position.x += 0.006 * Math.sin(t * 2 * Math.PI / 47) - (camera.userData.dx || 0); camera.userData.dx = 0.006 * Math.sin(t * 2 * Math.PI / 47);
      camera.position.y += 0.004 * Math.sin(t * 2 * Math.PI / 67) - (camera.userData.dy || 0); camera.userData.dy = 0.004 * Math.sin(t * 2 * Math.PI / 67); }
    clock.set(timeText, suffix); adapt(dt); composer.render(dt);
  }
  return { init, resize, setColors, render, motion, tilt, setView, getView: () => ({ ...view }), get ready() { return ready; } };
})();
window.ReefGL = ReefGL;
