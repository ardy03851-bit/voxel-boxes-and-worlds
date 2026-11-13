/* Project Genie — Scene Studio · App orchestrator
   Serialization · undo/redo · project save/open · exports · ingest · starter world */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { Engine } from './engine.js';
import { AssetStore } from './assets.js';
import { UI } from './ui.js';

const AUTOSAVE_KEY = 'genie-scene-autosave';
const SETTINGS_KEY = 'genie-settings';
const APP_SIG = 'genie-scene-studio';

const b64encode = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let bin = ''; const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
};
const b64decode = (b64) => { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return bytes.buffer; };
const dataUrlToBuffer = (url) => b64decode(url.split(',')[1]);

function meshPathMap(root) {
  const map = new Map();
  (function walk(o, prefix) {
    o.children.forEach((c, i) => {
      const p = prefix ? `${prefix}/${i}` : `${i}`;
      if (c.isMesh) map.set(c, p);
      walk(c, p);
    });
  })(root, '');
  return map;
}
function meshAtPath(root, path) {
  let o = root;
  for (const part of path.split('/')) { o = o?.children?.[+part]; if (!o) return null; }
  return o?.isMesh ? o : null;
}

class App {
  constructor() {
    this.settings = Object.assign({ snap: false, snapSize: 0.5, smartMatch: true, strategy: 'balanced', quality: 'balanced', autosave: true, fpsMeter: false }, this._loadSettings());
    this.engine = new Engine(document.getElementById('viewport'));
    this.assets = new AssetStore();
    this.undoStack = []; this.redoStack = []; this.dirty = false;
    this._assetIdRemap = new Map();

    this.engine.onTransformEnd = () => this.pushUndo('Transform');
    this.engine.onSceneDirty = () => { this.dirty = true; };
    this.engine.onSelectionChange = () => { this.ui.renderInspector(); this.ui.renderOutliner(); };

    this.ui = new UI(this);
    this._buildCreatePanel();

    const restored = this._restoreAutosave();
    if (!restored) this._starterScene();
    this.engine.setQuality(this.settings.quality);
    this.ui.syncWorldPanel();
    this.pushUndo('Initial');
    this.ui.updateUndoButtons();

    setInterval(() => { if (this.settings.autosave && this.dirty) this.quickSave(false); }, 45000);
    window.addEventListener('beforeunload', () => { if (this.dirty) this.quickSave(false); });

    requestAnimationFrame(() => {
      window.__genieReady = true;
      document.getElementById('splash').classList.add('done');
      document.getElementById('app').classList.add('ready');
    });
  }

