/* Lumina — Aquarium 3D: a desktop betta tank on a side table (Three.js + pmndrs/postprocessing).
   Same API as HearthGL: init / resize / setColors / render / motion / tilt / setView / getView. Exposes window.TankGL. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, NoiseEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode, BlendFunction } from 'postprocessing';

import { pink, rnd, clamp, lerp, GLSL_NOISE, vivid, mixHex, finTextures, bodyTexture, uT, makeBetta, makeTetra, Swimmer, SplashFX, makeDotClock, makeWater, placeGLB } from './fishlib.js';

/* ---------- dimensions (metres, from the product photo: 11.8 x 17.7 x 11.8 cm) ---------- */
const TANK = { W: 0.118, H: 0.177, D: 0.118, wall: 0.003, baseH: 0.03, baseW: 0.136, fill: 0.88 };
const T0 = { y: 0 };                                   // table-top height (world y)
const ASSET = new URL('./assets/', import.meta.url).href; const TL = new THREE.TextureLoader();
function tex(name, srgb, rep) { const t = TL.load(ASSET + name); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (rep) t.repeat.set(rep[0], rep[1]); return t; }
const gltfLoader = new GLTFLoader(); gltfLoader.setMeshoptDecoder(MeshoptDecoder); const loadGLB = (name) => new Promise((res, rej) => gltfLoader.load(ASSET + name, (g) => res(g.scene), undefined, rej));
const water = makeWater(TANK.D / 2, TANK.baseH + 0.006 + TANK.H * TANK.fill, 150);

