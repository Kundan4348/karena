/* Lumina — Reef 3D: a long rimless marine tank on a black cabinet, moonlit room. Landscape-first.
   Same API as HearthGL / TankGL. Exposes window.ReefGL. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, NoiseEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode, BlendFunction } from 'postprocessing';
import { pink, rnd, clamp, GLSL_NOISE, uT, makeClownfish, makeTang, makeChromis, Swimmer, makeGlowClock, loadFishGLB, makeWater, placeGLB } from './fishlib.js';

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
/* ---------- assets: CC0 scans from Poly Haven (see assets/LICENSE.txt), decimated + meshopt-compressed ---------- */
const ASSET = new URL('./assets/', import.meta.url).href;
const TL = new THREE.TextureLoader();
function tex(name, srgb, rep) { const t = TL.load(ASSET + name); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (rep) t.repeat.set(rep[0], rep[1]); return t; }
const gltfLoader = new GLTFLoader(); gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const loadGLB = (name) => new Promise((res, rej) => gltfLoader.load(ASSET + name, (g) => res(g.scene), undefined, rej));

/* ---------- underwater shading, shared by everything inside the tank ----------
   Real water over 30 cm is nearly clear: a little red loss with distance, a little blue in-scatter, and the LED's
   caustic web projected on up-facing surfaces. Injected into each material's fragment shader; chains after
   any existing onBeforeCompile (the fish spine shader). */
const WATER = makeWater(R.D / 2, R.cabH + R.H * R.fill, 58); const uWater = WATER.u, reefInject = WATER.inject, submerge = WATER.submerge;

/* ---------- the reef ---------- */
const sway = { value: 0 };
function swayInject(mat, amt) { const prev = mat.onBeforeCompile; mat.onBeforeCompile = (sh, r) => { if (prev) prev.call(mat, sh, r); sh.uniforms.uT = uT; sh.uniforms.uSway = sway;
  sh.vertexShader = 'uniform float uT, uSway;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    float k = clamp(position.y / ${amt.toFixed(3)}, 0.0, 1.0); k *= k;
    transformed.x += (sin(uT * 1.3 + position.z * 60.0 + position.x * 30.0) * 0.004 + uSway * 0.02) * k;
    transformed.z += (cos(uT * 1.1 + position.x * 50.0) * 0.003) * k;`); }; mat.customProgramCacheKey = () => 'sway' + amt; }
// sand bed height (CPU side, also used to keep the crab on the sand)
function sandH(x, z) { return 0.005 * Math.sin(x * 30) * Math.cos(z * 40) + 0.002 * Math.sin(x * 95 + z * 60) + 0.016 * Math.max(0, 1 - Math.hypot(x + 0.12, z + 0.05) / 0.2) + 0.008 * Math.max(0, 1 - Math.hypot(x - 0.16, z + 0.08) / 0.14); }
function radialAlpha() { const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'); const gr = x.createRadialGradient(N / 2, N / 2, N * 0.15, N / 2, N / 2, N * 0.5); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000'); x.fillStyle = gr; x.fillRect(0, 0, N, N);
  for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.6})`; x.fillRect(Math.random() * N, Math.random() * N, 2, 2); } return new THREE.CanvasTexture(c); }