  /* ═══════════════ CREATE PANEL ═══════════════ */
  _buildCreatePanel() {
    const ic = (body) => `<svg viewBox="0 0 24 24">${body}</svg>`;
    const prims = [
      ['box', 'Box', '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'],
      ['sphere', 'Sphere', '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/>'],
      ['cylinder', 'Cylinder', '<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6"/>'],
      ['cone', 'Cone', '<path d="M12 3l8.5 16h-17z"/>'],
      ['capsule', 'Capsule', '<rect x="8" y="3" width="8" height="18" rx="4"/>'],
      ['torus', 'Torus', '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/>'],
      ['plane', 'Plane', '<path d="M3 17L10 6h11l-7 11z"/>'],
      ['knot', 'Knot', '<circle cx="12" cy="12" r="8"/><path d="M12 4c5 4 5 12 0 16M4 12c4-5 12-5 16 0"/>']
    ];
    const proc = [
      ['rock', 'Rock', '<path d="M6 17l2-8 5-4.5L19 9l1 8z"/>'],
      ['pine', 'Pine', '<path d="M12 2l4.5 7h-2.4l3.6 5.6H14l2 4.9H8l2-4.9H6.3L9.9 9H7.5z"/>'],
      ['landscape', 'Terrain', '<path d="M2 18l6-9 5 7 4-10 5 12z"/>'],
      ['water', 'Water', '<path d="M2 13c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 3.5-2 5 0M2 18c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 3.5-2 5 0"/>']
    ];
    const lights = [
      ['sun', 'Sun', '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M19.8 4.2l-2.1 2.1M6.3 17.7l-2.1 2.1"/>'],
      ['point', 'Point', '<path d="M12 3a6.5 6.5 0 0 1 4 11.6c-.9.7-1.5 1.6-1.5 2.7h-5c0-1.1-.6-2-1.5-2.7A6.5 6.5 0 0 1 12 3z"/><path d="M9.5 21h5"/>'],
      ['spot', 'Spot', '<path d="M9 3h6l3 6H6z"/><path d="M12 9v5M8 21l2.5-7M16 21l-2.5-7"/>'],
      ['hemi', 'Ambient', '<path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z"/><path d="M2 17h20M6 21h12"/>']
    ];
    const fill = (id, entries, handler) => {
      const grid = document.getElementById(id);
      for (const [kind, label, svg] of entries) {
        const b = document.createElement('button');
        b.className = 'create-tile';
        b.innerHTML = ic(svg) + `<span>${label}</span>`;
        b.addEventListener('click', () => handler(kind, label));
        grid.appendChild(b);
      }
    };
    fill('primitivesGrid', prims, (kind) => {
      const mesh = this.engine.buildPrimitive(kind, {});
      mesh.userData.primitive = kind; mesh.name = kind.charAt(0).toUpperCase() + kind.slice(1);
      this._placeNew(mesh);
    });
    fill('proceduralGrid', proc, (kind) => {
      let obj;
      if (kind === 'rock') { obj = this.engine.buildRock({}); obj.userData.procKind = 'rock'; obj.name = 'Rock'; }
      else if (kind === 'pine') { obj = this.engine.buildPine({}); obj.userData.procKind = 'pine'; obj.name = 'Pine'; }
      else if (kind === 'landscape') { obj = this.engine.buildLandscape({}); obj.userData.procKind = 'landscape'; obj.name = 'Terrain'; }
      else { obj = this.engine.buildWater(); obj.userData.procKind = 'water'; obj.name = 'Water'; }
      obj.userData.params = obj.userData.procKind === 'landscape' ? { size: 56, amplitude: 2.6, seed: 7 } : obj.userData.procKind === 'rock' ? { seed: Math.floor(Math.random() * 1e9) } : {};
      if (kind === 'water') { this.engine.world.add(obj); this.engine.select(obj); this.pushUndo('Add Water'); this.ui.renderOutliner(); return; }
      this._placeNew(obj);
    });
    fill('lightsGrid', lights, (kind) => {
      const light = this.engine.buildLight(kind, {});
      light.name = kind === 'hemi' ? 'Ambient' : kind.charAt(0).toUpperCase() + kind.slice(1) + ' Light';
      this.engine.world.add(light);
      this.engine.select(light);
      this.pushUndo('Add Light');
      this.ui.renderOutliner(); this.ui.renderInspector();
    });
  }
  _placeNew(obj) {
    obj.position.set(0, 0, 0);
    this.engine.world.add(obj);
    if (obj.userData.procKind === 'landscape') { /* terrain stays at y=0 */ }
    else {
      const hit = this.engine.surfaceHeightAt(0, 0, obj);
      const box = new THREE.Box3().setFromObject(obj);
      obj.position.y += (hit ? hit.point.y : 0) - box.min.y;
    }
    obj.userData.selectable = true;
    this.engine.select(obj);
    this.pushUndo('Add ' + (obj.name || 'object'));
    this.ui.renderOutliner(); this.ui.renderInspector();
  }
  _groundObject(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    obj.position.y -= box.min.y;
  }

