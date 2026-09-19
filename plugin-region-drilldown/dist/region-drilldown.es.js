/* OneEarth Region Drilldown v1.0.0 | Cesium is a peer dependency */

// src/index.js
import * as Cesium from "cesium";

// src/core.js
var DEFAULT_COLORS = {
  accent: "#55D6FF",
  accentStrong: "#13B9FF",
  fill: "#0B2B4A",
  text: "#FFFFFF",
  muted: "#B8D8EA",
  danger: "#FF7A70"
};
var DEFAULT_OPTIONS = {
  initialLevel: "country",
  levels: ["country", "province", "city"],
  container: null,
  dataProvider: null,
  filters: {},
  showControls: true,
  controlsTitle: "\u884C\u653F\u533A\u4E0B\u94BB",
  backText: "\u8FD4\u56DE\u4E0A\u4E00\u7EA7",
  worldViewHeight: 225e5,
  regionViewHeight: 42e5,
  cameraDuration: 1.15,
  minMarkerSize: 62,
  maxMarkerSize: 92,
  layoutPadding: 8,
  colors: DEFAULT_COLORS,
  zIndex: 20
};
function toArray(value) {
  return Array.isArray(value) ? value : [];
}
function numberOrNull(value) {
  if (value === null || value === void 0 || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function firstFinite(values) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number !== null) {
      return number;
    }
  }
  return null;
}
function normalizeCenter(region) {
  const raw = region.center || region.centroid || region.point || null;
  if (Array.isArray(raw) && raw.length >= 2) {
    const longitude2 = numberOrNull(raw[0]);
    const latitude2 = numberOrNull(raw[1]);
    return longitude2 === null || latitude2 === null ? null : [longitude2, latitude2];
  }
  if (raw && typeof raw === "object") {
    const longitude2 = firstFinite([raw.longitude, raw.lon, raw.lng, raw.x]);
    const latitude2 = firstFinite([raw.latitude, raw.lat, raw.y]);
    return longitude2 === null || latitude2 === null ? null : [longitude2, latitude2];
  }
  const longitude = firstFinite([region.longitude, region.lon, region.lng]);
  const latitude = firstFinite([region.latitude, region.lat]);
  return longitude === null || latitude === null ? null : [longitude, latitude];
}
function normalizeBounds(region) {
  const raw = region.bounds || region.bbox || region.extent || null;
  if (!Array.isArray(raw) || raw.length < 4) {
    return null;
  }
  const values = raw.slice(0, 4).map(numberOrNull);
  if (values.some((value) => value === null)) {
    return null;
  }
  if (values[0] > values[2] || values[1] > values[3]) {
    return null;
  }
  return values;
}
function normalizeRegion(input, fallbackLevel) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const code = String(input.code ?? input.regionCode ?? input.id ?? "").trim();
  if (!code) {
    return null;
  }
  const datasetCount = firstFinite([
    input.datasetCount,
    input.dataset_count,
    input.count,
    input.total
  ]) ?? 0;
  const paperCount = firstFinite([
    input.paperCount,
    input.paper_count
  ]) ?? 0;
  const hasChildrenValue = input.hasChildren ?? input.has_children ?? input.hasChild;
  const center = normalizeCenter(input);
  const bounds = normalizeBounds(input);
  return {
    ...input,
    code,
    name: String(input.name ?? input.regionName ?? input.label ?? code),
    level: String(input.level ?? fallbackLevel ?? ""),
    parentCode: input.parentCode ?? input.parent_code ?? null,
    hasChildren: hasChildrenValue === true || hasChildrenValue === 1 || String(hasChildrenValue).toLowerCase() === "true",
    childLevel: input.childLevel ?? input.child_level ?? null,
    center,
    bounds,
    datasetCount: Math.max(0, Math.round(datasetCount)),
    paperCount: Math.max(0, Math.round(paperCount))
  };
}
function normalizeRegionPayload(payload, fallbackLevel) {
  const list = Array.isArray(payload) ? payload : toArray(payload && (payload.items || payload.regions || payload.data || payload.children));
  return list.map((item) => normalizeRegion(item, fallbackLevel)).filter(Boolean);
}
function normalizeCountPayload(payload, regions) {
  const source = payload && (payload.counts || payload.data || payload.items) ? payload.counts || payload.data || payload.items : payload;
  if (Array.isArray(source)) {
    const map = {};
    source.forEach((item) => {
      if (item && item.code) {
        map[String(item.code)] = item;
      }
    });
    return map;
  }
  if (source && typeof source === "object") {
    return source;
  }
  return regions.reduce((map, region) => {
    map[region.code] = {
      datasetCount: region.datasetCount,
      paperCount: region.paperCount
    };
    return map;
  }, {});
}
function applyCounts(regions, payload) {
  const counts = normalizeCountPayload(payload, regions);
  return regions.map((region) => {
    const item = counts[region.code];
    if (item === void 0 || item === null) {
      return region;
    }
    if (typeof item === "number") {
      return { ...region, datasetCount: Math.max(0, Math.round(item)) };
    }
    const datasetCount = firstFinite([
      item.datasetCount,
      item.dataset_count,
      item.count,
      item.total
    ]);
    const paperCount = firstFinite([item.paperCount, item.paper_count]);
    return {
      ...region,
      datasetCount: datasetCount === null ? region.datasetCount : Math.max(0, Math.round(datasetCount)),
      paperCount: paperCount === null ? region.paperCount : Math.max(0, Math.round(paperCount))
    };
  });
}
function formatCount(value) {
  const number = Math.max(0, Number(value) || 0);
  if (number >= 1e8) {
    return `${(number / 1e8).toFixed(number >= 1e9 ? 0 : 1)}\u4EBF`;
  }
  if (number >= 1e4) {
    return `${(number / 1e4).toFixed(number >= 1e5 ? 0 : 1)}\u4E07`;
  }
  return number.toLocaleString("zh-CN");
}
function shortName(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "\u672A\u547D\u540D";
  }
  const containsChinese = /[\u3400-\u9fff]/.test(text);
  const limit = containsChinese ? 6 : 12;
  return text.length > limit ? `${text.slice(0, limit)}\u2026` : text;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function nextLevel(level, levels) {
  const index = levels.indexOf(level);
  return index >= 0 && index < levels.length - 1 ? levels[index + 1] : null;
}
function worldToWindow(Cesium2, viewer, position) {
  const transforms = Cesium2.SceneTransforms;
  if (!transforms || !viewer || viewer.isDestroyed()) {
    return null;
  }
  if (typeof transforms.worldToWindowCoordinates === "function") {
    return transforms.worldToWindowCoordinates(viewer.scene, position);
  }
  if (typeof transforms.wgs84ToWindowCoordinates === "function") {
    return transforms.wgs84ToWindowCoordinates(viewer.scene, position);
  }
  return null;
}
function buildMarkerCanvas(documentRef, region, size, hovered, colors) {
  const view = documentRef.defaultView || window;
  const pixelRatio = Math.min(2, Math.max(1, view.devicePixelRatio || 1));
  const canvas = documentRef.createElement("canvas");
  canvas.width = Math.round(size * pixelRatio);
  canvas.height = Math.round(size * pixelRatio);
  const context = canvas.getContext("2d");
  context.scale(pixelRatio, pixelRatio);
  const center = size / 2;
  const radius = size * 0.39;
  const glow = context.createRadialGradient(center, center, radius * 0.5, center, center, size * 0.5);
  glow.addColorStop(0, hovered ? "rgba(85,214,255,0.44)" : "rgba(85,214,255,0.25)");
  glow.addColorStop(0.72, "rgba(19,185,255,0.12)");
  glow.addColorStop(1, "rgba(19,185,255,0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(center, center, size * 0.5, 0, Math.PI * 2);
  context.fill();
  const body = context.createLinearGradient(0, 0, 0, size);
  body.addColorStop(0, hovered ? "rgba(20,111,160,0.98)" : "rgba(10,66,106,0.96)");
  body.addColorStop(1, "rgba(5,35,65,0.98)");
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fillStyle = body;
  context.fill();
  context.lineWidth = hovered ? 3 : 2;
  context.strokeStyle = hovered ? colors.text : colors.accent;
  context.stroke();
  context.beginPath();
  context.arc(center, center, radius * 0.82, -0.25 * Math.PI, 0.15 * Math.PI);
  context.lineWidth = 1.5;
  context.strokeStyle = "rgba(255,255,255,0.3)";
  context.stroke();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = colors.text;
  context.font = `600 ${Math.max(11, Math.round(size * 0.16))}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  context.fillText(shortName(region.name), center, center - size * 0.12);
  context.fillStyle = colors.accent;
  context.font = `700 ${Math.max(12, Math.round(size * 0.17))}px "DIN Alternate", "PingFang SC", sans-serif`;
  context.fillText(`${formatCount(region.datasetCount)} \u96C6`, center, center + size * 0.11);
  if (region.paperCount > 0) {
    context.fillStyle = colors.muted;
    context.font = `500 ${Math.max(9, Math.round(size * 0.105))}px "PingFang SC", sans-serif`;
    context.fillText(`${formatCount(region.paperCount)} \u7BC7`, center, center + size * 0.28);
  }
  return canvas;
}
function ensureStyles(documentRef) {
  const id = "region-drilldown-plugin-styles";
  if (documentRef.getElementById(id)) {
    return;
  }
  const style = documentRef.createElement("style");
  style.id = id;
  style.textContent = `
.rdp-controls{position:absolute;top:18px;left:18px;z-index:20;display:flex;align-items:center;gap:10px;max-width:calc(100% - 36px);padding:8px 11px;border:1px solid rgba(85,214,255,.28);border-radius:10px;background:rgba(7,20,34,.86);box-shadow:0 12px 30px rgba(0,0,0,.28);backdrop-filter:blur(12px);color:#eaf8ff;font-family:"PingFang SC","Microsoft YaHei",sans-serif;pointer-events:auto}
.rdp-back{flex:0 0 auto;border:1px solid rgba(85,214,255,.35);border-radius:7px;background:rgba(17,74,105,.72);color:#dff8ff;padding:7px 10px;font-size:12px;cursor:pointer}
.rdp-back:hover{background:rgba(28,124,165,.86)}
.rdp-back:disabled{opacity:.38;cursor:default}
.rdp-breadcrumb{display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden;white-space:nowrap}
.rdp-crumb{border:0;background:transparent;color:#8ecde8;padding:2px 3px;font-size:12px;cursor:pointer;max-width:120px;overflow:hidden;text-overflow:ellipsis}
.rdp-crumb:hover,.rdp-crumb[aria-current="page"]{color:#fff}
.rdp-separator{color:rgba(182,222,240,.38);font-size:11px}
.rdp-status{flex:0 0 auto;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9fd4e8;font-size:11px}
.rdp-status[data-error="true"]{color:#ff9d96}
`;
  documentRef.head.appendChild(style);
}
function normalizeProvider(provider) {
  if (!provider || typeof provider.listChildren !== "function") {
    throw new Error("dataProvider \u5FC5\u987B\u63D0\u4F9B listChildren() \u65B9\u6CD5");
  }
  return provider;
}
var RegionDrilldownController = class {
  constructor(Cesium2, viewer, rawOptions) {
    if (!Cesium2) {
      throw new Error("\u7F3A\u5C11 Cesium\uFF0C\u8BF7\u5728 ESM \u73AF\u5883\u5BFC\u5165 cesium\uFF0C\u6216\u5728 UMD \u73AF\u5883\u5148\u52A0\u8F7D Cesium.js");
    }
    if (!viewer || viewer.isDestroyed()) {
      throw new Error("createRegionDrilldown \u9700\u8981\u4E00\u4E2A\u6709\u6548\u7684 Cesium Viewer");
    }
    this.Cesium = Cesium2;
    this.viewer = viewer;
    this.options = { ...DEFAULT_OPTIONS, ...rawOptions || {} };
    this.options.colors = { ...DEFAULT_COLORS, ...rawOptions && rawOptions.colors };
    this.levels = this.options.levels.slice();
    this.provider = normalizeProvider(this.options.dataProvider || this.options.provider);
    this.document = viewer.container && viewer.container.ownerDocument ? viewer.container.ownerDocument : document;
    this.dataSource = new Cesium2.CustomDataSource("\u884C\u653F\u533A\u5706\u5708\u4E0B\u94BB");
    this.viewer.dataSources.add(this.dataSource);
    this.handler = new Cesium2.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.listeners = /* @__PURE__ */ new Map();
    this.markerStates = [];
    this.path = [{ code: "WORLD", name: "\u5168\u7403", level: "world", childLevel: this.options.initialLevel }];
    this.level = this.options.initialLevel;
    this.parentCode = null;
    this.regions = [];
    this.filters = { ...this.options.filters || {} };
    this.cache = /* @__PURE__ */ new Map();
    this.loadToken = 0;
    this.destroyed = false;
    this.visible = true;
    this.hovered = null;
    this.cacheVersion = 0;
    this.controls = null;
    this.removePostRender = null;
    this.controlsContainerPosition = null;
    this.installEvents();
    if (this.options.showControls) {
      this.installControls();
    }
    this.ready = this.reload({ silent: true }).catch(() => null);
  }
  on(eventName, handler) {
    if (typeof handler !== "function") {
      return () => {
      };
    }
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, /* @__PURE__ */ new Set());
    }
    this.listeners.get(eventName).add(handler);
    return () => this.off(eventName, handler);
  }
  off(eventName, handler) {
    const handlers = this.listeners.get(eventName);
    if (handlers) {
      handlers.delete(handler);
    }
  }
  emit(eventName, payload) {
    const handlers = this.listeners.get(eventName);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[RegionDrilldown] ${eventName} \u76D1\u542C\u5668\u6267\u884C\u5931\u8D25`, error);
        }
      });
    }
    const callbackName = `on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`;
    const callback = this.options[callbackName];
    if (typeof callback === "function") {
      try {
        callback(payload);
      } catch (error) {
        console.error(`[RegionDrilldown] ${callbackName} \u56DE\u8C03\u5931\u8D25`, error);
      }
    }
  }
  installEvents() {
    const Cesium2 = this.Cesium;
    this.handler.setInputAction((movement) => {
      const region = this.pickRegion(movement.position);
      if (region) {
        this.activateRegion(region);
      }
    }, Cesium2.ScreenSpaceEventType.LEFT_CLICK);
    this.handler.setInputAction((movement) => {
      const region = this.pickRegion(movement.endPosition);
      this.setHovered(region);
    }, Cesium2.ScreenSpaceEventType.MOUSE_MOVE);
    this.removePostRender = this.viewer.scene.postRender.addEventListener(() => this.layoutMarkers());
  }
  installControls() {
    const container = this.options.container || this.viewer.container;
    if (!container) {
      return;
    }
    ensureStyles(this.document);
    const view = this.document.defaultView || window;
    const computedPosition = view.getComputedStyle(container).position;
    if (!computedPosition || computedPosition === "static") {
      this.controlsContainerPosition = container.style.position;
      container.style.position = "relative";
    }
    const controls = this.document.createElement("div");
    controls.className = "rdp-controls";
    controls.setAttribute("aria-label", this.options.controlsTitle);
    controls.innerHTML = `
      <button class="rdp-back" type="button">${escapeHtml(this.options.backText)}</button>
      <div class="rdp-breadcrumb" role="navigation" aria-label="\u884C\u653F\u533A\u5C42\u7EA7"></div>
      <span class="rdp-status" role="status"></span>
    `;
    container.appendChild(controls);
    this.controls = {
      root: controls,
      back: controls.querySelector(".rdp-back"),
      breadcrumb: controls.querySelector(".rdp-breadcrumb"),
      status: controls.querySelector(".rdp-status")
    };
    this.controls.back.addEventListener("click", () => this.goBack());
    this.renderControls();
  }
  setStatus(message, isError) {
    if (!this.controls) {
      return;
    }
    this.controls.status.textContent = message || "";
    this.controls.status.dataset.error = isError ? "true" : "false";
  }
  renderControls() {
    if (!this.controls) {
      return;
    }
    this.controls.back.disabled = this.path.length <= 1;
    this.controls.breadcrumb.innerHTML = "";
    this.path.forEach((entry, index) => {
      if (index > 0) {
        const separator = this.document.createElement("span");
        separator.className = "rdp-separator";
        separator.textContent = "/";
        this.controls.breadcrumb.appendChild(separator);
      }
      const button = this.document.createElement("button");
      button.type = "button";
      button.className = "rdp-crumb";
      button.textContent = entry.name || entry.code;
      if (index === this.path.length - 1) {
        button.setAttribute("aria-current", "page");
      }
      button.addEventListener("click", () => this.goToPath(index));
      this.controls.breadcrumb.appendChild(button);
    });
  }
  cacheKey(level, parentCode, filterSignature) {
    return `${level}|${parentCode || ""}|${filterSignature}|${this.cacheVersion}`;
  }
  filterSignature() {
    try {
      return JSON.stringify(this.filters || {});
    } catch (error) {
      return String(Date.now());
    }
  }
  async fetchRegions(level, parentCode, useCache) {
    const signature = this.filterSignature();
    const key = this.cacheKey(level, parentCode, signature);
    if (useCache && this.cache.has(key)) {
      return this.cache.get(key);
    }
    const request = {
      level,
      parentCode: parentCode || null,
      filters: { ...this.filters }
    };
    this.emit("loading", request);
    this.setStatus("\u6B63\u5728\u52A0\u8F7D\u533A\u57DF\u2026", false);
    const payload = await this.provider.listChildren(request);
    let regions = normalizeRegionPayload(payload, level);
    if (typeof this.provider.getCounts === "function" && regions.length) {
      try {
        const countPayload = await this.provider.getCounts({
          level,
          parentCode: parentCode || null,
          codes: regions.map((region) => region.code),
          filters: { ...this.filters }
        });
        regions = applyCounts(regions, countPayload);
      } catch (error) {
        this.emit("warning", {
          type: "counts",
          message: "\u533A\u57DF\u6570\u91CF\u52A0\u8F7D\u5931\u8D25\uFF0C\u5DF2\u4FDD\u7559\u533A\u57DF\u5706\u5708",
          error
        });
      }
    }
    this.cache.set(key, regions);
    return regions;
  }
  async loadLevel(level, parentCode, options = {}) {
    const token = ++this.loadToken;
    try {
      const regions = await this.fetchRegions(level, parentCode, options.useCache !== false);
      if (this.destroyed || token !== this.loadToken) {
        return false;
      }
      this.level = level;
      this.parentCode = parentCode || null;
      this.regions = regions;
      this.renderRegions(regions);
      this.renderControls();
      this.setStatus(options.silent ? "" : `${regions.length} \u4E2A\u533A\u57DF`, false);
      const state = this.getState();
      this.emit("levelChange", state);
      this.emit("dataChange", { regions: this.getRegions(), state });
      if (!options.skipCamera) {
        this.flyToCurrentLevel();
      }
      return true;
    } catch (error) {
      if (this.destroyed || token !== this.loadToken) {
        return false;
      }
      this.setStatus("\u533A\u57DF\u52A0\u8F7D\u5931\u8D25", true);
      this.emit("error", { error, level, parentCode: parentCode || null });
      return false;
    }
  }
  async reload(options = {}) {
    if (this.destroyed) {
      return false;
    }
    return this.loadLevel(this.level, this.parentCode, {
      useCache: options.useCache !== false,
      skipCamera: options.skipCamera === true,
      silent: options.silent === true
    });
  }
  async activateRegion(region) {
    if (!region || this.destroyed) {
      return;
    }
    this.emit("regionClick", region);
    const childLevel = region.childLevel || nextLevel(region.level, this.levels);
    if (region.hasChildren && childLevel) {
      this.path.push({ ...region, childLevel });
      const loaded = await this.loadLevel(childLevel, region.code, { useCache: true });
      if (!loaded) {
        this.path.pop();
        this.renderControls();
      }
      return;
    }
    this.setStatus(`${region.name} \xB7 ${formatCount(region.datasetCount)} \u96C6`, false);
    this.flyToRegion(region);
    this.emit("regionSelect", region);
  }
  async goBack() {
    if (this.destroyed || this.path.length <= 1) {
      return false;
    }
    this.path.pop();
    const target = this.path[this.path.length - 1];
    const level = target.childLevel || nextLevel(target.level, this.levels) || this.options.initialLevel;
    const parentCode = target.code === "WORLD" ? null : target.code;
    return this.loadLevel(level, parentCode, { useCache: true });
  }
  async goToPath(index) {
    if (this.destroyed || index < 0 || index >= this.path.length - 1) {
      return false;
    }
    this.path = this.path.slice(0, index + 1);
    const target = this.path[this.path.length - 1];
    const level = target.childLevel || nextLevel(target.level, this.levels) || this.options.initialLevel;
    const parentCode = target.code === "WORLD" ? null : target.code;
    return this.loadLevel(level, parentCode, { useCache: true });
  }
  async goHome() {
    if (this.destroyed) {
      return false;
    }
    this.path = [{ code: "WORLD", name: "\u5168\u7403", level: "world", childLevel: this.options.initialLevel }];
    this.cacheVersion += 1;
    return this.loadLevel(this.options.initialLevel, null, { useCache: false });
  }
  async drillTo(code) {
    const wanted = String(code || "");
    const region = this.regions.find((item) => item.code === wanted);
    if (!region) {
      return false;
    }
    await this.activateRegion(region);
    return true;
  }
  setFilters(filters, options = {}) {
    this.filters = { ...filters || {} };
    this.cacheVersion += 1;
    if (options.reload === false) {
      return Promise.resolve(false);
    }
    return this.reload({ useCache: false, skipCamera: true });
  }
  setRegions(regions, metadata = {}) {
    if (this.destroyed) {
      return false;
    }
    this.loadToken += 1;
    this.regions = normalizeRegionPayload(regions, metadata.level || this.level);
    if (metadata.level) {
      this.level = metadata.level;
    }
    if (Object.prototype.hasOwnProperty.call(metadata, "parentCode")) {
      this.parentCode = metadata.parentCode || null;
    }
    if (Array.isArray(metadata.path)) {
      this.path = metadata.path;
    }
    this.renderRegions(this.regions);
    this.renderControls();
    const state = this.getState();
    this.emit("levelChange", state);
    this.emit("dataChange", { regions: this.getRegions(), state });
    return true;
  }
  setVisible(visible) {
    this.visible = visible !== false;
    this.dataSource.show = this.visible;
    if (this.controls) {
      this.controls.root.style.display = this.visible ? "" : "none";
    }
    this.viewer.scene.requestRender();
  }
  getRegions() {
    return this.regions.map((region) => ({ ...region }));
  }
  getState() {
    return {
      level: this.level,
      parentCode: this.parentCode,
      path: this.path.map((entry) => ({ ...entry })),
      filters: { ...this.filters },
      regionCount: this.regions.length
    };
  }
  renderRegions(regions) {
    this.clearHover();
    this.dataSource.entities.removeAll();
    this.markerStates = [];
    if (!regions.length) {
      this.viewer.scene.requestRender();
      return;
    }
    const maxCount = regions.reduce((max, region) => Math.max(max, region.datasetCount || 0), 0);
    regions.forEach((region) => {
      if (!region.center) {
        console.warn("[RegionDrilldown] \u8DF3\u8FC7\u7F3A\u5C11 center \u7684\u533A\u57DF", region.code);
        return;
      }
      const countRatio = maxCount > 0 ? Math.sqrt(Math.max(0, region.datasetCount) / maxCount) : 0.5;
      const size = Math.round(this.options.minMarkerSize + (this.options.maxMarkerSize - this.options.minMarkerSize) * countRatio);
      const canvas = buildMarkerCanvas(this.document, region, size, false, this.options.colors);
      const position = this.Cesium.Cartesian3.fromDegrees(region.center[0], region.center[1], 9e3);
      const entity = this.dataSource.entities.add({
        id: `region-${region.code}`,
        position,
        billboard: {
          image: canvas,
          width: size,
          height: size,
          verticalOrigin: this.Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
      entity.regionData = region;
      const normal = this.Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(position, new this.Cesium.Cartesian3());
      this.markerStates.push({
        entity,
        region,
        position,
        normal,
        size,
        baseSize: size,
        show: true,
        screenX: 0,
        screenY: 0
      });
    });
    this.markerStates.sort((left, right) => right.region.datasetCount - left.region.datasetCount);
    this.viewer.scene.requestRender();
  }
  pickRegion(screenPosition) {
    if (!screenPosition || this.destroyed || !this.visible) {
      return null;
    }
    const picked = this.viewer.scene.pick(screenPosition);
    return picked && picked.id && picked.id.regionData ? picked.id.regionData : null;
  }
  setHovered(region) {
    const nextCode = region ? region.code : null;
    const currentCode = this.hovered ? this.hovered.code : null;
    if (nextCode === currentCode) {
      return;
    }
    this.hovered = region || null;
    this.markerStates.forEach((state) => {
      const hovered = Boolean(region && state.region.code === region.code);
      state.entity.billboard.width = hovered ? state.baseSize * 1.08 : state.baseSize;
      state.entity.billboard.height = hovered ? state.baseSize * 1.08 : state.baseSize;
    });
    this.viewer.scene.canvas.style.cursor = region && (region.hasChildren || region.center) ? "pointer" : "default";
    this.viewer.scene.requestRender();
  }
  clearHover() {
    if (!this.hovered && !this.markerStates.length) {
      return;
    }
    this.hovered = null;
    this.markerStates.forEach((state) => {
      state.entity.billboard.width = state.baseSize;
      state.entity.billboard.height = state.baseSize;
    });
    this.viewer.scene.canvas.style.cursor = "default";
  }
  layoutMarkers() {
    if (this.destroyed || !this.visible || !this.markerStates.length) {
      return;
    }
    const cameraPosition = this.viewer.camera.positionWC;
    const canvas = this.viewer.scene.canvas;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    const accepted = [];
    this.markerStates.forEach((state) => {
      const toCamera = this.Cesium.Cartesian3.subtract(cameraPosition, state.position, new this.Cesium.Cartesian3());
      this.Cesium.Cartesian3.normalize(toCamera, toCamera);
      const frontFacing = this.Cesium.Cartesian3.dot(state.normal, toCamera);
      if (frontFacing <= 0.04) {
        state.entity.billboard.show = false;
        return;
      }
      const screen = worldToWindow(this.Cesium, this.viewer, state.position);
      if (!screen || screen.x < -state.size || screen.y < -state.size || screen.x > width + state.size || screen.y > height + state.size) {
        state.entity.billboard.show = false;
        return;
      }
      state.screenX = screen.x;
      state.screenY = screen.y;
      const overlap = accepted.some((other) => {
        const minDistance = Math.max(20, (state.size + other.size) * 0.36);
        return Math.hypot(screen.x - other.screenX, screen.y - other.screenY) < minDistance;
      });
      state.entity.billboard.show = !overlap;
      if (!overlap) {
        accepted.push(state);
      }
    });
  }
  flyToCurrentLevel() {
    if (this.path.length <= 1) {
      this.flyToWorld();
      return;
    }
    const current = this.path[this.path.length - 1];
    this.flyToRegion(current);
  }
  flyToWorld() {
    const Cesium2 = this.Cesium;
    this.viewer.camera.flyTo({
      destination: Cesium2.Cartesian3.fromDegrees(104, 24, this.options.worldViewHeight),
      duration: this.options.cameraDuration
    });
  }
  flyToRegion(region) {
    if (!region || this.destroyed) {
      return;
    }
    const Cesium2 = this.Cesium;
    if (region.bounds) {
      const [west, south, east, north] = region.bounds;
      this.viewer.camera.flyTo({
        destination: Cesium2.Rectangle.fromDegrees(west, south, east, north),
        duration: this.options.cameraDuration
      });
      return;
    }
    if (region.center) {
      const [longitude, latitude] = region.center;
      const maxSpan = region.bounds ? Math.max(region.bounds[2] - region.bounds[0], region.bounds[3] - region.bounds[1]) : 8;
      const height = Math.max(6e5, Math.min(this.options.regionViewHeight, maxSpan * 15e4));
      this.viewer.camera.flyTo({
        destination: Cesium2.Cartesian3.fromDegrees(longitude, latitude, height),
        duration: this.options.cameraDuration
      });
    }
  }
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.loadToken += 1;
    this.clearHover();
    if (this.removePostRender) {
      this.removePostRender();
      this.removePostRender = null;
    }
    if (this.handler && !this.handler.isDestroyed()) {
      this.handler.destroy();
    }
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.dataSources.remove(this.dataSource, true);
    }
    if (this.controls && this.controls.root.parentNode) {
      this.controls.root.parentNode.removeChild(this.controls.root);
    }
    if (this.controlsContainerPosition !== null && this.viewer && this.viewer.container) {
      this.viewer.container.style.position = this.controlsContainerPosition;
    }
    this.listeners.clear();
    this.markerStates = [];
    this.regions = [];
  }
};
function createRegionDrilldownCore(Cesium2, viewer, options) {
  return new RegionDrilldownController(Cesium2, viewer, options);
}

// src/index.js
function createRegionDrilldown(viewer, options = {}) {
  return createRegionDrilldownCore(Cesium, viewer, options);
}
var index_default = createRegionDrilldown;
export {
  createRegionDrilldown,
  createRegionDrilldownCore,
  index_default as default
};
