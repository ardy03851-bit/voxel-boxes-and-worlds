/* Project Genie — Scene Studio · UI layer
   Panels, inspector, outliner, asset vault, photo mode, toasts, modals */
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const KIND_ICONS = {
  box: '<rect x="4" y="8" width="16" height="12" rx="1.5"/><path d="M4 8l3-4h10l3 4M12 4v4"/>',
  sphere: '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3.2"/>',
  cylinder: '<ellipse cx="12" cy="6.5" rx="6.5" ry="2.5"/><path d="M5.5 6.5v11c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-11"/>',
  cone: '<path d="M12 3l8 16H4z"/>', capsule: '<rect x="8" y="3.5" width="8" height="17" rx="4"/>',
  torus: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3"/>',
  plane: '<path d="M3 17L10 6h11l-7 11z"/>', disc: '<circle cx="12" cy="12" r="8"/>',
  knot: '<circle cx="12" cy="12" r="7"/><path d="M12 5c4 3 4 11 0 14M5 12c3-4 11-4 14 0"/>',
  monolith: '<rect x="9" y="3" width="6" height="18" rx="0.8"/>',
  rock: '<path d="M6 17l2-7 5-4 6 4 1 7z"/>', pine: '<path d="M12 2l4.5 7h-2.6L18 14h-4l1.6 5h-7l1.6-5h-4l3.9-5H7.5z"/>',
  landscape: '<path d="M2 17l6-8 5 6 4-9 5 11z"/>', water: '<path d="M2 12c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 3.5-2 5 0M2 17c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0 3.5-2 5 0"/>',
  asset: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12M3 7l9 5 9-5"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M19.8 4.2l-2.1 2.1M6.3 17.7l-2.1 2.1"/>',
  point: '<path d="M12 3a6.5 6.5 0 0 1 4 11.6c-.9.7-1.5 1.6-1.5 2.7h-5c0-1.1-.6-2-1.5-2.7A6.5 6.5 0 0 1 12 3z"/><path d="M9.5 21h5"/>',
  spot: '<path d="M9 3h6l3 6H6z"/><path d="M12 9v6M8 21l2-6M16 21l-2-6"/>',
  hemi: '<path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z"/><path d="M2 17h20M6 21h12"/>'
};

export class UI {
  constructor(app) {
    this.app = app;
    this.engine = app.engine;
    this.assets = app.assets;
    this.photo = { active: false, aspect: '16:9', timer: 0, filter: 'none', scale: 1, shots: [] };
    this._pickerSlot = null;
    this._bindRail(); this._bindTools(); this._bindTopbar(); this._bindWorldPanel(); this._bindAssetsPanel();
    this._bindCambar(); this._bindPhotoMode(); this._bindMenus(); this._bindInspectorDelegation();
    this._bindKeyboard(); this._bindGlobalDrop();
    this.assets.onChange = () => { this.renderAssets(); this.renderOutliner(); };
    this.renderOutliner(); this.renderInspector();
  }