function buildReef(scene) {
  const g = new THREE.Group(); const { W, H, D, fill, cabH, cabD } = R; const y0 = cabH; const waterH = H * fill; const sandY = y0 + 0.012;
  // cabinet: matte black, slightly rounded, with a shadow gap under the tank
  const crep = [1.6, 0.6], carm = tex('dark_wood_arm.webp', false, crep);
  const cab = new THREE.Mesh(new RoundedBoxGeometry(W + 0.02, cabH, cabD, 3, 0.004), new THREE.MeshPhysicalMaterial({ map: tex('dark_wood_diff.webp', true, crep), normalMap: tex('dark_wood_nor_gl.webp', false, crep), aoMap: carm, roughnessMap: carm, metalnessMap: carm, color: 0xc8b8a8, roughness: 1, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3 })); cab.position.y = cabH / 2; cab.receiveShadow = true; cab.castShadow = true; g.add(cab);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + 0.01, 0.012, cabD - 0.01), new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.7 })); plinth.position.y = 0.006; g.add(plinth);
  const mat = new THREE.Mesh(new THREE.BoxGeometry(W + 0.004, 0.006, D + 0.004), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9 })); mat.position.y = y0 + 0.003; g.add(mat);
  // glass: reflection-only faces + faint fill + edge seams (low-iron, so nearly colourless)
  const glass = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.03, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, envMapIntensity: 2.2, specularIntensity: 1, ior: 1.52, depthWrite: false })); glass.position.y = y0 + H / 2; glass.renderOrder = 30; g.add(glass);
  const fillM = new THREE.Mesh(new THREE.BoxGeometry(W - 0.001, H - 0.001, D - 0.001), new THREE.MeshBasicMaterial({ color: 0xa9c8dc, transparent: true, opacity: 0.025, depthWrite: false })); fillM.position.y = y0 + H / 2; fillM.renderOrder = 29; g.add(fillM);
  const seamMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe6f0, roughness: 0.2, transparent: true, opacity: 0.25, envMapIntensity: 1.2, depthWrite: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const seam = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, H, 8), seamMat); seam.position.set(sx * (W / 2 - 0.004), y0 + H / 2, sz * (D / 2 - 0.004)); seam.renderOrder = 31; g.add(seam); }
  const rim = new THREE.Mesh(new THREE.BoxGeometry(W, 0.003, D), seamMat); rim.position.y = y0 + H - 0.0015; rim.renderOrder = 31; g.add(rim);
  // waterline: the bright meniscus where the surface meets the glass
  const menM = new THREE.MeshBasicMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const [sx, sz, w, d] of [[0, 1, W - 0.012, 0.002], [0, -1, W - 0.012, 0.002], [1, 0, 0.002, D - 0.012], [-1, 0, 0.002, D - 0.012]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.0022, d), menM); m.position.set(sx * (W / 2 - 0.007), y0 + waterH + 0.0005, sz * (D / 2 - 0.007)); m.renderOrder = 26; g.add(m); }
  // back wall: deep blue gradient (a painted backdrop), tinted further by the water shader
  const bgTex = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d'); const gr = x.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#4d9ec8'); gr.addColorStop(0.45, '#216a9a'); gr.addColorStop(1, '#0d3a5a'); x.fillStyle = gr; x.fillRect(0, 0, 4, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.014, H - 0.01), reefInject(new THREE.MeshStandardMaterial({ map: bgTex, roughness: 1 }), { caustic: false })); back.position.set(0, y0 + H / 2, -D / 2 + 0.008); back.receiveShadow = true; g.add(back);
  const surfGeo = new THREE.PlaneGeometry(W - 0.014, D - 0.014, 48, 24); surfGeo.rotateX(-Math.PI / 2);
  const surface = new THREE.Mesh(surfGeo, new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.03, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, envMapIntensity: 1.3, specularIntensity: 1, ior: 1.33, depthWrite: false })); surface.position.y = y0 + waterH; surface.renderOrder = 25; g.add(surface);
  const surfBase = surfGeo.attributes.position.array.slice();
  // sand bed: scanned sand PBR set (colour / normal / AO-rough / displacement) on a shaped, finely tessellated plane
  const sandGeo = new THREE.PlaneGeometry(W - 0.014, D - 0.014, 180, 90); sandGeo.rotateX(-Math.PI / 2); { const p = sandGeo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, sandH(p.getX(i), p.getZ(i))); sandGeo.computeVertexNormals(); }
  const srep = [2.6, 1.3]; const sandArm = tex('aerial_sand_arm.webp', false, srep);
  const sandMat = reefInject(new THREE.MeshStandardMaterial({ map: tex('aerial_sand_diff.webp', true, srep), normalMap: tex('aerial_sand_nor_gl.webp', false, srep), normalScale: new THREE.Vector2(0.7, 0.7), aoMap: sandArm, roughnessMap: sandArm, metalnessMap: sandArm, displacementMap: tex('aerial_sand_disp.webp', false, srep), displacementScale: 0.0028, displacementBias: -0.0014, color: 0xe6dcc8, roughness: 1, metalness: 0 }));
  const sand = new THREE.Mesh(sandGeo, sandMat); sand.position.y = sandY; sand.receiveShadow = true; g.add(sand);
  // coral rubble patches at the rock bases (coral_ground_02), fading into the sand
  const rrep = [1.2, 0.8]; const rubArm = tex('coral_ground_02_arm.webp', false, rrep); const rubAlpha = radialAlpha();
  const rubMat = reefInject(new THREE.MeshStandardMaterial({ map: tex('coral_ground_02_diff.webp', true, rrep), normalMap: tex('coral_ground_02_nor_gl.webp', false, rrep), normalScale: new THREE.Vector2(0.8, 0.8), aoMap: rubArm, roughnessMap: rubArm, metalnessMap: rubArm, alphaMap: rubAlpha, transparent: true, depthWrite: false, color: 0xd9d2c4, roughness: 1 }));
  for (const [x, z, w, d, rot] of [[-0.02, 0.02, 0.2, 0.13, 0.3], [0.17, -0.02, 0.16, 0.1, -0.6], [-0.22, 0.05, 0.1, 0.08, 1.1]]) { const rg = new THREE.PlaneGeometry(w, d, 24, 16); rg.rotateX(-Math.PI / 2); const pp = rg.attributes.position; for (let i = 0; i < pp.count; i++) { const wx = x + pp.getX(i) * Math.cos(rot) - pp.getZ(i) * Math.sin(rot), wz = z + pp.getX(i) * Math.sin(rot) + pp.getZ(i) * Math.cos(rot); pp.setY(i, sandH(wx, wz) + 0.002); } rg.computeVertexNormals(); const rm = new THREE.Mesh(rg, rubMat); rm.position.set(x, sandY, z); rm.rotation.y = rot; rm.renderOrder = 1; rm.receiveShadow = true; g.add(rm); }
  // light shafts (kept soft; the caustic web itself is projected by the water shader)
  const rayMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uT: { value: 0 }, uAmt: { value: 0.14 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `${GLSL_NOISE} uniform float uT, uAmt; varying vec2 vUv;
      void main(){ float x=vUv.x*9.0+uT*0.05; float r=pow(fbm3(vec3(x, vUv.y*0.6+uT*0.1, uT*0.07)),3.0)*2.2;
        float fade=pow(vUv.y,1.6)*smoothstep(0.0,0.08,vUv.x)*smoothstep(1.0,0.92,vUv.x); gl_FragColor=vec4(vec3(0.55,0.8,1.0)*r*uAmt*fade, r*uAmt*fade); }` });
  for (const z of [-0.06, 0.03]) { const rays = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.03, waterH - 0.02), rayMat); rays.position.set(0, y0 + waterH / 2 + 0.005, z); rays.renderOrder = 4; g.add(rays); }
  // corals: natural, matte, a little translucent sheen; colours as they read under white/blue LED
  const coralM = (col) => reefInject(new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.95, sheen: 0.15, sheenRoughness: 0.8, sheenColor: new THREE.Color(col).lerp(new THREE.Color(0xffffff), 0.5) }));
  const acro = (col, tip, s) => { const grp = new THREE.Group(); const mat = coralM(col), tipM = coralM(tip);
    const branch = (parent, len, r, tilt, spin, depth) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r, len, 8), depth === 0 ? tipM : mat); m.position.y = len / 2; m.castShadow = true; m.receiveShadow = true; const piv = new THREE.Group(); piv.rotation.set(tilt, spin, 0); piv.add(m); parent.add(piv);
      if (depth > 0) for (let k = 0; k < 2 + (Math.random() < 0.6 ? 1 : 0); k++) { const sub = new THREE.Group(); sub.position.y = len * (0.5 + Math.random() * 0.45); piv.add(sub); branch(sub, len * 0.65, r * 0.72, rnd(0.4, 0.9), rnd(0, 6.28), depth - 1); } };
    for (let k = 0; k < 5; k++) branch(grp, rnd(0.035, 0.055) * s, 0.004 * s, rnd(0.15, 0.6), k * 1.25 + rnd(0, 0.4), 2); g.add(grp); return grp; };
  const acros = [acro(0x7a6048, 0x9a8668, 1.0), acro(0x4a5a70, 0x6f8fae, 0.85), acro(0x4e3c60, 0x7a6a92, 0.7)];
  // brain coral (Platygyra): meandering valleys painted + bumped
  const brainTex = (() => { const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'); x.fillStyle = '#5a7040'; x.fillRect(0, 0, N, N);
    x.lineCap = 'round'; for (let i = 0; i < 170; i++) { let px = Math.random() * N, py = Math.random() * N, a = Math.random() * 6.28; x.strokeStyle = `rgba(28,40,22,${0.75 + Math.random() * 0.25})`; x.lineWidth = 5 + Math.random() * 3; x.beginPath(); x.moveTo(px, py);
      for (let k = 0; k < 14; k++) { a += (Math.random() - 0.5) * 1.6; px += Math.cos(a) * 9; py += Math.sin(a) * 9; x.lineTo(px, py); } x.stroke(); }
    for (let i = 0; i < 9000; i++) { x.fillStyle = `rgba(${150 + Math.random() * 60 | 0},${170 + Math.random() * 50 | 0},${90 | 0},${Math.random() * 0.25})`; x.fillRect(Math.random() * N, Math.random() * N, 2, 2); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1.5); return t; })();
  const brain = new THREE.Mesh((() => { const gg = new THREE.SphereGeometry(0.035, 64, 40); const p = gg.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = v.clone().normalize(); const w = 1 + 0.05 * Math.sin(n.x * 60 + n.z * 45) * Math.sin(n.y * 50); v.multiplyScalar(w); v.y = v.y * 0.6; p.setXYZ(i, v.x, v.y, v.z); } gg.computeVertexNormals(); return gg; })(),
    reefInject(new THREE.MeshPhysicalMaterial({ map: brainTex, bumpMap: brainTex, bumpScale: -0.0025, roughness: 0.92, sheen: 0.15, sheenColor: new THREE.Color(0xaad080) }))); brain.castShadow = true; brain.receiveShadow = true; g.add(brain);
  // ---- plumbing: rim-hung overflow (back-right), loc-line return (back-left), wavemaker puck (left glass) ----
  const acrylic = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0c, roughness: 0.6, metalness: 0.0, clearcoat: 0.25, clearcoatRoughness: 0.45 });
  const ovW = 0.07, ovD = 0.034, ovH = 0.15, ovX = W / 2 - 0.008 - ovW / 2, ovZ = -D / 2 + 0.008 + ovD / 2, weirY = y0 + waterH - 0.007;
  const ovBody = new THREE.Mesh(new THREE.BoxGeometry(ovW, weirY - (y0 + waterH + 0.012 - ovH), ovD), acrylic); ovBody.position.set(ovX, (weirY + y0 + waterH + 0.012 - ovH) / 2, ovZ); ovBody.castShadow = true; ovBody.receiveShadow = true; g.add(ovBody);
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(ovW, 0.02, 0.003), acrylic); backWall.position.set(ovX, weirY + 0.01, ovZ - ovD / 2 + 0.0015); g.add(backWall);
  const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.02, ovD), acrylic); sideWall.position.set(ovX + ovW / 2 - 0.0015, weirY + 0.01, ovZ); g.add(sideWall);
  const toothGeo = new THREE.BoxGeometry(0.0028, 0.02, 0.003); const teethN = Math.floor(ovW / 0.0056) + Math.floor(ovD / 0.0056); const teeth = new THREE.InstancedMesh(toothGeo, acrylic, teethN); { const tm = new THREE.Matrix4(); let k = 0;
    for (let i = 0; i < Math.floor(ovW / 0.0056); i++) { tm.makeTranslation(ovX - ovW / 2 + 0.0028 + i * 0.0056, weirY + 0.01, ovZ + ovD / 2 - 0.0015); teeth.setMatrixAt(k++, tm); }
    for (let i = 0; i < Math.floor(ovD / 0.0056); i++) { tm.makeRotationY(Math.PI / 2).setPosition(ovX - ovW / 2 + 0.0015, weirY + 0.01, ovZ - ovD / 2 + 0.0028 + i * 0.0056); teeth.setMatrixAt(k++, tm); } } teeth.castShadow = true; g.add(teeth);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(ovW + 0.004, 0.003, ovD + 0.004), acrylic); lid.position.set(ovX, weirY + 0.0215, ovZ); g.add(lid);
  const innerLevel = new THREE.Mesh(new THREE.PlaneGeometry(ovW - 0.006, ovD - 0.006), new THREE.MeshBasicMaterial({ color: 0x08202e })); innerLevel.rotation.x = -Math.PI / 2; innerLevel.position.set(ovX, weirY - 0.012, ovZ); g.add(innerLevel);
  const sheetMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uT: uT },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `${GLSL_NOISE} uniform float uT; varying vec2 vUv; void main(){ float s = fbm3(vec3(vUv.x*40.0, vUv.y*6.0 + uT*4.0, uT*0.5)); float a = smoothstep(0.35,0.75,s) * (1.0 - vUv.y) * 0.55 + 0.08 * (1.0 - vUv.y); gl_FragColor = vec4(vec3(0.75,0.9,1.0) * a, a); }` });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(ovW, 0.014), sheetMat); sheet.position.set(ovX, weirY + 0.006, ovZ + ovD / 2 + 0.0005); sheet.renderOrder = 27; g.add(sheet);
  // return: loc-line down from the back-left rim, elbow just under the surface, nozzle aimed across the tank and slightly down
  const locM = new THREE.MeshPhysicalMaterial({ color: 0x111114, roughness: 0.5, clearcoat: 0.3 }); const jetO = new THREE.Vector3(-W / 2 + 0.05, y0 + waterH - 0.028, -D / 2 + 0.03), jetD = new THREE.Vector3(0.82, -0.18, 0.55).normalize();
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 14), locM); pipe.position.set(-W / 2 + 0.04, y0 + waterH + 0.012, -D / 2 + 0.02); pipe.castShadow = true; g.add(pipe);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.005, 10, 16, Math.PI), locM); hook.position.set(-W / 2 + 0.028, y0 + H + 0.004, -D / 2 + 0.02); hook.rotation.z = 0; g.add(hook);
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.1, 12), locM); outer.position.set(-W / 2 + 0.016, y0 + H - 0.045, -D / 2 + 0.02); g.add(outer);
  for (let i = 0; i < 4; i++) { const seg = new THREE.Mesh(new THREE.SphereGeometry(0.0072, 14, 10), locM); const pp = jetO.clone().addScaledVector(jetD, -0.03 + i * 0.011); seg.position.copy(pp); seg.scale.set(1, 1, 1.15); seg.castShadow = true; g.add(seg); }
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.006, 0.016, 12), locM); nozzle.position.copy(jetO).addScaledVector(jetD, 0.0); nozzle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), jetD); g.add(nozzle);
  // wavemaker: puck on the left glass, magnet outside
  const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 24), acrylic); puck.rotation.z = Math.PI / 2; puck.position.set(-W / 2 + 0.018, y0 + waterH * 0.62, 0.02); puck.castShadow = true; g.add(puck);
  const grille = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0015, 8, 24), acrylic); grille.rotation.y = Math.PI / 2; grille.position.set(-W / 2 + 0.0285, y0 + waterH * 0.62, 0.02); g.add(grille);
  for (let i = 0; i < 5; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.0015, 0.024 * Math.cos((i - 2) * 0.55), 0.0015), acrylic); bar.position.set(-W / 2 + 0.0285, y0 + waterH * 0.62, 0.02 + (i - 2) * 0.0055); g.add(bar); }
  const magnet = new THREE.Mesh(new RoundedBoxGeometry(0.014, 0.04, 0.04, 2, 0.003), acrylic); magnet.position.set(-W / 2 - 0.007, y0 + waterH * 0.62, 0.02); g.add(magnet);
  // flow field: jet from the return + the puck's reversing current (uCur set per frame)
  const flowState = { cur: 0 }; const _r = new THREE.Vector3(), _q = new THREE.Vector3();
  const flowAt = (p, out) => { out.set(flowState.cur, 0, 0); _r.subVectors(p, jetO); const s = _r.dot(jetD); if (s > 0) { const r = _q.copy(_r).addScaledVector(jetD, -s).length(), w = 0.012 + 0.2 * s; out.addScaledVector(jetD, 0.07 * Math.exp(-s / 0.28) * Math.exp(-(r * r) / (w * w))); } return out; };
  // microbubbles entrained in the return jet
  const jbN = 46; const jetBub = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.35, clearcoat: 1, depthWrite: false }), jbN); jetBub.renderOrder = 20; g.add(jetBub);
  const jb = []; for (let i = 0; i < jbN; i++) jb.push({ p: jetO.clone(), age: Math.random() * 2.5, r: rnd(0.0003, 0.0007) });
  const mushM = reefInject(new THREE.MeshPhysicalMaterial({ color: 0x9a4f30, roughness: 0.9, sheen: 0.15, sheenColor: new THREE.Color(0xffb090), side: THREE.DoubleSide }));
  const mushes = []; for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(new THREE.CircleGeometry(rnd(0.008, 0.014), 18), mushM); m.rotation.x = -Math.PI / 2 + rnd(-0.3, 0.3); m.userData.off = [rnd(-0.05, 0.05), rnd(-0.03, 0.03)]; g.add(m); mushes.push(m); }
  // anemone: 48 swaying tentacles (bubble tips) on a disc
  const anem = new THREE.Group(); const tentMat = new THREE.MeshPhysicalMaterial({ color: 0x7c5c3e, roughness: 0.75, transparent: true, opacity: 0.95, emissive: 0xffb070, emissiveIntensity: 0.0, sheen: 0.1, sheenColor: new THREE.Color(0xc09060) }); swayInject(tentMat, 0.06); reefInject(tentMat, { caustic: false });
  const tentGeo = new THREE.CylinderGeometry(0.0035, 0.0018, 0.06, 7, 8); tentGeo.translate(0, 0.03, 0); { const p = tentGeo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0.052) { const k = (y - 0.052) / 0.008; const sc = 1 + k * 1.2; p.setX(i, p.getX(i) * sc); p.setZ(i, p.getZ(i) * sc); } } tentGeo.computeVertexNormals(); }
  const tents = new THREE.InstancedMesh(tentGeo, tentMat, 48); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
  for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2 * 3.7, r = 0.006 + 0.028 * Math.sqrt(i / 48); e.set(rnd(-0.6, 0.6) + Math.sin(a) * 0.3, a, rnd(-0.5, 0.5) + Math.cos(a) * 0.3); q.setFromEuler(e); const s = rnd(0.7, 1.1); sc.set(s, s, s); m4.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q, sc); tents.setMatrixAt(i, m4); }
  tents.castShadow = true;
  const disc = new THREE.Mesh(new THREE.SphereGeometry(0.036, 24, 12, 0, 6.29, 0, 1.2), reefInject(new THREE.MeshStandardMaterial({ color: 0x7a5238, roughness: 0.85 }))); disc.scale.y = 0.35; anem.add(disc); anem.add(tents); anem.position.set(0.05, sandY + sandH(0.05, 0.02), 0.02); g.add(anem);
  // plankton motes: tiny drifting points give the water depth
  const moteN = 220, motePos = new Float32Array(moteN * 3); for (let i = 0; i < moteN; i++) { motePos[i * 3] = rnd(-W / 2 + 0.02, W / 2 - 0.02); motePos[i * 3 + 1] = y0 + rnd(0.02, waterH - 0.01); motePos[i * 3 + 2] = rnd(-D / 2 + 0.02, D / 2 - 0.02); }
  const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xbfe0ff, size: 0.0014, transparent: true, opacity: 0.4, depthWrite: false, sizeAttenuation: true })); motes.renderOrder = 5; g.add(motes);
  // light bar above (black, on two thin wires) — the marine LED
  const bar = new THREE.Mesh(new RoundedBoxGeometry(W * 0.9, 0.012, 0.05, 3, 0.003), new THREE.MeshPhysicalMaterial({ color: 0x141518, roughness: 0.45, metalness: 0.3, clearcoat: 0.4 })); bar.position.y = y0 + H + 0.075; bar.castShadow = true; g.add(bar);
  const wireM = new THREE.MeshStandardMaterial({ color: 0x333338, roughness: 0.6 }); for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.5, 6), wireM); w.position.set(sx * W * 0.38, y0 + H + 0.325, 0); g.add(w); }
  const led = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.82, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.5, 2.0) })); led.rotation.x = Math.PI / 2; led.position.y = y0 + H + 0.0685; g.add(led);
  const beam = new THREE.SpotLight(0xd8ecff, 1.45, 0.9, 0.95, 0.55, 2); beam.position.set(0, y0 + H + 0.065, 0); beam.target.position.set(0, y0, 0); beam.castShadow = true; beam.shadow.mapSize.set(2048, 2048); beam.shadow.camera.near = 0.05; beam.shadow.camera.far = 0.8; beam.shadow.bias = -0.00015; beam.shadow.normalBias = 0.0012; beam.shadow.radius = 3; g.add(beam); g.add(beam.target);
  const glow = new THREE.PointLight(0xbfe0ff, 0.6, 1.2, 2); glow.position.set(0, y0 + H + 0.06, 0); g.add(glow);
  const inner = new THREE.PointLight(0xa8d8ff, 0.3, 0.6, 2); inner.position.set(0.05, y0 + waterH * 0.55, 0.1); g.add(inner);
  const crab = buildCrab(g, y0, (x, z) => sandY + sandH(x, z));
  // scanned live rock + shell: loaded async, corals then dropped onto the rock surfaces by raycast
  const rocks = []; const ray = new THREE.Raycaster(); const dropTo = (x, z, extra = []) => { ray.set(new THREE.Vector3(x, y0 + 0.6, z), new THREE.Vector3(0, -1, 0)); const h = ray.intersectObjects([...rocks, ...extra], true)[0]; return h ? h.point.y : sandY + sandH(x, z); };
  const liveRock = (scene0, sx, sy, sz, rotY, x, z, sink, onto) => { const m = scene0.clone(); m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; const mm = o.material.clone(); mm.color.set(0x8f8a84); mm.roughness = 1; mm.metalness = 0; mm.envMapIntensity = 0.35; reefInject(mm, { caustic: true, coralline: true }); o.material = mm; } });
    m.scale.set(sx, sy, sz); m.rotation.y = rotY; m.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(m); const baseY = onto ? dropTo(x, z) : sandY + sandH(x, z); m.position.set(x - (bb.min.x + bb.max.x) / 2, baseY - bb.min.y - sink, z - (bb.min.z + bb.max.z) / 2); m.updateMatrixWorld(true); g.add(m); rocks.push(m); return m; };
  const loaded = Promise.all([loadGLB('coast_rocks_05.glb'), loadGLB('sand_rocks_small_01.glb'), loadGLB('lambis_shell.glb')]).then(([rockA, rockC, shell]) => {
    liveRock(rockA, 0.074, 0.09, 0.052, 0.35, -0.12, -0.05, 0.012, false);            // main structure, left
    liveRock(rockA, 0.042, 0.055, 0.034, 2.6, -0.08, -0.07, 0.014, true);             // second tier stacked on it
    liveRock(rockC, 0.05, 0.065, 0.045, -0.4, 0.17, -0.08, 0.006, false);             // low cluster, right-back
    const sh = shell.clone(); sh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; reefInject(o.material); } }); sh.scale.setScalar(0.55); sh.rotation.set(0.15, 2.3, 0.1); sh.position.set(-0.21, sandY + sandH(-0.21, 0.08) - 0.002, 0.08); g.add(sh);
    // place corals on the rock
    const put = (obj, x, z, sink = 0.003) => { obj.position.set(x, dropTo(x, z) - sink, z); };
    put(acros[0], -0.09, -0.07, 0.004); put(acros[1], -0.2, -0.03, 0.004); put(acros[2], 0.17, -0.09, 0.003); put(brain, -0.04, -0.06, 0.012);
    for (const m of mushes) { const x = -0.14 + m.userData.off[0], z = -0.02 + m.userData.off[1]; m.position.set(x, dropTo(x, z) + 0.0015, z); }
    return true; }).catch((e) => { console.warn('reef assets', e); return false; });
  g.userData = { y0, waterH, sandY, surface, surfBase, rayMat, beam, glow, tents, motes, motePos, anem, crab, loaded, rocks, flowAt, flowState, jetO, jetD, jetBub, jb, ov: { x: ovX, z: ovZ } };
  scene.add(g); return g;
}


