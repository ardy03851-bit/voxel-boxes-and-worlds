/* Project Genie — Scene Studio · render engine
   Three.js r180 · WebGL2 · PBR · ACES · bloom · filmic grade */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ── noise / rng ─────────────────────────────────────────────── */
function mulberry32(seed){ let a = seed >>> 0; return function(){ a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash3(x, y, z){ const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123; return s - Math.floor(s); }
const sstep = t => t * t * (3 - 2 * t);
function vnoise3(x, y, z){
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = sstep(xf), v = sstep(yf), w = sstep(zf);
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp( lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    lerp( lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w);
}
function fbm3(x, y, z, oct = 4){ let a = 0.5, f = 1, sum = 0, norm = 0; for (let i = 0; i < oct; i++){ sum += a * vnoise3(x * f, y * f, z * f); norm += a; a *= 0.5; f *= 2.03; } return sum / norm; }

/* ── filmic grade pass (saturation · contrast · temperature · fade · vignette · grain) ── */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 0.06 }, contrast: { value: 0.08 }, temperature: { value: 0 },
    fade: { value: 0 }, vignette: { value: 0.32 }, grain: { value: 0.05 }, time: { value: 0 }
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation, contrast, temperature, fade, vignette, grain, time;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + time * 61.7) * 43758.5453); }
    void main(){
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 col = tex.rgb;
      col.r += temperature * 0.13; col.b -= temperature * 0.13; col = max(col, 0.0);
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(luma) * 1.04 + vec3(0.052, 0.046, 0.04), clamp(fade, 0.0, 1.0));
      col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 1.0 + saturation);
      col = (col - 0.5) * (1.0 + contrast) + 0.5;
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.98, 0.28, length(d) * 1.18);
      col *= mix(1.0, v, clamp(vignette, 0.0, 1.0));
      col += (hash(vUv * vec2(1920.0, 1080.0)) - 0.5) * grain * 0.32;
      gl_FragColor = vec4(max(col, 0.0), tex.a);
    }`
};

const DEFAULT_ENV = {
  sky: true, elevation: 14, azimuth: 205, turbidity: 8, rayleigh: 2.2, sunIntensity: 2.4,
  fog: { on: true, color: '#b8c4cc', near: 30, far: 140 },
  hemi: 0.55, exposure: 0.95,
  bloom: { strength: 0.32, radius: 0.65, threshold: 0.82 },
  grade: { saturation: 0.06, contrast: 0.08, temperature: 0, fade: 0, vignette: 0.32, grain: 0.05 },
  background: '#060608', grid: true, ground: true, shadows: true
};

export const ENV_PRESETS = {
  golden:   { sky:true, elevation:9,  azimuth:205, turbidity:6,  rayleigh:3.0, sunIntensity:2.8, fog:{on:true, color:'#d9b48a', near:25, far:125}, hemi:0.42, exposure:0.95, bloom:{strength:0.38, radius:0.6, threshold:0.8}, grade:{saturation:0.12, contrast:0.10, temperature:0.35, fade:0.05, vignette:0.38, grain:0.08}, background:'#1a120c', grid:true, ground:true, shadows:true },
  day:      { sky:true, elevation:55, azimuth:140, turbidity:4,  rayleigh:1.6, sunIntensity:3.2, fog:{on:false, color:'#b8c4cc', near:30, far:140}, hemi:0.78, exposure:1.0,  bloom:{strength:0.16, radius:0.5, threshold:0.9}, grade:{saturation:0.05, contrast:0.05, temperature:0.0, fade:0.0, vignette:0.2, grain:0.02}, background:'#060608', grid:true, ground:true, shadows:true },
  noir:     { sky:true, elevation:22, azimuth:285, turbidity:10, rayleigh:0.6, sunIntensity:2.6, fog:{on:true, color:'#9a9a9a', near:20, far:95},  hemi:0.22, exposure:0.85, bloom:{strength:0.3,  radius:0.55, threshold:0.75}, grade:{saturation:-1,  contrast:0.38, temperature:0.0, fade:0.08, vignette:0.6, grain:0.3}, background:'#0a0a0a', grid:true, ground:true, shadows:true },
  midnight: { sky:true, elevation:7,  azimuth:30,  turbidity:12, rayleigh:0.3, sunIntensity:1.1, fog:{on:true, color:'#1c2742', near:18, far:110}, hemi:0.16, exposure:0.75, bloom:{strength:0.55, radius:0.7, threshold:0.6}, grade:{saturation:-0.2,contrast:0.15, temperature:-0.3,fade:0.0, vignette:0.55, grain:0.12}, background:'#05070f', grid:true, ground:true, shadows:true },
  overcast: { sky:true, elevation:48, azimuth:95,  turbidity:14, rayleigh:0.8, sunIntensity:1.6, fog:{on:true, color:'#b9c0c6', near:35, far:165}, hemi:0.9,  exposure:0.9,  bloom:{strength:0.08, radius:0.5, threshold:0.9}, grade:{saturation:-0.14,contrast:-0.02,temperature:0.0, fade:0.04, vignette:0.2, grain:0.03}, background:'#101216', grid:true, ground:true, shadows:true },
  dawn:     { sky:true, elevation:5,  azimuth:60,  turbidity:7,  rayleigh:3.6, sunIntensity:2.0, fog:{on:true, color:'#c9a9b8', near:22, far:120}, hemi:0.4,  exposure:0.9,  bloom:{strength:0.42, radius:0.65, threshold:0.75}, grade:{saturation:0.15, contrast:0.08, temperature:0.22,fade:0.05, vignette:0.4, grain:0.07}, background:'#171020', grid:true, ground:true, shadows:true }
};

const FILTER_GRADES = {
  none:   null,
  noir:   { saturation:-1, contrast:0.32, temperature:0, fade:0.1, vignette:0.55, grain:0.32 },
  golden: { saturation:0.18, contrast:0.1, temperature:0.45, fade:0.06, vignette:0.4, grain:0.06 },
  teal:   { saturation:0.12, contrast:0.2, temperature:-0.18, fade:0.02, vignette:0.34, grain:0.05 },
  fade:   { saturation:-0.3, contrast:-0.18, temperature:0.08, fade:0.5, vignette:0.25, grain:0.1 },
  vivid:  { saturation:0.5, contrast:0.18, temperature:0, fade:0, vignette:0.28, grain:0.02 }
};

export class Engine {
  constructor(container) {
    this.container = container;
    this.onSelectionChange = () => {};
    this.onTransformEnd = () => {};
    this.onSceneDirty = () => {};
    this.env = JSON.parse(JSON.stringify(DEFAULT_ENV));
    this._quality = 'balanced';
    this._fpsEma = 60; this._fpsLast = 0; this._baseGrade = null; this._activeFilter = null;

    this.scene = new THREE.Scene();
    this._defaultEnv = null;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    this.camera.position.set(9.5, 6.2, 11.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.env.exposure;
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    /* environment reflections (studio room → crisp PBR highlights) */
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this._defaultEnv = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
    this.scene.environment = this._defaultEnv;
    pmrem.dispose();

    /* world group — everything user content lives here (clean export root) */
    this.world = new THREE.Group();
    this.world.name = 'World';
    this.scene.add(this.world);

    /* procedural sky */
    this.sky = new Sky();
    this.sky.scale.setScalar(1200);
    this.scene.add(this.sky);

    /* sun (key light) */
    this.sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 160;
    const sc = 34;
    this.sun.shadow.camera.left = -sc; this.sun.shadow.camera.right = sc;
    this.sun.shadow.camera.top = sc; this.sun.shadow.camera.bottom = -sc;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    /* hemisphere ambience */
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a3128, 0.55);
    this.scene.add(this.hemi);

    /* cool fill from opposite key — lifts shadows, keeps blacks rich */
    this.fill = new THREE.DirectionalLight(0xa8c4ff, 0.35);
    this.fill.position.set(-24, 14, -18);
    this.scene.add(this.fill);

    /* ground shadow catcher + gradient disc */
    this.ground = this._makeGround();
    this.scene.add(this.ground);
    this.grid = new THREE.GridHelper(72, 72, 0x4a4a52, 0x232327);
    this.grid.material.transparent = true; this.grid.material.opacity = 0.5;
    this.grid.position.y = 0.002;
    this.scene.add(this.grid);

    /* controls */
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxDistance = 400; this.controls.minDistance = 0.4;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.target.set(0, 1.1, 0);
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    /* transform gizmo */
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.82);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (!e.value && this.selected) this.onTransformEnd(this.selected);
    });
    this.gizmo.addEventListener('objectChange', () => { this._updateSelBox(); this.onSceneDirty(); });
    this.scene.add(this.gizmo.getHelper());

    /* selection box */
    this.selBox = null;

    /* post-processing composer */
    const size = container.getBoundingClientRect();
    const rt = new THREE.WebGLRenderTarget(Math.max(2, size.width), Math.max(2, size.height), { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), this.env.bloom.strength, this.env.bloom.radius, this.env.bloom.threshold);
    this.composer.addPass(this.bloom);
    this.gradePass = new ShaderPass(GradeShader);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());

    /* picking */
    this.raycaster = new THREE.Raycaster();
    this.pointerDown = null;
    this.renderer.domElement.addEventListener('pointerdown', (e) => { this.pointerDown = { x: e.clientX, y: e.clientY }; });
    this.renderer.domElement.addEventListener('pointerup', (e) => this._handlePick(e));

    this.selected = null;
    this.clock = new THREE.Clock();
    this._resizeObs = new ResizeObserver(() => this._resize());
    this._resizeObs.observe(container);
    this._resize();
    this.applyEnvironment(this.env);
    this._animate = this._animate.bind(this);
    this._raf = requestAnimationFrame(this._animate);
  }

  /* ──────────────────────────────────────────── ground */
  _makeGround() {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(256, 256, 20, 256, 256, 256);
    g.addColorStop(0, 'rgba(19,19,23,1)'); g.addColorStop(0.62, 'rgba(15,15,18,0.96)'); g.addColorStop(1, 'rgba(10,10,12,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.96, metalness: 0.02, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(38, 64), mat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = -0.001; mesh.receiveShadow = true;
    mesh.userData.noExport = true; mesh.userData.noPick = true;
    return mesh;
  }

  /* ──────────────────────────────────────────── env / sky */
  setEnvironmentTexture(tex) { this.scene.environment = tex || this._defaultEnv; }
  getEnvironment() { return JSON.parse(JSON.stringify(this.env)); }
  setEnvironment(env) { this.applyEnvironment(env); }
  getCameraState() { return { position: this.camera.position.toArray(), target: this.controls.target.toArray(), fov: this.camera.fov }; }
  setCameraState(s) { if (!s) return; this.camera.position.fromArray(s.position); this.controls.target.fromArray(s.target); this.camera.fov = s.fov ?? 45; this.camera.updateProjectionMatrix(); }
  surfaceHeightAt(x, z, exclude = null) {
    const targets = this.world.children.filter(c => c !== exclude);
    this.raycaster.set(new THREE.Vector3(x, 80, z), new THREE.Vector3(0, -1, 0));
    const hits = this.raycaster.intersectObjects([this.ground, ...targets], true);
    for (const h of hits) { if (h.object.userData.noPick) continue; return h; }
    return null;
  }
  worldObjects() { return [...this.world.children]; }
  sunDirection() {
    const phi = THREE.MathUtils.degToRad(90 - this.env.elevation);
    const theta = THREE.MathUtils.degToRad(this.env.azimuth);
    return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  }
  applyEnvironment(env) {
    this.env = JSON.parse(JSON.stringify(env));
    const e = this.env;
    const sunDir = this.sunDirection();
    this.sky.visible = e.sky;
    if (e.sky) {
      const u = this.sky.material.uniforms;
      u.turbidity.value = e.turbidity; u.rayleigh.value = e.rayleigh;
      u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.82;
      u.sunPosition.value.copy(sunDir); u.up.value.set(0, 1, 0);
    }
    this.scene.background = e.sky ? null : new THREE.Color(e.background);
    this.sun.position.copy(sunDir).multiplyScalar(70);
    this.sun.intensity = e.sunIntensity;
    this.sun.castShadow = e.shadows;
    this.hemi.intensity = e.hemi;
    this.grid.visible = e.grid;
    this.ground.visible = e.ground;
    this.scene.fog = e.fog.on ? new THREE.Fog(new THREE.Color(e.fog.color), e.fog.near, e.fog.far) : null;
    this.renderer.toneMappingExposure = e.exposure;
    this.bloom.strength = e.bloom.strength; this.bloom.radius = e.bloom.radius; this.bloom.threshold = e.bloom.threshold;
    this.grid.visible = e.grid;
    this._applyGrade(e.grade);
  }
  _applyGrade(g) {
    const u = this.gradePass.uniforms;
    u.saturation.value = g.saturation; u.contrast.value = g.contrast; u.temperature.value = g.temperature;
    u.fade.value = g.fade; u.vignette.value = g.vignette; u.grain.value = g.grain;
  }
  setFilter(name) {
    this._activeFilter = name;
    const f = FILTER_GRADES[name];
    this._applyGrade(f ? { ...this.env.grade, ...f } : this.env.grade);
  }
  applyPreset(name) {
    const p = ENV_PRESETS[name]; if (!p) return null;
    this.applyEnvironment(JSON.parse(JSON.stringify(p)));
    return this.env;
  }
  setQuality(q) {
    this._quality = q;
    const dpr = window.devicePixelRatio || 1;
    if (q === 'performance') { this.renderer.setPixelRatio(1); this.sun.shadow.mapSize.set(1024, 1024); }
    else if (q === 'balanced') { this.renderer.setPixelRatio(Math.min(dpr, 1.6)); this.sun.shadow.mapSize.set(2048, 2048); }
    else { this.renderer.setPixelRatio(Math.min(dpr, 2)); this.sun.shadow.mapSize.set(4096, 4096); }
    this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    this._resize();
  }

  /* ──────────────────────────────────────────── primitives & procedural builders */
  _mat(opts = {}) {
    return new THREE.MeshStandardMaterial(Object.assign({ color: 0xd8d8dc, metalness: 0.05, roughness: 0.55, envMapIntensity: 1.0 }, opts));
  }
  buildPrimitive(kind, params = {}) {
    let geo;
    switch (kind) {
      case 'box': geo = new THREE.BoxGeometry(1.6, 1.6, 1.6); break;
      case 'sphere': geo = new THREE.SphereGeometry(1.1, 48, 32); break;
      case 'cylinder': geo = new THREE.CylinderGeometry(0.9, 0.9, 1.9, 48, 1); break;
      case 'cone': geo = new THREE.ConeGeometry(1.05, 2.1, 48); break;
      case 'capsule': geo = new THREE.CapsuleGeometry(0.75, 1.3, 8, 24); break;
      case 'torus': geo = new THREE.TorusGeometry(1.05, 0.38, 28, 64); break;
      case 'plane': geo = new THREE.PlaneGeometry(3.2, 3.2, 1, 1); break;
      case 'disc': geo = new THREE.CircleGeometry(1.5, 48); break;
      case 'knot': geo = new THREE.TorusKnotGeometry(0.85, 0.28, 220, 36, 2, 3); break;
      case 'monolith': geo = new THREE.BoxGeometry(1.5, 4.8, 0.85); break;
      default: geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    }
    const mesh = new THREE.Mesh(geo, this._mat(params.material || {}));
    this._prepMesh(mesh);
    return mesh;
  }
  buildRock(params = {}) {
    const seed = params.seed ?? Math.floor(Math.random() * 1e9);
    const geo = new THREE.IcosahedronGeometry(1.2, 3);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = fbm3(v.x * 1.35 + seed * 0.013, v.y * 1.35, v.z * 1.35, 4);
      const d = 1 + (n - 0.5) * 0.72;
      v.multiplyScalar(d);
      pos.setXYZ(i, v.x, v.y * 0.82, v.z);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this._mat({ color: 0x8f8f96, roughness: 0.93, metalness: 0.02, flatShading: true, ...(params.material || {}) }));
    this._prepMesh(mesh);
    return mesh;
  }
  buildPine(params = {}) {
    const green = new THREE.MeshStandardMaterial({ color: 0x22402a, roughness: 0.85, metalness: 0.0, flatShading: true });
    const bark = new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 0.95 });
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.1, 0.17, 0.9, 8); trunk.translate(0, 0.45, 0); parts.push({ g: trunk, m: bark });
    const tiers = [ [0.95, 1.15, 1.15], [0.72, 0.95, 1.85], [0.46, 0.8, 2.5] ];
    for (const [r, h, y] of tiers) { const cone = new THREE.ConeGeometry(r, h, 9); cone.translate(0, y, 0); parts.push({ g: cone, m: green }); }
    const group = new THREE.Group();
    for (const p of parts) { const m = new THREE.Mesh(p.g, p.m); this._prepMesh(m); group.add(m); }
    if (params.material) group.traverse(o => { if (o.isMesh) o.material.color.set(params.material.color); });
    return group;
  }
  buildLandscape(params = {}) {
    const size = params.size ?? 56, seg = 110, amp = params.amplitude ?? 2.6, seed = params.seed ?? 7;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(0x2e4632), mid = new THREE.Color(0x5c6058), high = new THREE.Color(0xd9d9de);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n = fbm3(x * 0.075 + seed * 0.31, 0, z * 0.075 + seed * 0.17, 5);
      const ridge = 1 - Math.abs(2 * fbm3(x * 0.045 + 31, 0, z * 0.045 + 17, 4) - 1);
      const h = Math.max(0, (n - 0.36)) * amp * 2 + Math.pow(ridge, 3) * amp * 0.8 - 0.6;
      pos.setY(i, h);
      const t = THREE.MathUtils.clamp((h + 0.6) / (amp * 2.4), 0, 1);
      if (t < 0.45) tmp.lerpColors(low, mid, t / 0.45); else tmp.lerpColors(mid, high, (t - 0.45) / 0.55);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0.02, flatShading: !!params.flatShading }));
    mesh.receiveShadow = true; mesh.castShadow = true;
    return mesh;
  }
  buildWater() {
    const geo = new THREE.CircleGeometry(320, 64);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x10222e, metalness: 0.05, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.06, transparent: true, opacity: 0.97, envMapIntensity: 1.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = -0.4;
    mesh.userData.noPick = false;
    return mesh;
  }
  buildLight(kind, opts = {}) {
    if (kind === 'sun') { const l = new THREE.DirectionalLight(opts.color ?? 0xfff1dc, opts.intensity ?? 2.2); l.position.set(opts.x ?? 10, opts.y ?? 14, opts.z ?? 6); l.castShadow = true; l.shadow.mapSize.set(2048, 2048); const s = 24; Object.assign(l.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 80 }); l.shadow.bias = -0.0004; return this._lightRoot(l, 'sun'); }
    if (kind === 'point') { const l = new THREE.PointLight(opts.color ?? 0xffd9a0, opts.intensity ?? 42, opts.distance ?? 0, 2); l.position.set(opts.x ?? 2, opts.y ?? 3, opts.z ?? 2); l.castShadow = true; l.shadow.mapSize.set(1024, 1024); return this._lightRoot(l, 'point'); }
    if (kind === 'spot') { const l = new THREE.SpotLight(opts.color ?? 0xffffff, opts.intensity ?? 90, opts.distance ?? 0, opts.angle ?? 0.42, opts.penumbra ?? 0.45, 2); l.position.set(opts.x ?? 3, opts.y ?? 6, opts.z ?? 3); l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.0003; const root = this._lightRoot(l, 'spot'); root.add(l.target); l.target.position.set(0, 1.5, 0).sub(root.position); return root; }
    if (kind === 'hemi') { const l = new THREE.HemisphereLight(opts.skyColor ?? 0xcfe8ff, opts.groundColor ?? 0x3a3128, opts.intensity ?? 0.6); return this._lightRoot(l, 'hemi'); }
    return this._lightRoot(new THREE.PointLight(0xffffff, 30), 'point');
  }
  _lightRoot(light, kind, fromOpts) {
    const g = new THREE.Group();
    const px = light.position.x, py = light.position.y, pz = light.position.z;
    g.add(light);
    light.position.set(0, 0, 0);
    if (kind !== 'hemi') g.position.set(px || 4, py > 0 ? py : 6, pz || 4);
    else g.position.set(0, 6, 0);
    /* visible proxy glyph so lights can be picked */
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color: kind === 'spot' ? 0xfff2b0 : kind === 'point' ? 0xffd9a0 : kind === 'sun' ? 0xffffff : 0xcfe8ff, transparent: true, opacity: 0.9, depthTest: false }));
    proxy.renderOrder = 50; proxy.userData.isLightProxy = true; proxy.castShadow = false; proxy.receiveShadow = false;
    g.add(proxy);
    g.userData.lightKind = kind; g.userData.light = light;
    return g;
  }
  _prepMesh(mesh) { mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }

  /* ──────────────────────────────────────────── object lifecycle */
  addObject(obj, { select = true, pushUndo = true } = {}) {
    obj.userData.selectable = true;
    this.world.add(obj);
    obj.traverse(o => { if (o.isMesh) { o.castShadow = o.userData.noPick ? o.castShadow : true; o.receiveShadow = true; } });
    if (select) this.select(obj);
    if (pushUndo) this.onTransformEnd(obj); // triggers pushUndo upstream
    return obj;
  }
  deleteSelected() {
    const t = this.selected; if (!t) return false;
    this.world.remove(t);
    this._disposeTree(t);
    this.select(null);
    return true;
  }
  duplicateSelected() {
    const t = this.selected; if (!t) return null;
    if (t.userData.lightKind) { /* rebuild light cleanly instead of cloning broken refs */
      const light = t.userData.light;
      const kind = t.userData.lightKind;
      const copy = this.buildLight(kind, { color: light.color?.getHex?.() ?? 0xffffff, intensity: light.intensity, distance: light.distance, angle: light.angle, penumbra: light.penumbra, x: t.position.x + 1.5, y: t.position.y, z: t.position.z + 1.5 });
      copy.name = (t.name || kind) + ' copy';
      this.world.add(copy);
      this.select(copy);
      return copy;
    }
    const clone = t.clone(true);
    clone.traverse(o => {
      if (o.isMesh) {
        o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      }
    });
    clone.position.x += 1.25; clone.position.z += 0.75;
    this.world.add(clone);
    this.select(clone);
    return clone;
  }
  _disposeTree(root) {
    root.traverse(o => {
      if (!o.isMesh) return;
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m && m.dispose());
    });
  }
  selectableRoot(obj) {
    let o = obj;
    while (o && o.parent && o.parent !== this.world) o = o.parent;
    return (o && o.parent === this.world) ? o : null;
  }
  _handlePick(e) {
    if (!this.pointerDown) return;
    const dx = e.clientX - this.pointerDown.x, dy = e.clientY - this.pointerDown.y;
    this.pointerDown = null;
    if (Math.hypot(dx, dy) > 6 || this.gizmo.dragging) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.world.children, true);
    for (const h of hits) {
      let o = h.object;
      if (o.userData.noPick) continue;
      const root = this.selectableRoot(o);
      if (!root) continue;
      if (root.userData.locked) { continue; }
      this.select(root === this.selected ? root : root);
      return;
    }
    this.select(null);
  }
  raycastSurface(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([this.world, this.ground], true);
    for (const h of hits) {
      if (h.object.userData.noPick) continue;
      if (h.object === this.ground) return { point: h.point, object: null };
      const root = this.selectableRoot(h.object);
      return { point: h.point, object: root };
    }
    return null;
  }
  select(obj) {
    this.selected = obj || null;
    const selectMode = this._mode === 'select';
    if (obj) {
      if (selectMode) this.gizmo.detach(); else { this.gizmo.attach(obj); this.gizmo.enabled = !obj.userData.locked; }
      this._makeSelBox(obj);
    } else {
      this.gizmo.detach();
      this._clearSelBox();
    }
    this.onSelectionChange(this.selected);
  }
  _makeSelBox(obj) {
    this._clearSelBox();
    this.selBox = new THREE.BoxHelper(obj, 0xffffff);
    this.selBox.material.transparent = true; this.selBox.material.opacity = 0.85;
    this.selBox.material.depthTest = false; this.selBox.renderOrder = 999;
    this.selBox.userData.noExport = true; this.selBox.userData.noPick = true;
    this.scene.add(this.selBox);
  }
  _clearSelBox() { if (this.selBox) { this.scene.remove(this.selBox); this.selBox.geometry?.dispose(); this.selBox = null; } }
  _updateSelBox() { if (this.selBox && this.selected) { this.selBox.setFromObject(this.selected); } }

  setGizmoMode(mode) {
    if (mode === 'select') { this.gizmo.detach(); if (this.selected) this._makeSelBox(this.selected); this.gizmo.enabled = false; }
    else { this.gizmo.setMode(mode); if (this.selected) { this.gizmo.attach(this.selected); this.gizmo.enabled = !this.selected.userData.locked; if (this.selBox == null) this._makeSelBox(this.selected); } }
    this._mode = mode;
  }
  setSnap(on, size = 0.5) {
    this.gizmo.setTranslationSnap(on ? size : null);
    this.gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
    this.gizmo.setScaleSnap(on ? 0.1 : null);
  }
  focusSelected() {
    const t = this.selected; if (!t) { this.controls.target.set(0, 1.1, 0); return; }
    const box = new THREE.Box3().setFromObject(t);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 2;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center.clone().add(dir.multiplyScalar(Math.max(2.2, size * 1.6))));
  }
  snapToGround() {
    const t = this.selected; if (!t) return;
    const box = new THREE.Box3().setFromObject(t);
    t.position.y -= box.min.y;
  }
  centerOrigin() { if (this.selected) { this.selected.position.x = 0; this.selected.position.z = 0; } }
  normalizeSize() {
    const t = this.selected; if (!t) return;
    const box = new THREE.Box3().setFromObject(t);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const s = 2 / maxDim;
    t.scale.multiplyScalar(s);
    const b2 = new THREE.Box3().setFromObject(t);
    t.position.y -= b2.min.y;
  }
  setCameraView(name) {
    const t = this.controls.target.clone();
    const d = this.camera.position.distanceTo(t);
    const set = (x, y, z) => { this.camera.position.set(t.x + x, t.y + y, t.z + z); this.camera.lookAt(t); };
    if (name === 'top') set(0, Math.max(d, 8), 0.001);
    else if (name === 'front') set(0, Math.max(2, d * 0.18), d);
    else if (name === 'right') set(d, Math.max(2, d * 0.18), 0);
    else if (name === 'orbit') { this.camera.position.set(9.5, 6.2, 11.5); this.controls.target.set(0, 1.1, 0); }
  }
  setTurntable(on) { this.controls.autoRotate = on; this.controls.autoRotateSpeed = 1.5; }

  /* ──────────────────────────────────────────── materials / textures on selection */
  eachEditableMesh(root, fn) { root.traverse(o => { if (o.isMesh && o.material && !o.userData.isLightProxy) fn(o); }); }
  snapshotMeshMaterial(mesh, texStore) {
    const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const t = (tex) => !tex ? '__cleared__' : (tex.userData && tex.userData.assetId ? { assetId: tex.userData.assetId } : '__keep__');
    return {
      color: '#' + m.color.getHexString(), metalness: m.metalness, roughness: m.roughness,
      emissive: '#' + (m.emissive ? m.emissive.getHexString() : '000000'), emissiveIntensity: m.emissiveIntensity ?? 1,
      opacity: m.opacity, transparent: m.transparent, clearcoat: m.clearcoat ?? 0,
      wireframe: m.wireframe, flatShading: m.flatShading,
      side: m.side === THREE.DoubleSide ? 2 : m.side === THREE.BackSide ? 1 : 0,
      normalScale: m.normalScale ? m.normalScale.x : 1,
      repeat: m.map ? [m.map.repeat.x, m.map.repeat.y] : [1, 1],
      offset: m.map ? [m.map.offset.x, m.map.offset.y] : [0, 0],
      maps: { map: t(m.map), normalMap: t(m.normalMap), roughnessMap: t(m.roughnessMap), metalnessMap: t(m.metalnessMap), emissiveMap: t(m.emissiveMap), aoMap: t(m.aoMap) }
    };
  }
  applyMaterialSnapshot(mesh, snap, resolveTex) {
    const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    m.color.set(snap.color); m.metalness = snap.metalness; m.roughness = snap.roughness;
    if (m.emissive) m.emissive.set(snap.emissive); m.emissiveIntensity = snap.emissiveIntensity;
    m.opacity = snap.opacity; m.transparent = snap.transparent;
    if ('clearcoat' in m) m.clearcoat = snap.clearcoat;
    m.wireframe = snap.wireframe; m.flatShading = snap.flatShading;
    m.side = snap.side === 2 ? THREE.DoubleSide : snap.side === 1 ? THREE.BackSide : THREE.FrontSide;
    if (m.normalScale) m.normalScale.set(snap.normalScale, snap.normalScale);
    const rx = snap.repeat?.[0] ?? 1, ry = snap.repeat?.[1] ?? 1, ox = snap.offset?.[0] ?? 0, oy = snap.offset?.[1] ?? 0;
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
      const ref = snap.maps?.[key];
      if (ref === '__keep__') continue;                 // leave template default untouched
      if (ref === '__cleared__' || ref == null) { m[key] = null; continue; }
      const tex = resolveTex(ref);
      if (tex) { m[key] = tex; tex.repeat.set(rx, ry); tex.offset.set(ox, oy); if (key === 'normalMap' && m.normalScale) m.normalScale.set(snap.normalScale ?? 1, snap.normalScale ?? 1); }
    }
    m.needsUpdate = true;
  }

  /* ──────────────────────────────────────────── export */
  collectExportScene() {
    const clone = this.world.clone(true);
    const kill = [];
    clone.traverse(o => { if (o.userData?.noExport || o.userData?.isLightProxy) kill.push(o); });
    kill.forEach(o => o.parent?.remove(o));
    return clone;
  }
  downloadBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  async capturePhoto({ aspect = null, filter = 'none', scale = 2 } = {}) {
    const base = FILTER_GRADES[filter];
    if (base) this._applyGrade({ ...this.env.grade, ...base });
    const cam = this.camera;
    const prevAspect = cam.aspect;
    const prevSize = new THREE.Vector2(); this.renderer.getSize(prevSize);
    const prevPR = this.renderer.getPixelRatio();
    let w, h;
    const longEdge = scale === 1 ? 1920 : scale === 2 ? 2560 : 3840;
    if (aspect && aspect !== 'free') {
      const [aw, ah] = aspect.split(':').map(Number); const ar = aw / ah;
      if (ar >= 1) { w = longEdge; h = Math.round(longEdge / ar); } else { h = longEdge; w = Math.round(longEdge * ar); }
    } else { w = prevSize.x; h = prevSize.y; }
    cam.aspect = w / h; cam.updateProjectionMatrix();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.render();
    const url = this.renderer.domElement.toDataURL('image/png');
    /* restore */
    cam.aspect = prevAspect; cam.updateProjectionMatrix();
    this.renderer.setPixelRatio(prevPR);
    this.renderer.setSize(prevSize.x, prevSize.y, false);
    this.composer.setSize(prevSize.x, prevSize.y);
    this._applyGrade(this.env.grade);
    this.composer.render();
    return url;
  }

  /* ──────────────────────────────────────────── loop / resize / stats */
  _resize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(2, Math.floor(rect.width)), h = Math.max(2, Math.floor(rect.height));
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }
  _animate() {
    this._raf = requestAnimationFrame(this._animate);
    const dt = this.clock.getDelta();
    const t = this.clock.elapsedTime;
    this._fpsEma = this._fpsEma * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    this.controls.update();
    this.gradePass.uniforms.time.value = t;
    if (this.selBox) this._updateSelBox();
    this.renderer.info.reset();
    this.composer.render();
  }
  stats() {
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, fps: this._fpsEma };
  }
  dispose() {
    cancelAnimationFrame(this._raf);
    this._resizeObs.disconnect();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