/* ---------- procedural textures ---------- */
function woodTexture() {
  const N = 1024, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
  x.fillStyle = '#4a3527'; x.fillRect(0, 0, N, N);
  for (let i = 0; i < 260; i++) { const y = Math.random() * N; x.strokeStyle = `rgba(${30 + Math.random() * 40 | 0},${18 + Math.random() * 22 | 0},${10 + Math.random() * 12 | 0},${0.1 + Math.random() * 0.3})`; x.lineWidth = 1 + Math.random() * 6;
    x.beginPath(); x.moveTo(0, y); for (let k = 1; k <= 8; k++) x.lineTo(k * N / 8, y + Math.sin(k * 1.3 + i) * 9 + (Math.random() - 0.5) * 6); x.stroke(); }
  for (let i = 0; i < 26000; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.16})`; x.fillRect(Math.random() * N, Math.random() * N, 1, 1 + Math.random() * 3); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
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
  const wrep = [3, 2.4], warm = tex('plaster_grey_04_arm.webp', false, wrep);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.4), new THREE.MeshStandardMaterial({ map: tex('plaster_grey_04_diff.webp', true, wrep), normalMap: tex('plaster_grey_04_nor_gl.webp', false, wrep), normalScale: new THREE.Vector2(0.6, 0.6), aoMap: warm, roughnessMap: warm, color: 0xa08c78, roughness: 1 })); wall.position.set(0, 0.9, -0.55); wall.receiveShadow = true; scene.add(wall);
  const wallWash = new THREE.PointLight(0xffd9b0, 1.1, 3.5, 2); wallWash.position.set(-0.55, 0.75, 0.15); scene.add(wallWash);
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
  const waterH = H * fill;
  const tintBack = new THREE.Mesh(new THREE.BoxGeometry(W - 0.007, waterH, D - 0.007), new THREE.MeshBasicMaterial({ color: 0x1a5f80, transparent: true, opacity: 0.06, side: THREE.BackSide, depthWrite: false }));
  tintBack.position.y = y0 + waterH / 2; tintBack.renderOrder = 2; g.add(tintBack);
  // open top (bettas jump). Light: a slim clip-on LED arm at the back-right, head over the centre
  const armMat = new THREE.MeshPhysicalMaterial({ color: 0x1b1c1f, roughness: 0.45, metalness: 0.2, clearcoat: 0.4 });
  const clip = new THREE.Mesh(new RoundedBoxGeometry(0.016, 0.03, 0.012, 3, 0.002), armMat); clip.position.set(W / 2 - 0.006, y0 + H - 0.012, -D / 2 + 0.002); clip.castShadow = true; g.add(clip);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.036, 12), armMat); post.position.set(W / 2 - 0.006, y0 + H + 0.012, -D / 2 + 0.002); g.add(post);
  const armLen = Math.hypot(W / 2 - 0.006, D / 2 - 0.002) * 0.85; const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, armLen, 12), armMat);
  arm.position.set((W / 2 - 0.006) * 0.5, y0 + H + 0.03, (-D / 2 + 0.002) * 0.5); arm.lookAt(0, y0 + H + 0.03, 0); arm.rotateX(Math.PI / 2); g.add(arm);
  const head = new THREE.Mesh(new RoundedBoxGeometry(0.052, 0.006, 0.02, 3, 0.002), armMat); head.position.set(0, y0 + H + 0.03, 0); head.castShadow = true; g.add(head);
  const ledStrip = new THREE.Mesh(new THREE.PlaneGeometry(0.044, 0.012), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.7, 2.0) })); ledStrip.rotation.x = Math.PI / 2; ledStrip.position.set(0, y0 + H + 0.0265, 0); g.add(ledStrip);
  const lidLight = new THREE.PointLight(0xdff2ff, 0.3, 0.6, 2); lidLight.position.set(0, y0 + H + 0.022, 0); g.add(lidLight);
  const beam = new THREE.SpotLight(0xe6f4ff, 0.6, 0.5, 0.66, 0.6, 2); beam.position.set(0, y0 + H + 0.026, 0); beam.target.position.set(0, y0, 0); beam.castShadow = true; beam.shadow.mapSize.set(1024, 1024); beam.shadow.camera.near = 0.01; beam.shadow.camera.far = 0.4; beam.shadow.bias = -0.00015; beam.shadow.normalBias = 0.0006; beam.shadow.radius = 3; g.add(beam); g.add(beam.target);
  // water surface: rippling, refractive
  const surfGeo = new THREE.PlaneGeometry(W - 0.008, D - 0.008, 26, 26); surfGeo.rotateX(-Math.PI / 2);
  const surfMat = new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.03, metalness: 0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, envMapIntensity: 1.2, specularIntensity: 1, ior: 1.33, depthWrite: false });
  const surface = new THREE.Mesh(surfGeo, surfMat); surface.position.y = y0 + waterH; surface.renderOrder = 25; g.add(surface);
  const surfBase = surfGeo.attributes.position.array.slice();
  // substrate: scanned river-pebble PBR set on a gently mounded, finely tessellated bed; a few blue glass gems on top
  const gH = (x, z) => 0.0035 * Math.max(0, 1 - Math.hypot(x + 0.02, z + 0.015) / 0.05) + 0.0015 * Math.sin(x * 120) * Math.cos(z * 100);
  const gravGeo = new THREE.PlaneGeometry(W - 0.007, D - 0.007, 96, 96); gravGeo.rotateX(-Math.PI / 2); { const p = gravGeo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, gH(p.getX(i), p.getZ(i))); gravGeo.computeVertexNormals(); }
  const grep = [1.6, 1.6]; const gravArm = tex('dry_river_pebbles_arm.webp', false, grep);
  const gravel = new THREE.Mesh(gravGeo, water.inject(new THREE.MeshStandardMaterial({ map: tex('dry_river_pebbles_diff.webp', true, grep), normalMap: tex('dry_river_pebbles_nor_gl.webp', false, grep), normalScale: new THREE.Vector2(1, 1), aoMap: gravArm, roughnessMap: gravArm, metalnessMap: gravArm, displacementMap: tex('dry_river_pebbles_disp.webp', false, grep), displacementScale: 0.004, displacementBias: -0.002, color: 0xb8ab98, roughness: 1, metalness: 0 })));
  gravel.position.y = y0 + 0.004; gravel.receiveShadow = true; g.add(gravel); const gravelY = (x, z) => y0 + 0.006 + gH(x, z);
  const gemMat = water.inject(new THREE.MeshPhysicalMaterial({ color: 0x2f6fe8, roughness: 0.08, transmission: 0.55, thickness: 0.006, ior: 1.5, clearcoat: 1 }));
  for (let i = 0; i < 5; i++) { const gx = (Math.random() - 0.5) * (W - 0.03), gz = (Math.random() - 0.5) * (D - 0.03); const gm = new THREE.Mesh(new THREE.SphereGeometry(0.0028 + Math.random() * 0.0015, 12, 8), gemMat); gm.scale.set(1, 0.55, 0.85); gm.position.set(gx, gravelY(gx, gz), gz); gm.rotation.set(Math.random() * 0.6, Math.random() * 3, Math.random() * 0.6); gm.castShadow = true; g.add(gm); }
  // decor (scanned, CC0): driftwood branch, an anthurium standing in for anubias, quartz stones, a small shell. Loaded async.
  const plant = new THREE.Group(); g.add(plant); const decor = [];
  const loaded = Promise.all([loadGLB('dead_quiver_branch_01.glb'), loadGLB('anthurium_botany_01.glb'), loadGLB('namaqualand_stones_01.glb'), loadGLB('lambis_shell.glb')]).then(([branch, anth, stones, shell]) => {
    const sub = (mm) => { mm.envMapIntensity = 0.5; water.inject(mm); };
    const wood = placeGLB(branch, { scale: [0.19, 0.19, 0.19], rotX: 1.05, rotY: 0.6, rotZ: 0.25, x: -0.008, z: -0.012, floorY: gravelY(-0.008, -0.012), sink: 0.004, material: (mm) => { mm.color.set(0x8a6a4c); mm.roughness = 0.9; sub(mm); } }); g.add(wood); decor.push(wood);
    const leaf = placeGLB(anth, { scale: [0.03, 0.05, 0.03], rotY: 0.9, x: -0.03, z: -0.02, floorY: gravelY(-0.03, -0.02), sink: 0.002, material: (mm) => { mm.color.set(0x7fb55a); mm.roughness = 0.6; mm.side = THREE.DoubleSide; sub(mm); } }); plant.add(leaf); decor.push(leaf);
    const leaf2 = placeGLB(anth, { scale: [0.02, 0.034, 0.02], rotY: 2.6, x: 0.035, z: -0.03, floorY: gravelY(0.035, -0.03), sink: 0.002, material: (mm) => { mm.color.set(0x6ea34e); mm.roughness = 0.6; mm.side = THREE.DoubleSide; sub(mm); } }); plant.add(leaf2); decor.push(leaf2);
    const st = placeGLB(stones, { scale: [0.11, 0.13, 0.13], rotY: -0.55, x: 0.02, z: 0.02, floorY: gravelY(0.02, 0.02), sink: 0.003, material: (mm) => { mm.roughness = 0.7; sub(mm); } }); g.add(st); decor.push(st);
    const sh = placeGLB(shell, { scale: [0.2, 0.2, 0.2], rotY: 1.4, rotX: 0.1, x: -0.035, z: 0.03, floorY: gravelY(-0.035, 0.03), sink: 0.001, material: (mm) => sub(mm) }); g.add(sh); decor.push(sh);
    return true; }).catch((e) => { console.warn('tank assets', e); return false; });
  // equipment: a small glass heater on the back-left glass (coil, black cap with a red indicator, two suction cups, cable over the rim)
  const eqBlack = water.inject(new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.25 }), { caustic: false });
  const tube = water.inject(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transmission: 0.92, thickness: 0.004, ior: 1.5, transparent: true, depthWrite: false }), { caustic: false });
  const hx = -W / 2 + 0.013, hz = -D / 2 + 0.0085, hy0 = y0 + 0.03, hL = 0.07;
  const heater = new THREE.Group(); g.add(heater);
  const hTube = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0034, hL, 20), tube); hTube.position.set(hx, hy0 + hL / 2, hz); hTube.renderOrder = 12; heater.add(hTube);
  const coilPts = []; for (let i = 0; i <= 260; i++) { const k = i / 260, a = k * Math.PI * 2 * 26; coilPts.push(new THREE.Vector3(hx + Math.cos(a) * 0.0021, hy0 + 0.006 + k * (hL - 0.02), hz + Math.sin(a) * 0.0021)); }
  const coil = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPts), 520, 0.00035, 5), water.inject(new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.6, metalness: 0.3 }), { caustic: false })); heater.add(coil);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, hL - 0.024, 10), water.inject(new THREE.MeshStandardMaterial({ color: 0xd8c8b0, roughness: 0.9 }), { caustic: false })); core.position.set(hx, hy0 + hL / 2 - 0.004, hz); heater.add(core);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0038, 0.016, 20), eqBlack); cap.position.set(hx, hy0 + hL + 0.006, hz); cap.castShadow = true; heater.add(cap);
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.0046, 0.0046, 0.003, 20), eqBlack); dial.position.set(hx, hy0 + hL + 0.0155, hz); heater.add(dial);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.0009, 8, 6), new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2010, emissiveIntensity: 3 })); led.position.set(hx + 0.0038, hy0 + hL + 0.008, hz + 0.0012); heater.add(led);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(hx, hy0 + hL + 0.017, hz), new THREE.Vector3(hx, y0 + H - 0.01, hz + 0.002), new THREE.Vector3(hx, y0 + H + 0.008, hz - 0.004), new THREE.Vector3(hx + 0.004, y0 + H + 0.004, hz - 0.03), new THREE.Vector3(hx + 0.01, y0 + H - 0.08, hz - 0.045)]), 40, 0.0012, 8), eqBlack); g.add(cable);
  for (const yy of [hy0 + 0.012, hy0 + hL - 0.012]) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.0028, 0.0025, 16), water.inject(new THREE.MeshPhysicalMaterial({ color: 0xdfe8ee, roughness: 0.3, transparent: true, opacity: 0.55 }), { caustic: false })); cup.rotation.x = -Math.PI / 2; cup.position.set(hx, yy, hz - 0.0025); heater.add(cup);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.006, 0.006), eqBlack); arm.position.set(hx, yy, hz - 0.0025); heater.add(arm); }
  // stick thermometer on the right glass: painted scale, red column, bulb, suction ring
  const thTex = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 512; const x = c.getContext('2d'); x.fillStyle = '#f4f2ea'; x.fillRect(0, 0, 128, 512);
    x.fillStyle = '#d8231c'; x.fillRect(48, 150, 22, 340); x.fillStyle = '#e9e9e9'; x.fillRect(48, 40, 22, 110);
    x.fillStyle = '#222'; for (let i = 0; i < 26; i++) { const yy = 60 + i * 16; x.fillRect(72, yy, i % 5 === 0 ? 30 : 16, 2); x.fillRect(i % 5 === 0 ? 14 : 30, yy, i % 5 === 0 ? 30 : 16, 2); }
    x.font = 'bold 22px sans-serif'; x.textAlign = 'right'; for (let i = 0; i < 6; i++) x.fillText(String(35 - i * 5), 44, 68 + i * 80); x.fillStyle = '#2a7dd0'; x.fillRect(8, 300, 112, 18); x.fillStyle = '#fff'; x.font = 'bold 14px sans-serif'; x.textAlign = 'center'; x.fillText('°C', 64, 314);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const tx = W / 2 - 0.0085, tz = 0.018, ty0 = y0 + 0.045, tL = 0.05;
  const thermo = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, tL, 24), water.inject(new THREE.MeshPhysicalMaterial({ map: thTex, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }), { caustic: false })); thermo.position.set(tx, ty0 + tL / 2, tz); thermo.rotation.y = -Math.PI / 2 - 0.3; thermo.castShadow = true; g.add(thermo);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 16, 12), water.inject(new THREE.MeshPhysicalMaterial({ color: 0xd8231c, roughness: 0.1, clearcoat: 1 }), { caustic: false })); bulb.position.set(tx, ty0 - 0.001, tz); g.add(bulb);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0026, 0.0008, 8, 20), eqBlack); ring.rotation.x = Math.PI / 2; ring.position.set(tx, ty0 + tL - 0.006, tz); g.add(ring);
  const tcup = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0025, 0.0025, 16), water.inject(new THREE.MeshPhysicalMaterial({ color: 0xdfe8ee, roughness: 0.3, transparent: true, opacity: 0.55 }), { caustic: false })); tcup.rotation.z = Math.PI / 2; tcup.position.set(tx + 0.0045, ty0 + tL - 0.006, tz); g.add(tcup);
  const tarm = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.0016, 0.0016), eqBlack); tarm.position.set(tx + 0.0025, ty0 + tL - 0.006, tz); g.add(tarm);
  // bubbles from an air stone in the back-right corner
  const bubN = 22; const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, envMapIntensity: 1.0, depthWrite: false }), bubN);
  bubbles.renderOrder = 20; const bub = []; for (let i = 0; i < bubN; i++) bub.push({ x: 0, y: y0 + Math.random() * waterH, z: 0, r: rnd(0.0005, 0.0012), ph: Math.random() * 6.28, v: rnd(0.045, 0.08) }); g.add(bubbles);
  const fx = new SplashFX(g, y0 + waterH, 30);
  g.userData = { y0, waterH, surface, surfBase, lidLight, plant, bubbles, bub, glass, tintBack, baseH, baseW, fx, loaded, led };
  scene.add(g); return g;
}
/* ---------- scene / renderer / post ---------- */
export const TankGL = (() => {
  const view = { zoom: 1, px: 0, py: 0 }; let lastW = 0, lastH = 0, land = false;
  let renderer, scene, camera, composer, bloom, tank, clock, betta, tetras = [], swimmers = [], school = [], ready = false, loaded = false, tSim = 0, nextJump = 20;
  const wind = { x: 0, z: 0, vx: 0, vz: 0, tx: 0, tz: 0, slosh: 0 }; const tiltBase = { g: null, b: null };
  function init(el) {
    renderer = new THREE.WebGLRenderer({ canvas: el, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x0c0a09);
    const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(livingRoomEnv(), 0.04).texture; scene.environmentIntensity = 0.55; pmrem.dispose();
    camera = new THREE.PerspectiveCamera(30, 1, 0.02, 20);
    buildRoom(scene); tank = buildTank(scene); tank.userData.loaded.then((ok) => { loaded = ok; }); clock = makeDotClock(tank.userData.baseH * 0.8); clock.mesh.position.set(0, tank.userData.baseH * 0.5, tank.userData.baseW / 2 + 0.0006); tank.add(clock.mesh);
    scene.add(new THREE.AmbientLight(0xffe9d2, 0.05)); scene.add(new THREE.HemisphereLight(0x9fb8d0, 0x3a2c22, 0.22));
    const lamp = new THREE.SpotLight(0xffdcb8, 1.7, 5, 0.55, 0.7, 2); lamp.position.set(-0.9, 1.05, 0.55); lamp.target.position.set(0.05, 0.05, 0); lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.camera.near = 0.3; lamp.shadow.camera.far = 3; lamp.shadow.bias = -0.0004; lamp.shadow.normalBias = 0.002; lamp.shadow.radius = 4; scene.add(lamp); scene.add(lamp.target);      // warm floor lamp, like the photo
    const fill = new THREE.PointLight(0x9fb8ff, 0.18, 3, 2); fill.position.set(0.7, 0.4, 0.5); scene.add(fill);
    // fish
    const { y0, waterH } = tank.userData; const W = TANK.W, D = TANK.D;
    const bounds = new THREE.Box3(new THREE.Vector3(-W / 2 + 0.04, y0 + 0.04, -D / 2 + 0.04), new THREE.Vector3(W / 2 - 0.04, y0 + waterH - 0.03, D / 2 - 0.04));
    betta = water.submerge(makeBetta(0.046, vivid('#4f8cff'), vivid('#ff5fb0')), { caustic: false }); tank.add(betta);
    swimmers.push(new Swimmer(betta, bounds, { cruise: 0.024, turn: 1.7, accel: 0.9, bank: 0.3, beat: 5.5, hoverP: 0.25, surfaceY: y0 + waterH }));
    const tb = new THREE.Box3(new THREE.Vector3(-W / 2 + 0.014, y0 + 0.02, -D / 2 + 0.014), new THREE.Vector3(W / 2 - 0.014, y0 + waterH - 0.015, D / 2 - 0.014));
    for (let i = 0; i < 6; i++) { const tt = water.submerge(makeTetra(0.019), { caustic: false }); tank.add(tt); tetras.push(tt); school.push(new Swimmer(tt, tb, { cruise: 0.04, turn: 5, accel: 3, bank: 0.3, beat: 13, hoverP: 0.08, dartP: 0.12, surfaceY: y0 + waterH })); }
    composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(scene, camera));
    bloom = new BloomEffect({ luminanceThreshold: 1.0, luminanceSmoothing: 0.15, intensity: 0.3, mipmapBlur: true, radius: 0.5, levels: 5, resolutionScale: 0.5 });
    const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.OVERLAY }); grain.blendMode.opacity.value = 0.04;
    composer.addPass(new EffectPass(camera, bloom, grain, new VignetteEffect({ offset: 0.3, darkness: 0.5 }), new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })));
    ready = true; return true;
  }
  function setView(zoom, px, py) { view.zoom = clamp(zoom, 0.5, 3); view.px = clamp(px, -1, 1); view.py = clamp(py, -1, 1); if (ready) frame(); return { ...view }; }
  let qScale = 1, slowFrames = 0;
  function applySize() { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * qScale); renderer.setSize(lastW, lastH, false); composer.setSize(lastW, lastH); }
  function resize(w, h) { if (!ready) return; if (w !== lastW || h !== lastH) { qScale = 1; slowFrames = 0; } lastW = w; lastH = h; applySize(); frame(); }
  // adaptive quality: only ever steps DOWN (max twice, after 2 s of sustained slow frames). Reallocating the framebuffer
  // flashes black on iOS, so this must never oscillate; a real resize/orientation change resets it.
  function adapt(dt) { if (dt > 1 / 36) slowFrames++; else slowFrames = Math.max(0, slowFrames - 2);
    if (slowFrames > 120 && qScale > 0.7) { qScale = Math.max(0.7, qScale - 0.15); slowFrames = 0; applySize(); } }
  function frame() {
    const w = lastW, h = lastH; camera.aspect = w / h; land = w > h;
    const totalH = TANK.baseH + TANK.H + 0.06, totalW = TANK.baseW;
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
    const U = tank.userData, sp = U.surface.geometry.attributes.position, base = U.surfBase, amp = 0.0006 + wind.slosh * 0.004; U.fx.update(sdt); const fxOn = U.fx.active;
    // jumps: rare, and never two at once
    nextJump -= sdt; if (nextJump < 0) { nextJump = rnd(28, 70); const cand = Math.random() < 0.45 ? swimmers[0] : school[(Math.random() * school.length) | 0]; if (![...swimmers, ...school].some(s => s.state !== 'swim')) cand.startJump(); }
    for (let i = 0; i < sp.count; i++) { const x = base[i * 3], z = base[i * 3 + 2];
      let y = Math.sin(x * 140 + t * 2.1) * amp * 0.6 + Math.sin(z * 120 - t * 1.7 + x * 40) * amp * 0.5 + Math.sin((x + z) * 90 + t * 3.1) * amp * 0.35 + (x * wind.x + z * wind.z) * 0.25;
      if (fxOn) y += U.fx.height(x, z);
      sp.setY(i, y); }
    sp.needsUpdate = true; U.surface.geometry.computeVertexNormals();
    // lid light breathes very slightly (LED driver), caustics follow
    U.lidLight.intensity = 0.3 * (0.96 + 0.04 * pink(t * 0.5, 3)) * (1 + bass * 0.25); water.u.uCaus.value = 0.45 + wind.slosh * 0.6 + bass * 0.2;
    U.led.material.emissiveIntensity = (t % 74) < 31 ? 3 : 0.0; U.plant.rotation.z = 0.04 * Math.sin(t * 0.7) + wind.x * 0.15; U.plant.rotation.x = 0.03 * Math.sin(t * 0.55 + 1) + wind.z * 0.15;
    // fish
    flowV.set(wind.x * 0.02, 0, wind.z * 0.02);
    for (const s of swimmers) s.update(sdt, t, flowV, null, U.fx); for (const s of school) s.update(sdt, t, flowV, school, U.fx);
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
  return { init, resize, setColors, render, motion, tilt, setView, getView: () => ({ ...view }), get ready() { return ready; }, get loaded() { return loaded; }, jump(i = 0) { (i === 0 ? swimmers[0] : school[i - 1]).startJump(); }, __state() { return swimmers[0].state; } };
})();
window.TankGL = TankGL;
