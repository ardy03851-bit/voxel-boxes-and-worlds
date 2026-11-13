/* Project Genie — Asset Store
   Uploads (single files · ZIP archives of any size · any common 3D/texture format),
   parsing, thumbnails, and Smart Match — automatic texture↔material wiring. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const MODEL_EXT = new Set(['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp']);
const HDR_EXT = new Set(['hdr']);
const SKIP_RE = /(^|\/)(__macosx|\.ds_store|thumbs\.db)/i;

const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
const baseOf = (path) => path.split('/').pop();
const stemOf = (path) => baseOf(path).replace(/\.[^.]+$/, '');
const normPath = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');

/* token helpers for smart matching */
const ROLE_TOKENS = {
  map: ['albedo', 'basecolor', 'base_color', 'diffuse', 'diff', 'color', 'col', 'bc', 'tex', 'd'],
  normalMap: ['normal', 'normalgl', 'normaldx', 'norm', 'nor', 'nrm', 'n'],
  roughnessMap: ['roughness', 'rough', 'rgh', 'r'],
  metalnessMap: ['metallic', 'metalness', 'metal', 'mtl', 'm'],
  aoMap: ['ao', 'ambientocclusion', 'occlusion', 'occ', 'ambientocclus'],
  emissiveMap: ['emissive', 'emission', 'emiss', 'glow', 'emit', 'e']
};
const NOISE_TOKENS = new Set(['2k', '4k', '8k', '1k', '512', '1024', '2048', '4096', '8192', 'gl', 'dx', 'png', 'jpg', 'jpeg', 'tga', 'tif', 'tiff', 'exr', 'final', 'v1', 'v2', 'udim', '0', '1', '1001']);
const tok = (s) => (s || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const roleOfTokens = (tokens) => { for (const role of Object.keys(ROLE_TOKENS)) if (tokens.some(t => ROLE_TOKENS[role].includes(t))) return role; return null; };

export function classifyTextureName(name) {
  const tokens = tok(stemOf(name));
  const role = roleOfTokens(tokens);
  const baseTokens = tokens.filter(t => !Object.values(ROLE_TOKENS).flat().includes(t) && !NOISE_TOKENS.has(t));
  return { role, baseTokens, tokens };
}

function similarity(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens), b = new Set(bTokens);
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += t.length >= 4 ? 2 : 1;
  const aStr = aTokens.join(''), bStr = bTokens.join('');
  if (aStr === bStr) return 100;
  if (aStr.includes(bStr) || bStr.includes(aStr)) return 40 + shared * 3;
  if (shared === 0) return 0;
  return shared;
}

const MATCH_THRESHOLD = { strict: 6, balanced: 3, loose: 1.4 };

export class AssetStore {
  constructor() {
    this.items = [];
    this._id = 1;
    this.onChange = () => {};
  }

  get(id) { return this.items.find(i => i.id === id) || null; }
  list() { return this.items; }
  count() { return this.items.length; }

  _addItem(item) {
    item.id = 'asset-' + (this._id++);
    item.sizeLabel = item.size > 1024 * 1024 ? (item.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(item.size / 1024)) + ' KB';
    this.items.push(item);
    this.onChange(this.items);
    return item;
  }
  remove(id) {
    const ix = this.items.findIndex(i => i.id === id);
    if (ix >= 0) { const [item] = this.items.splice(ix, 1); if (item.url) URL.revokeObjectURL(item.url); this.onChange(this.items); }
  }