/* ---------- red crab on the front-right sand: scuttles sideways in bursts, pauses, lifts a claw, turns slowly ---------- */
function buildCrab(parent, y0, hfn) {
  const grp = new THREE.Group(); const shellM = new THREE.MeshPhysicalMaterial({ color: 0xc8321f, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const darkM = new THREE.MeshPhysicalMaterial({ color: 0x8a1e12, roughness: 0.5, clearcoat: 0.5 });
  const body = new THREE.Group(); grp.add(body);
  const cara = new THREE.Mesh(new THREE.SphereGeometry(0.011, 24, 16), shellM); cara.scale.set(1.0, 0.45, 0.72); cara.castShadow = true; body.add(cara);
  const cara2 = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 20, 12), darkM); cara2.scale.set(0.9, 0.38, 0.7); cara2.position.set(0, 0.0025, -0.001); body.add(cara2);
  for (const sg of [-1, 1]) { const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0008, 0.004, 6), darkM); stalk.position.set(sg * 0.0035, 0.005, 0.0075); stalk.rotation.x = 0.5; body.add(stalk);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.001, 8, 6), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2 })); eye.position.set(sg * 0.0035, 0.0072, 0.0087); body.add(eye); }
  // limb segment helper: tapered cylinder from a to b (local coords)
  const seg = (a, b, r0, r1, mat) => { const d = b.clone().sub(a), L = d.length(); const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, L, 7), mat); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.castShadow = true; return m; };
  // legs: 4 per side, fanned front→back, femur up-and-out then tibia steeply down to a tip on the sand
  const legs = [];
  for (const sg of [-1, 1]) for (let i = 0; i < 4; i++) {
    const fan = new THREE.Group(); fan.position.set(sg * 0.0085, -0.0008, 0.0045 - i * 0.003); fan.rotation.y = sg * (i - 1.5) * 0.34; body.add(fan);
    const swing = new THREE.Group(); fan.add(swing);
    const kneeP = new THREE.Vector3(sg * 0.0085, 0.0058, 0), tipP = new THREE.Vector3(sg * 0.0135, -0.0068, 0);
    swing.add(seg(new THREE.Vector3(0, 0, 0), kneeP, 0.0011, 0.0009, shellM));
    const knee = new THREE.Group(); knee.position.copy(kneeP); swing.add(knee);
    knee.add(seg(new THREE.Vector3(0, 0, 0), tipP.clone().sub(kneeP), 0.0009, 0.0003, darkM));
    const kj = new THREE.Mesh(new THREE.SphereGeometry(0.0011, 8, 6), shellM); knee.add(kj);
    legs.push({ swing, knee, phase: (i % 2) * Math.PI + (sg > 0 ? 0 : Math.PI / 2), sg }); }
  // claws: arm forward, chunky hand with a fixed finger and a movable dactyl
  const claws = []; for (const sg of [-1, 1]) { const sh = new THREE.Group(); sh.position.set(sg * 0.0075, -0.0005, 0.0065); body.add(sh);
    sh.add(seg(new THREE.Vector3(0, 0, 0), new THREE.Vector3(sg * 0.0045, 0.001, 0.0085), 0.0014, 0.0016, shellM));
    const hand = new THREE.Group(); hand.position.set(sg * 0.0045, 0.001, 0.0085); hand.rotation.y = sg * -0.35; sh.add(hand);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.0034, 12, 9), shellM); palm.scale.set(0.85, 0.7, 1.4); palm.position.z = 0.0025; palm.castShadow = true; hand.add(palm);
    const fix = new THREE.Mesh(new THREE.ConeGeometry(0.0013, 0.0065, 8), darkM); fix.rotation.x = Math.PI / 2; fix.position.set(sg * 0.0012, -0.0006, 0.0085); hand.add(fix);
    const dac = new THREE.Group(); dac.position.set(sg * -0.0012, 0.0012, 0.0055); hand.add(dac);
    const dm = new THREE.Mesh(new THREE.ConeGeometry(0.0011, 0.006, 8), darkM); dm.rotation.x = Math.PI / 2; dm.position.z = 0.003; dac.add(dm);
    claws.push({ sh, hand, dac, sg }); }
  grp.scale.setScalar(1.25);
  grp.position.set(0.2, y0 + 0.012 + 0.0085, 0.075); parent.add(grp);
  // behaviour: bounded patch on the front-right sand
  const st = { x: 0.2, z: 0.075, tx: 0.2, tz: 0.075, yaw: 0.2, vel: 0, timer: 1.5, mode: 'pause', clawT: 0, gait: 0 };
  const B = { x0: 0.12, x1: 0.26, z0: 0.03, z1: 0.12 };
  return { update(dt, t) {
    st.timer -= dt;
    if (st.timer < 0) { if (st.mode === 'pause') { st.mode = 'walk'; st.tx = rnd(B.x0, B.x1); st.tz = rnd(B.z0, B.z1); st.timer = rnd(1.5, 3.5); } else { st.mode = 'pause'; st.timer = rnd(1.5, 5); if (Math.random() < 0.5) st.clawT = 1.6; } }
    const dx = st.tx - st.x, dz = st.tz - st.z, d = Math.hypot(dx, dz);
    // crabs walk sideways: the body faces perpendicular to the travel direction, turning slowly
    if (st.mode === 'walk' && d > 0.004) { const travel = Math.atan2(dx, dz); let want = travel + Math.PI / 2; let dy = want - st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); if (Math.abs(dy) > Math.PI / 2) { want += Math.PI; dy = Math.atan2(Math.sin(want - st.yaw), Math.cos(want - st.yaw)); }
      st.yaw += clamp(dy, -1.5 * dt, 1.5 * dt); const burst = 0.6 + 0.4 * Math.sin(t * 5.0); st.vel += ((0.028 * burst) - st.vel) * Math.min(1, dt * 6);
      st.x += dx / d * st.vel * dt; st.z += dz / d * st.vel * dt; }
    else { st.vel *= Math.exp(-dt * 8); if (st.mode === 'walk') st.timer = 0; }
    st.x = clamp(st.x, B.x0, B.x1); st.z = clamp(st.z, B.z0, B.z1);
    grp.position.x = st.x; grp.position.z = st.z; grp.position.y = hfn(st.x, st.z) + 0.0085; grp.rotation.y = st.yaw; body.position.y = 0.0006 * Math.sin(t * 9) * Math.min(1, st.vel / 0.02);
    // gait: legs swing about x (sideways travel), alternating tripod-style; lift when swinging
    st.gait += dt * (6 + st.vel * 300); const k = Math.min(1, st.vel / 0.02);
    for (const L of legs) { const ph = st.gait + L.phase; L.swing.rotation.z = L.sg * Math.max(0, Math.sin(ph)) * 0.45 * k; L.swing.rotation.x = Math.cos(ph) * 0.12 * k; L.knee.rotation.z = L.sg * (Math.cos(ph) * 0.3 * k + 0.04 * Math.sin(t * 1.7 + L.phase)); }
    // claws: held folded; occasionally raised and opened while paused
    st.clawT = Math.max(0, st.clawT - dt); const raise = Math.sin(Math.min(1, st.clawT / 1.6) * Math.PI);
    for (const C of claws) { C.sh.rotation.x = -0.9 * raise + 0.05 * Math.sin(t * 2 + C.sg); C.hand.rotation.y = C.sg * (-0.35 + 0.3 * raise + 0.06 * Math.sin(t * 3.1)); C.dac.rotation.y = C.sg * -(0.35 * raise + 0.1 + 0.08 * Math.sin(t * 2.6 + C.sg)); }
  } };
}