  /* ═══════════════ asset intake ═══════════════ */
  async ingestFiles(files) {
    /* a project file dropped into the vault opens as a project instead */
    const projectFile = files.find(f => /genieproj\.(json)$/i.test(f.name) || f.name.endsWith('.json'));
    if (projectFile && files.length === 1) {
      try {
        const text = await projectFile.text();
        const data = JSON.parse(text);
        if (data && data.app === APP_SIG) { this._restoreFromData(data, true); return; }
      } catch { /* not a project file — fall through to asset ingest */ }
    }
    this.ui.toast(`Ingesting ${files.length} file${files.length > 1 ? 's' : ''}…`, 'ok', 1600);
    const result = await this.assets.ingest(files, { autoMatch: this.settings.smartMatch, strategy: this.settings.strategy });
    this.ui.renderAssets();
    this.ui.renderOutliner();
    const nModels = result.added.filter(i => i.kind === 'model').length;
    if (result.added.length) this.ui.toast(`Vault +${result.added.length} asset${result.added.length > 1 ? 's' : ''}${nModels ? ` (${nModels} model${nModels > 1 ? 's' : ''})` : ''}`);
    const shown = result.errors.slice(0, 4);
    for (const err of shown) this.ui.toast(err, 'warn', 5200);
    if (result.errors.length > shown.length) this.ui.toast(`…and ${result.errors.length - shown.length} more skipped file(s)`, 'warn', 4200);
    if (result.matchLog.length) this.ui.toast(`✦ Smart Match wired ${result.matchLog.length} texture${result.matchLog.length > 1 ? 's' : ''} automatically`, 'ok', 4200);
    this.ui.showSmartLog(result.matchLog, result.errors);
    if (result.added.length) this.dirty = true;
  }

  addAssetToScene(item, at) {
    if (!item) return;
    if (item.kind === 'hdr') { this.engine.setEnvironmentTexture(item.texture); this.ui.toast(`Environment → ${item.name}`); return; }
    if (item.kind === 'texture') { this.applyTextureToSelection(item, document.getElementById('applyAsSelect').value); return; }
    const obj = this.assets.instantiate(item);
    obj.userData.selectable = true;
    this.engine.world.add(obj);
    let placed = false;
    if (at) {
      const hit = this.engine.raycastSurface(at.x, at.y);
      if (hit) {
        const box = new THREE.Box3().setFromObject(obj);
        obj.position.set(hit.point.x, hit.point.y - box.min.y, hit.point.z);
        placed = true;
      }
    }
    if (!placed) {
      const jitter = (this.engine.world.children.length % 5) * 0.6 - 1.2;
      obj.position.set(jitter, 0.4, jitter);
      const hit = this.engine.surfaceHeightAt(obj.position.x, obj.position.z, obj);
      const box = new THREE.Box3().setFromObject(obj);
      obj.position.y += ((hit ? hit.point.y : 0) - box.min.y);
    }
    this.engine.select(obj);
    this.pushUndo('Add ' + item.name);
    this.ui.renderOutliner(); this.ui.renderInspector();
  }