  /* ──────────────────────────────────────── intake */
  async ingest(fileList, { autoMatch = true, strategy = 'balanced' } = {}) {
    const result = { added: [], errors: [], matchLog: [] };
    const raw = [];
    for (const f of fileList) raw.push({ name: normPath(f.name), file: f });

    /* expand zips (and nested zips, one level) */
    const flat = [];
    for (const entry of raw) {
      if (extOf(entry.name) === 'zip') {
        try {
          const buf = await entry.file.arrayBuffer();
          const zip = await JSZip.loadAsync(buf);
          for (const [path, zf] of Object.entries(zip.files)) {
            if (zf.dir || SKIP_RE.test(path)) continue;
            const size = zf._data?.uncompressedSize ?? 0;
            const data = await zf.async('arraybuffer');
            flat.push({ name: normPath(path), data, size: data.byteLength || size, zip: baseOf(entry.name) });
          }
        } catch (err) { result.errors.push(`ZIP “${baseOf(entry.name)}” could not be read: ${err.message}`); }
      } else {
        const data = await entry.file.arrayBuffer();
        flat.push({ name: entry.name, data, size: entry.file.size, zip: null });
      }
    }

    /* index by path + basename for relative resolution (zips) */
    const byPath = new Map(); const byBase = new Map();
    for (const f of flat) { byPath.set(f.name.toLowerCase(), f); const b = baseOf(f.name).toLowerCase(); if (!byBase.has(b)) byBase.set(b, f); }
    const resolveUri = (uri) => {
      const clean = normPath(decodeURIComponent(uri.split('?')[0].split('#')[0])).toLowerCase();
      if (byPath.has(clean)) return byPath.get(clean);
      /* try matching tail of path (model lives in subfolder) */
      for (const [p, f] of byPath) if (p.endsWith('/' + clean) || clean.endsWith('/' + p)) return f;
      const b = clean.split('/').pop();
      return byBase.get(b) || null;
    };
    const blobUrlFor = (f) => f._url || (f._url = URL.createObjectURL(new Blob([f.data])));
    const makeManager = () => {
      const m = new THREE.LoadingManager();
      m.setURLModifier((url) => {
        if (/^(blob:|data:|https?:)/i.test(url)) return url;
        const hit = resolveUri(url);
        return hit ? blobUrlFor(hit) : url;
      });
      return m;
    };

    const models = flat.filter(f => MODEL_EXT.has(extOf(f.name)));
    const images = flat.filter(f => IMAGE_EXT.has(extOf(f.name)));
    const hdrs = flat.filter(f => HDR_EXT.has(extOf(f.name)));
    /* anything we don't understand gets a clear, honest answer instead of silence */
    const consumed = new Set([...models, ...images, ...hdrs]);
    for (const f of flat) if (extOf(f.name) === 'mtl') consumed.add(f);
    for (const f of flat) if (!consumed.has(f)) result.errors.push(`Skipped “${baseOf(f.name)}” — unsupported type “${extOf(f.name) || 'unknown'}”`);

    /* textures first so models can reference them */
    const textureItems = [];
    for (const f of images) {
      try {
        const url = blobUrlFor(f);
        const tex = await new Promise((res, rej) => new THREE.TextureLoader(makeManager()).load(url, res, undefined, rej));
        const cls = classifyTextureName(f.name);
        tex.colorSpace = (cls.role === 'map' || cls.role === 'emissiveMap') ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 8;
        const item = this._addItem({ kind: 'texture', name: baseOf(f.name), ext: extOf(f.name), size: f.size, url, texture: tex, role: cls.role, baseTokens: cls.baseTokens, zip: f.zip, raw: f.data });
        textureItems.push(item);
        result.added.push(item);
      } catch (err) { result.errors.push(`Texture “${baseOf(f.name)}” failed to decode`); }
    }

    /* HDR environment maps */
    for (const f of hdrs) {
      try {
        const tex = await new RGBELoader(makeManager()).loadAsync(blobUrlFor(f));
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const item = this._addItem({ kind: 'hdr', name: baseOf(f.name), ext: 'hdr', size: f.size, texture: tex, zip: f.zip, url: blobUrlFor(f), raw: f.data });
        result.added.push(item);
      } catch (err) { result.errors.push(`HDR “${baseOf(f.name)}” failed to decode`); }
    }

    /* models */
    const modelItems = [];
    for (const f of models) {
      try {
        const ext = extOf(f.name);
        let root = null;
        if (ext === 'glb' || ext === 'gltf') {
          const loader = new GLTFLoader(makeManager());
          const draco = new DRACOLoader(); draco.setDecoderPath('./vendor/addons/libs/draco/'); loader.setDRACOLoader(draco);
          const gltf = await loader.parseAsync(f.data, '');
          root = gltf.scene;
        } else if (ext === 'obj') {
          const loader = new OBJLoader(makeManager());
          const mtlEntry = this._findSibling(f, flat, 'mtl');
          if (mtlEntry) {
            try {
              const mtlText = new TextDecoder().decode(mtlEntry.data);
              const mtl = new MTLLoader(makeManager()).parse(mtlText, '');
              mtl.preload();
              loader.setMaterials(mtl);
            } catch { /* fall through with default materials */ }
          }
          root = loader.parse(new TextDecoder().decode(f.data));
        } else if (ext === 'fbx') {
          root = new FBXLoader(makeManager()).parse(f.data, '');
        } else if (ext === 'stl') {
          const geo = new STLLoader().parse(f.data);
          geo.computeVertexNormals();
          root = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xcfd0d4, roughness: 0.55, metalness: 0.1 }));
        } else if (ext === 'ply') {
          const geo = new PLYLoader().parse(f.data);
          geo.computeVertexNormals();
          const hasColor = !!geo.attributes.color;
          root = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xcfd0d4, roughness: 0.6, metalness: 0.05, vertexColors: hasColor }));
        }
        if (!root) throw new Error('unsupported');
        /* sane scale for pathological files (mm-STL, terrain × 10⁶) */
        const box = new THREE.Box3().setFromObject(root);
        const dim = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(dim.x, dim.y, dim.z);
        let normalized = false;
        if (maxDim > 80 || maxDim < 0.02) { const s = 2.4 / (maxDim || 1); root.scale.multiplyScalar(s); normalized = true; }
        root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.geometry) o.geometry.userData.shared = true; } });
        root.name = stemOf(f.name);
        const thumb = this._renderThumb(root);
        const item = this._addItem({ kind: 'model', name: stemOf(f.name), ext, size: f.size, template: root, thumb, zip: f.zip, normalized, baseTokens: tok(stemOf(f.name)), raw: f.data });
        modelItems.push(item);
        result.added.push(item);
      } catch (err) { console.warn(err); result.errors.push(`Model “${baseOf(f.name)}” failed to parse — if it references external files, drop the whole folder or a ZIP`); }
    }

    /* ═══ SMART MATCH — wire textures to materials automatically ═══ */
    if (autoMatch && modelItems.length && textureItems.length) {
      const threshold = MATCH_THRESHOLD[strategy] ?? MATCH_THRESHOLD.balanced;
      for (const model of modelItems) {
        const mats = new Set();
        model.template.traverse(o => { if (o.isMesh && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); });
        for (const mat of mats) {
          const matTokens = [...new Set([...tok(mat.name || ''), ...model.baseTokens])];
          for (const role of Object.keys(ROLE_TOKENS)) {
            if (mat[role]) continue;                       // material already textured
            const cands = textureItems.filter(t => t.role === role);
            if (!cands.length) continue;
            let best = null, bestScore = 0;
            for (const t of cands) {
              let score = similarity(t.baseTokens, matTokens);
              if (cands.length === 1) score += 2.5;        // only one candidate of this role — trust it more
              if (score > bestScore) { bestScore = score; best = t; }
            }
            if (best && bestScore >= threshold) {
              const tex = best.texture.clone();
              tex.needsUpdate = true;
              tex.userData = { ...(tex.userData || {}), assetId: best.id };
              tex.colorSpace = (role === 'map' || role === 'emissiveMap') ? THREE.SRGBColorSpace : THREE.NoColorSpace;
              mat[role] = tex;
              if (role === 'normalMap' && mat.normalScale) mat.normalScale.set(1, 1);
              if (role === 'emissiveMap' && mat.emissive && mat.emissive.getHex() === 0) { mat.emissive.setHex(0xffffff); mat.emissiveIntensity = 1; }
              mat.needsUpdate = true;
              result.matchLog.push({ model: model.name, material: mat.name || 'unnamed', texture: best.name, role, score: bestScore.toFixed(1) });
            }
          }
        }
      }
    }
    return result;
  }

  _findSibling(f, flat, ext) {
    const stem = stemOf(f.name).toLowerCase();
    return flat.find(o => extOf(o.name) === ext && stemOf(o.name).toLowerCase() === stem)
        || flat.find(o => extOf(o.name) === ext) || null;
  }

  /* instantiate a stored model template into the scene graph */
  instantiate(item) {
    const clone = item.template.clone(true);
    clone.traverse(o => {
      if (o.isMesh) {
        o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
        o.castShadow = true; o.receiveShadow = true;
      }
    });
    clone.userData.assetId = item.id;
    clone.userData.assetName = item.name;
    clone.name = item.name;
    return clone;
  }
  makeTexture(item) {
    if (!item.texture) return null;
    const t = item.texture.clone();
    t.needsUpdate = true;
    t.userData = { ...(t.userData || {}), assetId: item.id };
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  }

  /* tiny offscreen renderer for model thumbnails — genuinely shows YOUR asset */
  _renderThumb(root) {
    try {
      const s = 144;
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setSize(s, s); r.setPixelRatio(1);
      r.outputColorSpace = THREE.SRGBColorSpace;
      const sc = new THREE.Scene();
      sc.add(new THREE.HemisphereLight(0xffffff, 0x303038, 1.15));
      const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(3, 4, 2.5); sc.add(key);
      const rim = new THREE.DirectionalLight(0xa8c4ff, 0.8); rim.position.set(-3, 2, -3); sc.add(rim);
      const obj = root.clone(true);
      const box = new THREE.Box3().setFromObject(obj);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      obj.position.sub(sphere.center);
      sc.add(obj);
      const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);
      const d = sphere.radius / Math.sin((cam.fov * Math.PI / 180) / 2) * 1.12;
      cam.position.set(d * 0.72, d * 0.5, d * 0.72);
      cam.lookAt(0, 0, 0);
      r.render(sc, cam);
      const url = r.domElement.toDataURL('image/png');
      r.dispose(); r.forceContextLoss?.();
      return url;
    } catch (e) { return null; }
  }
}