function buildRoom(scene) {
  const frep = [3.5, 3.5], farm = tex('old_wooden_floor_01_arm.webp', false, frep);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ map: tex('old_wooden_floor_01_diff.webp', true, frep), normalMap: tex('old_wooden_floor_01_nor_gl.webp', false, frep), aoMap: farm, roughnessMap: farm, metalnessMap: farm, color: 0x8c8078, roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.0005; floor.receiveShadow = true; scene.add(floor);
  const wrep = [4, 2.6], warm = tex('plaster_grey_04_arm.webp', false, wrep);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6), new THREE.MeshStandardMaterial({ map: tex('plaster_grey_04_diff.webp', true, wrep), normalMap: tex('plaster_grey_04_nor_gl.webp', false, wrep), normalScale: new THREE.Vector2(0.6, 0.6), aoMap: warm, roughnessMap: warm, color: 0x7d8792, roughness: 1 })); wall.position.set(0, 1.0, -0.6); wall.receiveShadow = true; scene.add(wall);
  const room = new THREE.PointLight(0xa8bcd8, 1.6, 6, 2); room.position.set(0.9, 1.7, 1.0); scene.add(room);
  const front = new THREE.PointLight(0xd8c8b8, 0.9, 3, 2); front.position.set(1.0, 0.08, 0.9); scene.add(front);
}