  applyTextureToSelection(item, role = 'map') {
    const root = this.engine.selected;
    if (!root) { this.ui.toast('Select a model first — then the texture applies to it', 'warn'); return; }
    const meshes = [];
    root.traverse(o => { if (o.isMesh && o.material && !o.userData.isLightProxy) meshes.push(o); });
    if (!meshes.length) { this.ui.toast('Selection has no editable meshes', 'warn'); return; }
    for (const mesh of meshes) {
      const tex = this.assets.makeTexture(item);
      tex.colorSpace = (role === 'map' || role === 'emissiveMap') ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        m[role] = tex;
        if (role === 'emissiveMap' && m.emissive && m.emissive.getHex() === 0) { m.emissive.setHex(0xffffff); m.emissiveIntensity = 1; }
        if (role === 'normalMap' && m.normalScale) m.normalScale.set(1, 1);
        m.needsUpdate = true;
      }
    }
    this.pushUndo('Apply texture');
    this.ui.renderInspector();
    this.ui.toast(`${item.name} → ${role.replace('Map', '')}`);
  }

  duplicate() { const o = this.engine.duplicateSelected(); if (o) { this.pushUndo('Duplicate'); this.ui.renderOutliner(); this.ui.renderInspector(); } }
  deleteSelection() { if (this.engine.deleteSelected()) { this.pushUndo('Delete'); this.ui.renderOutliner(); this.ui.renderInspector(); this.ui.toast('Deleted'); } }

  /* ═══════════════ serialization ═══════════════ */
  _serializeEntry(obj) {
    const ud = obj.userData;
    const e = {
      name: obj.name, visible: obj.visible, locked: !!ud.locked,
      position: obj.position.toArray(), rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z], scale: obj.scale.toArray()
    };
    if (ud.lightKind) {
      e.kind = 'light'; e.lightKind = ud.lightKind;
      const L = ud.light;
      e.lightOpts = { color: L.color.getHex(), intensity: L.intensity, distance: L.distance ?? 0, angle: L.angle, penumbra: L.penumbra, castShadow: L.castShadow };
    } else if (ud.assetId) {
      e.kind = 'asset'; e.assetId = ud.assetId;
    } else if (ud.primitive) {
      e.kind = 'primitive'; e.primitive = ud.primitive; e.params = ud.params || {};
    } else if (ud.procKind) {
      e.kind = 'proc'; e.procKind = ud.procKind; e.params = ud.params || {};
    } else return null;
    /* material overrides by mesh path */
    const pathMap = meshPathMap(obj);
    const overrides = [];
    for (const [mesh, path] of pathMap) {
      const snap = this.engine.snapshotMeshMaterial(mesh, (tex) => tex);
      overrides.push({ path, material: snap });
    }
    e.materialOverrides = overrides;
    return e;
  }
  serializeScene(assetMode = 'full') {
    const data = {
      app: APP_SIG, version: 1, savedAt: Date.now(),
      environment: this.engine.getEnvironment(),
      camera: this.engine.getCameraState(),
      objects: this.engine.worldObjects().map(o => this._serializeEntry(o)).filter(Boolean),
      assets: []
    };
    if (assetMode !== 'none') {
      for (const item of this.assets.list()) {
        const entry = { id: item.id, kind: item.kind, name: item.name, ext: item.ext, size: item.size, role: item.role ?? null, thumb: assetMode === 'full' ? (item.thumb ?? null) : null, zip: item.zip ?? null };
        if (assetMode === 'full') {
          if (item.kind === 'model' || item.kind === 'hdr') {
            if (item.raw) entry.data = b64encode(item.raw);
            else entry.missing = true;
          } else if (item.kind === 'texture') {
            const img = item.texture?.image;
            if (img) {
              try { const c = document.createElement('canvas'); c.width = img.width || img.naturalWidth; c.height = img.height || img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); entry.dataUrl = c.toDataURL('image/png'); }
              catch { entry.missing = true; }
            } else entry.missing = true;
          }
        } else { entry.missing = true; }
        data.assets.push(entry);
      }
    }
    return data;
  }
  _applyEntry(entry, counts) {
    let obj = null;
    if (entry.kind === 'light') {
      obj = this.engine.buildLight(entry.lightKind, entry.lightOpts || {});
      const L = obj.userData.light;
      if (entry.lightOpts) {
        L.intensity = entry.lightOpts.intensity ?? L.intensity;
        if (entry.lightOpts.color != null) L.color.setHex(entry.lightOpts.color);
        if (entry.lightOpts.distance != null) L.distance = entry.lightOpts.distance;
        if (entry.lightOpts.angle != null && L.angle !== undefined) L.angle = entry.lightOpts.angle;
        if (entry.lightOpts.penumbra != null && L.penumbra !== undefined) L.penumbra = entry.lightOpts.penumbra;
        L.castShadow = entry.lightOpts.castShadow ?? L.castShadow;
      }
    } else if (entry.kind === 'asset') {
      const remapped = this._assetIdRemap.get(entry.assetId) ?? entry.assetId;
      const item = this.assets.get(remapped);
      if (item) obj = this.assets.instantiate(item); else { counts.missingAssets++; return null; }
    } else if (entry.kind === 'primitive') {
      obj = this.engine.buildPrimitive(entry.primitive, entry.params || {});
      obj.userData.primitive = entry.primitive; obj.userData.params = entry.params || {};
    } else if (entry.kind === 'proc') {
      if (entry.procKind === 'rock') obj = this.engine.buildRock(entry.params || {});
      else if (entry.procKind === 'pine') obj = this.engine.buildPine(entry.params || {});
      else if (entry.procKind === 'landscape') obj = this.engine.buildLandscape(entry.params || {});
      else if (entry.procKind === 'water') obj = this.engine.buildWater();
      if (obj) { obj.userData.procKind = entry.procKind; obj.userData.params = entry.params || {}; }
    }
    if (!obj) return null;
    obj.name = entry.name || obj.name;
    obj.position.fromArray(entry.position); obj.rotation.set(entry.rotation[0], entry.rotation[1], entry.rotation[2]); obj.scale.fromArray(entry.scale);
    obj.visible = entry.visible !== false; obj.userData.locked = !!entry.locked; obj.userData.selectable = true;
    /* material overrides */
    const resolveTex = (ref) => {
      const id = this._assetIdRemap.get(ref.assetId) ?? ref.assetId;
      const item = this.assets.get(id);
      return item ? this.assets.makeTexture(item) : null;
    };
    for (const ov of entry.materialOverrides || []) {
      const mesh = meshAtPath(obj, ov.path);
      if (mesh) this.engine.applyMaterialSnapshot(mesh, ov.material, resolveTex);
    }
    this.engine.world.add(obj);
    return obj;
  }
  _clearWorld() {
    for (const o of [...this.engine.world.children]) {
      this.engine.world.remove(o);
      o.traverse(c => { if (!c.isMesh) return; if (c.geometry && !c.geometry.userData?.shared) c.geometry.dispose(); if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m2 => m2.dispose()); });
    }
    this.engine.select(null);
  }
  _restoreFromData(data, isFile) {
    const counts = { missingAssets: 0 };
    /* rebuild assets first (project files embed them) */
    this._assetIdRemap = new Map();
    const embedded = (data.assets || []).filter(a => a.data || a.dataUrl);
    if (embedded.length) {
      const files = [];
      for (const a of embedded) {
        let buf = null, mime = 'application/octet-stream';
        if (a.data) buf = b64decode(a.data);
        else if (a.dataUrl) { buf = dataUrlToBuffer(a.dataUrl); mime = a.dataUrl.match(/data:(.*?);/)?.[1] || mime; }
        files.push(new File([buf], a.name, { type: mime }));
      }
      /* synchronous ingest can't be awaited in constructor path — handled by caller */
      this._pendingAssetFiles = files;
      this._pendingAssetIds = embedded.map(a => a.id);
    }
    const finish = () => {
      this._clearWorld();
      for (const entry of data.objects || []) this._applyEntry(entry, counts);
      if (data.environment) this.engine.setEnvironment(data.environment);
      if (data.camera) this.engine.setCameraState(data.camera);
      this.ui.renderOutliner(); this.ui.renderInspector(); this.ui.syncWorldPanel(); this.ui.renderAssets();
      this.pushUndo('Open');
      this.dirty = false;
      if (counts.missingAssets) this.ui.toast(`${counts.missingAssets} uploaded asset(s) were too large to embed — re-import them for full fidelity`, 'warn', 6000);
      return true;
    };
    if (this._pendingAssetFiles?.length) {
      const files = this._pendingAssetFiles, ids = this._pendingAssetIds;
      this._pendingAssetFiles = null;
      this.assets.ingest(files, { autoMatch: false }).then(res => {
        const byName = new Map(res.added.map(it => [(it.kind + '|' + String(it.name || '').toLowerCase()), it]));
        for (const oldId of ids) {
          const meta = (data.assets || []).find(a => a.id === oldId);
          if (!meta) continue;
          const bare = String(meta.name || '').toLowerCase();
          const stem = bare.replace(/\.[^.]+$/, '');
          const hit = byName.get(meta.kind + '|' + stem) || byName.get(meta.kind + '|' + bare);
          if (hit) this._assetIdRemap.set(oldId, hit.id);
        }
        finish();
      }).catch(() => finish());
      return true;
    }
    return finish();
  }
  restoreFromJSON(json, { environment = true } = {}) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!data || data.app !== APP_SIG) { this.ui.toast('Not a Scene Studio project file', 'error'); return false; }
    if (environment) return this._restoreFromData(data, false);
    /* undo/redo path — environment kept as-is */
    this._assetIdRemap = new Map();
    this._clearWorld();
    const counts = { missingAssets: 0 };
    for (const entry of data.objects || []) this._applyEntry(entry, counts);
    this.ui.renderOutliner(); this.ui.renderInspector();
    return true;
  }

  /* ═══════════════ undo / redo ═══════════════ */
  pushUndo(label = 'Edit') {
    try {
      const snap = JSON.stringify(this.serializeScene('none'));
      this.undoStack.push(snap);
      if (this.undoStack.length > 50) this.undoStack.shift();
      this.redoStack.length = 0;
      this.dirty = true;
      this.ui.updateUndoButtons();
    } catch (err) { console.warn('undo snapshot failed', err); }
  }
  undo() {
    if (this.undoStack.length < 2) { this.ui.toast('Nothing to undo', 'ok', 1500); return; }
    this.redoStack.push(this.undoStack.pop());
    const prev = this.undoStack[this.undoStack.length - 1];
    this.restoreFromJSON(prev, { environment: false });
    this.ui.updateUndoButtons();
  }
  redo() {
    if (!this.redoStack.length) { this.ui.toast('Nothing to redo', 'ok', 1500); return; }
    const next = this.redoStack.pop();
    this.undoStack.push(next);
    this.restoreFromJSON(next, { environment: false });
    this.ui.updateUndoButtons();
  }

  /* ═══════════════ save / open ═══════════════ */
  quickSave(announce) {
    try {
      let data = this.serializeScene('full');
      let json = JSON.stringify(data);
      if (json.length > 4_000_000) {
        data = this.serializeScene('lite');
        json = JSON.stringify(data);
        if (announce) this.ui.toast('Scene too large for browser backup — use Export → Save Project instead', 'warn', 5000);
      } else if (announce) this.ui.toast('Scene backed up to this browser');
      localStorage.setItem(AUTOSAVE_KEY, json);
      this.dirty = false;
      if (announce && json.length <= 4_000_000) { /* already toasted */ }
    } catch (err) {
      if (announce) this.ui.toast('Backup failed — quota exceeded?', 'error');
    }
  }
  saveProject() {
    const data = this.serializeScene('full');
    const json = JSON.stringify(data);
    this.engine.downloadBlob(new Blob([json], { type: 'application/json' }), 'genie-scene.genieproj.json');
    this.ui.toast('Project saved — re-open anytime');
  }
  async openProject(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== APP_SIG) { this.ui.toast('Not a Scene Studio project', 'error'); return; }
      this._restoreFromData(data, true);
      this.ui.toast('Project opened');
    } catch { this.ui.toast('Could not read project file', 'error'); }
  }
  _restoreAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data.app !== APP_SIG) return false;
      this._restoreFromData(data, false);
      return true;
    } catch { return false; }
  }

  /* ═══════════════ exports ═══════════════ */
  async exportSceneGLB() {
    try {
      const scene = this.engine.collectExportScene();
      const buf = await new GLTFExporter().parseAsync(scene, { binary: true });
      this.engine.downloadBlob(new Blob([buf], { type: 'model/gltf-binary' }), 'genie-scene.glb');
      this.ui.toast('Scene exported — genie-scene.glb');
    } catch (err) { console.error(err); this.ui.toast('GLB export failed', 'error'); }
  }
  async exportSelectionGLB() {
    const t = this.engine.selected;
    if (!t) { this.ui.toast('Select something first', 'warn'); return; }
    try {
      const buf = await new GLTFExporter().parseAsync(t.clone(true), { binary: true });
      const name = (t.name || 'selection').toLowerCase().replace(/[^a-z0-9-]+/g, '-') + '.glb';
      this.engine.downloadBlob(new Blob([buf], { type: 'model/gltf-binary' }), name);
      this.ui.toast('Selection exported — ' + name);
    } catch (err) { console.error(err); this.ui.toast('GLB export failed', 'error'); }
  }
  async exportSelectionSTL() {
    const t = this.engine.selected;
    if (!t) { this.ui.toast('Select something first', 'warn'); return; }
    try {
      const result = new STLExporter().parse(t.clone(true), { binary: true });
      const name = (t.name || 'selection').toLowerCase().replace(/[^a-z0-9-]+/g, '-') + '.stl';
      this.engine.downloadBlob(new Blob([result], { type: 'application/octet-stream' }), name);
      this.ui.toast('STL exported — ' + name);
    } catch (err) { console.error(err); this.ui.toast('STL export failed', 'error'); }
  }

  /* ═══════════════ starter diorama ═══════════════ */
  _starterScene() {
    const E = this.engine;
    E.applyPreset('golden');
    /* terrain */
    const terrain = E.buildLandscape({ size: 56, amplitude: 2.1, seed: 11 });
    terrain.userData.procKind = 'landscape'; terrain.userData.params = { size: 56, amplitude: 2.1, seed: 11 };
    terrain.name = 'Golden Terrain';
    E.world.add(terrain);
    const place = (obj, x, z) => {
      E.world.add(obj);
      const hit = E.surfaceHeightAt(x, z, obj);
      const box = new THREE.Box3().setFromObject(obj);
      obj.position.set(x, (hit ? hit.point.y : 0) - box.min.y, z);
    };
    const rock1 = E.buildRock({ seed: 42 }); rock1.scale.setScalar(1.7); rock1.name = 'Monolith Rock'; rock1.userData.procKind = 'rock'; rock1.userData.params = { seed: 42 }; place(rock1, 3.4, -2.6);
    const rock2 = E.buildRock({ seed: 777 }); rock2.scale.setScalar(0.8); rock2.name = 'Pebble'; rock2.userData.procKind = 'rock'; rock2.userData.params = { seed: 777 }; place(rock2, -2.6, 2.2);
    const pine1 = E.buildPine({}); pine1.name = 'Pine · West'; pine1.userData.procKind = 'pine'; place(pine1, -3.6, -0.6);
    const pine2 = E.buildPine({}); pine2.scale.setScalar(0.8); pine2.name = 'Pine · Small'; pine2.userData.procKind = 'pine'; place(pine2, 4.4, 2.4);
    const pine3 = E.buildPine({}); pine3.scale.setScalar(1.25); pine3.name = 'Pine · Ancient'; pine3.userData.procKind = 'pine'; place(pine3, -4.8, 3.4);
    /* hero knot on a basalt podium */
    const base = E.buildPrimitive('cylinder', {});
    base.scale.set(1.35, 0.62, 1.35); base.name = 'Basalt Podium'; base.userData.primitive = 'cylinder';
    base.material.color.set(0x35353c); base.material.roughness = 0.32; base.material.metalness = 0.35;
    place(base, 0, 0);
    const knot = E.buildPrimitive('knot', {});
    knot.name = 'Aurum Knot'; knot.userData.primitive = 'knot';
    const km = knot.material; km.color.set(0xd8b45a); km.metalness = 1.0; km.roughness = 0.18; km.emissive.set(0x2a1d05); km.emissiveIntensity = 0.7;
    const baseBox = new THREE.Box3().setFromObject(base);
    knot.position.set(0, baseBox.max.y + 1.0, 0);
    E.world.add(knot);
    /* warm accent light */
    const warm = E.buildLight('point', { color: 0xffb46b, intensity: 55, x: 2.4, y: 3.1, z: 1.6 });
    warm.name = 'Hearth Light';
    E.world.add(warm);
    E.controls.target.set(0, 1.6, 0);
    E.camera.position.set(8.6, 5.4, 10.4);
    E.select(knot);
  }

  _loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
  }
}

/* persist settings on any change */
const app = new App();
const persist = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.settings)); } catch {} };
setInterval(persist, 2000);
window.addEventListener('beforeunload', persist);

/* expose for debugging */
window.genie = app;