  /* ═══════════ toast ═══════════ */
  toast(msg, type = 'ok', ms = 3400) {
    const t = el(`<div class="toast ${type}"><span class="dot"></span><span>${esc(msg)}</span></div>`);
    $('toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; setTimeout(() => t.remove(), 350); }, ms);
  }

  /* ═══════════ rail / panels ═══════════ */
  _bindRail() {
    document.querySelectorAll('.rail-btn').forEach(btn => btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      const isActive = btn.classList.contains('active');
      document.querySelectorAll('.rail-btn').forEach(b => b.classList.toggle('active', b === btn && !isActive));
      document.querySelectorAll('.panel-page').forEach(p => p.classList.add('hidden'));
      const page = $('page-' + panel);
      if (!isActive && page) { page.classList.remove('hidden'); $('sidepanel').classList.add('open'); }
      else $('sidepanel').classList.remove('open');
    }));
    if (window.matchMedia('(min-width: 901px)').matches) $('sidepanel').classList.add('open');
  }
  openPanel(name) {
    document.querySelectorAll('.rail-btn').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
    document.querySelectorAll('.panel-page').forEach(p => p.classList.toggle('hidden', p.id !== 'page-' + name));
    $('sidepanel').classList.add('open');
  }

  /* ═══════════ tools panel ═══════════ */
  _bindTools() {
    document.querySelectorAll('#transformTools .tool-tile').forEach(tile => tile.addEventListener('click', () => {
      document.querySelectorAll('#transformTools .tool-tile').forEach(t => t.classList.toggle('active', t === tile));
      this.engine.setGizmoMode(tile.dataset.mode);
    }));
    this._syncSnapUI();
    $('swSnap').addEventListener('change', () => { this.app.settings.snap = $('swSnap').checked; this.engine.setSnap($('swSnap').checked, this.app.settings.snapSize); $('btnSnap').classList.toggle('active', $('swSnap').checked); });
    $('rngSnap').addEventListener('input', () => { this.app.settings.snapSize = +$('rngSnap').value; $('numSnap').textContent = this.app.settings.snapSize.toFixed(1) + ' m'; this.engine.setSnap($('swSnap').checked, this.app.settings.snapSize); });
    $('swGrid').addEventListener('change', () => { this.engine.env.grid = $('swGrid').checked; this.engine.grid.visible = $('swGrid').checked; $('btnGrid').classList.toggle('active', $('swGrid').checked); });
    $('swGround').addEventListener('change', () => { this.engine.env.ground = $('swGround').checked; this.engine.ground.visible = $('swGround').checked; });
    $('btnGroundSnap').addEventListener('click', () => { this.engine.snapToGround(); this.app.pushUndo('Snap to ground'); });
    $('btnCenter').addEventListener('click', () => { this.engine.centerOrigin(); this.app.pushUndo('Center'); });
    $('btnNormalize').addEventListener('click', () => { this.engine.normalizeSize(); this.app.pushUndo('Normalize size'); });
    $('btnDuplicate').addEventListener('click', () => this.app.duplicate());
    $('btnDelete').addEventListener('click', () => this.app.deleteSelection());
  }
  _syncSnapUI() { $('swSnap').checked = !!this.app.settings.snap; $('btnSnap').classList.toggle('active', !!this.app.settings.snap); }
  setTool(mode) { document.querySelectorAll('#transformTools .tool-tile').forEach(t => t.classList.toggle('active', t.dataset.mode === mode)); this.engine.setGizmoMode(mode); }

  /* ═══════════ top bar ═══════════ */
  _bindTopbar() {
    $('btnUndo').addEventListener('click', () => this.app.undo());
    $('btnRedo').addEventListener('click', () => this.app.redo());
    $('btnSnap').addEventListener('click', () => { const v = !($('swSnap').checked); $('swSnap').checked = v; $('swSnap').dispatchEvent(new Event('change')); });
    $('btnGrid').addEventListener('click', () => { const v = !($('swGrid').checked); $('swGrid').checked = v; $('swGrid').dispatchEvent(new Event('change')); });
    $('btnSave').addEventListener('click', () => this.app.quickSave(true));
    $('btnOpen').addEventListener('click', () => $('openProjectInput').click());
    $('btnExport').addEventListener('click', (e) => { e.stopPropagation(); this.toggleMenu('exportMenu', e.currentTarget); });
    $('btnPhoto').addEventListener('click', () => this.enterPhotoMode());
    $('btnSettings').addEventListener('click', () => $('settingsModal').classList.add('on'));
    $('btnHelp').addEventListener('click', () => $('helpModal').classList.add('on'));
    $('settingsDone').addEventListener('click', () => $('settingsModal').classList.remove('on'));
    $('helpDone').addEventListener('click', () => $('helpModal').classList.remove('on'));
    ['settingsModal', 'helpModal'].forEach(id => $(id).addEventListener('click', (e) => { if (e.target.id === id) $(id).classList.remove('on'); }));
    $('openProjectInput').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) this.app.openProject(f); e.target.value = ''; });
    /* settings */
    $('swSmartMatch').checked = this.app.settings.smartMatch;
    $('swAutosave').checked = this.app.settings.autosave;
    $('swFps').checked = this.app.settings.fpsMeter;
    $('swSmartMatch').addEventListener('change', () => this.app.settings.smartMatch = $('swSmartMatch').checked);
    $('swAutosave').addEventListener('change', () => this.app.settings.autosave = $('swAutosave').checked);
    $('swFps').addEventListener('change', () => { this.app.settings.fpsMeter = $('swFps').checked; $('fps').style.display = this.app.settings.fpsMeter ? 'block' : 'none'; });
    document.querySelectorAll('#matchStrategy button').forEach(b => b.addEventListener('click', () => { this.app.settings.strategy = b.dataset.strategy; document.querySelectorAll('#matchStrategy button').forEach(x => x.classList.toggle('active', x === b)); }));
    document.querySelectorAll('#qualitySeg button').forEach(b => b.addEventListener('click', () => {
      this.app.settings.quality = b.dataset.quality;
      document.querySelectorAll('#qualitySeg button').forEach(x => x.classList.toggle('active', x === b));
      this.engine.setQuality(b.dataset.quality);
      this.toast(`Render quality → ${b.textContent}`);
    }));
    $('btnClearStorage').addEventListener('click', () => { localStorage.removeItem('genie-scene-autosave'); this.toast('Browser backup cleared'); });
    $('fps').style.display = this.app.settings.fpsMeter ? 'block' : 'none';
    setInterval(() => { if (this.app.settings.fpsMeter) $('fps').textContent = Math.round(this.engine.stats().fps) + ' FPS · ' + this.engine.stats().calls + ' calls'; }, 500);
  }
  updateUndoButtons() { $('btnUndo').style.opacity = this.app.undoStack.length ? 1 : 0.35; $('btnRedo').style.opacity = this.app.redoStack.length ? 1 : 0.35; }

  /* ═══════════ world panel ═══════════ */
  _bindWorldPanel() {
    const E = () => this.engine.env;
    const slider = (rng, num, fmt, apply) => {
      const r = $(rng), n = $(num);
      r.addEventListener('input', () => { n.textContent = fmt(+r.value); apply(+r.value); this.app.dirty = true; });
    };
    const deg = v => (+v).toFixed(0) + '°'; const one = v => (+v).toFixed(2);
    slider('rngElevation', 'numElevation', deg, v => { E().elevation = v; this.engine.applyEnvironment(E()); });
    slider('rngAzimuth', 'numAzimuth', deg, v => { E().azimuth = v; this.engine.applyEnvironment(E()); });
    slider('rngTurbidity', 'numTurbidity', v => (+v).toFixed(1), v => { E().turbidity = v; this.engine.applyEnvironment(E()); });
    slider('rngRayleigh', 'numRayleigh', v => (+v).toFixed(2), v => { E().rayleigh = v; this.engine.applyEnvironment(E()); });
    slider('rngSunI', 'numSunI', v => (+v).toFixed(2), v => { E().sunIntensity = v; this.engine.applyEnvironment(E()); });
    slider('rngFogNear', 'numFogNear', v => (+v).toFixed(0), v => { E().fog.near = v; this.engine.applyEnvironment(E()); });
    slider('rngFogFar', 'numFogFar', v => (+v).toFixed(0), v => { E().fog.far = v; this.engine.applyEnvironment(E()); });
    slider('rngHemi', 'numHemi', v => (+v).toFixed(2), v => { E().hemi = v; this.engine.applyEnvironment(E()); });
    slider('rngExposure', 'numExposure', one, v => { E().exposure = v; this.engine.applyEnvironment(E()); });
    slider('rngBloom', 'numBloom', one, v => { E().bloom.strength = v; this.engine.applyEnvironment(E()); });
    slider('rngBloomR', 'numBloomR', one, v => { E().bloom.radius = v; this.engine.applyEnvironment(E()); });
    slider('rngBloomT', 'numBloomT', one, v => { E().bloom.threshold = v; this.engine.applyEnvironment(E()); });
    slider('rngSat', 'numSat', one, v => { E().grade.saturation = v; this.engine.applyEnvironment(E()); });
    slider('rngContrast', 'numContrast', one, v => { E().grade.contrast = v; this.engine.applyEnvironment(E()); });
    slider('rngVig', 'numVig', one, v => { E().grade.vignette = v; this.engine.applyEnvironment(E()); });
    slider('rngGrain', 'numGrain', v => (+v).toFixed(2), v => { E().grade.grain = v; this.engine.applyEnvironment(E()); });
    $('swSky').addEventListener('change', () => { E().sky = $('swSky').checked; this.engine.applyEnvironment(E()); });
    $('swFog').addEventListener('change', () => { E().fog.on = $('swFog').checked; this.engine.applyEnvironment(E()); });
    $('swShadows').addEventListener('change', () => { E().shadows = $('swShadows').checked; this.engine.applyEnvironment(E()); });
    $('fogColor').addEventListener('input', () => { E().fog.color = $('fogColor').value; $('fogColorHex').textContent = $('fogColor').value.toUpperCase(); this.engine.applyEnvironment(E()); });
    $('bgColor').addEventListener('input', () => { E().background = $('bgColor').value; $('bgColorHex').textContent = $('bgColor').value.toUpperCase(); this.engine.applyEnvironment(E()); });
    document.querySelectorAll('#presetGrid .preset').forEach(btn => btn.addEventListener('click', () => {
      const env = this.engine.applyPreset(btn.dataset.preset);
      if (env) { document.querySelectorAll('#presetGrid .preset').forEach(x => x.classList.toggle('active', x === btn)); this.syncWorldPanel(); this.toast(`Preset — ${btn.querySelector('span').textContent}`); this.app.dirty = true; }
    }));
  }
  syncWorldPanel() {
    const E = this.engine.env;
    const set = (id, v) => { const n = $(id); if (n) n.value = v; };
    set('rngElevation', E.elevation); $('numElevation').textContent = deg2(E.elevation);
    set('rngAzimuth', E.azimuth); $('numAzimuth').textContent = deg2(E.azimuth);
    set('rngTurbidity', E.turbidity); $('numTurbidity').textContent = E.turbidity.toFixed(1);
    set('rngRayleigh', E.rayleigh); $('numRayleigh').textContent = E.rayleigh.toFixed(2);
    set('rngSunI', E.sunIntensity); $('numSunI').textContent = E.sunIntensity.toFixed(2);
    set('rngFogNear', E.fog.near); $('numFogNear').textContent = E.fog.near;
    set('rngFogFar', E.fog.far); $('numFogFar').textContent = E.fog.far;
    set('rngHemi', E.hemi); $('numHemi').textContent = E.hemi.toFixed(2);
    set('rngExposure', E.exposure); $('numExposure').textContent = E.exposure.toFixed(2);
    set('rngBloom', E.bloom.strength); $('numBloom').textContent = E.bloom.strength.toFixed(2);
    set('rngBloomR', E.bloom.radius); $('numBloomR').textContent = E.bloom.radius.toFixed(2);
    set('rngBloomT', E.bloom.threshold); $('numBloomT').textContent = E.bloom.threshold.toFixed(2);
    set('rngSat', E.grade.saturation); $('numSat').textContent = E.grade.saturation.toFixed(2);
    set('rngContrast', E.grade.contrast); $('numContrast').textContent = E.grade.contrast.toFixed(2);
    set('rngVig', E.grade.vignette); $('numVig').textContent = E.grade.vignette.toFixed(2);
    set('rngGrain', E.grade.grain); $('numGrain').textContent = E.grade.grain.toFixed(2);
    $('swSky').checked = E.sky; $('swFog').checked = E.fog.on; $('swShadows').checked = E.shadows;
    $('swGrid').checked = E.grid; $('swGround').checked = E.ground; $('btnGrid').classList.toggle('active', E.grid);
    $('fogColor').value = E.fog.color; $('fogColorHex').textContent = E.fog.color.toUpperCase();
    $('bgColor').value = E.background; $('bgColorHex').textContent = E.background.toUpperCase();

    function deg2(v) { return (+v).toFixed(0) + '°'; }
  }

  /* ═══════════ assets panel ═══════════ */
  _bindAssetsPanel() {
    $('fileInput').addEventListener('change', (e) => { const files = [...e.target.files]; if (files.length) this.app.ingestFiles(files); e.target.value = ''; });
    const dz = $('dropzone');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('over')));
    dz.addEventListener('drop', (e) => { e.preventDefault(); const files = [...(e.dataTransfer?.files || [])]; if (files.length) this.app.ingestFiles(files); });
    $('smartLogHead').addEventListener('click', () => $('smartLogBody').classList.toggle('hidden'));
  }
  renderAssets() {
    const grid = $('assetGrid');
    $('assetCount').textContent = this.assets.count() + (this.assets.count() === 1 ? ' ITEM' : ' ITEMS');
    grid.innerHTML = '';
    for (const item of this.assets.list()) {
      const roleBadge = item.kind === 'texture' && item.role ? item.role.replace('Map', '').toUpperCase() : item.kind.toUpperCase();
      const thumb = item.kind === 'model' ? (item.thumb || null) : item.kind === 'texture' ? (item.url || null) : null;
      const card = el(`<div class="asset-card" draggable="true" data-id="${esc(item.id)}" title="${esc(item.name)}">
        <div class="asset-thumb">
          ${thumb ? `<img src="${thumb}" alt="">` : `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1.3"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>`}
          <span class="type-badge">${roleBadge}</span>
        </div>
        <div class="asset-body">
          <div class="asset-name">${esc(item.name)}</div>
          <div class="asset-meta">${esc(item.ext.toUpperCase())} · ${esc(item.sizeLabel)}${item.zip ? ' · ' + esc(item.zip) : ''}</div>
          <div class="asset-actions">
            ${item.kind === 'model' ? `<button data-act="place">Place in scene</button>` : item.kind === 'hdr' ? `<button data-act="env">Set environment</button>` : `<button data-act="apply">Apply to selection</button>`}
          </div>
        </div>
        <button class="asset-del" title="Remove from vault">×</button>
      </div>`);
      card.querySelector('.asset-del').addEventListener('click', (e) => { e.stopPropagation(); this.assets.remove(item.id); });
      card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/genie-asset', item.id); e.dataTransfer.effectAllowed = 'copy'; });
      card.querySelectorAll('.asset-actions button').forEach(btn => btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'place') this.app.addAssetToScene(item);
        else if (act === 'env') { this.engine.setEnvironmentTexture(item.texture); this.toast(`Environment → ${item.name}`); }
        else if (act === 'apply') this.app.applyTextureToSelection(item, $('applyAsSelect').value);
      }));
      grid.appendChild(card);
    }
  }
  showSmartLog(entries, errors) {
    const log = $('smartLog');
    const body = $('smartLogBody');
    if (!entries.length && !errors?.length) { log.classList.add('hidden'); return; }
    log.classList.remove('hidden');
    $('smartLogCount').textContent = String(entries.length);
    let html = entries.map(e => `✓ <b style="color:#e7d8ff">${esc(e.texture)}</b> → ${esc(e.material)} <span style="color:var(--purple-2)">[${esc(e.role.replace('Map', ''))}]</span> score ${esc(e.score)}`).join('<br>');
    if (errors?.length) html += `<br>${errors.map(e => '⚠ ' + esc(e)).join('<br>')}`;
    body.innerHTML = html;
  }

  /* ═══════════ outliner ═══════════ */
  renderOutliner() {
    const list = $('outlinerList');
    const objs = this.engine.worldObjects();
    $('objCount').textContent = objs.length + (objs.length === 1 ? ' OBJECT' : ' OBJECTS');
    list.innerHTML = '';
    if (!objs.length) { list.appendChild(el(`<div class="empty"><div class="e2">Empty world.<br>Add something from Create, or drop an asset into the viewport.</div></div>`)); return; }
    for (const o of objs) {
      const kind = o.userData.lightKind || o.userData.primitive || (o.userData.assetId ? 'asset' : o.userData.procKind || 'box');
      const icon = KIND_ICONS[kind] || KIND_ICONS.box;
      const row = el(`<div class="out-row ${o === this.engine.selected ? 'sel' : ''} ${o.visible ? '' : 'hidden-row'}" data-uid="${esc(o.uuid)}">
        <span class="oi"><svg viewBox="0 0 24 24">${icon}</svg></span>
        <span class="on">${esc(o.name || 'Object')}</span>
        <button class="obtn ${o.visible ? '' : 'off'}" data-act="eye" title="Toggle visibility"><svg viewBox="0 0 24 24">${o.visible ? '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3.2"/>' : '<path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c7 0 11 7 11 7a17 17 0 0 1-3.3 4M6.6 6.6A16.6 16.6 0 0 0 1 12s4 7 11 7c1.1 0 2.2-.2 3.2-.6"/>'}</svg></button>
        <button class="obtn ${o.userData.locked ? '' : ''}" data-act="lock" title="Lock / unlock" style="${o.userData.locked ? 'color:#ffd166' : ''}"><svg viewBox="0 0 24 24">${o.userData.locked ? '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>' : '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>'}</svg></button>
      </div>`);
      row.addEventListener('click', (e) => { if (e.target.closest('.obtn')) return; this.engine.select(o); });
      row.querySelector('[data-act="eye"]').addEventListener('click', () => { o.visible = !o.visible; this.renderOutliner(); this.app.dirty = true; });
      row.querySelector('[data-act="lock"]').addEventListener('click', () => { o.userData.locked = !o.userData.locked; if (o.userData.locked && this.engine.selected === o) this.engine.select(null); this.renderOutliner(); this.app.dirty = true; this.app.pushUndo('Lock'); });
      list.appendChild(row);
    }
  }

  /* ═══════════ INSPECTOR ═══════════ */
  renderInspector() {
    const root = this.engine.selected;
    const scroll = $('inspectorScroll');
    const nameInput = $('objName');
    if (!root) {
      $('objBadge').textContent = 'SCENE';
      nameInput.value = 'Scene';
      const s = this.engine.stats();
      const count = this.engine.worldObjects().length;
      scroll.innerHTML = `
        <div class="empty"><img src="assets/orb-hero.jpg" alt=""><div class="e1">Nothing selected</div>
          <div class="e2">Tap any object in the viewport, or pick one from Layers.<br>Drag assets straight onto the canvas to place them.</div></div>
        <div class="sec"><div class="sec-title">Live Scene</div>
          <div class="kv"><span>Objects</span><b>${count}</b></div>
          <div class="kv"><span>Triangles</span><b>${s.triangles.toLocaleString()}</b></div>
          <div class="kv"><span>Draw calls</span><b>${s.calls}</b></div>
          <div class="kv"><span>Vault items</span><b>${this.assets.count()}</b></div>
        </div>
        <div class="sec"><div class="sec-title">Camera</div>
          <div class="slider-row"><span class="lab">Field of view</span><input type="range" id="rngFov" min="24" max="80" step="1" value="${this.engine.camera.fov}"><span class="num" id="numFov">${this.engine.camera.fov}°</span></div>
        </div>
        <div class="btn-row"><button class="mini-btn" id="inspOpenWorld">Open World Panel</button></div>`;
      scroll.querySelector('#rngFov').addEventListener('input', (e) => { this.engine.camera.fov = +e.target.value; this.engine.camera.updateProjectionMatrix(); scroll.querySelector('#numFov').textContent = e.target.value + '°'; });
      scroll.querySelector('#inspOpenWorld').addEventListener('click', () => this.openPanel('world'));
      return;
    }
    /* ── selected ── */
    const isLight = !!root.userData.lightKind;
    nameInput.value = root.name || 'Object';
    $('objBadge').textContent = isLight ? ('LIGHT · ' + root.userData.lightKind.toUpperCase()) : (root.userData.assetId ? 'MODEL' : (root.userData.primitive || root.userData.procKind || 'OBJECT').toUpperCase());
    const p = root.position, r = root.rotation, s = root.scale;
    const deg = (x) => (x * 180 / Math.PI).toFixed(1);
    const num = (v) => (+v).toFixed(2);
    const editable = [];
    root.traverse(o => { if (o.isMesh && o.material && !o.userData.isLightProxy) editable.push(o); });
    const m0 = editable.length ? (Array.isArray(editable[0].material) ? editable[0].material[0] : editable[0].material) : null;

    let html = `<div class="sec" style="margin-top:10px"><div class="sec-title">Transform</div>
      <div class="prop-grid">${['x','y','z'].map((a,i) => `<div class="prop-cell ${a}"><span class="ax">${a.toUpperCase()}</span><input type="number" step="0.1" data-t="pos" data-i="${i}" value="${num(p[a])}"></div>`).join('')}</div>
      <div class="prop-grid">${['x','y','z'].map((a,i) => `<div class="prop-cell ${a}"><span class="ax">∠</span><input type="number" step="1" data-t="rot" data-i="${i}" value="${deg(r[a])}"></div>`).join('')}</div>
      <div class="prop-grid">${['x','y','z'].map((a,i) => `<div class="prop-cell ${a}"><span class="ax">S</span><input type="number" step="0.05" data-t="scale" data-i="${i}" value="${num(s[a])}"></div>`).join('')}</div>
    </div>`;

    if (isLight) {
      const L = root.userData.light;
      html += `<div class="sec"><div class="sec-title">Light</div>
        <div class="color-row"><input type="color" id="lightColor" value="#${L.color.getHexString()}"><span class="hex">${'#' + L.color.getHexString().toUpperCase()}</span></div>
        <div class="slider-row"><span class="lab">Intensity</span><input type="range" id="rngLightI" min="0" max="${root.userData.lightKind === 'hemi' ? 3 : 300}" step="0.1" value="${L.intensity}"><span class="num" id="numLightI">${(+L.intensity).toFixed(1)}</span></div>
        ${root.userData.lightKind === 'spot' ? `<div class="slider-row"><span class="lab">Cone</span><input type="range" id="rngSpotA" min="0.08" max="1.2" step="0.01" value="${L.angle}"><span class="num" id="numSpotA">${(L.angle * 180 / Math.PI).toFixed(0)}°</span></div>
        <div class="slider-row"><span class="lab">Softness</span><input type="range" id="rngSpotP" min="0" max="1" step="0.01" value="${L.penumbra}"><span class="num" id="numSpotP">${(+L.penumbra).toFixed(2)}</span></div>` : ''}
        ${root.userData.lightKind !== 'hemi' ? `<div class="slider-row"><span class="lab">Range</span><input type="range" id="rngLightD" min="0" max="120" step="0.5" value="${L.distance || 0}"><span class="num" id="numLightD">${L.distance ? (+L.distance).toFixed(1) + ' m' : '∞'}</span></div>` : ''}
        ${(root.userData.lightKind !== 'hemi') ? `<div class="row"><label for="swLightShadow">Cast shadow</label><span class="switch"><input type="checkbox" id="swLightShadow" ${L.castShadow ? 'checked' : ''}><i></i></span></div>` : ''}
      </div>`;
    } else if (m0) {
      const hex = (c) => '#' + c.getHexString();
      html += `<div class="sec"><div class="sec-title">Material${editable.length > 1 ? ` <span style="color:var(--dim-2);font-weight:400;text-transform:none;letter-spacing:0">(${editable.length} meshes)</span>` : ''}</div>
        <div class="color-row"><input type="color" id="matColor" value="${hex(m0.color)}"><span class="hex">${hex(m0.color).toUpperCase()}</span></div>
        <div class="slider-row"><span class="lab">Metalness</span><input type="range" id="rngMetal" min="0" max="1" step="0.01" value="${m0.metalness ?? 0}"><span class="num" id="numMetal">${(m0.metalness ?? 0).toFixed(2)}</span></div>
        <div class="slider-row"><span class="lab">Roughness</span><input type="range" id="rngRough" min="0" max="1" step="0.01" value="${m0.roughness ?? 0.5}"><span class="num" id="numRough">${(m0.roughness ?? 0.5).toFixed(2)}</span></div>
        <div class="color-row"><input type="color" id="matEmissive" value="${m0.emissive ? hex(m0.emissive) : '#000000'}"><span class="hex">EMISSIVE</span></div>
        <div class="slider-row"><span class="lab">Emiss. str</span><input type="range" id="rngEmissI" min="0" max="4" step="0.02" value="${m0.emissiveIntensity ?? 1}"><span class="num" id="numEmissI">${(m0.emissiveIntensity ?? 1).toFixed(2)}</span></div>
        <div class="slider-row"><span class="lab">Opacity</span><input type="range" id="rngOpacity" min="0" max="1" step="0.01" value="${m0.opacity ?? 1}"><span class="num" id="numOpacity">${(m0.opacity ?? 1).toFixed(2)}</span></div>
        <div class="row"><label for="swWire">Wireframe</label><span class="switch"><input type="checkbox" id="swWire" ${m0.wireframe ? 'checked' : ''}><i></i></span></div>
        <div class="row"><label for="swTrans">Transparent</label><span class="switch"><input type="checkbox" id="swTrans" ${m0.transparent ? 'checked' : ''}><i></i></span></div>
        <div class="row"><label for="swFlat">Flat shading</label><span class="switch"><input type="checkbox" id="swFlat" ${m0.flatShading ? 'checked' : ''}><i></i></span></div>
      </div>
      <div class="sec"><div class="sec-title">Textures <span style="color:var(--dim-2);font-weight:400;text-transform:none;letter-spacing:0">tap a slot · or drop a texture onto it</span></div>
        <div class="tex-grid" id="texGrid">
          ${['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap'].map(role => {
            const t = m0[role];
            const img = t?.image?.src || t?.image?.currentSrc || null;
            return `<div class="tex-slot ${t ? 'filled' : ''}" data-role="${role}" title="${role.replace('Map','')}">
              ${img ? `<img src="${img}" alt="">` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>`}
              <span class="role">${role.replace('Map','').replace('roughness','ROUGH').replace('metalness','METAL').replace('emissive','EMIS').replace(/^(map|normal|ao)$/i, m => m.toUpperCase())}</span>
              ${t ? `<span class="clear" data-clear="${role}">×</span>` : ''}
            </div>`;
          }).join('')}
        </div>
        <div class="slider-row"><span class="lab">Tiling X</span><input type="range" id="rngRepX" min="0.1" max="12" step="0.1" value="${m0.map?.repeat?.x ?? 1}"><span class="num" id="numRepX">${(m0.map?.repeat?.x ?? 1).toFixed(1)}</span></div>
        <div class="slider-row"><span class="lab">Tiling Y</span><input type="range" id="rngRepY" min="0.1" max="12" step="0.1" value="${m0.map?.repeat?.y ?? 1}"><span class="num" id="numRepY">${(m0.map?.repeat?.y ?? 1).toFixed(1)}</span></div>
        <div class="slider-row"><span class="lab">Normal scl</span><input type="range" id="rngNormS" min="0" max="2" step="0.01" value="${m0.normalScale ? m0.normalScale.x : 1}"><span class="num" id="numNormS">${m0.normalScale ? m0.normalScale.x.toFixed(2) : '1.00'}</span></div>
        <div class="btn-row"><button class="mini-btn" id="btnClearMaps">Clear all maps</button><button class="mini-btn" id="btnApplyAll">Apply vault “Apply as”</button></div>
        <div id="texPicker" class="hidden" style="display:none;flex-wrap:wrap;gap:6px;padding:8px;border:1px dashed var(--stroke-2);border-radius:12px;margin:6px 0;max-height:150px;overflow:auto;"></div>
      </div>`;
    }

    html += `<div class="sec"><div class="sec-title">Object</div>
      <div class="row"><label for="swCast">Cast shadow</label><span class="switch"><input type="checkbox" id="swCast" checked><i></i></span></div>
      <div class="row"><label for="swRecv">Receive shadow</label><span class="switch"><input type="checkbox" id="swRecv" checked><i></i></span></div>
      <div class="btn-row"><button class="mini-btn" id="btnInspGround">Snap to ground</button><button class="mini-btn" id="btnInspNormalize">Normalize size</button><button class="mini-btn warn" id="btnInspDelete">Delete</button></div>
    </div>`;
    scroll.innerHTML = html;
    this._wireInspector(root, editable);
    nameInput.onchange = () => { root.name = nameInput.value.trim() || root.name; this.renderOutliner(); this.app.dirty = true; };
  }

  _wireInspector(root, editable) {
    const scroll = $('inspectorScroll');
    const commitUndo = () => this.app.pushUndo('Edit');
    /* transform */
    scroll.querySelectorAll('[data-t]').forEach(inp => inp.addEventListener('change', () => {
      const i = +inp.dataset.i, t = inp.dataset.t, v = +inp.value;
      const arr = ['x', 'y', 'z'];
      if (t === 'pos') root.position[arr[i]] = v;
      else if (t === 'rot') root.rotation[arr[i]] = v * Math.PI / 180;
      else root.scale[arr[i]] = v;
      this.renderOutliner(); commitUndo();
    }));
    const light = root.userData.light;
    if (light) {
      $('lightColor')?.addEventListener('input', e => { light.color.set(e.target.value); this.app.dirty = true; });
      $('rngLightI')?.addEventListener('input', e => { light.intensity = +e.target.value; $('numLightI').textContent = (+e.target.value).toFixed(1); this.app.dirty = true; });
      $('rngSpotA')?.addEventListener('input', e => { light.angle = +e.target.value; $('numSpotA').textContent = Math.round(e.target.value * 180 / Math.PI) + '°'; this.app.dirty = true; });
      $('rngSpotP')?.addEventListener('input', e => { light.penumbra = +e.target.value; $('numSpotP').textContent = (+e.target.value).toFixed(2); this.app.dirty = true; });
      $('rngLightD')?.addEventListener('input', e => { light.distance = +e.target.value; $('numLightD').textContent = +e.target.value > 0 ? (+e.target.value).toFixed(1) + ' m' : '∞'; this.app.dirty = true; });
      $('swLightShadow')?.addEventListener('change', e => { light.castShadow = e.target.checked; commitUndo(); });
    }
    const eachMat = (fn) => editable.forEach(o => (Array.isArray(o.material) ? o.material : [o.material]).forEach(fn));
    if ($('matColor')) {
      $('matColor').addEventListener('input', e => { eachMat(m => m.color && m.color.set(e.target.value)); $('matColor').nextElementSibling.textContent = e.target.value.toUpperCase(); this.app.dirty = true; });
      $('matColor').addEventListener('change', commitUndo);
      const wireSlider = (id, numId, fmt, apply) => {
        $(id)?.addEventListener('input', e => { apply(+e.target.value); const n = $(numId); if (n) n.textContent = fmt(+e.target.value); this.app.dirty = true; });
        $(id)?.addEventListener('change', commitUndo);
      };
      wireSlider('rngMetal', 'numMetal', v => v.toFixed(2), v => eachMat(m => m.metalness = v));
      wireSlider('rngRough', 'numRough', v => v.toFixed(2), v => eachMat(m => m.roughness = v));
      wireSlider('rngEmissI', 'numEmissI', v => v.toFixed(2), v => eachMat(m => m.emissiveIntensity = v));
      wireSlider('rngOpacity', 'numOpacity', v => v.toFixed(2), v => eachMat(m => { m.opacity = v; }));
      wireSlider('rngRepX', 'numRepX', v => v.toFixed(1), v => eachMat(m => { for (const k of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap']) if (m[k]) m[k].repeat.x = v; }));
      wireSlider('rngRepY', 'numRepY', v => v.toFixed(1), v => eachMat(m => { for (const k of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap']) if (m[k]) m[k].repeat.y = v; }));
      wireSlider('rngNormS', 'numNormS', v => v.toFixed(2), v => eachMat(m => { if (m.normalScale) m.normalScale.set(v, v); }));
      $('matEmissive')?.addEventListener('input', e => { eachMat(m => m.emissive && m.emissive.set(e.target.value)); this.app.dirty = true; });
      $('matEmissive')?.addEventListener('change', commitUndo);
      $('swWire')?.addEventListener('change', e => { eachMat(m => m.wireframe = e.target.checked); commitUndo(); });
      $('swTrans')?.addEventListener('change', e => { eachMat(m => { m.transparent = e.target.checked; m.needsUpdate = true; }); commitUndo(); });
      $('swFlat')?.addEventListener('change', e => { eachMat(m => { m.flatShading = e.target.checked; m.needsUpdate = true; }); commitUndo(); });
      $('btnClearMaps')?.addEventListener('click', () => { eachMat(m => { for (const k of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap']) m[k] = null; m.needsUpdate = true; }); this.renderInspector(); commitUndo(); });

      /* texture slots — tap to pick from vault, drop to assign, × to clear */
      scroll.querySelectorAll('.tex-slot').forEach(slot => {
        const role = slot.dataset.role;
        slot.addEventListener('click', (e) => {
          if (e.target.closest('.clear')) return;
          this._openTexPicker(role, slot);
        });
        slot.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/genie-asset')) { e.preventDefault(); slot.classList.add('drop-hint'); } });
        slot.addEventListener('dragleave', () => slot.classList.remove('drop-hint'));
        slot.addEventListener('drop', (e) => {
          e.preventDefault(); slot.classList.remove('drop-hint');
          const id = e.dataTransfer.getData('text/genie-asset');
          const item = id && this.assets.get(id);
          if (item && item.kind === 'texture') this.app.applyTextureToSelection(item, role);
        });
        const clearBtn = slot.querySelector('.clear');
        if (clearBtn) clearBtn.addEventListener('click', () => { eachMat(m => { m[role] = null; m.needsUpdate = true; }); this.renderInspector(); commitUndo(); });
      });
      $('btnApplyAll')?.addEventListener('click', () => {
        const mode = $('applyAsSelect').value;
        this.toast('Tip: pick a vault texture, press its Apply button.', 'ok', 2600);
      });
    }
    /* object flags */
    const cast = $('swCast'), recv = $('swRecv');
    const meshes = []; root.traverse(o => { if (o.isMesh && !o.userData.isLightProxy) meshes.push(o); });
    if (cast && meshes.length) cast.checked = meshes.every(m => m.castShadow);
    if (recv && meshes.length) recv.checked = meshes.every(m => m.receiveShadow);
    cast?.addEventListener('change', () => { meshes.forEach(m => m.castShadow = cast.checked); commitUndo(); });
    recv?.addEventListener('change', () => { meshes.forEach(m => m.receiveShadow = recv.checked); commitUndo(); });
    $('btnInspGround')?.addEventListener('click', () => { this.engine.snapToGround(); commitUndo(); });
    $('btnInspNormalize')?.addEventListener('click', () => { this.engine.normalizeSize(); this.renderInspector(); commitUndo(); });
    $('btnInspDelete')?.addEventListener('click', () => this.app.deleteSelection());
  }

  _openTexPicker(role, slot) {
    const picker = $('texPicker');
    const textures = this.assets.list().filter(i => i.kind === 'texture');
    if (!textures.length) { this.toast('Vault has no textures yet — drop some in the Assets tab', 'warn'); return; }
    picker.style.display = 'flex'; picker.classList.remove('hidden');
    picker.innerHTML = textures.map(t => `<button class="tex-pick" data-id="${esc(t.id)}" title="${esc(t.name)}" style="width:56px;height:56px;border-radius:10px;border:1px solid var(--stroke-2);background:url('${esc(t.thumb || t.url)}') center/cover;cursor:pointer;"></button>`).join('');
    picker.querySelectorAll('.tex-pick').forEach(btn => btn.addEventListener('click', () => {
      const item = this.assets.get(btn.dataset.id);
      if (item) this.app.applyTextureToSelection(item, role);
      picker.style.display = 'none'; picker.classList.add('hidden');
    }));
  }

  /* ═══════════ camera bar + turntable ═══════════ */
  _bindCambar() {
    $('camOrbit').addEventListener('click', () => this.engine.setCameraView('orbit'));
    $('camTop').addEventListener('click', () => this.engine.setCameraView('top'));
    $('camFront').addEventListener('click', () => this.engine.setCameraView('front'));
    $('camRight').addEventListener('click', () => this.engine.setCameraView('right'));
    $('camFocus').addEventListener('click', () => this.engine.focusSelected());
    $('camTurntable').addEventListener('click', () => { const on = !$('camTurntable').classList.contains('active'); $('camTurntable').classList.toggle('active', on); this.engine.setTurntable(on); });
  }

  /* ═══════════ PHOTO MODE ═══════════ */
  _bindPhotoMode() {
    const p = this.photo;
    $('photo-exit').addEventListener('click', () => this.exitPhotoMode());
    const seg = (id, key, cb) => document.querySelectorAll(`#${id} button`).forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle('active', x === b));
      p[key] = key === 'timer' || key === 'scale' ? +b.dataset[key] : b.dataset[key === 'aspect' ? 'aspect' : 'filter'];
      if (cb) cb(); this._updateLetterbox();
    }));
    seg('aspectSeg', 'aspect', () => { p.aspect = document.querySelector('#aspectSeg button.active').dataset.aspect; });
    seg('timerSeg', 'timer', null);
    seg('filterSeg', 'filter', () => { this.engine.setFilter(p.filter); });
    seg('scaleSeg', 'scale', null);
    $('photoGridBtn').addEventListener('click', () => document.body.classList.toggle('photogrid'));
    $('shutter').addEventListener('click', () => this.capture());
    window.addEventListener('resize', () => this._updateLetterbox());
  }
  enterPhotoMode() {
    this.photo.active = true;
    document.body.classList.add('photomode');
    $('inspector').classList.remove('open'); $('sidepanel').classList.remove('open');
    this._updateLetterbox();
  }
  exitPhotoMode() {
    this.photo.active = false;
    document.body.classList.remove('photomode', 'photogrid');
    this.engine.setFilter('none');
    if (window.matchMedia('(min-width: 901px)').matches) $('sidepanel').classList.add('open');
  }
  _updateLetterbox() {
    if (!this.photo.active) return;
    const target = { free: null, '1:1': 1, '4:5': 0.8, '3:2': 1.5, '16:9': 16 / 9, '2.39:1': 2.39 }[this.photo.aspect];
    const top = $('lb-top'), bot = $('lb-bottom');
    if (!target) { top.style.height = '0px'; bot.style.height = '0px'; return; }
    const w = window.innerWidth, h = window.innerHeight;
    const current = w / h;
    if (current > target) { top.style.height = '0px'; bot.style.height = '0px'; return; }
    const barH = (h - w / target) / 2;
    top.style.height = barH + 'px'; bot.style.height = barH + 'px';
  }
  async capture() {
    const doShot = async () => {
      $('shotFlash').classList.remove('go'); void $('shotFlash').offsetWidth; $('shotFlash').classList.add('go');
      const url = await this.engine.capturePhoto({ aspect: this.photo.aspect === 'free' ? null : this.photo.aspect, filter: this.photo.filter, scale: this.photo.scale });
      const shot = { url, name: 'genie-' + Date.now() + '.png' };
      this.photo.shots.unshift(shot);
      const img = el(`<img class="shot-thumb" src="${url}" title="Click to download">`);
      img.addEventListener('click', () => { const a = document.createElement('a'); a.href = url; a.download = shot.name; a.click(); });
      $('shotStrip').prepend(img);
      this.toast('Frame captured — tap the thumbnail to save');
    };
    const t = this.photo.timer;
    if (t > 0) {
      let n = t;
      this.toast(`Capturing in ${n}…`, 'ok', 900);
      const tick = setInterval(() => {
        n -= 1;
        if (n <= 0) { clearInterval(tick); doShot(); } else this.toast(`Capturing in ${n}…`, 'ok', 900);
      }, 1000);
    } else doShot();
  }

  /* ═══════════ menus / modals ═══════════ */
  toggleMenu(id, anchor) {
    const menu = $(id);
    const willShow = !menu.classList.contains('on');
    document.querySelectorAll('.menu').forEach(m => m.classList.remove('on'));
    if (willShow) {
      const r = anchor.getBoundingClientRect();
      menu.style.top = (r.bottom + 10) + 'px';
      menu.style.left = Math.max(12, Math.min(window.innerWidth - 260, r.right - 240)) + 'px';
      menu.classList.add('on');
      const close = () => { menu.classList.remove('on'); window.removeEventListener('click', close); };
      setTimeout(() => window.addEventListener('click', close), 0);
    }
  }
  _bindMenus() {
    $('expSceneGLB').addEventListener('click', () => this.app.exportSceneGLB());
    $('expSelGLB').addEventListener('click', () => this.app.exportSelectionGLB());
    $('expSelSTL').addEventListener('click', () => this.app.exportSelectionSTL());
    $('expProject').addEventListener('click', () => this.app.saveProject());
    $('expBrowser').addEventListener('click', () => this.app.quickSave(true));
  }

  _bindInspectorDelegation() { /* reserved for future context menus */ }

  /* ═══════════ keyboard ═══════════ */
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); this.app.quickSave(true); return; }
      if (typing) return;
      if (mod && (e.key === 'z')) { e.preventDefault(); if (e.shiftKey) this.app.redo(); else this.app.undo(); return; }
      if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); this.app.duplicate(); return; }
      if (e.key === 'q' || e.key === 'Q') this.setTool('select');
      else if (e.key === 'w' || e.key === 'W') this.setTool('translate');
      else if (e.key === 'e' || e.key === 'E') this.setTool('rotate');
      else if (e.key === 'r' || e.key === 'R') this.setTool('scale');
      else if (e.key === 'f' || e.key === 'F') this.engine.focusSelected();
      else if (e.key === 'g') { const v = !($('swSnap').checked); $('swSnap').checked = v; $('swSnap').dispatchEvent(new Event('change')); }
      else if (e.key === 'G') { const v = !($('swGrid').checked); $('swGrid').checked = v; $('swGrid').dispatchEvent(new Event('change')); }
      else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('chrome-hidden');
      else if (e.key === 'p' || e.key === 'P') this.photo.active ? this.exitPhotoMode() : this.enterPhotoMode();
      else if (e.key === ' ' && this.photo.active) { e.preventDefault(); this.capture(); }
      else if (e.key === 'Escape') {
        const openModal = document.querySelector('.modal-veil.on');
        if (openModal) { openModal.classList.remove('on'); return; }
        document.querySelectorAll('.menu.on').forEach(mm => mm.classList.remove('on'));
        if (this.photo.active) this.exitPhotoMode(); else this.engine.select(null);
      }
      else if (e.key === 'Delete' || e.key === 'Backspace') this.app.deleteSelection();
    });
  }

  /* ═══════════ global drag & drop → placement ═══════════ */
  _bindGlobalDrop() {
    const hint = $('placeHint');
    let dragDepth = 0;
    const isAssetDrag = (e) => [...(e.dataTransfer?.types || [])].includes('text/genie-asset');
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!isAssetDrag(e) && !hasFiles(e)) return;
      dragDepth++;
      hint.classList.add('on');
      hint.querySelector('.t1').textContent = hasFiles(e) ? 'Release to import' : 'Release to place';
    });
    window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) hint.classList.remove('on'); });
    window.addEventListener('dragover', (e) => { if (isAssetDrag(e) || hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      hint.classList.remove('on'); dragDepth = 0;
      const files = [...(e.dataTransfer?.files || [])];
      const assetId = e.dataTransfer?.getData('text/genie-asset');
      if (assetId) {
        e.preventDefault();
        const item = this.assets.get(assetId);
        if (item) this.app.addAssetToScene(item, { x: e.clientX, y: e.clientY });
        return;
      }
      if (files.length) { e.preventDefault(); this.app.ingestFiles(files); }
    });
  }
}
