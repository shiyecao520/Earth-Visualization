(function () {
  "use strict";

  var CESIUM_VERSION = "1.144";
  var LOCAL_CESIUM_BASE = "./node_modules/cesium/Build/Cesium";
  window.CESIUM_BASE_URL = LOCAL_CESIUM_BASE + "/";
  var REMOTE_CESIUM_JS_SOURCES = [
    "https://cdn.jsdelivr.net/npm/cesium@" + CESIUM_VERSION + "/Build/Cesium/Cesium.js",
    "https://unpkg.com/cesium@" + CESIUM_VERSION + "/Build/Cesium/Cesium.js",
    "https://cesium.com/downloads/cesiumjs/releases/" + CESIUM_VERSION + "/Build/Cesium/Cesium.js"
  ];
  var REMOTE_CESIUM_CSS_SOURCES = [
    "https://cdn.jsdelivr.net/npm/cesium@" + CESIUM_VERSION + "/Build/Cesium/Widgets/widgets.css",
    "https://unpkg.com/cesium@" + CESIUM_VERSION + "/Build/Cesium/Widgets/widgets.css",
    "https://cesium.com/downloads/cesiumjs/releases/" + CESIUM_VERSION + "/Build/Cesium/Widgets/widgets.css"
  ];
  // 始终本地优先：先从本服务器加载 Cesium，CDN 仅作后备，
  // 避免内网环境公网 CDN 不可达时地球引擎加载失败。
  var CESIUM_JS_SOURCES = [LOCAL_CESIUM_BASE + "/Cesium.js"].concat(REMOTE_CESIUM_JS_SOURCES);
  var CESIUM_CSS_SOURCES = [LOCAL_CESIUM_BASE + "/Widgets/widgets.css"].concat(REMOTE_CESIUM_CSS_SOURCES);

  var ICONS = {
    globe: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    layers: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/></svg>',
    crosshair: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>',
    satellite: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10a8 8 0 0 1 16 0"/><path d="M12 10v12"/><circle cx="12" cy="18" r="2"/></svg>',
    map: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>',
    moon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
    search: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
    filter: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16"/><path d="M7 12h10"/><path d="M10 19h4"/></svg>',
    scan: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>',
    circleDot: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>',
    lasso: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 22a5 5 0 0 1-2-4"/><path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-.9"/><path d="M5 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0"/></svg>',
    chevronDown: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    x: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    arrowLeft: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    check: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  var state = {
    datasets: [],
    providerPromises: {},
    baseLayer: null,
    labelLayer: null,
    activeBaseKey: null,
    swapToken: 0
  };

  var viewer = null;
  var gridSource = null;
  var readoutTimer = 0;
  var loading = false;
  var eventsBound = false;
  var renderRecoveryCount = 0;
  var recoveryScheduled = false;
  var renderSoftRetries = 0;
  var renderErrorSuspended = false;
  var RENDER_SOFT_RETRY_LIMIT = 2;
  var RENDER_REBUILD_LIMIT = 2;
  var firstFrameShown = false;
  var baseLayerErrorWindowStart = 0;
  var baseLayerErrorCount = 0;
  var baseLayerFallbackUsed = false;
  var BASE_LAYER_FALLBACK = {
    satellite: "esri-satellite",
    street: "dark"
  };
  var baseLayerSelectedAt = 0;
  var BASE_LAYER_FALLBACK_GRACE_MS = 4000;
  var localBaseLayer = null;
  var lastValidCameraState = null;
  var cesiumRenderGuardInstalled = false;

  function paintIcons() {
    document.querySelectorAll("[data-icon]").forEach(function (node) {
      var key = node.getAttribute("data-icon");
      var markup = ICONS[key];
      if (markup) {
        node.innerHTML = markup;
      }
    });
  }

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = function () {
        resolve(url);
      };
      script.onerror = function () {
        reject(new Error("脚本加载失败: " + url));
      };
      document.head.appendChild(script);
    });
  }

  function loadCss(url) {
    return new Promise(function (resolve, reject) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.onload = function () {
        resolve(url);
      };
      link.onerror = function () {
        reject(new Error("样式加载失败: " + url));
      };
      document.head.appendChild(link);
    });
  }

  async function loadFirst(sources, loader) {
    var lastError = null;
    for (var i = 0; i < sources.length; i += 1) {
      try {
        await loader(sources[i]);
        return sources[i];
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("所有资源均加载失败");
  }

  async function loadCesiumRuntime() {
    var lastError = null;
    for (var index = 0; index < CESIUM_JS_SOURCES.length; index += 1) {
      var source = CESIUM_JS_SOURCES[index];
      window.CESIUM_BASE_URL = source.slice(0, source.lastIndexOf("/") + 1);
      try {
        await loadScript(source);
        return source;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("所有 Cesium 资源均加载失败");
  }

  function setLoaderStatus(text) {
    $("loader-status").textContent = text;
  }

  function showLoadError(error) {
    $("loader").classList.add("hidden");
    $("error-overlay").classList.remove("hidden");
    var detail = error && error.message ? error.message : "";
    $("error-message").textContent =
      detail ||
      "无法加载地球渲染引擎。请先运行 npm install 安装 Cesium，并确认网络可用后重试。";
    console.error(error);
  }

  function isFiniteVector3(value) {
    return !!value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
  }

  function zeroToTwoPi(angle) {
    var value = angle % (Math.PI * 2);
    return value < 0 ? value + Math.PI * 2 : value;
  }

  // 每帧记录最近一次"合法"的相机状态，NaN 崩溃后恢复到用户缩放前的位置。
  function captureCameraState(camera) {
    if (!camera) {
      return;
    }
    try {
      var carto = camera.positionCartographic;
      if (!carto || !Number.isFinite(carto.longitude) || !Number.isFinite(carto.latitude) ||
          !Number.isFinite(carto.height)) {
        return;
      }
      // 仅记录合理高度内的相机状态，避免 NaN 崩溃后恢复到异常位置。
      if (carto.height < 500 || carto.height > 60000000) {
        return;
      }
      var direction = camera.direction;
      var up = camera.up;
      var right = camera.right;
      if (!isFiniteVector3(direction) || !isFiniteVector3(up) || !isFiniteVector3(right)) {
        return;
      }
      var isVertical = Math.abs(Math.abs(direction.z) - 1) < 1e-6;
      var heading = (isVertical ? Math.atan2(up.y, up.x) : Math.atan2(direction.y, direction.x)) - Math.PI / 2;
      heading = Math.PI * 2 - zeroToTwoPi(heading);
      var pitch = Math.PI / 2 - Math.acos(Math.max(-1, Math.min(1, direction.z)));
      var roll = isVertical ? 0 : zeroToTwoPi(Math.atan2(-right.z, up.z) + Math.PI * 2);
      lastValidCameraState = {
        longitude: carto.longitude,
        latitude: carto.latitude,
        height: carto.height,
        heading: heading,
        pitch: pitch,
        roll: roll
      };
    } catch (ignoreError) {
      // 相机状态不可用时不记录
    }
  }

  // 恢复到最后一次合法的相机位置；失败时回退到全球视图。
  function restoreLastValidCamera() {
    var Cesium = window.Cesium;
    if (!viewer || viewer.isDestroyed() || !Cesium) {
      return false;
    }
    if (lastValidCameraState) {
      try {
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromRadians(
            lastValidCameraState.longitude,
            lastValidCameraState.latitude,
            lastValidCameraState.height
          ),
          orientation: {
            heading: lastValidCameraState.heading,
            pitch: lastValidCameraState.pitch,
            roll: lastValidCameraState.roll
          }
        });
        return true;
      } catch (ignoreError) {
        // 回退到全球视图
      }
    }
    try {
      resetView(false);
      return true;
    } catch (ignoreError) {
      return false;
    }
  }

  function cameraHasNaN(camera) {
    return camera && (!isFiniteVector3(camera.positionWC) || !isFiniteVector3(camera.directionWC) ||
      !isFiniteVector3(camera.upWC));
  }

  // Cesium 已知 bug：滚轮缩放时相机 positionWC/directionWC 偶发变为 NaN，
  // 导致 updateFrustums 里 frustumCommandsList.length = NaN 抛出
  // "RangeError: Invalid array length"，进而停止整个渲染循环（Rendering has stopped），
  // 热力图等图层不再刷新，快速缩放还会耗尽重建次数进入"地球加载失败"卡死页。
  // 这里在 View.createPotentiallyVisibleSet 处拦截错误：修复相机并跳过本帧，
  // 保证渲染循环不中断。
  function installCesiumRenderGuard() {
    var Cesium = window.Cesium;
    if (!Cesium || !Cesium.View || cesiumRenderGuardInstalled) {
      return;
    }
    var original = Cesium.View.prototype.createPotentiallyVisibleSet;
    if (typeof original !== "function") {
      return;
    }
    cesiumRenderGuardInstalled = true;
    Cesium.View.prototype.createPotentiallyVisibleSet = function (scene) {
      try {
        return original.call(this, scene);
      } catch (error) {
        if (scene && scene.camera && cameraHasNaN(scene.camera)) {
          try {
            restoreLastValidCamera();
          } catch (ignoreError) {
            // 忽略
          }
        }
        if (typeof window.__geoOnRenderGuard === "function") {
          try {
            window.__geoOnRenderGuard(error);
          } catch (ignoreError) {
            // 忽略
          }
        }
        return undefined; // 跳过本帧，下一帧用修复后的相机继续渲染
      }
    };
  }

  function handleRenderGuard(error) {
    console.warn("已拦截地球渲染抖动并自动修复相机", error && error.message);
    if (viewer && !viewer.isDestroyed()) {
      try {
        viewer.scene.requestRender();
      } catch (ignoreError) {
        // 忽略
      }
    }
  }

  async function init() {
    if (loading) {
      return;
    }
    loading = true;
    teardown();
    $("error-overlay").classList.add("hidden");
    $("loader").classList.remove("hidden");
    paintIcons();
    setLoaderStatus("正在加载地球渲染引擎...");
    try {
      if (!document.querySelector('link[href*="Widgets/widgets.css"]')) {
        await loadFirst(CESIUM_CSS_SOURCES, loadCss);
      }
      if (!window.Cesium) {
        await loadCesiumRuntime();
      }
      if (!window.Cesium) {
        throw new Error("Cesium 未加载");
      }
      installCesiumRenderGuard();
      await boot();
    } catch (error) {
      showLoadError(error);
    } finally {
      loading = false;
    }
  }

  function teardown() {
    if (viewer) {
      try {
        viewer.destroy();
      } catch (error) {
        console.warn("销毁旧场景失败", error);
      }
      viewer = null;
    }
    gridSource = null;
    firstFrameShown = false;
    localBaseLayer = null;
    state.baseLayer = null;
    state.labelLayer = null;
    state.providerPromises = {};
    state.activeBaseKey = null;
    var container = $("cesium-container");
    while (container && container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  async function boot() {
    var Cesium = window.Cesium;
    setLoaderStatus("正在初始化场景...");

    viewer = new Cesium.Viewer("cesium-container", {
      baseLayer: false,
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      fullscreenButton: true,
      sceneModePicker: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: false,
      contextOptions: {
        webgl: {
          alpha: false,
          antialias: false
        }
      }
    });

    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#02070d");
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#071b25");
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.hueShift = -0.035;
    viewer.scene.skyAtmosphere.saturationShift = -0.16;
    viewer.scene.skyAtmosphere.brightnessShift = -0.24;
    viewer.scene.skyBox.show = true;
    viewer.scene.globe.enableLighting = false;
    viewer.scene.highDynamicRange = false;
    viewer.scene.postProcessStages.fxaa.enabled = false;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 48000000;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 3000;
    if (viewer.scene.fog) {
      viewer.scene.fog.enabled = true;
      viewer.scene.fog.density = 0.00018;
      viewer.scene.fog.minimumBrightness = 0.025;
    }

    viewer.scene.renderError.addEventListener(onRenderError);
    viewer.scene.preRender.addEventListener(function () {
      captureCameraState(viewer.camera);
    });
    window.__geoOnRenderGuard = handleRenderGuard;
    viewer.canvas.addEventListener("webglcontextlost", onWebGlContextLost, false);

    await installLocalBaseLayer();

    gridSource = createGridSource();
    viewer.dataSources.add(gridSource);
    gridSource.show = false;

    bindEvents();
    resetView(false);
    updateReadout();

    window.GeoApp = createPublicApi();
    window.viewer = viewer;
    window.dispatchEvent(new CustomEvent("geoapp:ready", {
      detail: { viewer: viewer }
    }));

    setLoaderStatus("地球已就绪");
    waitForFirstFrame();
    // 默认底图使用天地图影像，离线底图已作为兜底保留。
    await setBaseLayer("satellite");
  }

  async function installLocalBaseLayer() {
    var Cesium = window.Cesium;
    var provider = await Cesium.TileMapServiceImageryProvider.fromUrl(
      (window.CESIUM_BASE_URL || LOCAL_CESIUM_BASE + "/") + "Assets/Textures/NaturalEarthII"
    );
    localBaseLayer = viewer.imageryLayers.addImageryProvider(provider, 0);
    localBaseLayer.__geoLayerRole = "base";
    localBaseLayer.brightness = 0.66;
    localBaseLayer.contrast = 1.2;
    localBaseLayer.saturation = 0.58;
    localBaseLayer.gamma = 0.86;
    state.activeBaseKey = "offline";
    updateBaseRowState("offline");
  }

  function waitForFirstFrame() {
    if (firstFrameShown || !viewer) {
      return;
    }
    var listener = function () {
      firstFrameShown = true;
      if (viewer && !viewer.isDestroyed()) {
        $("loader").classList.add("hidden");
        renderRecoveryCount = 0;
        renderSoftRetries = 0;
        renderErrorSuspended = false;
        viewer.scene.postRender.removeEventListener(listener);
      }
    };
    viewer.scene.postRender.addEventListener(listener);
    window.setTimeout(function () {
      if (!firstFrameShown && viewer && !viewer.isDestroyed()) {
        $("loader").classList.add("hidden");
      }
    }, 2500);
  }

  function onRenderError(scene, error) {
    console.error("地球渲染异常", error);
    var detail = error && (error.message || error.stack || String(error));
    if (renderErrorSuspended) {
      return;
    }
    // 兜底：若 Cesium 防护未生效且相机已 NaN，直接修复相机并继续渲染，
    // 不再走软重试/重建路径，避免快速耗尽重建次数后卡死在错误页。
    if (typeof detail === "string" && /invalid array length/i.test(detail) &&
        scene && scene.camera && cameraHasNaN(scene.camera)) {
      renderSoftRetries = 0;
      restoreLastValidCamera();
      try {
        scene.requestRender();
      } catch (ignoreError) {
        // 忽略
      }
      return;
    }
    if (renderSoftRetries < RENDER_SOFT_RETRY_LIMIT) {
      renderSoftRetries += 1;
      renderErrorSuspended = true;
      setLoaderStatus("地球渲染抖动，正在轻量恢复...");
      try {
        scene.requestRender();
      } catch (ignoreError) {
        // 忽略：requestRender 失败时仍会走重建路径
      }
      window.setTimeout(function () {
        renderErrorSuspended = false;
      }, 1500);
      return;
    }
    renderSoftRetries = 0;
    scheduleRendererRecovery(detail);
  }

  function onWebGlContextLost(event) {
    if (event && event.preventDefault) {
      event.preventDefault();
    }
    console.error("WebGL 上下文丢失");
    scheduleRendererRecovery("WebGL 上下文丢失");
  }

  function scheduleRendererRecovery(detail) {
    if (recoveryScheduled) {
      return;
    }
    if (renderRecoveryCount >= RENDER_REBUILD_LIMIT) {
      showLoadError(new Error(detail ? "渲染异常：" + detail : "渲染异常，请重试"));
      return;
    }
    recoveryScheduled = true;
    renderRecoveryCount += 1;
    renderSoftRetries = 0;
    setLoaderStatus("地球渲染异常，正在自动恢复...");
    $("loader").classList.remove("hidden");
    window.setTimeout(function recoverWhenReady() {
      if (loading) {
        window.setTimeout(recoverWhenReady, 200);
        return;
      }
      recoveryScheduled = false;
      init();
    }, 600);
  }

  function bindEvents() {
    if (!eventsBound) {
      $("layers-toggle").addEventListener("click", togglePanel);
      $("reset-view").addEventListener("click", function () {
        if (window.AdminExplorer) {
          window.AdminExplorer.returnToWorld();
        } else {
          resetView(true);
        }
      });
      $("base-layer-list").addEventListener("click", onBaseLayerClick);
      $("retry-load").addEventListener("click", function () {
        $("error-overlay").classList.add("hidden");
        renderRecoveryCount = 0;
        recoveryScheduled = false;
        init();
      });
      document.addEventListener("click", onDocumentClick);
      eventsBound = true;
    }
    viewer.camera.changed.addEventListener(scheduleReadout);
    viewer.scene.postRender.addEventListener(scheduleReadout);
  }

  function togglePanel() {
    var panel = $("layers-panel");
    var open = !panel.classList.contains("hidden");
    panel.classList.toggle("hidden", open);
    $("layers-toggle").classList.toggle("is-active", !open);
  }

  function onDocumentClick(event) {
    var panel = $("layers-panel");
    if (panel.classList.contains("hidden")) {
      return;
    }
    if (panel.contains(event.target)) {
      return;
    }
    if (event.target.closest("#layers-toggle")) {
      return;
    }
    panel.classList.add("hidden");
    $("layers-toggle").classList.remove("is-active");
  }

  function toggleClassState(button, callback) {
    var on = !button.classList.contains("is-on");
    button.classList.toggle("is-on", on);
    callback(on);
  }

  function onBaseLayerClick(event) {
    var row = event.target.closest("[data-layer]");
    if (row) {
      setBaseLayer(row.getAttribute("data-layer"));
    }
  }

  function updateBaseRowState(key) {
    document.querySelectorAll(".base-row[data-layer]").forEach(function (row) {
      row.classList.toggle("is-active", row.getAttribute("data-layer") === key);
    });
  }

  async function setBaseLayer(key) {
    if (!viewer || key === state.activeBaseKey) {
      return;
    }
    baseLayerFallbackUsed = false;
    baseLayerErrorCount = 0;
    baseLayerErrorWindowStart = 0;
    baseLayerSelectedAt = Date.now();
    state.activeBaseKey = key;
    updateBaseRowState(key);
    var token = ++state.swapToken;
    if (key === "offline") {
      removeActiveOnlineLayers();
      localBaseLayer.show = true;
      localBaseLayer.alpha = 1;
      notifyBaseLayerChanged(key);
      return;
    }
    try {
      var providers = await getProviders(key);
      if (token !== state.swapToken || !viewer) {
        return;
      }
      // Cesium 1.144 中 ImageryLayerCollection.add() 不再返回图层对象，
      // 因此必须显式记录图层引用，否则切换底图时无法移除旧图层。
      var added = [];
      for (var layerIndex = 0; layerIndex < providers.length; layerIndex += 1) {
        var layer = new Cesium.ImageryLayer(providers[layerIndex]);
        layer.__geoLayerRole = layerIndex === 0 ? "base" : "labels";
        layer.__geoProviderKind = providers[layerIndex].__geoKind || key;
        layer.alpha = 1;
        watchBaseLayerErrors(layer);
        viewer.imageryLayers.add(layer);
        added.push(layer);
      }
      if (token !== state.swapToken) {
        added.forEach(function (layer) {
          viewer.imageryLayers.remove(layer, true);
        });
        return;
      }
      removeActiveOnlineLayers();
      state.baseLayer = added[0] || null;
      state.labelLayer = added[1] || null;
      notifyBaseLayerChanged(key);
    } catch (error) {
      if (token === state.swapToken) {
        console.error("底图切换失败", error);
        removeActiveOnlineLayers();
        localBaseLayer.show = true;
        localBaseLayer.alpha = 1;
        state.activeBaseKey = "offline";
        updateBaseRowState("offline");
      }
    }
  }

  function notifyBaseLayerChanged(key) {
    window.dispatchEvent(new CustomEvent("geoapp:baselayerchanged", {
      detail: { key: key }
    }));
  }

  function removeActiveOnlineLayers() {
    if (state.labelLayer) {
      viewer.imageryLayers.remove(state.labelLayer, true);
      state.labelLayer = null;
    }
    if (state.baseLayer) {
      viewer.imageryLayers.remove(state.baseLayer, true);
      state.baseLayer = null;
    }
  }

  function getProviders(key) {
    // 不缓存：每次切换在线底图都重新创建 provider，
    // 否则天地图被限流后，缓存的 provider 会一直处于失败状态，
    // 即使限额恢复后也无法重新加载。
    return createProviders(key);
  }

  function createProviders(key) {
    var Cesium = window.Cesium;
    if (key === "satellite") {
      if (!getTiandituToken()) {
        return Promise.resolve([createEsriSatelliteProvider()]);
      }
      return Promise.resolve([
        createTiandituProvider("img"),
        createTiandituProvider("cia")
      ]);
    }
    if (key === "esri-satellite") {
      return Promise.resolve([createEsriSatelliteProvider()]);
    }
    if (key === "street") {
      if (!getTiandituToken()) {
        return Promise.resolve([new Cesium.UrlTemplateImageryProvider({
          url: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
          maximumLevel: 19,
          credit: "© OpenStreetMap contributors © CARTO"
        })]);
      }
      return Promise.resolve([
        createTiandituProvider("vec"),
        createTiandituProvider("cva")
      ]);
    }
    if (key === "dark") {
      return Promise.resolve([new Cesium.UrlTemplateImageryProvider({
        url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        maximumLevel: 19,
        credit: "© OpenStreetMap contributors © CARTO"
      })]);
    }
    return Promise.reject(new Error("未知底图: " + key));
  }

  function getTiandituToken() {
    var config = window.GEO_APP_CONFIG || {};
    return String(config.tiandituToken || "").trim();
  }

  function createTiandituProvider(layer) {
    var Cesium = window.Cesium;
    var token = getTiandituToken();
    if (!token) {
      throw new Error("缺少天地图 Token，请配置 js/config.local.js");
    }
    var provider = new Cesium.UrlTemplateImageryProvider({
      url:
        "https://t{s}.tianditu.gov.cn/" + layer + "_w/wmts" +
        "?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
        "&LAYER=" + layer + "&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles" +
        "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}" +
        "&tk=" + encodeURIComponent(token),
      subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
      minimumLevel: 0,
      maximumLevel: 18,
      credit: "天地图"
    });
    provider.__geoKind = "tianditu";
    return provider;
  }

  function createEsriSatelliteProvider() {
    var Cesium = window.Cesium;
    var provider = new Cesium.UrlTemplateImageryProvider({
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      minimumLevel: 0,
      maximumLevel: 19,
      credit: "Esri, Maxar, Earthstar Geographics"
    });
    provider.__geoKind = "esri";
    return provider;
  }

  function watchBaseLayerErrors(layer) {
    var provider = layer.imageryProvider;
    if (!provider || !provider.errorEvent || provider.__geoFallbackWatched) {
      return;
    }
    provider.__geoFallbackWatched = true;
    provider.errorEvent.addEventListener(function (tileError) {
      onBaseLayerTileError(tileError);
    });
  }

  function onBaseLayerTileError(tileError) {
    var key = state.activeBaseKey;
    if (baseLayerFallbackUsed || !BASE_LAYER_FALLBACK[key]) {
      return;
    }
    var now = Date.now();
    // 底图刚切换时先给一段缓冲期，避免瞬时网络错误导致立即回退，
    // 否则在天地图恢复后手动切回时也会被误判为失败。
    if (now - baseLayerSelectedAt < BASE_LAYER_FALLBACK_GRACE_MS) {
      return;
    }
    if (now - baseLayerErrorWindowStart > 6000) {
      baseLayerErrorWindowStart = now;
      baseLayerErrorCount = 0;
    }
    baseLayerErrorCount += 1;
    if (baseLayerErrorCount < 8) {
      return;
    }
    baseLayerFallbackUsed = true;
    baseLayerErrorCount = 0;
    var name = key === "satellite" ? "天地图影像" : "天地图矢量";
    window.dispatchEvent(new CustomEvent("geoapp:notice", {
      detail: {
        message: name + "服务暂时不可用（当前请求被限流），已自动切换到备用高清卫星影像，可稍后再次尝试切换" + name,
        duration: 8000
      }
    }));
    setBaseLayer(BASE_LAYER_FALLBACK[key]);
  }

  function createGridSource() {
    var Cesium = window.Cesium;
    var source = new Cesium.CustomDataSource("地理网格");
    var material = Cesium.Color.fromCssColorString("#b9d6f0").withAlpha(0.24);

    for (var lon = -180; lon < 180; lon += 30) {
      var meridian = [];
      for (var mlat = -90; mlat <= 90; mlat += 3) {
        meridian.push(Cesium.Cartesian3.fromDegrees(lon, mlat, 0));
      }
      source.entities.add({
        polyline: {
          positions: meridian,
          width: 1,
          material: material
        }
      });
    }

    for (var lat = -60; lat <= 60; lat += 30) {
      var parallel = [];
      for (var plon = -180; plon <= 180; plon += 3) {
        parallel.push(Cesium.Cartesian3.fromDegrees(plon, lat, 0));
      }
      source.entities.add({
        polyline: {
          positions: parallel,
          width: 1,
          material: material
        }
      });
    }

    return source;
  }

  function scheduleReadout() {
    if (readoutTimer) {
      return;
    }
    readoutTimer = window.setTimeout(function () {
      readoutTimer = 0;
      updateReadout();
    }, 80);
  }

  function updateReadout() {
    if (!viewer || viewer.isDestroyed()) {
      return;
    }
    var carto = viewer.camera.positionCartographic;
    if (!carto) {
      return;
    }
    var Cesium = window.Cesium;
    $("lon-value").textContent = formatCoordinate(
      Cesium.Math.toDegrees(carto.longitude),
      "E",
      "W"
    );
    $("lat-value").textContent = formatCoordinate(
      Cesium.Math.toDegrees(carto.latitude),
      "N",
      "S"
    );
    $("height-value").textContent = formatDistance(carto.height);
  }

  function formatCoordinate(value, positive, negative) {
    var direction = value >= 0 ? positive : negative;
    return Math.abs(value).toFixed(2) + "°" + direction;
  }

  function formatDistance(meters) {
    var value = Number(meters);
    if (!Number.isFinite(value)) {
      return "--";
    }
    if (Math.abs(value) >= 1000) {
      return (value / 1000).toFixed(Math.abs(value) >= 100000 ? 0 : 1) + " km";
    }
    return Math.round(value) + " m";
  }

  function resetView(animate) {
    var Cesium = window.Cesium;
    var target = {
      destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 17000000),
      orientation: {
        heading: 0,
        pitch: -Cesium.Math.PI_OVER_TWO,
        roll: 0
      }
    };
    if (animate) {
      viewer.camera.flyTo({
        destination: target.destination,
        orientation: target.orientation,
        duration: 1.2
      });
    } else {
      viewer.camera.setView(target);
    }
  }

  function updateDatasetCount() {
    var node = $("dataset-count");
    if (node) {
      node.textContent = state.datasets.length + " 数据集";
    }
  }

  function createPublicApi() {
    return {
      viewer: viewer,
      scene: viewer.scene,
      setBaseLayer: setBaseLayer,
      resetView: resetView,
      addEntity: function (options) {
        return viewer.entities.add(options);
      },
      clearEntities: function () {
        viewer.entities.removeAll();
      },
      addDataset: function (entry) {
        state.datasets.push(entry);
        updateDatasetCount();
        return entry;
      },
      removeDataset: function (id) {
        var index = state.datasets.findIndex(function (entry) {
          return entry && (entry.id === id || entry === id);
        });
        if (index >= 0) {
          state.datasets.splice(index, 1);
        }
        updateDatasetCount();
      },
      get datasets() {
        return state.datasets.slice();
      }
    };
  }

  paintIcons();
  init();
})();