/* ---------- scene / renderer / post ---------- */
export const ReefGL = (() => {
  const view = { zoom: 1, px: 0, py: 0 }; let lastW = 0, lastH = 0;
  let renderer, scene, camera, composer, reef, clock, swimmers = [], school = [], clowns = [], ready = false, loaded = false, tSim = 0;
  const wind = { x: 0, z: 0, vx: 0, vz: 0, tx: 0, tz: 0, slosh: 0 }; const tiltBase = { g: null, b: null };
  function init(el) {
    renderer = new THREE.WebGLRenderer({ canvas: el, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x0c0e12);
    const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(nightRoomEnv(), 0.04).texture; scene.environmentIntensity = 0.7; pmrem.dispose();
    camera = new THREE.PerspectiveCamera(28, 1, 0.05, 30);
    buildRoom(scene); reef = buildReef(scene); reef.userData.loaded.then((ok) => { loaded = ok; });
    clock = makeGlowClock(0.085, new THREE.Color(1.6, 2.1, 2.6)); clock.mesh.position.set(0, R.cabH * 0.52, R.cabD / 2 + 0.0008); reef.add(clock.mesh);
    scene.add(new THREE.AmbientLight(0x8fa8c8, 0.08)); scene.add(new THREE.HemisphereLight(0x9fc0e8, 0x2a2c34, 0.55));
    const moon = new THREE.SpotLight(0xb9d0f0, 2.4, 8, 0.55, 0.8, 2); moon.position.set(-1.6, 1.9, 0.9); moon.target.position.set(0.1, 0.2, 0); moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024); moon.shadow.camera.near = 0.5; moon.shadow.camera.far = 5; moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.003; moon.shadow.radius = 5; scene.add(moon); scene.add(moon.target);
    // fish
    const { y0, waterH } = reef.userData; const W = R.W, D = R.D;
    const full = new THREE.Box3(new THREE.Vector3(-W / 2 + 0.03, y0 + 0.05, -D / 2 + 0.03), new THREE.Vector3(W / 2 - 0.03, y0 + waterH - 0.025, D / 2 - 0.03));
    const upper = new THREE.Box3(new THREE.Vector3(-W / 2 + 0.03, y0 + 0.12, -D / 2 + 0.03), new THREE.Vector3(W / 2 - 0.03, y0 + waterH - 0.02, D / 2 - 0.03));
    const home = new THREE.Box3(new THREE.Vector3(0.0, y0 + 0.045, -0.04), new THREE.Vector3(0.12, y0 + 0.12, 0.09));   // clownfish stay by the anemone
    const tang = submerge(makeTang(0.075), { caustic: false }); reef.add(tang); swimmers.push(new Swimmer(tang, full, { cruise: 0.05, turn: 1.6, accel: 1.0, bank: 0.25, beat: 4.5, hoverP: 0.15 }));
    for (let i = 0; i < 2; i++) { const cf = submerge(makeClownfish(i ? 0.036 : 0.046), { caustic: false }); reef.add(cf); clowns.push(new Swimmer(cf, home, { cruise: 0.03, turn: 4.0, accel: 2.4, bank: 0.35, beat: 7, hoverP: 0.45 })); }
    for (let i = 0; i < 8; i++) { const ch = submerge(makeChromis(0.03), { caustic: false }); reef.add(ch); school.push(new Swimmer(ch, upper, { cruise: 0.06, turn: 4.5, accel: 2.8, bank: 0.3, beat: 9, hoverP: 0.05, dartP: 0.08 })); }
    // optional drop-in glTF fish: put clown.glb / tang.glb / chromis.glb in assets/fish/ and they replace the procedural bodies
    const swapIn = (sw, name, L) => loadFishGLB(gltfLoader, ASSET + 'fish/' + name + '.glb', L).then((g) => { submerge(g, { caustic: false }); g.position.copy(sw.m.position); g.rotation.copy(sw.m.rotation); reef.remove(sw.m); reef.add(g); sw.m = g; sw.ctrl = g.userData.ctrl; }).catch(() => {});
    swapIn(swimmers[0], 'tang', 0.075); clowns.forEach((sw, i) => swapIn(sw, 'clown', i ? 0.036 : 0.046)); school.forEach((sw) => swapIn(sw, 'chromis', 0.03));
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
    const totalH = R.cabH + R.H + 0.09, totalW = R.W + 0.02;
    const vf = THREE.MathUtils.degToRad(camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    // landscape: fit the whole tank + light bar; portrait: fit the tank width (the cabinet with the clock sits below)
    const dist = R.D / 2 + Math.max(totalW * (land ? 1.02 : 1.0) / 2 / Math.tan(hf / 2), land ? totalH * 1.02 / 2 / Math.tan(vf / 2) : 0) / view.zoom;
    const cy = R.cabH + R.H * 0.42, halfH = Math.tan(vf / 2) * dist, halfW = halfH * camera.aspect, ox = -view.px * halfW, oy = -view.py * halfH;
    camera.position.set(dist * 0.12 + ox, cy + dist * 0.14 + oy, dist * 0.99); camera.lookAt(0.0 + ox, cy - 0.01 + oy, 0); camera.updateProjectionMatrix(); camera.userData.dx = camera.userData.dy = 0;
  }
  function setColors(hexA, hexB) { const c = new THREE.Color(hexA), cool = new THREE.Color(0xdff0ff); c.lerp(cool, 0.55).multiplyScalar(2.2); clock.mat.color.copy(c); }
  function motion(ax, ay, az) { wind.vx -= ax * 0.04; wind.vz -= az * 0.025; wind.slosh = Math.min(1, wind.slosh + Math.hypot(ax, ay, az) / 14); }
  function tilt(g, b) { if (tiltBase.g === null) { tiltBase.g = g || 0; tiltBase.b = b || 0; } tiltBase.g += ((g || 0) - tiltBase.g) * 0.03; tiltBase.b += ((b || 0) - tiltBase.b) * 0.03;
    wind.tx = -Math.sin(THREE.MathUtils.degToRad(clamp((g || 0) - tiltBase.g, -45, 45))) * 0.5; wind.tz = Math.sin(THREE.MathUtils.degToRad(clamp((b || 0) - tiltBase.b, -45, 45))) * 0.35; }
  const flowV = new THREE.Vector3();
  function render(dt, timeText, suffix, mo = 1, bass = 0) {
    if (!ready) return; const sdt = dt * (0.4 + 0.6 * mo); tSim += sdt; const t = tSim; uT.value = t;
    wind.vx += ((wind.tx - wind.x) * 8 - wind.vx * 3) * dt; wind.vz += ((wind.tz - wind.z) * 8 - wind.vz * 3) * dt; wind.x += wind.vx * dt; wind.z += wind.vz * dt; wind.slosh *= Math.exp(-dt * 1.1);
    const U = reef.userData, sp = U.surface.geometry.attributes.position, base = U.surfBase, amp = 0.0008 + wind.slosh * 0.005;
    for (let i = 0; i < sp.count; i++) { const x = base[i * 3], z = base[i * 3 + 2];
      const dxo = (x - U.ov.x) / 0.05, dzo = (z - U.ov.z) / 0.04; const jx = x - U.jetO.x, jz = z - U.jetO.z, js = jx * U.jetD.x + jz * U.jetD.z, jr = Math.hypot(jx - js * U.jetD.x, jz - js * U.jetD.z);
      sp.setY(i, Math.sin(x * 60 + t * 1.6) * amp * 0.6 + Math.sin(z * 90 - t * 1.3 + x * 20) * amp * 0.5 + Math.sin((x + z) * 45 + t * 2.4) * amp * 0.35 + (x * wind.x + z * wind.z) * 0.12
        - 0.0022 * Math.exp(-(dxo * dxo + dzo * dzo)) + (js > 0 ? 0.0012 * Math.exp(-js / 0.15) * Math.exp(-(jr * jr) / 0.0009) * Math.sin(js * 220 - t * 9) : 0)); }
    sp.needsUpdate = true; U.surface.geometry.computeVertexNormals();
    // current: slow reversing flow (like a wavemaker), tilt adds to it; anemone leans with it
    const cur = Math.sin(t * 0.25) * 0.012 + wind.x * 0.02; sway.value = cur * 30 + Math.sin(t * 0.7) * 0.15; U.flowState.cur = cur;
    U.rayMat.uniforms.uT.value = t; uWater.uCaus.value = 0.5 + wind.slosh * 0.5 + bass * 0.15;
    U.beam.intensity = 1.45 * (0.97 + 0.03 * pink(t * 0.4, 5)) * (1 + bass * 0.2); U.glow.intensity = 0.5 * (1 + bass * 0.3);
    for (const s of swimmers) s.update(sdt, t, U.flowAt(s.pos, flowV), null); for (const s of clowns) s.update(sdt, t, U.flowAt(s.pos, flowV), clowns); for (const s of school) s.update(sdt, t, U.flowAt(s.pos, flowV), school);
    // jet microbubbles: born at the nozzle, carried by the flow, rise, die at the surface or after 2.5 s
    { const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(); for (let i = 0; i < U.jb.length; i++) { const b = U.jb[i]; b.age += sdt; U.flowAt(b.p, flowV); b.p.addScaledVector(flowV, sdt); b.p.y += 0.012 * sdt * (1 + b.r * 800);
      if (b.age > 2.5 || b.p.y > U.y0 + U.waterH - 0.001) { b.age = 0; b.p.copy(U.jetO).addScaledVector(U.jetD, 0.01); b.p.x += rnd(-0.003, 0.003); b.p.y += rnd(-0.003, 0.003); }
      sc.setScalar(b.r); m4.compose(b.p, q, sc); U.jetBub.setMatrixAt(i, m4); } U.jetBub.instanceMatrix.needsUpdate = true; }
    U.crab.update(sdt, t);
    // plankton drift
    const mp = U.motePos, y0 = U.y0, W = R.W, D = R.D, mv = new THREE.Vector3(); for (let i = 0; i < mp.length; i += 3) { mv.set(mp[i], mp[i + 1], mp[i + 2]); U.flowAt(mv, flowV); mp[i] += (flowV.x * 0.8 + Math.sin(t * 0.5 + i) * 0.002) * sdt; mp[i + 1] += (flowV.y * 0.8 + Math.sin(t * 0.3 + i * 0.7) * 0.0015) * sdt; mp[i + 2] += flowV.z * 0.8 * sdt;
      if (mp[i] > W / 2 - 0.02) mp[i] = -W / 2 + 0.02; if (mp[i] < -W / 2 + 0.02) mp[i] = W / 2 - 0.02; if (mp[i + 2] > D / 2 - 0.02) mp[i + 2] = -D / 2 + 0.02; if (mp[i + 2] < -D / 2 + 0.02) mp[i + 2] = D / 2 - 0.02; if (mp[i + 1] > y0 + U.waterH - 0.01) mp[i + 1] = y0 + 0.03; if (mp[i + 1] < y0 + 0.02) mp[i + 1] = y0 + U.waterH - 0.02; } U.motes.geometry.attributes.position.needsUpdate = true;
    if (mo > 0) { camera.position.x += 0.006 * Math.sin(t * 2 * Math.PI / 47) - (camera.userData.dx || 0); camera.userData.dx = 0.006 * Math.sin(t * 2 * Math.PI / 47);
      camera.position.y += 0.004 * Math.sin(t * 2 * Math.PI / 67) - (camera.userData.dy || 0); camera.userData.dy = 0.004 * Math.sin(t * 2 * Math.PI / 67); }
    clock.set(timeText, suffix); adapt(dt); composer.render(dt);
  }
  return { init, resize, setColors, render, motion, tilt, setView, getView: () => ({ ...view }), get ready() { return ready; }, get loaded() { return loaded; } };
})();
window.ReefGL = ReefGL;
