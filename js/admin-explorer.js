(function () {
  "use strict";

  var DATA_ROOT = "./data/boundaries";
  var MOCK_DENSITY_URL = "./assets/mock-global-density.png?v=3";
  var HEAT_CACHE_VERSION = "20260901h";
  var MOCK_DENSITY_BOUNDS = [-180, -90, 180, 90];
  var COLORS = {
    fill: "#2c9bb7",
    border: "#72c9d8",
    hover: "#42d6c5",
    selected: "#f4bd62",
    marker: "#d86c3a",
    markerHover: "#128f84"
  };
  var AUTO_LEVEL_HEIGHTS = {
    // 滞回带必须满足 exit > enter，否则在重叠区间内会出现
    // “低层级要退出、高层级要进入”的来回震荡（下钻后缩小地球时
    // 城市/省份圆圈画面反复跳动）。
    enterProvince: 9000000,
    exitProvince: 10000000,
    enterCity: 2200000,
    exitCity: 2800000,
    enterFineCity: 420000,
    exitFineCity: 720000
  };
  var CIRCLE_RADIUS_MIN_KM = 0.05;
  var CIRCLE_RADIUS_MAX_KM = 5000;
  var HUMAN_YEAR_MIN = 1900;
  var HUMAN_YEAR_MAX = new Date().getFullYear();
  // 纪年轴不再固定为 1900—当前年，而是跟随当前地球范围/筛选结果的
  // 数据集与论文真实年份范围动态变化。
  var humanTimelineYearMin = HUMAN_YEAR_MIN;
  var humanTimelineYearMax = HUMAN_YEAR_MAX;
  var timelineRangeRequestController = null;
  var timelineRangeRequestToken = 0;
  var timelineRangeRequestTimer = 0;
  var timelineRangeRequestSignature = "";
  var GEOLOGIC_MAX_MA = 4600;
  var GEOLOGIC_SLIDER_MAX = 1000;
  var publicationYearMin = 1850;
  var publicationYearMax = 2021;
  var MOCK_HEAT_HUBS = [
    [-74, 41], [-118, 34], [-99, 20], [-47, -23], [-58, -35],
    [-1, 52], [8, 50], [31, 30], [4, 7], [28, -26],
    [73, 20], [78, 29], [90, 23], [105, 30], [117, 39],
    [121, 31], [114, 23], [127, 37], [139, 36], [104, 2],
    [107, -7], [151, -33], [174, -37], [39, 56]
  ];

  var Cesium;
  var viewer;
  var handler;
  var currentBoundarySource;
  var currentMarkerSource;
  var highlightSource;
  var selectionSource;
  var h3SelectionSource;
  var searchResultSource;
  var cityDatasetCoverageSource;
  var highlightPrimitiveRoot;
  var heatLayer;
  var overlayPrimitiveRoot;
  var regionBillboardCollection;
  var paperDistributionCollection;
  var pointBillboardCollection;
  var searchResultBillboardCollection;
  var flightLineCollection;
  var flightTrailCollection;
  var flightParticleCollection;
  var heatSurfaceRoot;
  var heatSurfacePrimitive;
  var regionMarkerStates = [];
  var pulseStates = [];
  var flightParticleStates = [];
  var FLIGHT_COLORS = ["#63d8cf", "#7daee9", "#9a91d8"];
  var removeOverlayPreRenderListener;
  var hoveredMeta;
  var selectedMeta;
  var hoverClearTimer;
  var loadToken = 0;
  var heatToken = 0;
  var heatRequestController = null;
  var markerImageCache = {};
  var pointImageCache = {};
  var searchSpatialImageCache = {};
  var lastMarkerLayoutAt = 0;
  var uiBound = false;
  var heatVisible = true;
  var h3GridVisible = true;
  var pointVisible = true;
  var paperPointsVisible = false;
  var regionPaperLocationsActive = false;
  var regionPaperRequestToken = 0;
  var regionPaperSignature = "";
  var flightVisible = true;
  var regionMarkersVisible = true;
  var statisticsPanelVisible = true;
  var datasetPanelVisible = true;
  var referenceHeatImagePromise;
  var filteredReferenceHeatCache = {};
  var filteredReferenceHeatOrder = [];
  var removeHeatCameraListener;
  var removeCameraMoveStartListener;
  var removeAutoLevelListener;
  var removeImageryLayerAddedListener;
  var suppliedCounts = {};
  var suppliedPaperCounts = {};
  var suppliedDensities = {};
  var suppliedHeatPoints = null;
  var suppliedPointData = null;
  var suppliedCityDatasets = {};
  var suppliedSearchResults = null;
  var suppliedSelectionResult = null;
  var suppliedRegionStats = {};
  var activeDatasetCityCode = null;
  var activeCityPanelTab = "datasets";
  var activeCityPanelData = null;
  var activeCityDatasetId = null;
  var cityDatasetById = {};
  var cityPaperLocationStates = [];
  var cityPaperLocationById = {};
  var cityPaperLocationImageCache = {};
  var activeCityPaperLocationId = null;
  var paperCameraPosition = null;
  var paperCameraDirection = null;
  var paperCameraUp = null;
  var lastPaperScreenPositionUpdate = 0;
  var lastHoverPickAt = 0;
  var paperLocationGrid = null;
  var paperLocationGridDirty = true;
  var searchTimer = 0;
  var timelineFilterTimer = 0;
  var searchActionToken = 0;
  var locationIndexPromise = null;
  var datasetSearchController = null;
  var keywordSearchState = null;
  var keywordSearchController = null;
  var keywordSearchRequestToken = 0;
  var cityDatasetRequestController = null;
  var cityDatasetRequestToken = 0;
  var selectionDatasetRequestController = null;
  var selectionDatasetRequestToken = 0;
  var h3PointRequestController = null;
  var h3PointRequestToken = 0;
  var activeH3Point = null;
  var currentH3Resolution = null;
  var adaptiveHeatRefreshTimer = 0;
  var adaptiveHeatBoundsSignature = "";
  var adaptiveHeatRequestInFlight = false;
  var heatCameraStyleFrame = 0;
  var heatCameraStyleLastProgress = null;
  var cameraMoving = false;
  var cameraSettleTimer = 0;
  var datasetDetailRequestController = null;
  var datasetDetailRequestToken = 0;
  var datasetDetailCache = {};
  var expandedCityDatasetId = null;
  var statisticsRequestController = null;
  var statisticsRequestSignature = "";
  var statisticsRequestToken = 0;
  var statisticsCache = {};
  var searchSpatialEntries = [];
  var searchSpatialByKey = {};
  var activeSearchSpatialKey = null;
  var selectionMode = false;
  var selectionTool = "rectangle";
  var selectionDrawing = false;
  var selectionStart = null;
  var selectionStartScreen = null;
  var selectionPath = [];
  var selectionPathScreens = [];
  var circlePressCandidate = null;
  var circlePressScreen = null;
  var freehandPreviewFrame = 0;
  var freehandPreviewNearStart = false;
  var freehandPreviewClosePolygon = null;
  var selectionBounds = null;
  var selectionCircle = null;
  var selectionPolygon = null;
  var circleRadiusUpdateTimer = 0;
  var h3SelectionAnimationFrame = 0;
  var suppressMapClickUntil = 0;
  var autoLevelTimer = 0;
  var autoLevelTransition = false;
  var lastAutoLevelTransitionAt = 0;
  var manualNavigationLockUntil = 0;
  var datasetFlyLockUntil = 0;
  var boundaryGeoJsonCache = {};
  var regionCountsCache = {};
  var regionCountsCacheOrder = [];
  var regionCountsAbortController = null;
  var heatCameraStyleLastHeight = null;
  var heatCameraStyleLayer = null;
  var filterState = createDefaultFilterState();
  var state = {
    level: "country",
    parentCode: null,
    path: [{ code: "WORLD", name: "全球", level: "world" }]
  };

  function init(event) {
    var api = window.GeoApp || (event && event.detail);
    if (!api || !api.viewer) {
      return;
    }
    if (viewer === api.viewer) {
      return;
    }
    if (handler && !handler.isDestroyed()) {
      handler.destroy();
    }
    if (removeImageryLayerAddedListener) {
      removeImageryLayerAddedListener();
      removeImageryLayerAddedListener = null;
    }
    if (removeOverlayPreRenderListener) {
      removeOverlayPreRenderListener();
      removeOverlayPreRenderListener = null;
    }
    if (removeHeatCameraListener) {
      removeHeatCameraListener();
      removeHeatCameraListener = null;
    }
    if (removeCameraMoveStartListener) {
      removeCameraMoveStartListener();
      removeCameraMoveStartListener = null;
    }
    if (removeAutoLevelListener) {
      removeAutoLevelListener();
      removeAutoLevelListener = null;
    }
    viewer = api.viewer;
    Cesium = window.Cesium;
    currentBoundarySource = null;
    currentMarkerSource = null;
    heatLayer = null;
    highlightSource = new Cesium.CustomDataSource("行政区高亮描边");
    viewer.dataSources.add(highlightSource);
    selectionSource = new Cesium.CustomDataSource("空间框选范围");
    viewer.dataSources.add(selectionSource);
    h3SelectionSource = new Cesium.CustomDataSource("H3 精细查询网格");
    viewer.dataSources.add(h3SelectionSource);
    searchResultSource = new Cesium.CustomDataSource("自然语言检索空间结果");
    viewer.dataSources.add(searchResultSource);
    cityDatasetCoverageSource = new Cesium.CustomDataSource("城市数据集空间范围");
    viewer.dataSources.add(cityDatasetCoverageSource);
    heatSurfaceRoot = viewer.scene.primitives.add(new Cesium.PrimitiveCollection());
    highlightPrimitiveRoot = viewer.scene.primitives.add(new Cesium.PrimitiveCollection());
    regionBillboardCollection = viewer.scene.primitives.add(new Cesium.BillboardCollection({ scene: viewer.scene }));
    paperDistributionCollection = viewer.scene.primitives.add(new Cesium.BillboardCollection({ scene: viewer.scene }));
    searchResultBillboardCollection = viewer.scene.primitives.add(new Cesium.BillboardCollection({ scene: viewer.scene }));
    removeOverlayPreRenderListener = viewer.scene.preRender.addEventListener(animatePointOverlays);
    removeHeatCameraListener = viewer.camera.changed.addEventListener(handleCameraChanged);
    removeCameraMoveStartListener = viewer.camera.moveStart.addEventListener(handleCameraMoveStart);
    removeAutoLevelListener = viewer.camera.moveEnd.addEventListener(handleCameraMoveEnd);
    removeImageryLayerAddedListener = viewer.imageryLayers.layerAdded.addEventListener(function (layer) {
      if (layer === heatLayer) {
        return;
      }
      window.setTimeout(function () {
        if (!viewer || viewer.isDestroyed() || !layer || layer.isDestroyed()) {
          return;
        }
          applyTechBaseStyle();
        if (heatLayer && !heatLayer.isDestroyed()) {
          viewer.imageryLayers.raiseToTop(heatLayer);
        }
          viewer.scene.requestRender();
      }, 0);
    });
    hoveredMeta = null;
    selectedMeta = null;
    selectionMode = false;
    selectionDrawing = false;
    selectionStart = null;
    selectionStartScreen = null;
    selectionPath = [];
    selectionPathScreens = [];
    selectionBounds = null;
    selectionCircle = null;
    selectionPolygon = null;
    suppliedSelectionResult = null;
    autoLevelTransition = false;
    lastAutoLevelTransitionAt = 0;
    cameraMoving = false;
    if (!uiBound) {
      bindUi();
      uiBound = true;
    }
    bindMapEvents();
    window.AdminExplorer = {
      returnToWorld: returnToWorld,
      showCountries: returnToWorld,
      showChinaProvinces: showChinaProvinces,
      showProvinceCities: showProvinceCities,
      setRegionCounts: setRegionData,
      setRegionData: setRegionData,
      setHeatPoints: setHeatPoints,
      setCityDatasets: setCityDatasets,
      setSearchResults: setSearchResults,
      setSelectionResult: setSelectionResult,
      setSpatialSelectionResult: setSelectionResult,
      setRegionStats: setRegionStats,
      setTemporalExtent: setTemporalExtent,
      setFilterResult: setFilterResult,
      locatePlace: locatePlace,
      searchDatasets: searchNaturalDatasets,
      getState: function () {
        return {
          level: state.level,
          parentCode: state.parentCode,
          path: state.path.slice(),
          filters: publicFilterState(),
          selectionBounds: selectionBounds ? publicSelectionBounds(selectionBounds) : null,
          selectionCircle: selectionCircle ? publicSelectionCircle(selectionCircle) : null,
          selectionPolygon: selectionPolygon ? publicSelectionPolygon(selectionPolygon) : null,
          selectionTool: selectionTool
        };
      }
    };
    returnToWorld(false).catch(function (error) {
      console.error("行政边界初始化失败", error);
      showStatus("行政边界加载失败", 2400);
    });
  }

  function bindUi() {
    document.getElementById("drill-back").addEventListener("click", goBack);
    document.getElementById("spatial-select-toggle").addEventListener("click", function () {
      if (selectionMode) {
        cancelSelectionMode(true);
        return;
      }
      beginSelectionMode(selectionTool);
    });
    document.getElementById("spatial-select-menu-toggle").addEventListener("click", function (event) {
      event.stopPropagation();
      var menu = document.getElementById("spatial-select-menu");
      var willOpen = menu.classList.contains("hidden");
      menu.classList.toggle("hidden", !willOpen);
      event.currentTarget.classList.toggle("is-open", willOpen);
      event.currentTarget.setAttribute("aria-expanded", String(willOpen));
    });
    document.getElementById("spatial-select-menu").addEventListener("click", function (event) {
      event.stopPropagation();
      var option = event.target.closest("[data-selection-tool]");
      if (!option) {
        return;
      }
      setSelectionTool(option.getAttribute("data-selection-tool"));
      closeSpatialSelectMenu();
      beginSelectionMode(selectionTool);
    });
    bindCircleRadiusUi();
    document.getElementById("dataset-panel-clear").addEventListener("click", function () {
      if (activeH3Point) {
        clearH3PointQuery(true);
        showStatus("已返回城市数据", 1400);
        return;
      }
      clearSpatialSelection(true, true);
      showStatus("已清除空间筛选", 1400);
    });
    window.addEventListener("geoapp:baselayerchanged", ensureHeatLayerOnTop);
    window.addEventListener("geoapp:notice", function (event) {
      var notice = (event && event.detail) || {};
      if (notice.message) {
        showStatus(notice.message, notice.duration || 5000);
      }
    });
    document.getElementById("toggle-heat").addEventListener("click", function (event) {
      heatVisible = !heatVisible;
      event.currentTarget.classList.toggle("is-on", heatVisible);
      syncMapExpressionForActiveTab();
    });
    document.getElementById("toggle-paper-points").addEventListener("click", function (event) {
      paperPointsVisible = !paperPointsVisible;
      event.currentTarget.classList.toggle("is-on", paperPointsVisible);
      syncRegionPaperPoints();
      syncMapExpressionForActiveTab();
    });
    document.getElementById("toggle-h3-grid").addEventListener("click", function (event) {
      h3GridVisible = !h3GridVisible;
      event.currentTarget.classList.toggle("is-on", h3GridVisible);
      adaptiveHeatBoundsSignature = "";
      scheduleAdaptiveH3HeatRefresh(0);
      showStatus(h3GridVisible ? "已显示全部 H3 网格" : "已隐藏未选 H3 网格", 1400);
    });
    document.getElementById("toggle-region-markers").addEventListener("click", function (event) {
      regionMarkersVisible = !regionMarkersVisible;
      event.currentTarget.classList.toggle("is-on", regionMarkersVisible);
      syncMapExpressionForActiveTab();
      if (!regionMarkersVisible) {
        clearHover();
        document.getElementById("region-tooltip").classList.add("hidden");
      }
      viewer.scene.requestRender();
    });
    document.getElementById("toggle-stats-panel").addEventListener("click", function (event) {
      statisticsPanelVisible = !statisticsPanelVisible;
      event.currentTarget.classList.toggle("is-on", statisticsPanelVisible);
      if (statisticsPanelVisible) {
        syncStatisticsPanelForLevel();
      } else {
        hideStatisticsPanel();
      }
    });
    document.getElementById("toggle-dataset-panel").addEventListener("click", function (event) {
      datasetPanelVisible = !datasetPanelVisible;
      event.currentTarget.classList.toggle("is-on", datasetPanelVisible);
      if (datasetPanelVisible) {
        syncDatasetPanelForLevel();
      } else {
        concealDatasetPanel();
      }
    });
    document.getElementById("drill-breadcrumb").addEventListener("click", function (event) {
      var button = event.target.closest("[data-path-index]");
      if (!button || button.disabled) {
        return;
      }
      navigateToPathIndex(Number(button.getAttribute("data-path-index")));
    });
    var searchInput = document.getElementById("dataset-search-input");
    searchInput.addEventListener("input", function (event) {
      window.clearTimeout(searchTimer);
      abortDatasetSearch();
      abortKeywordSearch();
      var query = event.target.value.trim();
      var token = ++searchActionToken;
      var shouldSearchRemotely = looksLikeNaturalDatasetQuery(query);
      searchTimer = window.setTimeout(function () {
        handleSearchQuery(query, token, false);
      }, shouldSearchRemotely ? 500 : 220);
    });
    searchInput.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      window.clearTimeout(searchTimer);
      abortDatasetSearch();
      abortKeywordSearch();
      handleSearchQuery(event.currentTarget.value.trim(), ++searchActionToken, true);
    });
    document.getElementById("ai-results-close").addEventListener("click", closeAiResultsPanel);
    document.getElementById("ai-results-cancel").addEventListener("click", cancelAiSearch);
    document.getElementById("search-locate-hint").addEventListener("click", function () {
      var query = activeCityPanelData && activeCityPanelData.mode === "search"
        ? String(activeCityPanelData.query || "").trim()
        : "";
      if (!query) {
        return;
      }
      closeAiResultsPanel();
      abortKeywordSearch();
      keywordSearchState = null;
      var token = ++searchActionToken;
      clearDatasetQueryForLocation(query);
      locatePlace(query, token).catch(function () {});
    });
    document.getElementById("ai-results-list").addEventListener("click", onAiResultsListClick);
    document.getElementById("ai-results-list").addEventListener("keydown", onAiResultsListKeydown);
    document.getElementById("city-dataset-list").addEventListener("click", onCityDatasetListClick);
    document.getElementById("dataset-panel-tabs").addEventListener("click", function (event) {
      var button = event.target.closest("[data-city-tab]");
      if (!button || !activeCityPanelData) {
        return;
      }
      activeCityPanelTab = button.getAttribute("data-city-tab") === "papers" ? "papers" : "datasets";
      document.getElementById("region-tooltip").classList.add("hidden");
      renderActiveCityTab();
    });
    document.getElementById("filters-toggle").addEventListener("click", function (event) {
      event.stopPropagation();
      var panel = document.getElementById("filters-panel");
      var willOpen = panel.classList.contains("hidden");
      panel.classList.toggle("hidden", !willOpen);
      if (willOpen) {
        positionFiltersPanel();
        document.getElementById("region-tooltip").classList.add("hidden");
      }
      event.currentTarget.classList.toggle("is-active", willOpen);
      event.currentTarget.setAttribute("aria-expanded", String(willOpen));
    });
    window.addEventListener("resize", function () {
      var panel = document.getElementById("filters-panel");
      if (panel && !panel.classList.contains("hidden")) {
        positionFiltersPanel();
      }
    });
    document.getElementById("filters-panel").addEventListener("click", function (event) {
      event.stopPropagation();
    });
    bindPublicationRangeUi();
    loadRealFilterOptions();
    bindTimelineUi();
    document.addEventListener("click", function () {
      closeFiltersPanel();
      closeSpatialSelectMenu();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeFiltersPanel();
        closeAiResultsPanel();
        if (activeH3Point) {
          clearH3PointQuery(true);
          showStatus("已返回城市数据", 1200);
        } else if (selectionMode || selectionBounds) {
          clearSpatialSelection(true, true);
          showStatus("已退出空间筛选", 1200);
        }
      }
    });
    document.getElementById("apply-filters").addEventListener("click", function () {
      filterState.theme = document.getElementById("filter-theme").value;
      filterState.paperTheme = document.getElementById("filter-paper-theme").value;
      filterState.source = document.getElementById("filter-source").value;
      var publicationRange = selectedPublicationRange();
      filterState.publicationStartYear = publicationRange.start;
      filterState.publicationEndYear = publicationRange.end;
      closeFiltersPanel();
      applyFilterState("筛选条件已应用");
      rerunActiveKeywordSearch();
    });
    document.getElementById("reset-filters").addEventListener("click", function () {
      document.getElementById("dataset-search-input").value = "";
      document.getElementById("filter-theme").value = "";
      document.getElementById("filter-paper-theme").value = "";
      document.getElementById("filter-source").value = "";
      resetPublicationRangeUi();
      filterState = createDefaultFilterState();
      abortKeywordSearch();
      keywordSearchState = null;
      configureTimelineUi();
      closeFiltersPanel();
      applyFilterState("筛选条件已重置");
    });
  }

  async function handleSearchQuery(query, token, committed) {
    if (token !== searchActionToken) {
      return;
    }
    var trimmed = String(query || "").trim();

    // 1) 明确的位置意图（定位/导航/带我去/飞到/前往/查看/想去…）
    var locationQuery = extractLocationQuery(trimmed);
    if (locationQuery) {
      closeAiResultsPanel();
      clearDatasetQueryForLocation(trimmed);
      try {
        var explicitTarget = await locatePlace(locationQuery, token);
        if (explicitTarget || token !== searchActionToken) {
          return;
        }
      } catch (error) {
        if (token !== searchActionToken) {
          return;
        }
        console.error("自然语言定位失败", error);
        showStatus("定位失败，请稍后重试", 2200);
        return;
      }
      return;
    }

    // 2) 自然语言研究问题 / 时空检索 → MCP 智能检索
    if (trimmed && (looksLikeNaturalDatasetQuery(trimmed) || (committed && trimmed.length >= 12))) {
      clearDatasetQueryForRemoteSearch(trimmed);
      searchNaturalDatasets(trimmed, token);
      return;
    }

    // 3) 关键词匹配 → 检索真实数据集与论文
    if (trimmed) {
      clearDatasetQueryForKeywordSearch(trimmed);
      runKeywordSearch(trimmed, token);
      return;
    }

    // 4) 清空搜索框 → 恢复当前区域的真实数据面板
    closeAiResultsPanel();
    abortKeywordSearch();
    keywordSearchState = null;
    if (filterState.query === trimmed) {
      return;
    }
    filterState.query = trimmed;
    window.dispatchEvent(new CustomEvent("geoapp:searchchange", {
      detail: { query: trimmed, filters: publicFilterState() }
    }));
    applyFilterState("搜索条件已更新");
  }

  function clearDatasetQueryForLocation(rawQuery) {
    filterState.query = "";
    abortKeywordSearch();
    keywordSearchState = null;
    updateActiveFilterBadge();
    window.dispatchEvent(new CustomEvent("geoapp:searchchange", {
      detail: {
        query: "",
        rawQuery: rawQuery,
        intent: "location",
        filters: publicFilterState()
      }
    }));
  }

  function clearDatasetQueryForRemoteSearch(rawQuery) {
    filterState.query = "";
    abortKeywordSearch();
    keywordSearchState = null;
    updateActiveFilterBadge();
    syncDatasetPanelForLevel();
    window.dispatchEvent(new CustomEvent("geoapp:searchchange", {
      detail: {
        query: "",
        rawQuery: rawQuery,
        intent: "dataset-search",
        filters: publicFilterState()
      }
    }));
  }

  function clearDatasetQueryForKeywordSearch(rawQuery) {
    filterState.query = rawQuery;
    updateActiveFilterBadge();
    window.dispatchEvent(new CustomEvent("geoapp:searchchange", {
      detail: {
        query: rawQuery,
        rawQuery: rawQuery,
        intent: "keyword-search",
        filters: publicFilterState()
      }
    }));
    applyFilterState("搜索条件已更新");
  }

  function abortKeywordSearch() {
    if (keywordSearchController) {
      keywordSearchController.abort();
      keywordSearchController = null;
    }
    keywordSearchRequestToken += 1;
  }

  function runKeywordSearch(query, token) {
    abortKeywordSearch();
    keywordSearchController = new AbortController();
    var requestToken = keywordSearchRequestToken;
    keywordSearchState = {
      query: query,
      datasets: [],
      papers: [],
      total: 0,
      loading: true,
      error: ""
    };
    showSearchResultsPanel();
    showStatus("正在搜索“" + query + "”...");
    var parameters = datasetFilterParameters();
    parameters.set("query", query);
    parameters.set("limit", "50");
    return fetch("./api/keyword-search?" + parameters.toString(), {
      signal: keywordSearchController.signal,
      cache: "default"
    }).then(function (response) {
      return response.json().catch(function () {
        return { error: "关键词搜索服务返回格式不正确" };
      }).then(function (payload) {
        if (!response.ok) {
          throw new Error(payload.error || "关键词搜索失败");
        }
        return payload;
      });
    }).then(function (payload) {
      if (requestToken !== keywordSearchRequestToken || token !== searchActionToken) {
        return null;
      }
      keywordSearchController = null;
      keywordSearchState = {
        query: query,
        datasets: sanitizeCityDatasets(payload.datasets || []),
        papers: sanitizeCityPapers(payload.papers || []),
        total: Math.max(0, Number(payload.total) || 0),
        loading: false,
        error: ""
      };
      showSearchResultsPanel();
      showStatus("找到 " + formatCount(keywordSearchState.total) + " 个匹配结果", 1800);
      return payload;
    }).catch(function (error) {
      if (error && error.name === "AbortError") {
        return null;
      }
      if (requestToken !== keywordSearchRequestToken || token !== searchActionToken) {
        return null;
      }
      keywordSearchController = null;
      keywordSearchState = {
        query: query,
        datasets: [],
        papers: [],
        total: 0,
        loading: false,
        error: error && error.message ? String(error.message) : "关键词搜索失败"
      };
      showSearchResultsPanel();
      showStatus("关键词搜索失败", 2200);
      return null;
    });
  }

  function extractLocationQuery(query) {
    var value = String(query || "")
      .trim()
      .replace(/[。！!？?，,]+$/g, "");
    if (!value) {
      return "";
    }
    var patterns = [
      /^(?:请|麻烦)?(?:帮我)?(?:定位|导航)(?:一下)?(?:到|至|去)?\s*(.+)$/,
      /^(?:请|麻烦)?(?:带我|领我)(?:去|到)\s*(.+)$/,
      /^(?:请|麻烦)?(?:飞到|飞往|前往|移动到|跳转到|查看)\s*(.+)$/,
      /^(?:我想|我要|想)?(?:去|到)\s*(.+)$/
    ];
    for (var i = 0; i < patterns.length; i += 1) {
      var match = value.match(patterns[i]);
      if (match && match[1]) {
        return match[1].trim().replace(/(?:附近|那里|那儿)$/g, "");
      }
    }
    return "";
  }


  function looksLikeNaturalDatasetQuery(query) {
    var value = String(query || "").trim();
    if (!value) {
      return false;
    }
    if (/(?:帮我|请帮|给我|推荐|查找|检索|寻找|搜集|搜索|研究|分析|数据集|数据产品|数据资源|有哪些|需要|适合|用于)/.test(value)) {
      return true;
    }
    if (/\b(?:find|recommend|search|dataset|datasets|research|show me)\b/i.test(value)) {
      return true;
    }
    if (/(?:18|19|20)\d{2}\s*(?:年)?\s*(?:-|—|–|~|至|到)\s*(?:18|19|20)\d{2}\s*(?:年)?/.test(value)) {
      return true;
    }
    return value.length >= 12 && /(?:影像|遥感|地震|气象|环境|海洋|土地|人口|交通|地质|水文|卫星|观测|监测)/.test(value);
  }

  async function locatePlace(placeName, existingToken) {
    var token = existingToken == null ? ++searchActionToken : existingToken;
    showStatus("正在查找“" + placeName + "”...");
    var locations = await loadLocationIndex();
    if (token !== searchActionToken) {
      return null;
    }
    var target = findLocationTarget(placeName, locations);
    if (!target) {
      showStatus("暂未找到“" + placeName + "”", 2200);
      return null;
    }
    beginManualNavigation();
    await navigateToLocation(target);
    if (token !== searchActionToken || !viewer || viewer.isDestroyed()) {
      return null;
    }
    window.dispatchEvent(new CustomEvent("geoapp:locationchange", {
      detail: {
        query: placeName,
        location: {
          code: target.code,
          name: target.name,
          level: target.level,
          parentCode: target.parentCode,
          center: target.center
        }
      }
    }));
    showStatus("已定位到" + target.name, 1800);
    return target;
  }

  function loadLocationIndex() {
    if (locationIndexPromise) {
      return locationIndexPromise;
    }
    locationIndexPromise = Promise.all([
      loadBoundaryGeoJson(DATA_ROOT + "/countries.geojson"),
      loadBoundaryGeoJson(DATA_ROOT + "/china-provinces.geojson")
    ]).then(function (sources) {
      var countries = sources[0];
      var provinces = sources[1];
      var provinceByCode = {};
      var records = [];
      records.push({
        code: "WORLD",
        name: "全球",
        level: "world",
        parentCode: null,
        parentName: null,
        center: [104, 24],
        aliases: ["全球", "世界", "地球"]
      });
      countries.features.forEach(function (feature) {
        records.push(locationRecord(feature.properties));
      });
      provinces.features.forEach(function (feature) {
        var record = locationRecord(feature.properties);
        provinceByCode[record.code] = record;
        records.push(record);
      });
      var cityLoads = provinces.features
        .filter(function (feature) {
          return Boolean(feature.properties.hasChildren);
        })
        .map(function (feature) {
          var provinceCode = String(feature.properties.regionCode);
          return loadBoundaryGeoJson(DATA_ROOT + "/china-cities/" + provinceCode + ".geojson")
            .then(function (citySource) {
              citySource.features.forEach(function (cityFeature) {
                var record = locationRecord(cityFeature.properties);
                record.parentName = provinceByCode[provinceCode]
                  ? provinceByCode[provinceCode].name
                  : "";
                records.push(record);
              });
            })
            .catch(function (error) {
              console.warn("地名索引跳过边界文件", provinceCode, error);
            });
        });
      return Promise.all(cityLoads).then(function () {
        return records;
      });
    }).catch(function (error) {
      locationIndexPromise = null;
      throw error;
    });
    return locationIndexPromise;
  }

  function locationRecord(properties) {
    var name = String(properties.name || properties.nameEn || properties.regionCode);
    var aliases = [name];
    if (properties.nameEn) {
      aliases.push(String(properties.nameEn));
    }
    var shortName = locationShortName(name);
    if (shortName && shortName !== name) {
      aliases.push(shortName);
    }
    return {
      code: String(properties.regionCode),
      name: name,
      level: String(properties.level || "country"),
      parentCode: properties.parentCode == null ? null : String(properties.parentCode),
      parentName: null,
      center: validCenter(properties.center),
      aliases: aliases
    };
  }

  function locationShortName(name) {
    return String(name || "")
      .replace(/特别行政区$/g, "")
      .replace(/(?:维吾尔|壮族|回族|蒙古族|藏族)?自治区$/g, "")
      .replace(/(?:自治州|地区|盟|省|市|区|县)$/g, "");
  }

  function normalizeLocationName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\s·•.。,'"，、_-]+/g, "");
  }

  function findLocationTarget(placeName, locations) {
    var query = normalizeLocationName(placeName);
    if (!query) {
      return null;
    }
    var best = null;
    var bestScore = -1;
    locations.forEach(function (location) {
      location.aliases.forEach(function (alias) {
        var normalizedAlias = normalizeLocationName(alias);
        if (normalizedAlias.length < 2) {
          return;
        }
        var score = -1;
        if (query === normalizedAlias) {
          score = 1000 + normalizedAlias.length;
        } else if (query.endsWith(normalizedAlias)) {
          score = 700 + normalizedAlias.length;
        } else if (query.indexOf(normalizedAlias) !== -1) {
          score = 500 + normalizedAlias.length;
        }
        if (score > bestScore) {
          best = location;
          bestScore = score;
        }
      });
    });
    return best;
  }

  async function navigateToLocation(target) {
    if (target.level === "world") {
      await returnToWorld(true);
      return;
    }
    if (target.level === "country") {
      if (target.code === "CHN") {
        await showChinaProvinces();
        return;
      }
      await returnToWorld(false, { preserveCamera: true });
      focusCurrentRegion(target.code, 1.25, true);
      return;
    }
    if (target.level === "province") {
      await showProvinceCities(
        target.code,
        target.name,
        regionCount(target.code, "province")
      );
      return;
    }
    var provinceName = target.parentName || target.parentCode;
    await showProvinceCities(
      target.parentCode,
      provinceName,
      regionCount(target.parentCode, "province"),
      { preserveCamera: true }
    );
    var meta = currentRegionMeta(target.code);
    if (!meta) {
      throw new Error("定位目标边界未加载: " + target.code);
    }
    selectLeaf(meta);
  }

  function currentRegionMeta(code) {
    var entity = currentBoundarySource && currentBoundarySource.entities.values.find(function (item) {
      return item.regionMeta && item.regionMeta.code === String(code);
    });
    return entity ? entity.regionMeta : null;
  }

  function focusCurrentRegion(code, duration, showStatistics) {
    var meta = currentRegionMeta(code);
    if (!meta) {
      throw new Error("定位目标边界未加载: " + code);
    }
    if (selectedMeta && selectedMeta.code !== meta.code) {
      applyRegionStyle(selectedMeta, false);
    }
    selectedMeta = meta;
    applyRegionStyle(meta, true, true);
    if (showStatistics) {
      showStatisticsPanel(meta, true);
    }
    viewer.flyTo(meta.boundaryEntity, { duration: duration || 1.1 });
  }

  function searchNaturalDatasets(query, existingToken) {
    var normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) {
      return Promise.resolve(null);
    }
    var token = existingToken == null ? ++searchActionToken : existingToken;
    if (datasetSearchController) {
      datasetSearchController.abort();
    }
    datasetSearchController = new AbortController();
    var request = datasetSearchArguments(normalizedQuery);
    showAiResultsLoading(normalizedQuery, request);
    showStatus("正在检索相关数据集...");

    return fetch("/api/dataset-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: datasetSearchController.signal
    }).then(function (response) {
      return response.json().catch(function () {
        return { error: "检索服务返回格式不正确" };
      }).then(function (payload) {
        if (!response.ok) {
          throw new Error(payload.error || "数据集检索失败");
        }
        return payload;
      });
    }).then(function (payload) {
      if (token !== searchActionToken) {
        return null;
      }
      datasetSearchController = null;
      renderAiResults(payload.results || [], payload.arguments || request);
      window.dispatchEvent(new CustomEvent("geoapp:datasetsearchresult", {
        detail: payload
      }));
      showStatus("已找到 " + (payload.results || []).length + " 个相关数据集", 1800);
      return payload;
    }).catch(function (error) {
      if (error && error.name === "AbortError") {
        return null;
      }
      if (token !== searchActionToken) {
        return null;
      }
      datasetSearchController = null;
      var keywordFallback = String(normalizedQuery || "").trim();
      if (keywordFallback) {
        // 智能检索不可用时自动回退到关键词匹配，避免用户空手而归
        closeAiResultsPanel();
        clearDatasetQueryForKeywordSearch(keywordFallback);
        runKeywordSearch(keywordFallback, token);
        showStatus("智能检索暂不可用，已自动改用关键词匹配", 3000);
        return null;
      }
      showAiResultsError(friendlyRetrievalError(error));
      showStatus("数据集检索失败", 2200);
      return null;
    });
  }

  function friendlyRetrievalError(error) {
    var detail = error && error.message ? String(error.message) : "";
    var normalized = detail.indexOf("无法连接") !== -1 || detail.indexOf("timed out") !== -1
      ? "智能检索服务暂时无法连接，请确认服务已启动后重试"
      : "智能检索服务暂时不可用，请稍后重试";
    if (detail && normalized.indexOf(detail) === -1) {
      normalized += "（" + detail + "）";
    }
    return normalized;
  }

  function datasetSearchArguments(query) {
    var request = {
      query: query,
      top_k: extractRequestedResultCount(query)
    };
    var yearRange = extractTargetYear(query);
    if (yearRange) {
      request.target_year = yearRange;
    }
    var bbox = extractTargetBoundingBox(query);
    if (!bbox && selectionBounds && /(?:框选|当前)(?:的)?(?:空间)?范围/.test(query)) {
      var selected = publicSelectionBounds(selectionBounds);
      bbox = {
        min_lon: selected.west,
        max_lon: selected.east,
        min_lat: selected.south,
        max_lat: selected.north
      };
    }
    if (bbox) {
      request.target_bbox = bbox;
    }
    return request;
  }

  function extractRequestedResultCount(query) {
    var match = String(query).match(/(?:推荐|返回|给我|查找|检索|前)\s*(\d{1,2})(?!\d)\s*(?:个|条|项|份)?/);
    return match ? clamp(Number(match[1]), 1, 50) : 5;
  }

  function extractTargetYear(query) {
    var value = String(query);
    var range = value.match(/((?:18|19|20)\d{2})\s*(?:年)?\s*(?:-|—|–|~|至|到)\s*((?:18|19|20)\d{2})\s*(?:年)?/);
    if (range) {
      return range[1] + "-" + range[2];
    }
    var single = value.match(/((?:18|19|20)\d{2})\s*年/);
    return single ? single[1] : "";
  }

  function extractTargetBoundingBox(query) {
    var value = String(query);
    var match = value.match(
      /经度\s*([+-]?\d+(?:\.\d+)?)\s*(?:-|—|–|~|至|到)\s*([+-]?\d+(?:\.\d+)?)\s*[,，、;；\s]*纬度\s*([+-]?\d+(?:\.\d+)?)\s*(?:-|—|–|~|至|到)\s*([+-]?\d+(?:\.\d+)?)/
    );
    if (!match) {
      return null;
    }
    var longitudes = [Number(match[1]), Number(match[2])].sort(function (left, right) {
      return left - right;
    });
    var latitudes = [Number(match[3]), Number(match[4])].sort(function (left, right) {
      return left - right;
    });
    if (longitudes[0] < -180 || longitudes[1] > 180 || latitudes[0] < -90 || latitudes[1] > 90) {
      return null;
    }
    return {
      min_lon: longitudes[0],
      max_lon: longitudes[1],
      min_lat: latitudes[0],
      max_lat: latitudes[1]
    };
  }

  function showAiResultsLoading(query, request) {
    clearSearchSpatialOverlays();
    document.getElementById("ai-results-panel").classList.remove("hidden");
    document.getElementById("ai-results-query-text").textContent = query;
    document.getElementById("ai-results-count").textContent = "检索中";
    renderAiSearchArguments(request);
    setAiResultsState("loading");
  }

  function showAiResultsError(message) {
    clearSearchSpatialOverlays();
    document.getElementById("ai-results-panel").classList.remove("hidden");
    document.getElementById("ai-results-count").textContent = "失败";
    document.getElementById("ai-results-error-message").textContent = message;
    setAiResultsState("error");
  }

  function renderAiResults(results, request) {
    var list = document.getElementById("ai-results-list");
    var spatialGroups = results.map(extractAiSpatialEntries);
    searchSpatialEntries = spatialGroups.reduce(function (entries, group) {
      return entries.concat(group);
    }, []);
    searchSpatialByKey = {};
    searchSpatialEntries.forEach(function (entry) {
      searchSpatialByKey[entry.key] = entry;
    });
    document.getElementById("ai-results-count").textContent = results.length + " 项";
    renderAiSearchArguments(request);
    document.getElementById("ai-results-map-summary").textContent = searchSpatialEntries.length
      ? searchSpatialEntries.length + " 处可定位"
      : "暂无可定位坐标";
    list.innerHTML = results.map(function (item, index) {
      return renderAiResultItem(item, index, spatialGroups[index]);
    }).join("");
    renderSearchSpatialOverlays();
    setAiResultsState(results.length ? "results" : "empty");
  }

  function renderAiSearchArguments(request) {
    var labels = [];
    if (request.target_year) {
      labels.push("时间 " + request.target_year);
    }
    if (request.target_bbox) {
      labels.push(
        "范围 " + request.target_bbox.min_lon + "~" + request.target_bbox.max_lon + "°E · " +
        request.target_bbox.min_lat + "~" + request.target_bbox.max_lat + "°N"
      );
    }
    document.getElementById("ai-results-arguments").innerHTML = labels.map(function (label) {
      return "<span>" + escapeHtml(label) + "</span>";
    }).join("");
  }

  function renderAiResultItem(item, resultIndex, spatialEntries) {
    var data = item.dataset_data || item.data || {};
    var name = item.dataset_name || data.dataset_name || data.title || "未命名数据集";
    var title = String(data.title || "").trim();
    var description = data.dataset_description || data.description || "暂无数据集描述";
    var scientificProblem = String(data.scientific_problem || "").trim();
    var datasetTimeRange = data.dataset_temporal_range || "未提供";
    var paperTimeRange = data.paper_use_temporal_range || "未提供";
    var datasetRegion = data.dataset_spatio_region || "未提供";
    var paperRegion = data.paper_use_spatio_region || "未提供";
    var datasetCoordinates = data.dataset_spatio_coords || "";
    var paperCoordinates = data.paper_use_spatio_coords || "";
    var tags = Array.isArray(data.research_topic_tags) ? data.research_topic_tags.slice(0, 4) : [];
    var datasetUrl = safeExternalUrl(data.dataset_url);
    var doi = String(data.doi || "").trim();
    var doiUrl = doi ? "https://doi.org/" + encodeURIComponent(doi) : "";
    var actions = [];
    if (datasetUrl) {
      actions.push('<a href="' + escapeHtml(datasetUrl) + '" target="_blank" rel="noopener noreferrer">数据集链接</a>');
    }
    if (doiUrl) {
      actions.push('<a href="' + escapeHtml(doiUrl) + '" target="_blank" rel="noopener noreferrer">论文 DOI</a>');
    }
    var primarySpatialKey = spatialEntries.length ? spatialEntries[0].key : "";
    var spatialByType = {};
    spatialEntries.forEach(function (entry) {
      spatialByType[entry.type] = entry;
    });
    return (
      '<article class="ai-result-item' + (spatialEntries.length ? ' has-spatial' : '') + '" role="listitem" ' +
        'data-result-index="' + resultIndex + '" data-primary-spatial-key="' + escapeHtml(primarySpatialKey) + '" ' +
        'aria-selected="false"' + (spatialEntries.length ? ' tabindex="0"' : '') + '>' +
        '<div class="ai-result-title-row">' +
          '<span class="ai-result-map-index' + (spatialEntries.length ? '' : ' is-muted') + '">' + (resultIndex + 1) + '</span>' +
          "<strong>" + escapeHtml(name) + "</strong>" +
          '<span class="ai-result-score">' + formatMatchScore(item.score) + "</span>" +
        "</div>" +
        (title ? '<span class="ai-result-paper-title"><b>关联论文</b>' + escapeHtml(title) + "</span>" : "") +
        '<div class="ai-result-scopes">' +
          renderAiScopeRow("dataset", "数据集覆盖", datasetTimeRange, datasetRegion, spatialByType.dataset) +
          renderAiScopeRow("paper", "论文使用", paperTimeRange, paperRegion, spatialByType.paper) +
        "</div>" +
        '<div class="ai-result-toolbar">' +
          (actions.length ? '<div class="ai-result-actions">' + actions.join("") + "</div>" : "<span></span>") +
          '<button class="ai-result-details-toggle" type="button" aria-expanded="false">' +
            '<span>详情</span><i aria-hidden="true"></i>' +
          "</button>" +
        "</div>" +
        '<div class="ai-result-details hidden">' +
          '<div class="ai-result-copy">' +
            '<span>数据集描述</span>' +
            '<p class="ai-result-description">' + escapeHtml(description) + "</p>" +
          "</div>" +
          (scientificProblem ? '<div class="ai-result-copy ai-result-science">' +
            '<span>科学问题</span><p>' + escapeHtml(scientificProblem) + "</p></div>" : "") +
          '<div class="ai-result-meta ai-result-meta-details">' +
            (datasetCoordinates ? renderAiMetaField("数据集全部经纬度", datasetCoordinates) : "") +
            (paperCoordinates ? renderAiMetaField("论文使用经纬度", paperCoordinates) : "") +
            (data.publication_date ? renderAiMetaField("论文发表日期", data.publication_date) : "") +
          "</div>" +
          (tags.length ? '<div class="ai-result-detail-tags"><span>学科标签</span><div class="ai-result-tags">' + tags.map(function (tag) {
            return "<span>" + escapeHtml(tag) + "</span>";
          }).join("") + "</div></div>" : "") +
        "</div>" +
      "</article>"
    );
  }

  function renderAiMetaField(label, value) {
    var text = String(value == null || value === "" ? "未提供" : value);
    return '<div><span>' + escapeHtml(label) + '</span><b title="' + escapeHtml(text) + '">' +
      escapeHtml(text) + "</b></div>";
  }

  function renderAiScopeRow(type, label, timeRange, region, spatialEntry) {
    var action = spatialEntry
      ? '<button class="ai-spatial-target ai-scope-locate" type="button" data-spatial-key="' +
          escapeHtml(spatialEntry.key) + '" title="定位' + escapeHtml(spatialEntry.typeLabel) + '">' +
          '<span>定位</span><small>' + (spatialEntry.extent.isArea ? "区域" : "点位") + "</small></button>"
      : '<span class="ai-scope-unavailable">无坐标</span>';
    return (
      '<section class="ai-result-scope is-' + type + '">' +
        '<div class="ai-result-scope-head">' +
          '<span class="ai-result-scope-kind"><i class="ai-spatial-swatch is-' + type +
            '" aria-hidden="true"></i>' + escapeHtml(label) + "</span>" +
          action +
        "</div>" +
        '<div class="ai-result-scope-values">' +
          '<span><small>时间</small><b title="' + escapeHtml(timeRange) + '">' + escapeHtml(timeRange) + "</b></span>" +
          '<span><small>区域</small><b title="' + escapeHtml(region) + '">' + escapeHtml(region) + "</b></span>" +
        "</div>" +
      "</section>"
    );
  }

  function extractAiSpatialEntries(item, resultIndex) {
    var data = item.dataset_data || item.data || {};
    var datasetName = item.dataset_name || data.dataset_name || data.title || "未命名数据集";
    var paperName = data.title || datasetName + " 相关论文";
    var entries = [];
    var datasetExtent = parseCoordinateExtent(data.dataset_spatio_coords);
    var paperExtent = parseCoordinateExtent(data.paper_use_spatio_coords);
    if (datasetExtent) {
      entries.push(createAiSpatialEntry(
        resultIndex,
        "dataset",
        datasetName,
        data.dataset_spatio_region,
        data.dataset_spatio_coords,
        datasetExtent
      ));
    }
    if (paperExtent) {
      entries.push(createAiSpatialEntry(
        resultIndex,
        "paper",
        paperName,
        data.paper_use_spatio_region,
        data.paper_use_spatio_coords,
        paperExtent
      ));
    }
    return entries;
  }

  function createAiSpatialEntry(resultIndex, type, name, region, coordinateText, extent) {
    return {
      key: "ai-result-" + resultIndex + "-" + type,
      resultIndex: resultIndex,
      displayIndex: resultIndex + 1,
      type: type,
      typeLabel: type === "paper" ? "论文使用范围" : "数据集全部范围",
      name: String(name || (type === "paper" ? "相关论文" : "数据集")),
      region: String(region || "未提供区域名称"),
      coordinateText: String(coordinateText || ""),
      extent: extent,
      markerEntity: null,
      areaEntity: null,
      outlineEntity: null
    };
  }

  function parseCoordinateExtent(value) {
    if (!value) {
      return null;
    }
    if (typeof value === "object") {
      var bounds = Array.isArray(value) ? value : value.bbox || value.bounds;
      if (Array.isArray(bounds) && bounds.length >= 4) {
        return normalizeCoordinateExtent(bounds[0], bounds[2], bounds[1], bounds[3]);
      }
      var west = value.min_lon != null ? value.min_lon : value.west;
      var east = value.max_lon != null ? value.max_lon : value.east;
      var south = value.min_lat != null ? value.min_lat : value.south;
      var north = value.max_lat != null ? value.max_lat : value.north;
      if (west != null && east != null && south != null && north != null) {
        return normalizeCoordinateExtent(west, east, south, north);
      }
      var longitude = value.longitude != null ? value.longitude : value.lon;
      var latitude = value.latitude != null ? value.latitude : value.lat;
      if (longitude != null && latitude != null) {
        return normalizeCoordinateExtent(longitude, longitude, latitude, latitude);
      }
      return null;
    }
    var text = String(value);
    var longitudeRange = coordinateAxisRange(text, "(?:Longitude|经度)");
    var latitudeRange = coordinateAxisRange(text, "(?:Latitude|纬度)");
    if (!longitudeRange || !latitudeRange) {
      return null;
    }
    return normalizeCoordinateExtent(
      longitudeRange[0],
      longitudeRange[1],
      latitudeRange[0],
      latitudeRange[1]
    );
  }

  function coordinateAxisRange(text, labelPattern) {
    var pattern = new RegExp(
      labelPattern + "\\s*[:：]?\\s*([+-]?\\d+(?:\\.\\d+)?)" +
      "\\s*(?:(?:-|—|–|~|至|到|to)\\s*([+-]?\\d+(?:\\.\\d+)?))?",
      "i"
    );
    var match = String(text).match(pattern);
    if (!match) {
      return null;
    }
    var first = Number(match[1]);
    var second = match[2] == null ? first : Number(match[2]);
    return [Math.min(first, second), Math.max(first, second)];
  }

  function normalizeCoordinateExtent(west, east, south, north) {
    var longitudes = [Number(west), Number(east)].sort(function (left, right) {
      return left - right;
    });
    var latitudes = [Number(south), Number(north)].sort(function (left, right) {
      return left - right;
    });
    if (!longitudes.concat(latitudes).every(Number.isFinite) ||
        longitudes[0] < -180 || longitudes[1] > 180 ||
        latitudes[0] < -90 || latitudes[1] > 90) {
      return null;
    }
    return {
      west: longitudes[0],
      east: longitudes[1],
      south: latitudes[0],
      north: latitudes[1],
      longitude: (longitudes[0] + longitudes[1]) * 0.5,
      latitude: (latitudes[0] + latitudes[1]) * 0.5,
      isArea: longitudes[1] - longitudes[0] > 0.02 || latitudes[1] - latitudes[0] > 0.02
    };
  }

  function renderSearchSpatialOverlays() {
    if (!searchResultSource || !searchResultBillboardCollection) {
      return;
    }
    searchResultSource.entities.removeAll();
    searchResultBillboardCollection.removeAll();
    activeSearchSpatialKey = null;
    searchSpatialEntries.forEach(addSearchSpatialOverlay);
    searchResultSource.show = pointVisible;
    searchResultBillboardCollection.show = pointVisible;
    if (regionBillboardCollection && searchSpatialEntries.length) {
      regionBillboardCollection.show = false;
    }
    syncAiSpatialSelection(null);
    if (viewer && !viewer.isDestroyed()) {
      viewer.scene.requestRender();
    }
  }

  function addSearchSpatialOverlay(entry) {
    var extent = entry.extent;
    var position = Cesium.Cartesian3.fromDegrees(extent.longitude, extent.latitude, 18000);
    var markerBillboard = searchResultBillboardCollection.add({
      position: position,
      image: searchSpatialMarkerImage(entry, false),
      width: 32,
      height: 32,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      pixelOffset: new Cesium.Cartesian2(entry.type === "paper" ? 9 : -9, 0),
      disableDepthTestDistance: 0,
      scaleByDistance: new Cesium.NearFarScalar(50000, 1.18, 25000000, 0.88),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 28000000),
      id: { searchSpatialMeta: entry }
    });
    entry.markerEntity = { billboard: markerBillboard };
    if (!extent.isArea) {
      return;
    }
    var ring = [
      extent.west, extent.south,
      extent.east, extent.south,
      extent.east, extent.north,
      extent.west, extent.north,
      extent.west, extent.south
    ];
    var fillPositions = Cesium.Cartesian3.fromDegreesArray(ring.slice(0, 8));
    entry.areaEntity = searchResultSource.entities.add({
      id: entry.key + "-area",
      polygon: {
        hierarchy: fillPositions,
        height: 10000,
        material: searchSpatialColor(entry.type, false).withAlpha(0.1),
        classificationType: Cesium.ClassificationType.BOTH
      }
    });
    entry.areaEntity.searchSpatialMeta = entry;
    entry.outlineEntity = searchResultSource.entities.add({
      id: entry.key + "-outline",
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([
          ring[0], ring[1], 12000,
          ring[2], ring[3], 12000,
          ring[4], ring[5], 12000,
          ring[6], ring[7], 12000,
          ring[8], ring[9], 12000
        ]),
        width: 1.4,
        material: searchSpatialColor(entry.type, false).withAlpha(0.78),
        arcType: Cesium.ArcType.GEODESIC
      }
    });
    entry.outlineEntity.searchSpatialMeta = entry;
  }

  function searchSpatialColor(type, active) {
    var color = active ? "#ffd16a" : type === "paper" ? "#8fa7ff" : "#63d8cf";
    return Cesium.Color.fromCssColorString(color);
  }

  function searchSpatialMarkerImage(entry, active) {
    var cacheKey = entry.type + ":" + entry.displayIndex + ":" + (active ? "1" : "0");
    if (searchSpatialImageCache[cacheKey]) {
      return searchSpatialImageCache[cacheKey];
    }
    var canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    var context = canvas.getContext("2d");
    var baseColor = entry.type === "paper" ? "#8fa7ff" : "#63d8cf";
    var glow = context.createRadialGradient(48, 48, 8, 48, 48, 43);
    glow.addColorStop(0, active ? "rgba(255, 209, 106, 0.32)" : entry.type === "paper"
      ? "rgba(143, 167, 255, 0.28)"
      : "rgba(99, 216, 207, 0.28)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, 96, 96);
    context.beginPath();
    if (entry.type === "paper") {
      context.moveTo(48, 20);
      context.lineTo(76, 48);
      context.lineTo(48, 76);
      context.lineTo(20, 48);
      context.closePath();
    } else {
      context.arc(48, 48, 28, 0, Math.PI * 2);
    }
    context.fillStyle = "rgba(7, 20, 27, 0.96)";
    context.fill();
    context.lineWidth = active ? 6 : 4;
    context.strokeStyle = active ? "#ffd16a" : baseColor;
    context.stroke();
    context.fillStyle = active ? "#ffe5a6" : "#effbfb";
    context.font = '700 27px "DIN Alternate", Arial, sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(entry.displayIndex), 48, 49);
    searchSpatialImageCache[cacheKey] = canvas;
    return canvas;
  }

  function onAiResultsListClick(event) {
    var detailsToggle = event.target.closest(".ai-result-details-toggle");
    if (detailsToggle) {
      event.preventDefault();
      event.stopPropagation();
      toggleAiResultDetails(detailsToggle);
      return;
    }
    var spatialButton = event.target.closest("[data-spatial-key]");
    if (spatialButton) {
      event.preventDefault();
      event.stopPropagation();
      selectSearchSpatialTarget(spatialButton.getAttribute("data-spatial-key"), "list", true);
      return;
    }
    if (event.target.closest("a, button")) {
      return;
    }
    var card = event.target.closest(".ai-result-item[data-primary-spatial-key]");
    if (card && card.getAttribute("data-primary-spatial-key")) {
      selectSearchSpatialTarget(card.getAttribute("data-primary-spatial-key"), "list", true);
    }
  }

  function toggleAiResultDetails(button) {
    var card = button.closest(".ai-result-item");
    var details = card && card.querySelector(".ai-result-details");
    if (!card || !details) {
      return;
    }
    var willOpen = details.classList.contains("hidden");
    details.classList.toggle("hidden", !willOpen);
    card.classList.toggle("is-details-open", willOpen);
    button.setAttribute("aria-expanded", String(willOpen));
    button.querySelector("span").textContent = willOpen ? "收起" : "详情";
  }

  function onAiResultsListKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    var card = event.target.closest(".ai-result-item[data-primary-spatial-key]");
    if (!card || event.target !== card || !card.getAttribute("data-primary-spatial-key")) {
      return;
    }
    event.preventDefault();
    selectSearchSpatialTarget(card.getAttribute("data-primary-spatial-key"), "list", true);
  }

  function selectSearchSpatialTarget(key, source, flyToTarget) {
    var entry = searchSpatialByKey[key];
    if (!entry) {
      return;
    }
    if (activeSearchSpatialKey && searchSpatialByKey[activeSearchSpatialKey]) {
      applySearchSpatialStyle(searchSpatialByKey[activeSearchSpatialKey], false);
    }
    activeSearchSpatialKey = key;
    applySearchSpatialStyle(entry, true);
    syncAiSpatialSelection(entry, source === "globe");
    if (flyToTarget) {
      focusSearchSpatialTarget(entry);
    }
    showStatus(entry.typeLabel + " · " + entry.region, 1800);
    window.dispatchEvent(new CustomEvent("geoapp:searchspatialselect", {
      detail: { key: entry.key, resultIndex: entry.resultIndex, type: entry.type, source: source }
    }));
  }

  function applySearchSpatialStyle(entry, active) {
    if (entry.markerEntity && entry.markerEntity.billboard) {
      entry.markerEntity.billboard.image = searchSpatialMarkerImage(entry, active);
      entry.markerEntity.billboard.width = active ? 42 : 32;
      entry.markerEntity.billboard.height = active ? 42 : 32;
    }
    if (entry.areaEntity && entry.areaEntity.polygon) {
      entry.areaEntity.polygon.material = searchSpatialColor(entry.type, active).withAlpha(active ? 0.24 : 0.1);
    }
    if (entry.outlineEntity && entry.outlineEntity.polyline) {
      entry.outlineEntity.polyline.material = searchSpatialColor(entry.type, active).withAlpha(active ? 0.98 : 0.78);
      entry.outlineEntity.polyline.width = active ? 2.8 : 1.4;
    }
    if (viewer && !viewer.isDestroyed()) {
      viewer.scene.requestRender();
    }
  }

  function syncAiSpatialSelection(entry, scrollIntoView) {
    document.querySelectorAll(".ai-result-item.is-spatial-active").forEach(function (card) {
      card.classList.remove("is-spatial-active");
      card.setAttribute("aria-selected", "false");
    });
    document.querySelectorAll(".ai-spatial-target.is-active").forEach(function (button) {
      button.classList.remove("is-active");
    });
    document.querySelectorAll(".ai-result-scope.is-active").forEach(function (scope) {
      scope.classList.remove("is-active");
    });
    if (!entry) {
      return;
    }
    var card = document.querySelector('.ai-result-item[data-result-index="' + entry.resultIndex + '"]');
    var button = document.querySelector('[data-spatial-key="' + entry.key + '"]');
    if (card) {
      card.classList.add("is-spatial-active");
      card.setAttribute("aria-selected", "true");
      if (scrollIntoView) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    if (button) {
      button.classList.add("is-active");
      var scope = button.closest(".ai-result-scope");
      if (scope) {
        scope.classList.add("is-active");
      }
    }
  }

  function focusSearchSpatialTarget(entry) {
    if (!viewer || viewer.isDestroyed()) {
      return;
    }
    beginManualNavigation();
    var extent = entry.extent;
    var span = Math.max(extent.east - extent.west, extent.north - extent.south);
    var height = extent.isArea ? clamp(span * 150000, 520000, 8500000) : 720000;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(extent.longitude, extent.latitude, height),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-76),
        roll: 0
      },
      duration: 1.05
    });
  }

  function clearSearchSpatialOverlays() {
    if (searchResultSource) {
      searchResultSource.entities.removeAll();
    }
    if (searchResultBillboardCollection) {
      searchResultBillboardCollection.removeAll();
    }
    if (regionBillboardCollection) {
      regionBillboardCollection.show = regionMarkersShouldShow();
    }
    searchSpatialEntries = [];
    searchSpatialByKey = {};
    activeSearchSpatialKey = null;
    syncAiSpatialSelection(null);
    if (viewer && !viewer.isDestroyed()) {
      viewer.scene.requestRender();
    }
  }

  function formatMatchScore(score) {
    var value = Number(score);
    return Number.isFinite(value) ? Math.round(clamp(value, 0, 1) * 100) + "%" : "--";
  }

  function safeExternalUrl(value) {
    var url = String(value || "").trim();
    return /^https?:\/\//i.test(url) ? url : "";
  }

  function setAiResultsState(stateName) {
    document.getElementById("ai-results-loading").classList.toggle("hidden", stateName !== "loading");
    document.getElementById("ai-results-error").classList.toggle("hidden", stateName !== "error");
    document.getElementById("ai-results-empty").classList.toggle("hidden", stateName !== "empty");
    document.getElementById("ai-results-section-head").classList.toggle("hidden", stateName !== "results");
    document.getElementById("ai-results-list").classList.toggle("hidden", stateName !== "results");
  }

  function closeAiResultsPanel() {
    abortDatasetSearch();
    clearSearchSpatialOverlays();
    document.getElementById("ai-results-panel").classList.add("hidden");
  }

  function cancelAiSearch() {
    if (datasetSearchController) {
      datasetSearchController.abort();
      datasetSearchController = null;
    }
    clearSearchSpatialOverlays();
    document.getElementById("ai-results-panel").classList.add("hidden");
    showStatus("已取消检索", 1200);
  }

  function abortDatasetSearch() {
    if (datasetSearchController) {
      datasetSearchController.abort();
      datasetSearchController = null;
    }
  }

  function closeFiltersPanel() {
    var panel = document.getElementById("filters-panel");
    var toggle = document.getElementById("filters-toggle");
    panel.classList.add("hidden");
    toggle.classList.remove("is-active");
    toggle.setAttribute("aria-expanded", "false");
  }

  // 筛选下拉框水平对齐：左边缘与搜索框(输入框)左边缘对齐，右边缘与筛选按钮右边缘对齐。
  function positionFiltersPanel() {
    var panel = document.getElementById("filters-panel");
    var searchInput = document.querySelector(".dataset-search input");
    var toggle = document.getElementById("filters-toggle");
    if (!panel || !searchInput || !toggle) {
      return;
    }
    var leftRect = searchInput.getBoundingClientRect();
    var rightRect = toggle.getBoundingClientRect();
    if (!leftRect || !rightRect || leftRect.width < 1 || rightRect.width < 1) {
      return;
    }
    var left = leftRect.left;
    var right = rightRect.right;
    var width = right - left;
    // 窄屏兜底：优先保证右缘与筛选按钮右缘对齐，必要时整体右移压缩宽度。
    var viewportMargin = 8;
    var maxWidth = window.innerWidth - viewportMargin * 2;
    if (width > maxWidth) {
      left = Math.max(viewportMargin, right - maxWidth);
      width = right - left;
    }
    if (width < 120) {
      return;
    }
    panel.style.left = left + "px";
    panel.style.width = width + "px";
  }

  async function loadRealFilterOptions() {
    try {
      var response = await fetch("./api/filter-options", { cache: "default" });
      if (!response.ok) {
        throw new Error("真实筛选项请求失败: " + response.status);
      }
      var options = await response.json();
      var topics = Array.isArray(options.topics) ? options.topics : [];
      document.getElementById("filter-theme").innerHTML = '<option value="">全部数据集主题</option>' +
        topics.map(function (topic) {
          return '<option value="' + escapeHtml(topic.value) + '">' + escapeHtml(topic.value) +
            " · " + formatCount(topic.count) + "</option>";
        }).join("");
      var paperTopics = Array.isArray(options.paper_topics) ? options.paper_topics : [];
      document.getElementById("filter-paper-theme").innerHTML = '<option value="">全部论文主题</option>' +
        paperTopics.map(function (topic) {
          return '<option value="' + escapeHtml(topic.value) + '">' + escapeHtml(topic.value) +
            " · " + formatCount(topic.count) + "</option>";
        }).join("");
      var periods = Array.isArray(options.publication_periods) ? options.publication_periods : [];
      if (periods.length) {
        configurePublicationRange(
          Math.min.apply(null, periods.map(function (period) { return Number(period.start); })),
          Math.max.apply(null, periods.map(function (period) { return Number(period.end); }))
        );
      }
      var sources = Array.isArray(options.sources) ? options.sources : [];
      document.getElementById("filter-source").innerHTML = '<option value="">全部数据来源</option>' +
        sources.map(function (source) {
          return '<option value="' + escapeHtml(source.value) + '">' + escapeHtml(source.value) +
            " · " + formatCount(source.count) + "</option>";
        }).join("");
    } catch (error) {
      console.warn("真实筛选项加载失败", error);
    }
  }

  function updateFilterOptionCount(selectId, value, count) {
    var option = document.querySelector("#" + selectId + ' option[value="' + value + '"]');
    if (!option || count == null) {
      return;
    }
    option.textContent = option.textContent.split(" · ")[0] + " · " + formatCount(count);
  }

  function bindPublicationRangeUi() {
    var start = document.getElementById("filter-publication-start");
    var end = document.getElementById("filter-publication-end");
    [start, end].forEach(function (input) {
      input.addEventListener("input", function () {
        normalizePublicationRange(input === start ? "start" : "end");
        updatePublicationRangePresentation();
      });
    });
    updatePublicationRangePresentation();
  }

  function configurePublicationRange(minimum, maximum) {
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
      return;
    }
    publicationYearMin = Math.round(minimum);
    publicationYearMax = Math.round(maximum);
    var start = document.getElementById("filter-publication-start");
    var end = document.getElementById("filter-publication-end");
    [start, end].forEach(function (input) {
      input.min = String(publicationYearMin);
      input.max = String(publicationYearMax);
    });
    start.value = String(filterState.publicationStartYear == null
      ? publicationYearMin
      : clamp(filterState.publicationStartYear, publicationYearMin, publicationYearMax));
    end.value = String(filterState.publicationEndYear == null
      ? publicationYearMax
      : clamp(filterState.publicationEndYear, publicationYearMin, publicationYearMax));
    document.getElementById("filter-publication-min").textContent = String(publicationYearMin);
    document.getElementById("filter-publication-mid").textContent = String(
      Math.round((publicationYearMin + publicationYearMax) * 0.5)
    );
    document.getElementById("filter-publication-max").textContent = String(publicationYearMax);
    updatePublicationRangePresentation();
  }

  function normalizePublicationRange(changed) {
    var start = document.getElementById("filter-publication-start");
    var end = document.getElementById("filter-publication-end");
    var startYear = Number(start.value);
    var endYear = Number(end.value);
    if (startYear <= endYear) {
      return;
    }
    if (changed === "start") {
      start.value = String(endYear);
    } else {
      end.value = String(startYear);
    }
  }

  function updatePublicationRangePresentation() {
    var start = document.getElementById("filter-publication-start");
    var end = document.getElementById("filter-publication-end");
    var startYear = Number(start.value);
    var endYear = Number(end.value);
    var span = Math.max(1, publicationYearMax - publicationYearMin);
    var startPercent = (startYear - publicationYearMin) / span * 100;
    var endPercent = (endYear - publicationYearMin) / span * 100;
    var selection = document.getElementById("filter-publication-selection");
    selection.style.left = clamp(startPercent, 0, 100) + "%";
    selection.style.width = clamp(endPercent - startPercent, 0, 100) + "%";
    document.getElementById("filter-publication-value").textContent = startYear + " — " + endYear;
    start.setAttribute("aria-valuetext", String(startYear));
    end.setAttribute("aria-valuetext", String(endYear));
  }

  function selectedPublicationRange() {
    var start = Number(document.getElementById("filter-publication-start").value);
    var end = Number(document.getElementById("filter-publication-end").value);
    if (start <= publicationYearMin && end >= publicationYearMax) {
      return { start: null, end: null };
    }
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  function resetPublicationRangeUi() {
    document.getElementById("filter-publication-start").value = String(publicationYearMin);
    document.getElementById("filter-publication-end").value = String(publicationYearMax);
    updatePublicationRangePresentation();
  }

  function createDefaultFilterState() {
    return {
      query: "",
      theme: "",
      paperTheme: "",
      source: "",
      publicationStartYear: null,
      publicationEndYear: null,
      timeActive: false,
      timeView: "human",
      timeScope: "human",
      timeOlderYears: HUMAN_YEAR_MAX - humanTimelineYearMin,
      timeYoungerYears: HUMAN_YEAR_MAX - humanTimelineYearMax
    };
  }

  function bindTimelineUi() {
    var start = document.getElementById("time-range-start");
    var end = document.getElementById("time-range-end");
    document.querySelectorAll("[data-time-focus]").forEach(function (button) {
      button.addEventListener("click", function () {
        focusTimeline(button.getAttribute("data-time-focus"));
      });
    });
    [start, end].forEach(function (input) {
      input.addEventListener("input", function () {
        normalizeTimelineHandles(input === start ? "start" : "end");
        storeTimelineRange();
        filterState.timeActive = true;
        updateTimelinePresentation(false);
        scheduleTimelineFilter();
      });
      input.addEventListener("change", function () {
        window.clearTimeout(timelineFilterTimer);
        timelineFilterTimer = 0;
        if (filterState.timeScope === "human" && filterState.timeView === "unified") {
          filterState.timeView = "human";
          configureTimelineUi();
        }
        applyTimelineFilter("时间范围已更新");
      });
    });
    configureTimelineUi();
  }

  // 拖动时间轴时按短延迟节流触发真实筛选（含地图热力、统计卡片与关键词检索），
  // 保证时间轴与搜索框、筛选按钮中的条件按交集(AND)实时生效。
  function scheduleTimelineFilter() {
    window.clearTimeout(timelineFilterTimer);
    timelineFilterTimer = window.setTimeout(function () {
      timelineFilterTimer = 0;
      applyTimelineFilter("时间范围已更新");
    }, 160);
  }

  function configureTimelineUi() {
    var start = document.getElementById("time-range-start");
    var end = document.getElementById("time-range-end");
    start.min = "0";
    start.max = String(GEOLOGIC_SLIDER_MAX);
    start.step = "1";
    end.min = "0";
    end.max = String(GEOLOGIC_SLIDER_MAX);
    end.step = "1";
    start.value = String(ageToViewSlider(filterState.timeOlderYears));
    end.value = String(ageToViewSlider(filterState.timeYoungerYears));
    start.setAttribute("aria-label", "数据集较早时间边界");
    end.setAttribute("aria-label", "数据集较晚时间边界");
    updateTimelinePresentation(true);
  }

  function normalizeTimelineHandles(changed) {
    var start = document.getElementById("time-range-start");
    var end = document.getElementById("time-range-end");
    var startValue = Number(start.value);
    var endValue = Number(end.value);
    var gap = 2;
    if (startValue <= endValue - gap) {
      return;
    }
    if (changed === "start") {
      start.value = String(Math.max(Number(start.min), endValue - gap));
    } else {
      end.value = String(Math.min(Number(end.max), startValue + gap));
    }
  }

  function storeTimelineRange() {
    var startValue = Number(document.getElementById("time-range-start").value);
    var endValue = Number(document.getElementById("time-range-end").value);
    filterState.timeOlderYears = viewSliderToAge(startValue);
    filterState.timeYoungerYears = viewSliderToAge(endValue);
    filterState.timeScope = filterState.timeView === "human" || filterState.timeView === "geologic"
      ? filterState.timeView
      : inferTimelineScope(filterState.timeOlderYears, filterState.timeYoungerYears);
  }

  function updateTimelinePresentation(renderScale) {
    var start = document.getElementById("time-range-start");
    var end = document.getElementById("time-range-end");
    var minimum = Number(start.min);
    var maximum = Number(start.max);
    var startPercent = (Number(start.value) - minimum) / (maximum - minimum) * 100;
    var endPercent = (Number(end.value) - minimum) / (maximum - minimum) * 100;
    var selection = document.getElementById("time-range-selection");
    selection.style.left = startPercent + "%";
    selection.style.width = Math.max(0, endPercent - startPercent) + "%";
    document.getElementById("time-filter-value").textContent = timelineSummary();
    document.getElementById("time-filter").classList.toggle("is-active", filterState.timeActive);
    document.querySelectorAll("[data-time-focus]").forEach(function (button) {
      button.classList.toggle("is-active", button.getAttribute("data-time-focus") === filterState.timeView);
    });
    renderTimelineDensity(startPercent, endPercent);
    if (renderScale) {
      renderTimelineScale();
    }
  }

  function renderTimelineScale() {
    var ticks;
    if (filterState.timeView === "human") {
      ticks = humanTimelineTicks();
    } else if (filterState.timeView === "geologic") {
      ticks = [
        { age: 4600e6, label: "4600 Ma" },
        { age: 541e6, label: "541 Ma" },
        { age: 66e6, label: "66 Ma" },
        { age: 2.58e6, label: "2.58 Ma" },
        { age: humanTimelineBoundaryAge() + 1, label: "近现代" }
      ];
    } else {
      ticks = [
        { age: 4600e6, label: "46亿年前" },
        { age: 66e6, label: "66 Ma" },
        { age: humanTimelineBoundaryAge(), label: String(humanTimelineYearMin) },
        { age: HUMAN_YEAR_MAX - humanTimelineYearMax, label: String(humanTimelineYearMax) }
      ];
    }
    ticks = ticks.map(function (tick) {
      return { position: ageToViewSlider(tick.age) / GEOLOGIC_SLIDER_MAX * 100, label: tick.label };
    });
    document.getElementById("time-scale").innerHTML = ticks.map(function (tick) {
      return '<span style="left:' + tick.position + '%">' + tick.label + "</span>";
    }).join("");
  }

  function humanTimelineTicks() {
    var startYear = humanTimelineYearMin;
    var endYear = humanTimelineYearMax;
    var span = Math.max(1, endYear - startYear);
    var steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    var step = steps[steps.length - 1];
    for (var index = 0; index < steps.length; index += 1) {
      if (span / steps[index] <= 5) {
        step = steps[index];
        break;
      }
    }
    var ticks = [];
    for (var year = startYear; year < endYear; year += step) {
      ticks.push({ age: HUMAN_YEAR_MAX - year, label: String(year) });
    }
    ticks.push({ age: HUMAN_YEAR_MAX - endYear, label: String(endYear) });
    return ticks;
  }

  function renderTimelineDensity(startPercent, endPercent) {
    var container = document.getElementById("time-density");
    if (!container) {
      return;
    }
    var catalog = suppliedSearchResults || createMockSearchDatasets();
    var datasets = catalog.filter(datasetMatchesNonTemporalFilters);
    var densityDatasets = datasets.filter(function (dataset) {
      return filterState.timeView !== "human" || dataset.temporalMode !== "geologic";
    });
    var barCount = 132;
    var values = new Array(barCount).fill(0);
    var signature = [
      filterState.timeView,
      filterState.query,
      filterState.theme,
      filterState.source,
      filterState.publicationStartYear,
      filterState.publicationEndYear
    ].join(":");
    var random = seededRandom(stringHash(signature || "timeline-density"));
    var peaks = filterState.timeView === "human"
      ? [0.08, 0.35, 0.62, 0.82, 0.96].map(function (ratio, index) {
          var year = Math.round(humanTimelineYearMin +
            (humanTimelineYearMax - humanTimelineYearMin) * ratio);
          return {
            age: HUMAN_YEAR_MAX - year,
            amplitude: 0.24 + index * 0.16,
            width: Math.max(0.035, 0.08 - index * 0.01)
          };
        })
      : [
          { age: 3800e6, amplitude: 0.34, width: 0.055 },
          { age: 2500e6, amplitude: 0.44, width: 0.06 },
          { age: 541e6, amplitude: 0.7, width: 0.05 },
          { age: 252e6, amplitude: 0.54, width: 0.045 },
          { age: 66e6, amplitude: 0.82, width: 0.04 },
          { age: 2.58e6, amplitude: 0.58, width: 0.036 },
          { age: 0, amplitude: 0.74, width: 0.028 }
        ];
    if (densityDatasets.length) {
      peaks.forEach(function (peak) {
        var center = ageToViewSlider(peak.age) / GEOLOGIC_SLIDER_MAX + (random() - 0.5) * 0.028;
        var amplitude = peak.amplitude * (0.68 + random() * 0.58);
        addTimelineDensityPeak(values, center, peak.width, amplitude);
      });
      densityDatasets.forEach(function (dataset, index) {
        var extent = datasetUnifiedExtent(dataset);
        if (!extent) {
          return;
        }
        var older = ageToViewSlider(extent.older) / GEOLOGIC_SLIDER_MAX;
        var younger = ageToViewSlider(extent.younger) / GEOLOGIC_SLIDER_MAX;
        var center = (older + younger) * 0.5;
        var width = clamp(Math.abs(younger - older) * 0.32 + 0.025, 0.025, 0.12);
        addTimelineDensityPeak(values, center, width, 0.18 + (index % 5) * 0.035);
      });
      values = values.map(function (value, index) {
        var position = (index + 0.5) / barCount;
        var recentBias = filterState.timeView === "human" ? 0.08 + position * 0.18 : 0.08;
        return value + recentBias + random() * 0.09;
      });
    }
    var maximum = Math.max.apply(Math, values.concat([1]));
    var start = Number.isFinite(startPercent) ? startPercent : 0;
    var end = Number.isFinite(endPercent) ? endPercent : 100;
    container.classList.toggle("is-empty", densityDatasets.length === 0);
    var normalized = values.map(function (value) { return value / maximum; });
    var bars = timelineDensityBars(normalized, densityDatasets.length > 0);
    var clipX = clamp(start, 0, 100) * 10;
    var clipWidth = Math.max(0, clamp(end, 0, 100) - clamp(start, 0, 100)) * 10;
    container.innerHTML =
      '<svg viewBox="0 0 1000 30" preserveAspectRatio="none" focusable="false">' +
        '<defs>' +
          '<clipPath id="time-density-selection"><rect x="' + clipX.toFixed(2) + '" y="0" width="' +
            clipWidth.toFixed(2) + '" height="30"></rect></clipPath>' +
        '</defs>' +
        '<g class="time-density-bars">' + bars.base + '</g>' +
        '<g class="time-density-bars-active" clip-path="url(#time-density-selection)">' + bars.active + '</g>' +
      '</svg>';
  }

  function timelineDensityBars(values, hasData) {
    var baseline = 28;
    var slotWidth = 1000 / Math.max(1, values.length);
    var barWidth = Math.max(2.8, slotWidth * 0.58);
    var base = [];
    var active = [];
    values.forEach(function (value, index) {
      var height = hasData ? 3 + value * 21 : 1;
      var x = index * slotWidth + (slotWidth - barWidth) * 0.5;
      var y = baseline - height;
      var geometry = ' x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' +
        barWidth.toFixed(2) + '" height="' + height.toFixed(2) + '" rx="0.8"';
      base.push('<rect class="time-density-bar"' + geometry + '></rect>');
      active.push('<rect class="time-density-bar-active"' + geometry + '></rect>');
    });
    return { base: base.join(""), active: active.join("") };
  }

  function addTimelineDensityPeak(values, center, width, amplitude) {
    values.forEach(function (_, index) {
      var position = (index + 0.5) / values.length;
      var distance = (position - center) / Math.max(0.012, width);
      values[index] += amplitude * Math.exp(-0.5 * distance * distance);
    });
  }

  function timelineViewBounds() {
    if (filterState.timeView === "human") {
      return {
        older: HUMAN_YEAR_MAX - humanTimelineYearMin,
        younger: HUMAN_YEAR_MAX - humanTimelineYearMax
      };
    }
    if (filterState.timeView === "geologic") {
      return { older: GEOLOGIC_MAX_MA * 1000000, younger: 0 };
    }
    return { older: GEOLOGIC_MAX_MA * 1000000, younger: 0 };
  }

  function ageToViewSlider(ageYears) {
    var bounds = timelineViewBounds();
    var age = clamp(Number(ageYears) || 0, bounds.younger, bounds.older);
    var progress;
    if (filterState.timeView === "human") {
      progress = (bounds.older - age) / (bounds.older - bounds.younger);
    } else if (filterState.timeView === "geologic") {
      progress = 1 - Math.cbrt(age / bounds.older);
    } else {
      progress = 1 - Math.log10(age + 1) / Math.log10(bounds.older + 1);
    }
    return Math.round(clamp(progress, 0, 1) * GEOLOGIC_SLIDER_MAX);
  }

  function viewSliderToAge(sliderValue) {
    var bounds = timelineViewBounds();
    var progress = clamp(Number(sliderValue) || 0, 0, GEOLOGIC_SLIDER_MAX) / GEOLOGIC_SLIDER_MAX;
    if (filterState.timeView === "human") {
      return bounds.older + (bounds.younger - bounds.older) * progress;
    }
    if (filterState.timeView === "geologic") {
      return bounds.older * Math.pow(1 - progress, 3);
    }
    return Math.pow(10, Math.log10(bounds.older + 1) * (1 - progress)) - 1;
  }

  function formatGeologicAge(ageMa) {
    if (ageMa <= 0.005) {
      return "0 Ma";
    }
    if (ageMa >= 1000) {
      return (Math.round(ageMa / 10) * 10).toLocaleString("zh-CN") + " Ma";
    }
    if (ageMa >= 100) {
      return Math.round(ageMa) + " Ma";
    }
    if (ageMa >= 10) {
      return ageMa.toFixed(1) + " Ma";
    }
    return ageMa.toFixed(2) + " Ma";
  }

  function timelineSummary() {
    if (!filterState.timeActive && filterState.timeView === "unified") {
      return "46亿年前 — " + HUMAN_YEAR_MAX;
    }
    if (filterState.timeView === "geologic") {
      return formatGeologicAge(filterState.timeOlderYears / 1000000) + " — " +
        formatGeologicAge(filterState.timeYoungerYears / 1000000);
    }
    if (filterState.timeView === "human") {
      return ageToCalendarYear(filterState.timeOlderYears) + " — " +
        ageToCalendarYear(filterState.timeYoungerYears);
    }
    return formatUnifiedAge(filterState.timeOlderYears) + " — " + formatUnifiedAge(filterState.timeYoungerYears);
  }

  function formatUnifiedAge(ageYears) {
    if (ageYears <= humanTimelineBoundaryAge()) {
      return ageToCalendarYear(ageYears);
    }
    if (ageYears >= 1000000) {
      return formatGeologicAge(ageYears / 1000000);
    }
    if (ageYears >= 10000) {
      return (ageYears / 10000).toFixed(ageYears >= 100000 ? 0 : 1) + "万年前";
    }
    return Math.round(ageYears).toLocaleString("zh-CN") + "年前";
  }

  function inferTimelineScope(olderYears, youngerYears) {
    var humanBoundary = humanTimelineBoundaryAge();
    if (olderYears <= humanBoundary) {
      return "human";
    }
    if (youngerYears > humanBoundary) {
      return "geologic";
    }
    return "unified";
  }

  function publicTemporalFilter() {
    if (!filterState.timeActive) {
      return null;
    }
    var temporal = {
      mode: filterState.timeScope,
      scope: filterState.timeScope,
      older: publicTemporalBoundary(filterState.timeOlderYears),
      younger: publicTemporalBoundary(filterState.timeYoungerYears)
    };
    if (filterState.timeScope === "human") {
      temporal.startYear = ageToCalendarYear(filterState.timeOlderYears);
      temporal.endYear = ageToCalendarYear(filterState.timeYoungerYears);
    } else if (filterState.timeScope === "geologic") {
      temporal.olderMa = Number((filterState.timeOlderYears / 1000000).toFixed(4));
      temporal.youngerMa = Number((filterState.timeYoungerYears / 1000000).toFixed(4));
    }
    return temporal;
  }

  function publicTemporalBoundary(ageYears) {
    // 人类纪年模式必须始终输出 calendar；动态范围可能早于 1900，
    // 不能再用固定 1900 阈值把它误判成地质深时。
    if (filterState.timeScope === "human" || ageYears <= humanTimelineBoundaryAge()) {
      return { scale: "calendar", year: ageToCalendarYear(ageYears) };
    }
    return { scale: "ma", value: Number((ageYears / 1000000).toFixed(6)) };
  }

  function timelineFilterSignature() {
    var temporal = publicTemporalFilter();
    if (!temporal) {
      return "";
    }
    return temporal.scope + ":" + filterState.timeOlderYears.toFixed(3) + ":" +
      filterState.timeYoungerYears.toFixed(3);
  }

  function resetTimelineState() {
    filterState.timeActive = false;
    filterState.timeView = "human";
    filterState.timeScope = "human";
    filterState.timeOlderYears = HUMAN_YEAR_MAX - humanTimelineYearMin;
    filterState.timeYoungerYears = HUMAN_YEAR_MAX - humanTimelineYearMax;
    configureTimelineUi();
  }

  function focusTimeline(view) {
    if (view === "unified") {
      resetTimelineState();
      applyTimelineFilter("已显示完整时域");
      return;
    }
    filterState.timeActive = true;
    filterState.timeView = view === "geologic" ? "geologic" : "human";
    filterState.timeScope = filterState.timeView;
    var bounds = timelineViewBounds();
    filterState.timeOlderYears = bounds.older;
    filterState.timeYoungerYears = bounds.younger;
    configureTimelineUi();
    applyTimelineFilter(filterState.timeView === "human" ? "已聚焦人类纪年" : "已聚焦地质深时");
  }

  function applyTimelineFilter(message) {
    window.dispatchEvent(new CustomEvent("geoapp:timechange", {
      detail: { temporal: publicTemporalFilter(), filters: publicFilterState() }
    }));
    applyFilterState(message, true);
    rerunActiveKeywordSearch();
  }

  // 时间轴/筛选变化后，若当前正展示关键词搜索结果，则用最新条件重新检索，
  // 保证“筛选 + 时间轴 + 关键词”始终按交集(AND)生效。
  function rerunActiveKeywordSearch() {
    var keywordQuery = filterState.query;
    if (keywordQuery && keywordSearchState && keywordSearchState.query === keywordQuery) {
      runKeywordSearch(keywordQuery, ++searchActionToken);
    }
  }

  function applyFilterState(message, skipTimelineAutoFocus) {
    if (!skipTimelineAutoFocus) {
      syncTimelineToFilterResults();
    }
    updateTimelinePresentation(true);
    markerImageCache = {};
    updateActiveFilterBadge();
    window.dispatchEvent(new CustomEvent("geoapp:filterchange", {
      detail: { filters: publicFilterState() }
    }));
    if (selectionBounds) {
      dispatchSpatialSelection("filters");
    }
    refreshCurrentLevel().then(function () {
      showStatus(message, 1500);
    }).catch(function (error) {
      console.error("筛选结果刷新失败", error);
      showStatus("筛选结果刷新失败", 2200);
    });
  }

  function syncTimelineToFilterResults() {
    if (filterState.timeActive) {
      return;
    }
    // 立即贴合当前动态范围，随后用真实统计结果修正数据集与论文的年份边界。
    filterState.timeView = "human";
    filterState.timeScope = "human";
    var bounds = timelineViewBounds();
    filterState.timeOlderYears = bounds.older;
    filterState.timeYoungerYears = bounds.younger;
    configureTimelineUi();
    scheduleTimelineRangeForCurrentScope(0);
  }

  function humanTimelineBoundaryAge() {
    return HUMAN_YEAR_MAX - humanTimelineYearMin;
  }

  function ageToCalendarYear(ageYears) {
    return HUMAN_YEAR_MAX - Math.round(Number(ageYears) || 0);
  }

  function normalizeTimelineYear(value) {
    var year = Math.round(Number(value));
    return Number.isFinite(year) && year >= 1 && year <= 10000 ? year : null;
  }

  function timelineYearRangeFromStatistics(statistics) {
    var value = statistics || {};
    var years = [
      value.dataset_year_start, value.dataset_year_end,
      value.paper_year_start, value.paper_year_end,
      value.year_start, value.year_end,
    ].map(normalizeTimelineYear).filter(function (year) { return year != null; });
    if (!years.length) {
      return null;
    }
    return {
      start: Math.min.apply(Math, years),
      end: Math.max.apply(Math, years)
    };
  }

  function applyHumanTimelineYearRange(startYear, endYear) {
    var start = normalizeTimelineYear(startYear);
    var end = normalizeTimelineYear(endYear);
    if (start == null || end == null) {
      return false;
    }
    if (filterState.timeActive) {
      // 用户已手动选择时间范围时，不能用该范围的统计结果反向压缩坐标轴，
      // 否则拖动一次后就无法再拖回更宽的时间范围。
      return false;
    }
    var range = start <= end ? { start: start, end: end } : { start: end, end: start };
    humanTimelineYearMin = range.start;
    humanTimelineYearMax = range.end;
    filterState.timeView = "human";
    filterState.timeScope = "human";
    filterState.timeOlderYears = HUMAN_YEAR_MAX - range.start;
    filterState.timeYoungerYears = HUMAN_YEAR_MAX - range.end;
    configureTimelineUi();
    return true;
  }

  function applyHumanTimelineYearRangeFromStatistics(statistics) {
    var range = timelineYearRangeFromStatistics(statistics);
    return !!range && applyHumanTimelineYearRange(range.start, range.end);
  }

  function scheduleTimelineRangeForCurrentScope(delay) {
    window.clearTimeout(timelineRangeRequestTimer);
    timelineRangeRequestTimer = window.setTimeout(function () {
      timelineRangeRequestTimer = 0;
      loadTimelineRangeForCurrentScope();
    }, Math.max(0, Number(delay) || 0));
  }

  async function loadTimelineRangeForCurrentScope() {
    if (filterState.timeActive || selectionBounds) {
      return;
    }
    var meta = defaultStatisticsMeta();
    if (!meta) {
      return;
    }
    var signature = statisticsSignature(meta);
    if (statisticsCache[signature]) {
      applyHumanTimelineYearRangeFromStatistics(statisticsCache[signature]);
      return;
    }
    if (
      (timelineRangeRequestSignature === signature && timelineRangeRequestController) ||
      (statisticsRequestSignature === signature && statisticsRequestController)
    ) {
      return;
    }
    var token = ++timelineRangeRequestToken;
    timelineRangeRequestSignature = signature;
    if (timelineRangeRequestController) {
      timelineRangeRequestController.abort();
    }
    timelineRangeRequestController = new AbortController();
    try {
      var parameters = datasetFilterParameters();
      parameters.set("region_code", meta.code);
      var response = await fetch("./api/region-statistics?" + parameters.toString(), {
        signal: timelineRangeRequestController.signal,
        cache: "default"
      });
      if (!response.ok) {
        throw new Error("时间范围统计请求失败: " + response.status);
      }
      var statistics = await response.json();
      statisticsCache[signature] = statistics;
      if (token === timelineRangeRequestToken && statisticsSignature(meta) === signature) {
        applyHumanTimelineYearRangeFromStatistics(statistics);
      }
    } catch (error) {
      if (error && error.name === "AbortError") {
        return;
      }
      console.error("时间范围统计加载失败", error);
    } finally {
      if (token === timelineRangeRequestToken) {
        timelineRangeRequestController = null;
      }
    }
  }

  function publicFilterState() {
    return {
      query: filterState.query,
      theme: filterState.theme,
      paperTheme: filterState.paperTheme,
      timeRange: filterState.timeActive ? timelineSummary() : "",
      temporal: publicTemporalFilter(),
      source: filterState.source,
      publicationStartYear: filterState.publicationStartYear,
      publicationEndYear: filterState.publicationEndYear
    };
  }

  function updateActiveFilterBadge() {
    // 角标只统计“筛选面板”里的条件（主题/来源/时间轴等），
    // 搜索框输入的关键词不参与，避免输入时出现 +1 提示。
    var count = activeFilterBadgeCount();
    var badge = document.getElementById("active-filter-count");
    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
    document.getElementById("filters-toggle").classList.toggle("has-filters", count > 0);
  }

  function activeFilterBadgeCount() {
    return (filterState.theme ? 1 : 0) +
      (filterState.paperTheme ? 1 : 0) +
      (filterState.timeActive ? 1 : 0) +
      (filterState.source ? 1 : 0) +
      (filterState.publicationStartYear != null && filterState.publicationEndYear != null ? 1 : 0);
  }

  function activeFilterCount() {
    return (filterState.query ? 1 : 0) +
      (filterState.theme ? 1 : 0) +
      (filterState.paperTheme ? 1 : 0) +
      (filterState.timeActive ? 1 : 0) +
      (filterState.source ? 1 : 0) +
      (filterState.publicationStartYear != null && filterState.publicationEndYear != null ? 1 : 0);
  }

  function hasActiveFilters() {
    return activeFilterCount() > 0;
  }

  function ensureHeatLayerOnTop() {
    window.setTimeout(function () {
      if (viewer && !viewer.isDestroyed()) {
        applyTechBaseStyle();
        if (heatLayer && !heatLayer.isDestroyed()) {
          viewer.imageryLayers.raiseToTop(heatLayer);
        }
        viewer.scene.requestRender();
      }
    }, 0);
  }

  function applyTechBaseStyle() {
    if (!viewer || viewer.isDestroyed()) {
      return;
    }
    for (var index = 0; index < viewer.imageryLayers.length; index += 1) {
      var layer = viewer.imageryLayers.get(index);
      if (!layer || layer === heatLayer || layer.isDestroyed()) {
        continue;
      }
      var kind = layer.__geoProviderKind;
      if (layer.__geoLayerRole === "labels") {
        layer.brightness = 0.82;
        layer.saturation = 0.42;
        layer.contrast = 1.08;
        layer.gamma = 0.92;
      } else if (kind === "esri" || kind === "esri-satellite" ||
                 (kind === "tianditu" && layer.__geoLayerRole === "base")) {
        // 卫星影像随缩放级别自适应（低饱和偏暗，贴合暗黑 UI）：
        // 全球视图压暗/降饱和以突出热力图，深放大略提亮保证可读。
        applyEsriBaseCameraStyle(layer);
      } else {
        layer.brightness = 0.64;
        layer.saturation = 0.56;
        layer.contrast = 1.22;
        layer.gamma = 0.84;
      }
    }
  }

  // Esri 卫星影像随缩放级别自适应（global→深放大）：
  // far=1 表示全球视图，far=0 表示深放大。
  function applyEsriBaseCameraStyle(layer) {
    if (!layer || layer.isDestroyed() || !viewer || viewer.isDestroyed() ||
        layer.__geoLayerRole === "labels") {
      return;
    }
    var cartographic = viewer.camera.positionCartographic;
    var height = cartographic ? cartographic.height : 0;
    if (!Number.isFinite(height)) {
      return;
    }
    // 高度几乎不变时跳过，避免每帧写影像图层属性。
    if (layer.__geoEsriLastHeight != null &&
        Math.abs(height - layer.__geoEsriLastHeight) < Math.max(20000, height * 0.004)) {
      return;
    }
    layer.__geoEsriLastHeight = height;
    var far = smoothStep(4000000, 18000000, height);
    // 低饱和、偏暗的基调贴合暗黑 UI；深放大提亮保证可读。
    // 全球：压暗 + 降饱和，减弱海洋浅蓝，避免与暖色热力图抢对比；
    // 深放大：适当提亮 + 适中饱和，保证可读且与暗黑 UI 协调。
    layer.brightness = 0.92 - far * 0.44;  // 深 0.92 → 全球 0.48
    layer.saturation = 0.46 - far * 0.28;  // 深 0.46 → 全球 0.18
    layer.contrast   = 1.00 + far * 0.14;  // 深 1.00 → 全球 1.14
    layer.gamma      = 1.00 - far * 0.12;  // 深 1.00 → 全球 0.88
  }

  function applyEsriBaseLayersCameraStyle() {
    if (!viewer || viewer.isDestroyed()) {
      return;
    }
    for (var index = 0; index < viewer.imageryLayers.length; index += 1) {
      var layer = viewer.imageryLayers.get(index);
      if (!layer || layer.isDestroyed() || layer.__geoLayerRole === "labels") {
        continue;
      }
      var kind = layer.__geoProviderKind;
      if (kind === "esri" || kind === "esri-satellite" ||
          (kind === "tianditu" && layer.__geoLayerRole === "base")) {
        applyEsriBaseCameraStyle(layer);
      }
    }
  }

  function bindMapEvents() {
    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(onMouseMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction(onLeftClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(onSelectionStart, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(onSelectionEnd, Cesium.ScreenSpaceEventType.LEFT_UP);
  }

  function setSelectionTool(tool) {
    selectionTool = tool === "circle" || tool === "freehand" ? tool : "rectangle";
    document.querySelectorAll("[data-selection-tool]").forEach(function (option) {
      option.classList.toggle("is-active", option.getAttribute("data-selection-tool") === selectionTool);
    });
    document.querySelectorAll("[data-selection-icon]").forEach(function (icon) {
      icon.classList.toggle("is-active", icon.getAttribute("data-selection-icon") === selectionTool);
    });
    var button = document.getElementById("spatial-select-toggle");
    button.title = selectionToolName(selectionTool);
  }

  function selectionToolName(tool) {
    if (tool === "circle") {
      return "圆形点选";
    }
    if (tool === "freehand") {
      return "自由圈选";
    }
    return "矩形框选";
  }

  function completedSelectionName() {
    if (selectionCircle) {
      return "圆形点选";
    }
    if (selectionPolygon) {
      return "自由圈选";
    }
    return "矩形框选";
  }

  function closeSpatialSelectMenu() {
    var menu = document.getElementById("spatial-select-menu");
    var toggle = document.getElementById("spatial-select-menu-toggle");
    menu.classList.add("hidden");
    toggle.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  }

  function bindCircleRadiusUi() {
    var slider = document.getElementById("circle-radius-slider");
    var input = document.getElementById("circle-radius-input");
    slider.addEventListener("input", function () {
      updateCircleRadius(circleRadiusFromSlider(Number(slider.value)), true);
    });
    input.addEventListener("change", function () {
      updateCircleRadius(Number(input.value), false);
      refreshCircleSelectionResults();
    });
  }

  function beginSelectionMode(tool) {
    setSelectionTool(tool || selectionTool);
    clearH3PointQuery(false);
    clearSpatialSelection(false, true);
    clearHover();
    closeFiltersPanel();
    selectionMode = true;
    selectionDrawing = false;
    selectionPath = [];
    selectionPathScreens = [];
    circlePressCandidate = null;
    circlePressScreen = null;
    suppliedSelectionResult = null;
    document.body.classList.add("spatial-select-mode");
    var button = document.getElementById("spatial-select-toggle");
    button.classList.add("is-selecting");
    button.classList.remove("has-selection");
    button.setAttribute("aria-pressed", "true");
    button.title = "取消" + selectionToolName(selectionTool);
    clearSelectionDrawOverlay();
    hideH3HoverIndicator();
    viewer.scene.canvas.style.cursor = "crosshair";
    setSelectionContextOverlays(true);
    showStatus(
      selectionTool === "circle"
        ? "点击地图确定圆心"
        : selectionTool === "freehand" ? "拖动画线并回到起点闭合" : "在地球表面拖拽绘制范围",
      1800
    );
  }

  function cancelSelectionMode(restorePanel) {
    selectionMode = false;
    selectionDrawing = false;
    selectionStart = null;
    selectionStartScreen = null;
    selectionPath = [];
    selectionPathScreens = [];
    circlePressCandidate = null;
    circlePressScreen = null;
    clearSelectionDrawOverlay();
    restoreCameraInputs();
    document.body.classList.remove("spatial-select-mode");
    var button = document.getElementById("spatial-select-toggle");
    button.classList.remove("is-selecting");
    button.setAttribute("aria-pressed", "false");
    button.title = selectionBounds ? "重新" + completedSelectionName() : selectionToolName(selectionTool);
    viewer.scene.canvas.style.cursor = "default";
    if (!selectionBounds) {
      setSelectionContextOverlays(false);
      document.getElementById("circle-radius-control").classList.add("hidden");
    }
    if (restorePanel) {
      syncDatasetPanelForLevel();
    }
  }

  function onSelectionStart(movement) {
    if (!selectionMode) {
      return;
    }
    var cartographic = cartographicAtScreen(movement.position);
    if (!cartographic) {
      showStatus(selectionTool === "circle" ? "请点击地球表面确定圆心" : "请从地球表面开始框选", 1400);
      return;
    }
    if (selectionTool === "circle") {
      selectionDrawing = true;
      circlePressCandidate = cartographic;
      circlePressScreen = Cesium.Cartesian2.clone(movement.position);
      suppressMapClickUntil = Date.now() + 500;
      disableCameraInputs();
      return;
    }
    if (selectionTool !== "rectangle" && selectionTool !== "freehand") {
      return;
    }
    selectionDrawing = true;
    selectionStart = cartographic;
    selectionStartScreen = Cesium.Cartesian2.clone(movement.position);
    if (selectionTool === "freehand") {
      selectionPath = [cartographic];
      selectionPathScreens = [Cesium.Cartesian2.clone(movement.position)];
      drawFreehandSelectionPreview(false);
    }
    suppressMapClickUntil = Date.now() + 500;
    disableCameraInputs();
    clearSelectionGraphics();
  }

  function onSelectionEnd(movement) {
    if (!selectionMode || !selectionDrawing) {
      return;
    }
    if (selectionTool === "circle") {
      var circleDistance = circlePressScreen
        ? Cesium.Cartesian2.distance(circlePressScreen, movement.position)
        : Number.POSITIVE_INFINITY;
      var center = circlePressCandidate;
      selectionDrawing = false;
      circlePressCandidate = null;
      circlePressScreen = null;
      restoreCameraInputs();
      suppressMapClickUntil = Date.now() + 500;
      if (!center || circleDistance > 14) {
        showStatus("请在地球表面轻点确定圆心", 1500);
        return;
      }
      applyCircleSelection(center);
      return;
    }
    if (selectionTool !== "rectangle" && selectionTool !== "freehand") {
      return;
    }
    if (selectionTool === "freehand") {
      finishFreehandSelection(movement.position);
      return;
    }
    var cartographic = cartographicAtScreen(movement.position);
    var screenDistance = selectionStartScreen
      ? Cesium.Cartesian2.distance(selectionStartScreen, movement.position)
      : 0;
    selectionDrawing = false;
    restoreCameraInputs();
    suppressMapClickUntil = Date.now() + 500;
    if (!cartographic || screenDistance < 6) {
      clearSelectionGraphics();
      showStatus("拖拽距离过短，请重新框选", 1500);
      return;
    }
    var bounds = boundsFromCartographics(selectionStart, cartographic);
    selectionStart = null;
    selectionStartScreen = null;
    if (!bounds || bounds.east - bounds.west < 0.00005 || bounds.north - bounds.south < 0.00005) {
      clearSelectionGraphics();
      showStatus("框选范围过小，请重新绘制", 1500);
      return;
    }
    applySpatialSelectionBounds(bounds, true);
    showStatus("框选完成 · " + formatArea(selectionAreaKm2(bounds)), 1800);
  }

  function finishFreehandSelection(position) {
    appendFreehandSelectionPoint(position, true);
    clearSelectionDrawOverlay();
    var closingDistance = selectionStartScreen
      ? Cesium.Cartesian2.distance(selectionStartScreen, position)
      : Number.POSITIVE_INFINITY;
    var screenBounds = selectionPathScreens.reduce(function (bounds, point) {
      bounds.west = Math.min(bounds.west, point.x);
      bounds.north = Math.min(bounds.north, point.y);
      bounds.east = Math.max(bounds.east, point.x);
      bounds.south = Math.max(bounds.south, point.y);
      return bounds;
    }, { west: Number.POSITIVE_INFINITY, north: Number.POSITIVE_INFINITY,
      east: Number.NEGATIVE_INFINITY, south: Number.NEGATIVE_INFINITY });
    var screenSpan = Math.max(screenBounds.east - screenBounds.west, screenBounds.south - screenBounds.north);
    selectionDrawing = false;
    restoreCameraInputs();
    suppressMapClickUntil = Date.now() + 500;
    if (selectionPath.length < 4 || screenSpan < 16) {
      resetFreehandAttempt("圈选范围过小，请重新绘制");
      return;
    }
    // 只要线条自交叉即视为闭合：截取起点到首个交叉点的路径形成闭合多边形。
    var crossing = findFreehandSelfIntersection(selectionPathScreens);
    if (closingDistance > 22 && !crossing) {
      resetFreehandAttempt("线条未闭合，请回到起点附近或让线条交叉后松开");
      return;
    }
    var polygon;
    if (crossing) {
      var crossingCartographic = cartographicAtScreen(
        new Cesium.Cartesian2(crossing.point.x, crossing.point.y)
      );
      if (!crossingCartographic) {
        resetFreehandAttempt("无法解析交叉点，请重新绘制");
        return;
      }
      polygon = simplifySelectionPolygon(selectionPath.slice(0, crossing.index + 1), 64);
      polygon.push(crossingCartographic);
    } else {
      polygon = simplifySelectionPolygon(selectionPath, 64);
      if (polygon.length > 3) {
        var firstPoint = polygon[0];
        var lastPoint = polygon[polygon.length - 1];
        if (Math.abs(firstPoint.longitude - lastPoint.longitude) < 0.0000001 &&
            Math.abs(firstPoint.latitude - lastPoint.latitude) < 0.0000001) {
          polygon.pop();
        }
      }
    }
    var bounds = selectionPolygonBounds(polygon);
    var area = selectionPolygonAreaKm2(polygon);
    if (!bounds || area < 0.000001) {
      resetFreehandAttempt("圈选区域面积过小，请重新绘制");
      return;
    }
    selectionStart = null;
    selectionStartScreen = null;
    selectionPath = [];
    selectionPathScreens = [];
    applyFreehandSelection(polygon, bounds, true);
    showStatus("自由圈选完成 · " + formatArea(area), 1800);
  }

  function segmentIntersection(a, b, c, d) {
    var ax = a.x, ay = a.y, bx = b.x, by = b.y;
    var cx = c.x, cy = c.y, dx = d.x, dy = d.y;
    var denominator = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(denominator) < 1e-9) {
      return null;
    }
    var t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denominator;
    var u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denominator;
    if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) {
      return null;
    }
    return { x: ax + t * (bx - ax), y: ay + t * (by - ay) };
  }

  // 寻找自由圈选路径中首个自交叉点（沿路径最早的交叉），返回交叉点与所在线段下标。
  // index 指向交叉发生时靠后的线段 j（而非更早的线段 i），这样闭合时能保留
  // 从起点到交叉点的整段手绘路径，而不会把后面画的大圈裁掉。
  function findFreehandSelfIntersection(screens) {
    if (!Array.isArray(screens) || screens.length < 5) {
      return null;
    }
    for (var j = 2; j < screens.length - 1; j += 1) {
      for (var i = 0; i < j - 1; i += 1) {
        var hit = segmentIntersection(screens[i], screens[i + 1], screens[j], screens[j + 1]);
        if (hit) {
          return { point: hit, index: j };
        }
      }
    }
    return null;
  }

  function resetFreehandAttempt(message) {
    selectionStart = null;
    selectionStartScreen = null;
    selectionPath = [];
    selectionPathScreens = [];
    clearSelectionDrawOverlay();
    clearSelectionGraphics();
    showStatus(message, 1900);
  }

  function applySpatialSelectionBounds(bounds, notify) {
    selectionCircle = null;
    selectionPolygon = null;
    document.getElementById("circle-radius-control").classList.add("hidden");
    selectionBounds = bounds;
    suppliedSelectionResult = null;
    setSelectionContextOverlays(true);
    drawSelectionBounds(bounds, true);
    finishSelectionMode();
    if (notify) {
      dispatchSpatialSelection("select");
    }
    showSelectionResultsPanel();
  }

  function applyCircleSelection(center) {
    var height = viewer.camera.positionCartographic && viewer.camera.positionCartographic.height;
    var radiusKm = clamp((Number(height) || 20000) / 20000, CIRCLE_RADIUS_MIN_KM, CIRCLE_RADIUS_MAX_KM);
    selectionCircle = {
      longitude: center.longitude,
      latitude: center.latitude,
      radiusKm: normalizedCircleRadius(radiusKm)
    };
    selectionPolygon = null;
    selectionBounds = circleSelectionBounds(selectionCircle);
    suppliedSelectionResult = null;
    setSelectionContextOverlays(true);
    drawSelectionCircle(selectionCircle, true);
    syncCircleRadiusUi();
    document.getElementById("circle-radius-control").classList.remove("hidden");
    finishSelectionMode();
    dispatchSpatialSelection("select");
    showSelectionResultsPanel();
    showStatus("圆形筛选已建立 · 半径 " + formatDistanceKm(selectionCircle.radiusKm), 1700);
  }

  function applyFreehandSelection(polygon, bounds, notify) {
    selectionCircle = null;
    selectionPolygon = polygon;
    selectionBounds = bounds;
    suppliedSelectionResult = null;
    document.getElementById("circle-radius-control").classList.add("hidden");
    setSelectionContextOverlays(true);
    drawSelectionPolygon(polygon, true, true);
    finishSelectionMode();
    if (notify) {
      dispatchSpatialSelection("select");
    }
    showSelectionResultsPanel();
  }

  function updateCircleRadius(radiusKm, debounceResults) {
    if (!selectionCircle) {
      return;
    }
    selectionCircle.radiusKm = normalizedCircleRadius(radiusKm);
    selectionBounds = circleSelectionBounds(selectionCircle);
    drawSelectionCircle(selectionCircle, true);
    syncCircleRadiusUi();
    renderSelectionSummary(selectionStatistics([], selectionBounds, {
      datasetCount: activeCityPanelData ? activeCityPanelData.datasetTotal : 0,
      paperCount: activeCityPanelData ? activeCityPanelData.paperTotal : 0,
      tags: activeCityPanelData
        ? (activeCityPanelTab === "papers" ? activeCityPanelData.paperTopics : activeCityPanelData.datasetTopics)
        : []
    }));
    window.clearTimeout(circleRadiusUpdateTimer);
    if (debounceResults) {
      circleRadiusUpdateTimer = window.setTimeout(refreshCircleSelectionResults, 260);
    }
  }

  function refreshCircleSelectionResults() {
    if (!selectionCircle || !selectionBounds) {
      return;
    }
    dispatchSpatialSelection("radius");
    showSelectionResultsPanel();
  }

  function normalizedCircleRadius(radiusKm) {
    var value = clamp(Number(radiusKm) || CIRCLE_RADIUS_MIN_KM, CIRCLE_RADIUS_MIN_KM, CIRCLE_RADIUS_MAX_KM);
    if (value < 1) {
      return Math.round(value * 1000) / 1000;
    }
    if (value < 100) {
      return Math.round(value * 10) / 10;
    }
    return Math.round(value);
  }

  function circleRadiusFromSlider(value) {
    var ratio = clamp(Number(value) / 1000, 0, 1);
    return CIRCLE_RADIUS_MIN_KM * Math.pow(CIRCLE_RADIUS_MAX_KM / CIRCLE_RADIUS_MIN_KM, ratio);
  }

  function circleRadiusToSlider(radiusKm) {
    return Math.round(
      Math.log(clamp(radiusKm, CIRCLE_RADIUS_MIN_KM, CIRCLE_RADIUS_MAX_KM) / CIRCLE_RADIUS_MIN_KM) /
      Math.log(CIRCLE_RADIUS_MAX_KM / CIRCLE_RADIUS_MIN_KM) * 1000
    );
  }

  function syncCircleRadiusUi() {
    if (!selectionCircle) {
      return;
    }
    document.getElementById("circle-radius-input").value = String(selectionCircle.radiusKm);
    document.getElementById("circle-radius-slider").value = String(circleRadiusToSlider(selectionCircle.radiusKm));
    document.getElementById("circle-radius-output").textContent = formatDistanceKm(selectionCircle.radiusKm);
    document.getElementById("circle-center-label").textContent =
      coordinateLabel(selectionCircle.longitude, "W", "E") + " / " +
      coordinateLabel(selectionCircle.latitude, "S", "N");
  }

  function circleBoundary(circle, segments) {
    var earthRadiusKm = 6371.0088;
    var angularDistance = circle.radiusKm / earthRadiusKm;
    var latitude = Cesium.Math.toRadians(circle.latitude);
    var longitude = Cesium.Math.toRadians(circle.longitude);
    var points = [];
    var count = Math.max(36, Number(segments) || 72);
    for (var index = 0; index < count; index += 1) {
      var bearing = index / count * Math.PI * 2;
      var pointLatitude = Math.asin(
        Math.sin(latitude) * Math.cos(angularDistance) +
        Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing)
      );
      var pointLongitude = longitude + Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
        Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(pointLatitude)
      );
      points.push([
        Cesium.Math.negativePiToPi(pointLongitude) * 180 / Math.PI,
        Cesium.Math.toDegrees(pointLatitude)
      ]);
    }
    return points;
  }

  function circleSelectionBounds(circle) {
    var boundary = circleBoundary(circle, 72);
    return boundary.reduce(function (bounds, point) {
      bounds.west = Math.min(bounds.west, point[0]);
      bounds.south = Math.min(bounds.south, point[1]);
      bounds.east = Math.max(bounds.east, point[0]);
      bounds.north = Math.max(bounds.north, point[1]);
      return bounds;
    }, { west: 180, south: 90, east: -180, north: -90 });
  }

  function formatDistanceKm(radiusKm) {
    if (radiusKm < 1) {
      return Math.round(radiusKm * 1000).toLocaleString("zh-CN") + " m";
    }
    return radiusKm < 100 ? radiusKm.toFixed(1) + " km" : Math.round(radiusKm).toLocaleString("zh-CN") + " km";
  }

  function updateSelectionDrawing(position) {
    if (!selectionMode) {
      return false;
    }
    viewer.scene.canvas.style.cursor = "crosshair";
    document.getElementById("region-tooltip").classList.add("hidden");
    if (!selectionDrawing || !selectionStart) {
      return true;
    }
    if (selectionTool === "freehand") {
      appendFreehandSelectionPoint(position, false);
      var nearStart = selectionStartScreen && selectionPath.length >= 4 &&
        Cesium.Cartesian2.distance(selectionStartScreen, position) <= 22;
      var crossing = !nearStart ? findFreehandSelfIntersection(selectionPathScreens) : null;
      var closePolygon = null;
      if (crossing) {
        closePolygon = selectionPathScreens.slice(0, crossing.index + 1);
        closePolygon.push(crossing.point);
      }
      scheduleFreehandSelectionPreview(Boolean(nearStart || crossing), closePolygon);
      return true;
    }
    var cartographic = cartographicAtScreen(position);
    if (!cartographic) {
      return true;
    }
    var bounds = boundsFromCartographics(selectionStart, cartographic);
    if (bounds) {
      drawSelectionBounds(bounds, false);
    }
    return true;
  }

  function appendFreehandSelectionPoint(position, force) {
    if (!position || !selectionPathScreens.length) {
      return;
    }
    var lastScreen = selectionPathScreens[selectionPathScreens.length - 1];
    var pointDistance = Cesium.Cartesian2.distance(lastScreen, position);
    if ((!force && pointDistance < 4) || (force && pointDistance < 1)) {
      return;
    }
    var cartographic = cartographicAtScreen(position);
    if (!cartographic) {
      return;
    }
    selectionPath.push(cartographic);
    selectionPathScreens.push(Cesium.Cartesian2.clone(position));
    if (selectionPath.length > 240) {
      selectionPath = simplifySelectionPolygon(selectionPath, 160);
      selectionPathScreens = simplifySelectionPolygon(selectionPathScreens, 160);
    }
  }

  function clearSelectionDrawOverlay() {
    window.cancelAnimationFrame(freehandPreviewFrame);
    freehandPreviewFrame = 0;
    var canvas = document.getElementById("selection-draw-overlay");
    if (!canvas) {
      return;
    }
    var context = canvas.getContext("2d");
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function selectionDrawContext() {
    var canvas = document.getElementById("selection-draw-overlay");
    if (!canvas) {
      return null;
    }
    var ratio = Math.min(1.5, window.devicePixelRatio || 1);
    var width = Math.max(1, window.innerWidth);
    var height = Math.max(1, window.innerHeight);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    var context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    return context;
  }

  function viewportSelectionPoint(point) {
    var rectangle = viewer.scene.canvas.getBoundingClientRect();
    return { x: rectangle.left + point.x, y: rectangle.top + point.y };
  }

  function drawFreehandSelectionPreview(nearStart, closePolygon) {
    if (!selectionPathScreens.length) {
      return;
    }
    var context = selectionDrawContext();
    if (!context) {
      return;
    }
    var points = selectionPathScreens.map(viewportSelectionPoint);
    if (closePolygon && closePolygon.length >= 3) {
      var closePoints = closePolygon.map(viewportSelectionPoint);
      context.beginPath();
      context.moveTo(closePoints[0].x, closePoints[0].y);
      closePoints.slice(1).forEach(function (point) {
        context.lineTo(point.x, point.y);
      });
      context.closePath();
      context.fillStyle = "rgba(244, 189, 98, 0.10)";
      context.fill();
      context.lineWidth = 1.4;
      context.strokeStyle = "rgba(244, 189, 98, 0.55)";
      context.stroke();
    }
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach(function (point) {
      context.lineTo(point.x, point.y);
    });
    if (nearStart && points.length >= 4) {
      context.closePath();
      context.fillStyle = "rgba(89, 220, 207, 0.08)";
      context.fill();
    }
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = nearStart ? 2.2 : 1.8;
    context.strokeStyle = nearStart ? "rgba(244, 189, 98, 0.96)" : "rgba(140, 245, 235, 0.9)";
    context.shadowColor = nearStart ? "rgba(244, 189, 98, 0.42)" : "rgba(79, 209, 197, 0.34)";
    context.shadowBlur = 8;
    context.stroke();
    context.shadowBlur = 0;
    context.beginPath();
    context.arc(points[0].x, points[0].y, nearStart ? 6 : 4.5, 0, Math.PI * 2);
    context.fillStyle = nearStart ? "#f4bd62" : "#d8fffb";
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = "rgba(10, 33, 36, 0.92)";
    context.stroke();
  }

  function scheduleFreehandSelectionPreview(nearStart, closePolygon) {
    freehandPreviewNearStart = nearStart;
    freehandPreviewClosePolygon = closePolygon || null;
    if (freehandPreviewFrame) {
      return;
    }
    freehandPreviewFrame = window.requestAnimationFrame(function () {
      freehandPreviewFrame = 0;
      drawFreehandSelectionPreview(freehandPreviewNearStart, freehandPreviewClosePolygon);
    });
  }

  function simplifySelectionPolygon(points, maximum) {
    if (!Array.isArray(points) || points.length <= maximum) {
      return (points || []).slice();
    }
    var simplified = [];
    var lastIndex = points.length - 1;
    for (var index = 0; index < maximum; index += 1) {
      simplified.push(points[Math.round(index / (maximum - 1) * lastIndex)]);
    }
    return simplified;
  }

  function selectionPolygonBounds(points) {
    if (!Array.isArray(points) || points.length < 3) {
      return null;
    }
    return points.reduce(function (bounds, point) {
      bounds.west = Math.min(bounds.west, point.longitude);
      bounds.south = Math.min(bounds.south, point.latitude);
      bounds.east = Math.max(bounds.east, point.longitude);
      bounds.north = Math.max(bounds.north, point.latitude);
      return bounds;
    }, { west: 180, south: 90, east: -180, north: -90 });
  }

  function selectionPolygonAreaKm2(points) {
    if (!Array.isArray(points) || points.length < 3) {
      return 0;
    }
    var radius = 6371.0088;
    var total = 0;
    for (var index = 0; index < points.length; index += 1) {
      var current = points[index];
      var next = points[(index + 1) % points.length];
      total += Cesium.Math.toRadians(next.longitude - current.longitude) *
        (2 + Math.sin(Cesium.Math.toRadians(current.latitude)) +
          Math.sin(Cesium.Math.toRadians(next.latitude)));
    }
    return Math.abs(total) * radius * radius * 0.5;
  }

  function finishSelectionMode() {
    selectionMode = false;
    selectionDrawing = false;
    circlePressCandidate = null;
    circlePressScreen = null;
    clearSelectionDrawOverlay();
    restoreCameraInputs();
    document.body.classList.remove("spatial-select-mode");
    var button = document.getElementById("spatial-select-toggle");
    button.classList.remove("is-selecting");
    button.classList.add("has-selection");
    button.setAttribute("aria-pressed", "false");
    button.title = "重新" + completedSelectionName();
    viewer.scene.canvas.style.cursor = "default";
  }

  function clearSpatialSelection(notify, restorePanel) {
    var hadSelection = Boolean(
      selectionBounds || selectionCircle || selectionPolygon || selectionMode || selectionDrawing
    );
    window.clearTimeout(circleRadiusUpdateTimer);
    selectionDatasetRequestToken += 1;
    if (selectionDatasetRequestController) {
      selectionDatasetRequestController.abort();
      selectionDatasetRequestController = null;
    }
    selectionBounds = null;
    selectionCircle = null;
    selectionPolygon = null;
    selectionPath = [];
    selectionPathScreens = [];
    circlePressCandidate = null;
    circlePressScreen = null;
    clearSelectionDrawOverlay();
    suppliedSelectionResult = null;
    document.getElementById("circle-radius-control").classList.add("hidden");
    setSelectionContextOverlays(false);
    if (activeDatasetCityCode === "__selection__") {
      activeDatasetCityCode = null;
      clearCityDatasetCoverage();
    }
    clearSelectionGraphics();
    cancelSelectionMode(false);
    var button = document.getElementById("spatial-select-toggle");
    button.classList.remove("has-selection");
    button.title = selectionToolName(selectionTool);
    renderSelectionSummary(null);
    if (notify && hadSelection) {
      window.dispatchEvent(new CustomEvent("geoapp:spatialselect", {
        detail: { bounds: null, circle: null, polygon: null, filters: publicFilterState(), reason: "clear" }
      }));
    }
    if (restorePanel) {
      syncDatasetPanelForLevel();
    }
    schedulePaperDistributionRefresh(60);
  }

  function canQueryH3Point() {
    return Boolean(
      activeCityPanelTab === "datasets" &&
      state.level === "city" && selectedMeta && selectedMeta.level === "city" &&
      activeDatasetCityCode === selectedMeta.code && !selectionMode && !selectionDrawing && !selectionBounds
    );
  }


  function activeH3LayerResolution() {
    if (heatLayer && !heatLayer.isDestroyed()) {
      var progress = Number(heatLayer.geoTransitionProgress);
      if (Number.isFinite(progress) && progress < 0.5 &&
          heatLayer.previousH3Resolution != null &&
          Number.isFinite(Number(heatLayer.previousH3Resolution))) {
        return Number(heatLayer.previousH3Resolution);
      }
      if (heatLayer.h3Resolution != null && Number.isFinite(Number(heatLayer.h3Resolution))) {
        return Number(heatLayer.h3Resolution);
      }
    }
    return Number(currentH3Resolution) || null;
  }

  function h3CityAtScreen(position) {
    if (!position || state.level !== "city" || !currentBoundarySource) {
      return null;
    }
    var coordinate = cartographicAtScreen(position);
    if (!coordinate) {
      return null;
    }
    var picked = viewer.scene.pick(position);
    var pickedMeta = picked && picked.id && picked.id.regionMeta;
    if (pickedMeta && pickedMeta.level === "city" &&
        pointInGeometry([coordinate.longitude, coordinate.latitude], pickedMeta.geometry)) {
      return pickedMeta;
    }
    var entities = currentBoundarySource.entities.values;
    for (var index = 0; index < entities.length; index += 1) {
      var meta = entities[index].regionMeta;
      if (meta && meta.level === "city" &&
          pointInGeometry([coordinate.longitude, coordinate.latitude], meta.geometry)) {
        return meta;
      }
    }
    return null;
  }

  function canOfferH3PointAtScreen(position) {
    if (activeCityPanelTab === "papers") {
      return false;
    }
    if (canQueryH3Point()) {
      return true;
    }
    var height = viewer && viewer.camera.positionCartographic
      ? viewer.camera.positionCartographic.height
      : Number.POSITIVE_INFINITY;
    if (state.level !== "city" ||
        (activeH3LayerResolution() < 8 && height >= AUTO_LEVEL_HEIGHTS.enterFineCity)) {
      return false;
    }
    return Boolean(h3CityAtScreen(position));
  }

  function showH3HoverIndicator(position) {
    var indicator = document.getElementById("h3-hover-indicator");
    if (!indicator || !position) {
      return;
    }
    var rectangle = viewer.scene.canvas.getBoundingClientRect();
    indicator.style.left = (rectangle.left + position.x) + "px";
    indicator.style.top = (rectangle.top + position.y) + "px";
    indicator.classList.remove("hidden");
  }

  function hideH3HoverIndicator() {
    var indicator = document.getElementById("h3-hover-indicator");
    if (indicator) {
      indicator.classList.add("hidden");
    }
  }

  async function queryH3PointAtScreen(position) {
    if (activeCityPanelTab === "papers") {
      return false;
    }
    var cityMeta = canQueryH3Point() ? selectedMeta : h3CityAtScreen(position);
    if (!cityMeta) {
      return false;
    }
    var coordinate = cartographicAtScreen(position);
    if (!coordinate) {
      return false;
    }
    if (!selectedMeta || selectedMeta.code !== cityMeta.code || activeDatasetCityCode !== cityMeta.code) {
      selectLeaf(cityMeta, { preserveCamera: true, silent: true });
    }
    cityDatasetRequestToken += 1;
    if (cityDatasetRequestController) {
      cityDatasetRequestController.abort();
      cityDatasetRequestController = null;
    }
    var resolution = Math.max(7, Math.min(11, activeH3LayerResolution() || 8));
    var token = ++h3PointRequestToken;
    if (h3PointRequestController) {
      h3PointRequestController.abort();
    }
    h3PointRequestController = new AbortController();
    hideH3HoverIndicator();
    drawH3PointPending(coordinate);
    activeH3Point = { loading: true, longitude: coordinate.longitude, latitude: coordinate.latitude };
    activeCityPanelTab = "datasets";
    activeCityPanelData = {
      mode: "h3",
      meta: cityMeta,
      datasets: [],
      papers: [],
      datasetTotal: 0,
      paperTotal: 0,
      datasetTopics: [],
      paperTopics: [],
      loading: true
    };
    renderDatasetPanel({
      kicker: "H3 精细网格",
      title: "正在查询该网格",
      datasets: [],
      totalCount: 0,
      emptyTitle: "正在聚合空间数据",
      emptyText: "按当前筛选条件查询约 1 km² 范围",
      footerText: "",
      compact: true,
      cityInteractive: true,
      cityTabs: true
    });
    var parameters = datasetFilterParameters();
    parameters.set("longitude", coordinate.longitude.toFixed(7));
    parameters.set("latitude", coordinate.latitude.toFixed(7));
    parameters.set("resolution", String(resolution));
    try {
      var response = await fetch("./api/h3-point-query?" + parameters.toString(), {
        signal: h3PointRequestController.signal,
        cache: "default"
      });
      if (!response.ok) {
        var detail = await response.json().catch(function () { return {}; });
        throw new Error(detail.error || "H3 网格查询失败: " + response.status);
      }
      var payload = await response.json();
      if (token !== h3PointRequestToken || !activeH3Point || selectedMeta !== cityMeta) {
        return true;
      }
      var datasets = sanitizeCityDatasets(payload.datasets || []);
      var papers = sanitizeCityPapers(payload.papers || []);
      activeH3Point = payload;
      activeCityPanelData = {
        mode: "h3",
        meta: cityMeta,
        h3: payload,
        datasets: datasets,
        papers: papers,
        datasetTotal: Math.max(0, Number(payload.dataset_total) || 0),
        paperTotal: Math.max(0, Number(payload.paper_total) || 0),
        datasetTopics: (payload.dataset_topics || []).map(function (item) { return item.name; }).filter(Boolean),
        paperTopics: (payload.paper_topics || []).map(function (item) { return item.name; }).filter(Boolean),
        loading: false
      };
      drawH3PointCell(payload);
      renderActiveCityTab();
      showStatus(
        "精细网格 · " + formatCount(activeCityPanelData.datasetTotal) + " 个数据集 · " +
        formatCount(activeCityPanelData.paperTotal) + " 篇论文",
        1800
      );
      return true;
    } catch (error) {
      if (error && error.name === "AbortError") {
        return true;
      }
      console.error("H3 网格查询失败", error);
      if (token === h3PointRequestToken) {
        activeH3Point = null;
        renderDatasetPanel({
          kicker: "H3 精细网格",
          title: "网格查询失败",
          datasets: [],
          totalCount: 0,
          emptyTitle: "暂时无法读取该网格",
          emptyText: "请稍后重新点击地图",
          footerText: "",
          compact: true,
          cityInteractive: true,
          cityTabs: true
        });
      }
      return true;
    }
  }

  function drawH3PointCell(payload) {
    if (!h3SelectionSource || !payload || !Array.isArray(payload.boundary)) {
      return;
    }
    window.cancelAnimationFrame(h3SelectionAnimationFrame);
    h3SelectionSource.entities.removeAll();
    var surfaceHeight = clamp(
      (viewer.camera.positionCartographic ? viewer.camera.positionCartographic.height : 100000) * 0.00035,
      18,
      160
    );
    var positions = payload.boundary.map(function (point) {
      return Cesium.Cartesian3.fromDegrees(Number(point[0]), Number(point[1]), surfaceHeight + 2);
    });
    if (!positions.length) {
      return;
    }
    positions.push(positions[0]);
    var color = Cesium.Color.fromCssColorString("#79dcd4");
    var cell = h3SelectionSource.entities.add({
      h3Cell: true,
      polygon: {
        hierarchy: positions.slice(0, -1),
        height: surfaceHeight,
        material: color.withAlpha(0),
        outline: false
      },
      polyline: {
        positions: positions,
        width: 1.55,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: color.withAlpha(0),
          glowPower: 0.06,
          taperPower: 1
        })
      }
    });
    var center = payload.center || [payload.longitude, payload.latitude];
    var centerEntity = null;
    if (Array.isArray(center) && Number.isFinite(Number(center[0])) && Number.isFinite(Number(center[1]))) {
      centerEntity = h3SelectionSource.entities.add({
        h3Cell: true,
        position: Cesium.Cartesian3.fromDegrees(Number(center[0]), Number(center[1]), surfaceHeight + 5),
        point: {
          pixelSize: 5,
          color: Cesium.Color.fromCssColorString("#d8fffb").withAlpha(0),
          outlineColor: Cesium.Color.fromCssColorString("#163b3d").withAlpha(0),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
    }
    viewer.dataSources.raiseToTop(h3SelectionSource);
    animateH3PointCell(cell, centerEntity, color);
  }

  function drawH3PointPending(coordinate) {
    if (!h3SelectionSource || !coordinate) {
      return;
    }
    window.cancelAnimationFrame(h3SelectionAnimationFrame);
    h3SelectionSource.entities.removeAll();
    h3SelectionSource.entities.add({
      h3Cell: true,
      position: Cesium.Cartesian3.fromDegrees(coordinate.longitude, coordinate.latitude, 60),
      point: {
        pixelSize: 6,
        color: Cesium.Color.fromCssColorString("#b8fff7").withAlpha(0.92),
        outlineColor: Cesium.Color.fromCssColorString("#5cd7cc").withAlpha(0.28),
        outlineWidth: 6,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    viewer.dataSources.raiseToTop(h3SelectionSource);
    viewer.scene.requestRender();
  }

  function animateH3PointCell(cell, centerEntity, color) {
    var startedAt = performance.now();
    var duration = 190;
    function frame(now) {
      if (!viewer || viewer.isDestroyed() || !h3SelectionSource ||
          !h3SelectionSource.entities.getById(cell.id)) {
        return;
      }
      var progress = smoothStep(0, 1, (now - startedAt) / duration);
      cell.polygon.material.color.setValue(color.withAlpha(0.055 * progress));
      cell.polyline.material.color.setValue(color.withAlpha(0.74 * progress));
      if (centerEntity) {
        centerEntity.point.color.setValue(Cesium.Color.fromCssColorString("#d8fffb").withAlpha(0.9 * progress));
        centerEntity.point.outlineColor.setValue(Cesium.Color.fromCssColorString("#163b3d").withAlpha(0.88 * progress));
      }
      viewer.scene.requestRender();
      if (progress < 1) {
        h3SelectionAnimationFrame = window.requestAnimationFrame(frame);
      }
    }
    h3SelectionAnimationFrame = window.requestAnimationFrame(frame);
  }

  function clearH3PointQuery(restorePanel) {
    h3PointRequestToken += 1;
    if (h3PointRequestController) {
      h3PointRequestController.abort();
      h3PointRequestController = null;
    }
    activeH3Point = null;
    window.cancelAnimationFrame(h3SelectionAnimationFrame);
    if (h3SelectionSource) {
      h3SelectionSource.entities.removeAll();
    }
    renderSelectionSummary(null);
    if (restorePanel && selectedMeta && selectedMeta.level === "city") {
      showCityDatasetPanel(selectedMeta);
    }
    if (viewer && !viewer.isDestroyed()) {
      viewer.scene.requestRender();
    }
  }

  function setSelectionContextOverlays(active) {
    var showBackgroundPoints = !active && pointVisible;
    if (pointBillboardCollection) {
      pointBillboardCollection.show = showBackgroundPoints;
    }
    if (flightLineCollection) {
      flightLineCollection.show = !active && flightVisible;
    }
    if (flightTrailCollection) {
      flightTrailCollection.show = !active && flightVisible;
    }
    if (flightParticleCollection) {
      flightParticleCollection.show = !active && flightVisible;
    }
    if (searchResultSource) {
      searchResultSource.show = showBackgroundPoints;
    }
    if (searchResultBillboardCollection) {
      searchResultBillboardCollection.show = showBackgroundPoints;
    }
    if (paperDistributionCollection) {
      paperDistributionCollection.show = showBackgroundPoints && isRegionPaperPointMode();
    }
    if (viewer && !viewer.isDestroyed()) {
      viewer.scene.requestRender();
    }
  }

  function isCityDetailMode() {
    return datasetPanelVisible && state.level === "city" && activeDatasetCityCode &&
      activeDatasetCityCode !== "__selection__" && activeCityPanelData &&
      activeCityPanelData.mode !== "selection" && activeCityPanelData.meta &&
      activeCityPanelData.meta.level === "city";
  }

  // 城市圆圈可见性：用户开关 + 无空间检索覆盖 + 未下钻进入城市详情。
  // 点击城市圆圈下钻后隐藏其他城市圆圈，缩小超过阈值（自动退出城市详情）后恢复。
  function regionMarkersShouldShow() {
    return regionMarkersVisible && !searchSpatialEntries.length &&
      !(selectedMeta && selectedMeta.level === "city") &&
      !isCityDetailMode();
  }

  function isPaperTabSelected() {
    return Boolean(activeDatasetCityCode && activeCityPanelData &&
      activeCityPanelTab === "papers");
  }

  function isRegionPaperPointMode() {
    if (!isPaperTabSelected() || !activeCityPanelData.meta ||
        activeCityPanelData.loading || activeCityPanelData.mode === "selection") {
      return false;
    }
    var level = activeCityPanelData.meta.level;
    return level === "country" || level === "province" || level === "city";
  }

  function currentPaperPointMode() {
    if (selectionBounds || selectionMode || selectionDrawing) {
      return false;
    }
    if (isRegionPaperPointMode()) {
      return true;
    }
    return regionPaperLocationsActive && paperPointsVisible && Boolean(regionPaperTarget());
  }

  function regionPaperTarget() {
    if (selectionBounds || selectionMode || selectionDrawing || filterState.query) {
      return null;
    }
    if (isCityDetailMode() || (activeDatasetCityCode && activeCityPanelData && activeCityPanelData.meta)) {
      return null;
    }
    if (state.level === "country") {
      return { code: "WORLD", name: "全球", level: "world" };
    }
    if (state.level === "province") {
      return { code: "CHN", name: "中国", level: "country" };
    }
    if (state.level === "city" && state.path[2]) {
      return { code: state.path[2].code, name: state.path[2].name, level: "province" };
    }
    return null;
  }

  function syncRegionPaperPoints() {
    var target = paperPointsVisible ? regionPaperTarget() : null;
    if (!target) {
      if (regionPaperSignature || regionPaperLocationsActive) {
        regionPaperSignature = "";
        var wasActive = regionPaperLocationsActive;
        regionPaperLocationsActive = false;
        if (wasActive && paperDistributionCollection) {
          paperDistributionCollection.removeAll();
        }
        syncMapExpressionForActiveTab();
      }
      return;
    }
    var signature = target.code + "?" + datasetFilterParameters().toString() +
      (paperPointsVisible ? "&pp=1" : "&pp=0");
    if (signature === regionPaperSignature) {
      syncMapExpressionForActiveTab();
      return;
    }
    regionPaperSignature = signature;
    regionPaperLocationsActive = false;
    if (paperDistributionCollection) {
      paperDistributionCollection.removeAll();
    }
    var token = ++regionPaperRequestToken;
    var parameters = datasetFilterParameters();
    parameters.set("region_code", target.code);
    parameters.set("limit", "200");
    // 背景论文点仅作视觉参考：全球/中国级别点位可能数以万计，按 count 排序截取
    // 靠前的一批，避免一次性传输/渲染数万 billboard 造成卡顿（城市详情仍单独按城市拉取）。
    parameters.set("location_limit", "5000");
    fetch("./api/region-papers?" + parameters.toString(), { cache: "default" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("区域论文点位请求失败: " + response.status);
        }
        return response.json();
      })
      .then(function (payload) {
        if (token !== regionPaperRequestToken || !paperPointsVisible) {
          return;
        }
        if (payload && Array.isArray(payload.locations)) {
          regionPaperLocationsActive = true;
          var paperLocations = sanitizeCityPaperLocations(payload.locations || []);
          var papers = sanitizeCityPapers(payload.papers || []);
          renderCityPaperLocations(paperLocations, papers, payload.locationTotal, payload.total);
        }
      })
      .catch(function (error) {
        if (token === regionPaperRequestToken) {
          regionPaperSignature = "";
          console.error("区域论文点位加载失败", error);
        }
      });
  }

  function syncMapExpressionForActiveTab() {
    if (!viewer || viewer.isDestroyed()) {
      return;
    }
    var paperPointMode = currentPaperPointMode();
    var paperTab = isPaperTabSelected();
    if (isCityDetailMode()) {
      document.getElementById("region-tooltip").classList.add("hidden");
      viewer.scene.canvas.style.cursor = "default";
    }
    if (paperDistributionCollection) {
      paperDistributionCollection.show = pointVisible && paperPointMode;
    }
    if (regionBillboardCollection) {
      regionBillboardCollection.show = regionMarkersShouldShow();
    }
    if (heatLayer) {
      heatLayer.show = heatVisible && !paperTab;
    }
    if (heatSurfaceRoot) {
      heatSurfaceRoot.show = heatVisible && !paperTab;
    }
    var legend = document.getElementById("paper-location-legend");
    if (legend) {
      legend.classList.toggle("hidden", !paperPointMode);
    }
    var heatLegend = document.querySelector(".heat-legend");
    if (heatLegend) {
      heatLegend.classList.toggle("heat-hidden", Boolean(paperTab));
    }
    if (heatVisible && !paperTab) {
      scheduleAdaptiveH3HeatRefresh(0);
    }
    viewer.scene.requestRender();
  }

  function clearSelectionForNavigation() {
    window.clearTimeout(adaptiveHeatRefreshTimer);
    adaptiveHeatBoundsSignature = "";
    datasetFlyLockUntil = 0;
    clearH3PointQuery(false);
    clearCityDatasetCoverage();
    activeDatasetCityCode = null;
    activeCityPanelData = null;
    if (selectionBounds || selectionMode || selectionDrawing) {
      clearSpatialSelection(true, false);
    }
  }

  function clearSelectionGraphics() {
    if (selectionSource) {
      selectionSource.entities.removeAll();
    }
    if (viewer && !viewer.isDestroyed()) {
      viewer.scene.requestRender();
    }
  }

  function disableCameraInputs() {
    if (viewer && viewer.scene && viewer.scene.screenSpaceCameraController) {
      viewer.scene.screenSpaceCameraController.enableInputs = false;
    }
  }

  function restoreCameraInputs() {
    if (viewer && viewer.scene && viewer.scene.screenSpaceCameraController) {
      viewer.scene.screenSpaceCameraController.enableInputs = true;
    }
  }

  function cartographicAtScreen(position) {
    if (!position || !viewer || viewer.isDestroyed()) {
      return null;
    }
    var ray = viewer.camera.getPickRay(position);
    var cartesian = ray && viewer.scene.globe.pick(ray, viewer.scene);
    if (!cartesian) {
      cartesian = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
    }
    if (!cartesian) {
      return null;
    }
    var value = Cesium.Cartographic.fromCartesian(cartesian);
    return {
      longitude: Cesium.Math.toDegrees(value.longitude),
      latitude: Cesium.Math.toDegrees(value.latitude)
    };
  }

  function boundsFromCartographics(start, end) {
    if (!start || !end) {
      return null;
    }
    return {
      west: Math.max(-180, Math.min(start.longitude, end.longitude)),
      south: Math.max(-90, Math.min(start.latitude, end.latitude)),
      east: Math.min(180, Math.max(start.longitude, end.longitude)),
      north: Math.min(90, Math.max(start.latitude, end.latitude))
    };
  }

  function drawSelectionBounds(bounds, confirmed) {
    if (!selectionSource || !bounds) {
      return;
    }
    selectionSource.entities.removeAll();
    var color = Cesium.Color.fromCssColorString(confirmed ? "#61e3d6" : "#8cf5eb");
    var surfaceHeight = selectionSurfaceHeight();
    selectionSource.entities.add({
      selectableRange: true,
      rectangle: {
        coordinates: Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
        height: surfaceHeight,
        material: color.withAlpha(confirmed ? 0.115 : 0.075),
        outline: false
      }
    });
    var corners = selectionCornerPositions(bounds, surfaceHeight + 5);
    selectionSource.entities.add({
      selectableRange: true,
      polyline: {
        positions: corners.concat([corners[0]]),
        width: confirmed ? 2.2 : 1.7,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: color.withAlpha(0.96),
          glowPower: confirmed ? 0.16 : 0.1,
          taperPower: 1
        }),
        clampToGround: false
      }
    });
    corners.forEach(function (position) {
      selectionSource.entities.add({
        selectableRange: true,
        position: position,
        point: {
          pixelSize: confirmed ? 6 : 5,
          color: Cesium.Color.fromCssColorString("#b8fff7").withAlpha(0.98),
          outlineColor: Cesium.Color.fromCssColorString("#12383c").withAlpha(0.95),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
    });
    if (confirmed) {
      selectionSource.entities.add({
        selectableRange: true,
        position: Cesium.Cartesian3.fromDegrees(
          (bounds.west + bounds.east) * 0.5,
          bounds.north,
          surfaceHeight + 10
        ),
        label: {
          text: "已选范围 · " + formatArea(selectionAreaKm2(bounds)),
          font: '11px "PingFang SC", "Microsoft YaHei", sans-serif',
          fillColor: Cesium.Color.fromCssColorString("#d9fffb"),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#071116").withAlpha(0.88),
          backgroundPadding: new Cesium.Cartesian2(8, 5),
          pixelOffset: new Cesium.Cartesian2(0, -12),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
    }
    viewer.dataSources.raiseToTop(selectionSource);
    viewer.scene.requestRender();
  }

  function drawSelectionCircle(circle, confirmed) {
    if (!selectionSource || !circle) {
      return;
    }
    selectionSource.entities.removeAll();
    var boundary = circleBoundary(circle, 96);
    var surfaceHeight = selectionSurfaceHeight();
    var color = Cesium.Color.fromCssColorString(confirmed ? "#61e3d6" : "#8cf5eb");
    var positions = boundary.map(function (point) {
      return Cesium.Cartesian3.fromDegrees(point[0], point[1], surfaceHeight + 5);
    });
    selectionSource.entities.add({
      selectableRange: true,
      polygon: {
        hierarchy: positions,
        height: surfaceHeight,
        material: color.withAlpha(confirmed ? 0.12 : 0.075),
        outline: false
      }
    });
    selectionSource.entities.add({
      selectableRange: true,
      polyline: {
        positions: positions.concat([positions[0]]),
        width: confirmed ? 2.2 : 1.7,
        material: new Cesium.PolylineGlowMaterialProperty({
          color: color.withAlpha(0.98),
          glowPower: confirmed ? 0.16 : 0.1,
          taperPower: 1
        })
      }
    });
    selectionSource.entities.add({
      selectableRange: true,
      position: Cesium.Cartesian3.fromDegrees(circle.longitude, circle.latitude, surfaceHeight + 8),
      point: {
        pixelSize: 7,
        color: Cesium.Color.fromCssColorString("#d8fffb"),
        outlineColor: Cesium.Color.fromCssColorString("#12383c"),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    if (confirmed) {
      selectionSource.entities.add({
        selectableRange: true,
        position: positions[0],
        label: {
          text: "半径 " + formatDistanceKm(circle.radiusKm),
          font: '11px "PingFang SC", "Microsoft YaHei", sans-serif',
          fillColor: Cesium.Color.fromCssColorString("#d9fffb"),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#071116").withAlpha(0.88),
          backgroundPadding: new Cesium.Cartesian2(8, 5),
          pixelOffset: new Cesium.Cartesian2(0, -12),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
    }
    viewer.dataSources.raiseToTop(selectionSource);
    viewer.scene.requestRender();
  }

  function drawSelectionPolygon(points, confirmed, closePreview) {
    if (!selectionSource || !Array.isArray(points) || !points.length) {
      return;
    }
    selectionSource.entities.removeAll();
    var surfaceHeight = selectionSurfaceHeight();
    var color = Cesium.Color.fromCssColorString(confirmed ? "#61e3d6" : "#8cf5eb");
    var positions = points.map(function (point) {
      return Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, surfaceHeight + 5);
    });
    if ((confirmed || closePreview) && positions.length >= 3) {
      selectionSource.entities.add({
        selectableRange: true,
        polygon: {
          hierarchy: positions,
          height: surfaceHeight,
          material: color.withAlpha(confirmed ? 0.035 : 0.018),
          outline: false
        }
      });
    }
    if (positions.length >= 2) {
      selectionSource.entities.add({
        selectableRange: true,
        polyline: {
          positions: confirmed || closePreview ? positions.concat([positions[0]]) : positions,
          width: confirmed ? 2.2 : 1.8,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: color.withAlpha(0.98),
            glowPower: confirmed ? 0.16 : 0.1,
            taperPower: 1
          })
        }
      });
    }
    selectionSource.entities.add({
      selectableRange: true,
      position: positions[0],
      point: {
        pixelSize: closePreview || confirmed ? 10 : 8,
        color: Cesium.Color.fromCssColorString(closePreview ? "#f4bd62" : "#d8fffb"),
        outlineColor: Cesium.Color.fromCssColorString("#12383c"),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });
    if (confirmed) {
      selectionSource.entities.add({
        selectableRange: true,
        position: positions[0],
        label: {
          text: "已圈选 · " + formatArea(selectionPolygonAreaKm2(points)),
          font: '11px "PingFang SC", "Microsoft YaHei", sans-serif',
          fillColor: Cesium.Color.fromCssColorString("#d9fffb"),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#071116").withAlpha(0.88),
          backgroundPadding: new Cesium.Cartesian2(8, 5),
          pixelOffset: new Cesium.Cartesian2(0, -14),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
    }
    viewer.dataSources.raiseToTop(selectionSource);
    viewer.scene.requestRender();
  }

  function selectionSurfaceHeight() {
    var height = viewer && viewer.camera.positionCartographic && viewer.camera.positionCartographic.height;
    return clamp((Number(height) || 1000000) * 0.015, 20, 12000);
  }

  function selectionCornerPositions(bounds, height) {
    return [
      Cesium.Cartesian3.fromDegrees(bounds.west, bounds.south, height),
      Cesium.Cartesian3.fromDegrees(bounds.east, bounds.south, height),
      Cesium.Cartesian3.fromDegrees(bounds.east, bounds.north, height),
      Cesium.Cartesian3.fromDegrees(bounds.west, bounds.north, height)
    ];
  }

  function publicSelectionBounds(bounds) {
    return {
      west: roundSelectionCoordinate(bounds.west),
      south: roundSelectionCoordinate(bounds.south),
      east: roundSelectionCoordinate(bounds.east),
      north: roundSelectionCoordinate(bounds.north)
    };
  }

  function publicSelectionCircle(circle) {
    return {
      longitude: roundSelectionCoordinate(circle.longitude),
      latitude: roundSelectionCoordinate(circle.latitude),
      radiusKm: normalizedCircleRadius(circle.radiusKm)
    };
  }

  function publicSelectionPolygon(polygon) {
    return polygon.map(function (point) {
      return [roundSelectionCoordinate(point.longitude), roundSelectionCoordinate(point.latitude)];
    });
  }

  function roundSelectionCoordinate(value) {
    return Math.round(Number(value) * 1000000) / 1000000;
  }

  function roundCoordinate(value) {
    return Math.round(Number(value) * 10000) / 10000;
  }

  function dispatchSpatialSelection(reason) {
    if (!selectionBounds) {
      return;
    }
    window.dispatchEvent(new CustomEvent("geoapp:spatialselect", {
      detail: {
        bounds: publicSelectionBounds(selectionBounds),
        circle: selectionCircle ? publicSelectionCircle(selectionCircle) : null,
        polygon: selectionPolygon ? publicSelectionPolygon(selectionPolygon) : null,
        filters: publicFilterState(),
        reason: reason || "select"
      }
    }));
  }

  function handleCameraMoveStart() {
    if (!viewer || viewer.isDestroyed()) {
      return;
    }
    cameraMoving = true;
    lastPaperScreenPositionUpdate = performance.now();
    hideH3HoverIndicator();
    window.clearTimeout(autoLevelTimer);
    if (flightLineCollection) {
      flightLineCollection.show = false;
    }
    if (flightTrailCollection) {
      flightTrailCollection.show = false;
    }
    if (flightParticleCollection) {
      flightParticleCollection.show = false;
    }
  }

  function handleCameraMoveEnd() {
    cameraMoving = false;
    window.clearTimeout(cameraSettleTimer);
    hideH3HoverIndicator();
    if (hoveredMeta) {
      clearHover();
    }
    updateHeatLayerForCamera();
    applyEsriBaseLayersCameraStyle();
    updateRegionMarkerVisibility();
    restoreOverlaysAfterCameraMove();
    // 程序化下钻飞行期间不要重新评估层级，避免飞行中的高相机高度把刚进入的层级回退。
    if (Date.now() >= manualNavigationLockUntil) {
      scheduleAutoLevelEvaluation();
    }
    schedulePaperDistributionRefresh(360);
    scheduleAdaptiveH3HeatRefresh(120);
  }

  function handleCameraChanged() {
    hideH3HoverIndicator();
    window.clearTimeout(cameraSettleTimer);
    // 缩放时 Cesium 有时只触发 changed，不一定稳定触发 moveEnd。
    // 这里不再依赖 cameraMoving，固定做一次短防抖，保证层级回退能及时评估。
    cameraSettleTimer = window.setTimeout(function () {
      handleCameraMoveEnd();
    }, 180);
    if (!heatCameraStyleFrame) {
      heatCameraStyleFrame = window.requestAnimationFrame(function () {
        heatCameraStyleFrame = 0;
        updateHeatLayerForCamera();
      });
    }
  }

  function restoreOverlaysAfterCameraMove() {
    var spatialSelectionActive = selectionMode || selectionDrawing || Boolean(selectionBounds);
    if (pointBillboardCollection) {
      pointBillboardCollection.show = !spatialSelectionActive && pointVisible;
    }
    if (paperDistributionCollection) {
      paperDistributionCollection.show = !spatialSelectionActive && pointVisible && isRegionPaperPointMode();
    }
    if (flightLineCollection) {
      flightLineCollection.show = !spatialSelectionActive && flightVisible;
    }
    if (flightTrailCollection) {
      flightTrailCollection.show = !spatialSelectionActive && flightVisible;
    }
    if (flightParticleCollection) {
      flightParticleCollection.show = !spatialSelectionActive && flightVisible;
    }
  }

  function scheduleAdaptiveH3HeatRefresh(delay) {
    window.clearTimeout(adaptiveHeatRefreshTimer);
    if (!currentMarkerSource || !Array.isArray(currentMarkerSource.heatBounds) ||
        selectionMode || selectionDrawing || selectionBounds) {
      return;
    }
    adaptiveHeatRefreshTimer = window.setTimeout(refreshAdaptiveH3Heat, Math.max(0, Number(delay) || 0));
  }

  function refreshAdaptiveH3Heat() {
    if (activeCityPanelTab === "papers") {
      return;
    }
    if (!currentMarkerSource || !Array.isArray(currentMarkerSource.heatBounds) ||
        !viewer || viewer.isDestroyed() || autoLevelTransition) {
      return;
    }
    if (cameraMoving) {
      scheduleAdaptiveH3HeatRefresh(120);
      return;
    }
    var bounds = currentHeatBounds(currentMarkerSource.heatBounds);
    var signature = adaptiveHeatSignature(bounds);
    if (signature === adaptiveHeatBoundsSignature) {
      return;
    }
    adaptiveHeatBoundsSignature = signature;
    var canvas = createTransparentHeatCanvas(bounds);
    updateContinuousHeatLayer(bounds, loadToken, canvas, "real").catch(function (error) {
      if (!error || error.name !== "AbortError") {
        console.error("H3 热力图自适应刷新失败", error);
        // 渲染/网络失败时稍后自动重试一次，避免热力图一直空白、需要重新缩放才恢复。
        scheduleAdaptiveH3HeatRefresh(900);
      }
    });
  }

  function adaptiveHeatSignature(bounds) {
    var precision = state.level === "city" ? 3 : 2;
    return state.level + ":" + bounds.map(function (value) {
      return Number(value).toFixed(precision);
    }).join(",") + "?" + datasetFilterParameters().toString() + "&h3_grid=" + (h3GridVisible ? "1" : "0");
  }

  function scheduleAutoLevelEvaluation(delay) {
    window.clearTimeout(autoLevelTimer);
    autoLevelTimer = window.setTimeout(evaluateAutoLevel, Math.max(0, Number(delay) || 120));
  }

  function evaluateAutoLevel() {
    if (!viewer || viewer.isDestroyed() || autoLevelTransition || selectionDrawing) {
      return;
    }
    // 选择工具已激活但尚未完成任何选择时，不因滚轮缩放切换行政层级，
    // 避免打断用户正在进行的框选/点圆/圈选操作；已完成的选择不阻塞缩放下钻。
    if (selectionMode && !selectionBounds && !selectionCircle && !selectionPolygon) {
      return;
    }
    var now = Date.now();
    if (now < manualNavigationLockUntil) {
      // 手动/程序化导航锁期内直接放弃本次评估。后续用户再次缩放会触发
      // camera.changed/moveEnd，到时再评估，避免锁一过期就自动撤销刚完成的下钻。
      return;
    }
    if (now < datasetFlyLockUntil) {
      return;
    }
    if (activeCityPanelData && activeCityPanelData.mode === "search") {
      return;
    }
    var transitionCooldown = now - lastAutoLevelTransitionAt;
    if (transitionCooldown < 160) {
      scheduleAutoLevelEvaluation(180 - transitionCooldown);
      return;
    }
    var height = viewer.camera.positionCartographic ?
      viewer.camera.positionCartographic.height : NaN;
    if (!Number.isFinite(height)) {
      return;
    }
    if (state.level === "city") {
      if (height > AUTO_LEVEL_HEIGHTS.exitCity) {
        runAutoLevelTransition(function () {
          return showChinaProvinces({ preserveCamera: true });
        }, "已按缩放返回省级分布");
        return;
      }
      if (selectedMeta && selectedMeta.level === "city" &&
          height > AUTO_LEVEL_HEIGHTS.exitFineCity) {
        restoreProvinceSelectionAfterAutoZoom();
        return;
      }
      if (height < AUTO_LEVEL_HEIGHTS.enterFineCity) {
        var city = regionAtCameraFocus("city");
        if (city && (!selectedMeta || selectedMeta.code !== city.code)) {
          runAutoLevelTransition(function () {
            return selectLeaf(city, { preserveCamera: true, silent: true });
          }, "已按缩放定位到" + shortName(city.name) + "，可点击 H3 网格");
        }
      }
      return;
    }
    if (state.level === "province") {
      if (height > AUTO_LEVEL_HEIGHTS.exitProvince) {
        runAutoLevelTransition(function () {
          return returnToWorld(false, { preserveCamera: true });
        }, "已按缩放返回国家分布");
        return;
      }
      if (height < AUTO_LEVEL_HEIGHTS.enterCity) {
        runAutoLevelTransition(function () {
          return drillDownToCameraFocus(height);
        }, "已按缩放进入城市分布");
      }
      return;
    }
    if (state.level === "country" && height < AUTO_LEVEL_HEIGHTS.enterProvince) {
      var country = regionAtCameraFocus("country", "CHN");
      if (country) {
        runAutoLevelTransition(function () {
          return drillDownToCameraFocus(height);
        }, "已按缩放进入中国省级分布");
      }
    }
  }

  async function drillDownToCameraFocus(height) {
    var message = "已按缩放更新行政层级";
    if (state.level === "country") {
      var country = regionAtCameraFocus("country", "CHN");
      if (!country) {
        return message;
      }
      await showChinaProvinces({ preserveCamera: true });
      message = "已按缩放进入中国省级分布";
    }
    if (state.level === "province" && height < AUTO_LEVEL_HEIGHTS.enterCity) {
      var province = regionAtCameraFocus("province");
      if (!province) {
        return message;
      }
      await showProvinceCities(
        province.code,
        province.name,
        province.count,
        { preserveCamera: true }
      );
      message = "已按缩放进入" + shortName(province.name) + "城市分布";
    }
    if (state.level === "city" && height < AUTO_LEVEL_HEIGHTS.enterFineCity) {
      var city = regionAtCameraFocus("city");
      if (city) {
        selectLeaf(city, { preserveCamera: true, silent: true });
        message = "已按缩放定位到" + shortName(city.name) + "，可点击 H3 网格";
      }
    }
    return message;
  }

  function runAutoLevelTransition(action, message) {
    if (autoLevelTransition) {
      return;
    }
    autoLevelTransition = true;
    Promise.resolve().then(action).then(function (resultMessage) {
      showStatus(typeof resultMessage === "string" ? resultMessage : message, 1500);
    }).catch(function (error) {
      console.error("缩放层级切换失败", error);
      showStatus("缩放层级切换失败", 1800);
    }).finally(function () {
      autoLevelTransition = false;
      lastAutoLevelTransitionAt = Date.now();
    scheduleAdaptiveH3HeatRefresh(state.level === "city" ? 120 : 200);
      window.setTimeout(function () {
        scheduleAutoLevelEvaluation(80);
      }, 120);
    });
  }

  function restoreProvinceSelectionAfterAutoZoom() {
    if (selectedMeta) {
      applyRegionStyle(selectedMeta, false);
    }
    selectedMeta = null;
    clearHighlightOutline();
    state.path = state.path.slice(0, 3);
    var province = state.path[2];
    if (province) {
      hideDatasetPanel();
      syncStatisticsPanelForLevel();
    } else {
      hideDatasetPanel();
    }
    updateDrillUi(currentBoundarySource ? currentBoundarySource.entities.values.length : 0);
    syncMapExpressionForActiveTab();
    showStatus("已按缩放返回城市分布", 1200);
  }

  function regionAtCameraFocus(level, requiredCode) {
    var focus = cameraFocusCoordinate();
    if (!focus || !currentBoundarySource) {
      return null;
    }
    var entities = currentBoundarySource.entities.values;
    for (var index = 0; index < entities.length; index += 1) {
      var meta = entities[index].regionMeta;
      if (!meta || meta.level !== level || (requiredCode && meta.code !== requiredCode)) {
        continue;
      }
      if (pointInGeometry([focus.longitude, focus.latitude], meta.geometry)) {
        return meta;
      }
    }
    return null;
  }

  function cameraFocusCoordinate() {
    if (!viewer || viewer.isDestroyed()) {
      return null;
    }
    var canvas = viewer.scene.canvas;
    return cartographicAtScreen(new Cesium.Cartesian2(
      canvas.clientWidth * 0.5,
      canvas.clientHeight * 0.5
    ));
  }

  async function returnToWorld(animate, options) {
    var navigationOptions = options || {};
    clearSelectionForNavigation();
    state.level = "country";
    state.parentCode = null;
    state.path = [{ code: "WORLD", name: "全球", level: "world" }];
    await loadLevel(DATA_ROOT + "/countries.geojson");
    hideDatasetPanel();
    if (!viewer || viewer.isDestroyed()) {
      return;
    }
    if (navigationOptions.preserveCamera) {
      return;
    }
    var destination = Cesium.Cartesian3.fromDegrees(104, 24, 22500000);
    if (animate === false) {
      viewer.camera.setView({ destination: destination });
    } else {
      beginManualNavigation(2300);
      viewer.camera.flyTo({ destination: destination, duration: 1.25 });
    }
  }

  async function showChinaProvinces(options) {
    var navigationOptions = options || {};
    clearSelectionForNavigation();
    state.level = "province";
    state.parentCode = "CHN";
    state.path = [
      { code: "WORLD", name: "全球", level: "world" },
      { code: "CHN", name: "中国", level: "country", count: regionCount("CHN", "country") }
    ];
    await loadLevel(DATA_ROOT + "/china-provinces.geojson");
    syncStatisticsPanelForLevel();
    if (!navigationOptions.preserveCamera) {
      flyToChina();
    }
  }

  async function showProvinceCities(code, name, count, options) {
    var navigationOptions = options || {};
    clearSelectionForNavigation();
    state.level = "city";
    state.parentCode = code;
    state.path = [
      { code: "WORLD", name: "全球", level: "world" },
      { code: "CHN", name: "中国", level: "country" },
      { code: code, name: name, level: "province", count: count }
    ];
    try {
      await loadLevel(DATA_ROOT + "/china-cities/" + code + ".geojson");
      syncStatisticsPanelForLevel();
      if (!navigationOptions.preserveCamera) {
        flyToCurrentSource();
      }
    } catch (error) {
      showStatus(name + "暂未提供下级边界", 2200);
      await showChinaProvinces(navigationOptions);
    }
  }

  async function loadLevel(url) {
    var token = ++loadToken;
    showStatus("正在加载行政边界...");
    selectedMeta = null;
    clearHover();
    cityPaperLocationStates = [];
    invalidatePaperLocationGrid();
    cityPaperLocationById = {};
    paperCameraPosition = null;
    paperCameraDirection = null;
    paperCameraUp = null;
    regionPaperSignature = "";
    regionPaperLocationsActive = false;
    if (paperDistributionCollection) {
      paperDistributionCollection.removeAll();
    }

    var geojson = await loadBoundaryGeoJson(url);
    // 真实热力图不依赖区域计数和 GeoJSON DataSource 解析。
    // 先发起请求，让热力图与边界解析/计数并行，避免下钻时等待整条串行链路。
    var earlyHeatBounds = heatBoundsForLevel(geojson);
    var useRealHeat = !suppliedHeatPoints;
    if (useRealHeat) {
      updateContinuousHeatLayer(
        earlyHeatBounds,
        token,
        createTransparentHeatCanvas(earlyHeatBounds),
        "real"
      ).catch(function (error) {
        if (error && error.name === "AbortError") {
          return;
        }
        console.error("连续热力图生成失败", error);
        if (token === loadToken) {
          clearCurrentHeatLayer();
          showStatus("真实热力图暂时无法加载", 2200);
        }
      });
    }

    // 边界解析与区域计数互不依赖，并行执行以缩短切换层级的等待时间。
    var levelLoadResults = await Promise.all([
      Cesium.GeoJsonDataSource.load(geojson, {
        stroke: Cesium.Color.fromCssColorString(COLORS.border).withAlpha(0.78),
        strokeWidth: 1.4,
        fill: Cesium.Color.fromCssColorString(COLORS.fill).withAlpha(0.045),
        clampToGround: false
      }),
      loadRegionCounts(geojson, token)
    ]);
    var dataSource = levelLoadResults[0];
    var markerSource = createMarkerSource(geojson, dataSource);
    styleBoundaryEntities(dataSource);

    if (token !== loadToken || !viewer || viewer.isDestroyed()) {
      return;
    }

    removeCurrentSources();
    currentBoundarySource = dataSource;
    currentMarkerSource = markerSource;
    viewer.dataSources.add(currentBoundarySource);
    viewer.dataSources.add(currentMarkerSource);
    installRegionMarkers(markerSource);
    var heatCanvas = markerSource.useRealHeat
      ? createTransparentHeatCanvas(markerSource.heatBounds)
      : renderHeatCanvas(markerSource.heatPoints, markerSource.heatBounds);
    // 2K 热力画布转 dataURL 较耗时，只编码一次，供地面贴片与连续热力层复用。
    var heatImageUrl = markerSource.useRealHeat ? null : heatCanvas.toDataURL("image/png");
    if (markerSource.useRealHeat) {
      clearHeatSurface();
    } else {
      updateHeatSurface(markerSource.heatBounds, heatCanvas, heatImageUrl);
      updateContinuousHeatLayer(
        markerSource.heatBounds,
        token,
        heatCanvas,
        "points",
        heatImageUrl
      ).catch(function (error) {
        if (error && error.name === "AbortError") {
          return;
        }
        console.error("连续热力图生成失败", error);
      });
    }
    viewer.dataSources.remove(highlightSource, false);
    viewer.dataSources.add(highlightSource);
    if (selectionSource) {
      viewer.dataSources.raiseToTop(selectionSource);
    }
    updateDrillUi(geojson.features.length);
    syncDatasetPanelForLevel();
    hideStatus();
    viewer.scene.requestRender();
    schedulePaperDistributionRefresh(0, markerSource.heatBounds);
  }

  function loadBoundaryGeoJson(url) {
    if (!boundaryGeoJsonCache[url]) {
      boundaryGeoJsonCache[url] = fetch(url).then(function (response) {
        if (!response.ok) {
          throw new Error("边界文件加载失败: " + response.status);
        }
        return response.json();
      }).catch(function (error) {
        delete boundaryGeoJsonCache[url];
        throw error;
      });
    }
    return boundaryGeoJsonCache[url];
  }

  async function loadRegionCounts(geojson, token) {
    var codes = (geojson.features || []).map(function (feature) {
      return String((feature.properties || {}).regionCode || "");
    }).filter(Boolean);
    state.path.forEach(function (entry) {
      if (entry.code && entry.code !== "WORLD" && codes.indexOf(String(entry.code)) === -1) {
        codes.push(String(entry.code));
      }
    });
    if (codes.indexOf("WORLD") === -1) {
      codes.push("WORLD");
    }
    if (!codes.length) {
      return;
    }
    var parameters = datasetFilterParameters();
    parameters.set("codes", codes.join(","));
    var url = "./api/region-counts?" + parameters.toString();
    if (regionCountsCache[url]) {
      applyRegionCountsPayload(regionCountsCache[url], token);
      return;
    }
    // 快速连续切换层级时，取消上一次尚未完成的计数请求，避免无效请求堆积。
    if (regionCountsAbortController) {
      regionCountsAbortController.abort();
    }
    regionCountsAbortController = new AbortController();
    var response;
    try {
      response = await fetch(url, {
        cache: "default",
        signal: regionCountsAbortController.signal
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        return;
      }
      throw error;
    }
    var payload;
    try {
      if (!response.ok) {
        var detail = await response.json().catch(function () { return {}; });
        throw new Error(detail.error || "区域计数请求失败: " + response.status);
      }
      payload = await response.json();
    } catch (error) {
      if (error && error.name === "AbortError") {
        return;
      }
      throw error;
    }
    if (token !== loadToken) {
      return;
    }
    regionCountsCache[url] = payload;
    regionCountsCacheOrder.push(url);
    if (regionCountsCacheOrder.length > 16) {
      delete regionCountsCache[regionCountsCacheOrder.shift()];
    }
    applyRegionCountsPayload(payload, token);
  }

  function applyRegionCountsPayload(payload, token) {
    if (token !== loadToken) {
      return;
    }
    Object.keys(payload.counts || {}).forEach(function (code) {
      suppliedCounts[String(code)] = Math.max(0, Number(payload.counts[code]) || 0);
    });
    Object.keys(payload.paper_counts || {}).forEach(function (code) {
      suppliedPaperCounts[String(code)] = Math.max(0, Number(payload.paper_counts[code]) || 0);
    });
    markerImageCache = {};
  }

  function createMarkerSource(geojson, boundarySource) {
    var markerSource = new Cesium.CustomDataSource("行政区数据集数量");
    markerSource.markerSpecs = [];
    var boundaryByCode = {};
    var boundaryEntitiesByCode = {};
    boundarySource.entities.values.forEach(function (entity) {
      var properties = entity.properties && entity.properties.getValue(Cesium.JulianDate.now());
      if (!properties) {
        return;
      }
      var code = String(properties.regionCode);
      var meta = createRegionMeta(properties, entity);
      entity.regionMeta = meta;
      boundaryByCode[code] = meta;
      if (!boundaryEntitiesByCode[code]) {
        boundaryEntitiesByCode[code] = [];
      }
      boundaryEntitiesByCode[code].push(entity);
    });

    var ranked = geojson.features
      .map(function (feature) {
        var properties = feature.properties;
        return {
          feature: feature,
          count: regionCount(properties.regionCode, properties.level),
          density: regionDensity(
            properties.regionCode,
            properties.level,
            regionCount(properties.regionCode, properties.level)
          )
        };
      })
      .sort(function (left, right) {
        return right.count - left.count;
      });
    var countRange = ranked.reduce(function (range, item) {
      range.min = Math.min(range.min, item.count);
      range.max = Math.max(range.max, item.count);
      return range;
    }, { min: Number.POSITIVE_INFINITY, max: 0 });
    var densityRange = ranked.reduce(function (range, item) {
      range.min = Math.min(range.min, item.density);
      range.max = Math.max(range.max, item.density);
      return range;
    }, { min: Number.POSITIVE_INFINITY, max: 0 });

    geojson.features.forEach(function (feature) {
      var properties = feature.properties;
      var code = String(properties.regionCode);
      var meta = boundaryByCode[code];
      if (!meta) {
        return;
      }
      // GeoJSON 的 MultiPolygon 会被 Cesium 拆成多个实体，几何信息需写回同代码的全部实体，
      // 否则按屏幕中心点查找行政区（缩放自动下钻）可能命中 geometry 为空的实体而失败。
      (boundaryEntitiesByCode[code] || []).forEach(function (entity) {
        var target = entity.regionMeta || meta;
        target.geometry = feature.geometry;
        target.count = regionCount(code, properties.level);
        target.paperCount = regionPaperCount(code);
        target.density = regionDensity(code, properties.level, target.count);
        target.densityRatio = normalizedValue(target.density, densityRange);
        target.markerSize = markerSize(target.count, countRange);
      });
      var center = validCenter(properties.center) || geometryCenter(feature.geometry);
      if (!center) {
        return;
      }
      markerSource.markerSpecs.push({
        center: center,
        meta: meta
      });
    });

    markerSource.heatBounds = heatBoundsForLevel(geojson);
    markerSource.heatPoints = suppliedHeatPoints
      ? pointsInBounds(suppliedHeatPoints, markerSource.heatBounds)
      : [];
    markerSource.useRealHeat = !suppliedHeatPoints;

    return markerSource;
  }

  function installRegionMarkers(markerSource) {
    if (!regionBillboardCollection) {
      return;
    }
    regionBillboardCollection.removeAll();
    regionBillboardCollection.show = regionMarkersShouldShow();
    regionMarkerStates = [];
    (markerSource.markerSpecs || []).forEach(function (spec) {
      var meta = spec.meta;
      var position = Cesium.Cartesian3.fromDegrees(spec.center[0], spec.center[1], 6500);
      var billboard = regionBillboardCollection.add({
        position: position,
        image: markerImage(meta, false, false),
        width: meta.markerSize,
        height: meta.markerSize,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, levelDistanceLimit()),
        id: { regionMeta: meta }
      });
      regionMarkerStates.push({
        billboard: billboard,
        meta: meta,
        position: position,
        normal: Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(
          position,
          new Cesium.Cartesian3()
        ),
        toCamera: new Cesium.Cartesian3(),
        screenPosition: new Cesium.Cartesian2(),
        frontFacing: null,
        shownByLayout: null
      });
      meta.markerEntity = { billboard: billboard };
    });
    updateRegionMarkerVisibility();
  }

  function createRegionMeta(properties, boundaryEntity) {
    var code = String(properties.regionCode);
    return {
      code: code,
      name: String(properties.name || properties.nameEn || code),
      level: String(properties.level || state.level),
      parentCode: properties.parentCode == null ? null : String(properties.parentCode),
      hasChildren: Boolean(properties.hasChildren),
      count: regionCount(code, properties.level || state.level),
      paperCount: regionPaperCount(code),
      density: 0,
      densityRatio: 0,
      boundaryEntity: boundaryEntity,
      markerEntity: null,
      geometry: null
    };
  }

  function styleBoundaryEntities(dataSource) {
    dataSource.entities.values.forEach(function (entity) {
      var meta = entity.regionMeta;
      if (!meta || !entity.polygon) {
        return;
      }
      entity.polygon.material = Cesium.Color.fromCssColorString(COLORS.fill).withAlpha(0.025);
      entity.polygon.height = 0;
      entity.polygon.arcType = Cesium.ArcType.GEODESIC;
      entity.polygon.outline = true;
      entity.polygon.outlineColor = Cesium.Color.fromCssColorString(COLORS.border).withAlpha(0.84);
      entity.polygon.classificationType = Cesium.ClassificationType.BOTH;
      if (entity.polyline) {
        entity.polyline.arcType = Cesium.ArcType.GEODESIC;
      }
    });
  }

  function onMouseMove(movement) {
    if (!viewer || viewer.isDestroyed()) {
      return;
    }
    if (updateSelectionDrawing(movement.endPosition)) {
      return;
    }
    hideH3HoverIndicator();
    var hoverNow = Date.now();
    var canHoverPick = hoverNow - lastHoverPickAt >= 60;
    if (canHoverPick) {
      lastHoverPickAt = hoverNow;
    }
    var searchSpatialMeta = canHoverPick ? searchSpatialMetaAt(movement.endPosition) : null;
    if (searchSpatialMeta) {
      cancelScheduledHoverClear();
      if (hoveredMeta) {
        clearHover();
      }
      document.getElementById("region-tooltip").classList.add("hidden");
      viewer.scene.canvas.style.cursor = "pointer";
      return;
    }
    var interactivePaper = isRegionPaperPointMode();
    var cityPaperLocationMeta = null;
    var meta = null;
    if (interactivePaper) {
      cityPaperLocationMeta = cityPaperLocationMetaAt(movement.endPosition);
      meta = cityPaperLocationMeta ? null : regionMarkerMetaAt(movement.endPosition);
    } else {
      meta = regionMarkerMetaAt(movement.endPosition);
      cityPaperLocationMeta = meta ? null : cityPaperLocationMetaAt(movement.endPosition);
    }
    var pointMeta = cityPaperLocationMeta || (!meta && canHoverPick ? drillPickMetadata(movement.endPosition, meta).pointMeta : null);
    if (meta) {
      cancelScheduledHoverClear();
      if (!hoveredMeta || hoveredMeta.code !== meta.code) {
        clearHover();
        if (selectedMeta && selectedMeta.code !== meta.code) {
          applyRegionStyle(selectedMeta, false);
        }
        hoveredMeta = meta;
        applyRegionStyle(meta, true, Boolean(selectedMeta && selectedMeta.code === meta.code));
        if (state.level !== "city") {
          showStatisticsPanel(meta, true);
        }
      }
      showTooltip(meta, movement.endPosition);
      return;
    }
    if (pointMeta) {
      cancelScheduledHoverClear();
      if (hoveredMeta) {
        clearHover();
      }
      showPointTooltip(pointMeta, movement.endPosition);
      return;
    }
    if (canHoverPick && canOfferH3PointAtScreen(movement.endPosition)) {
      cancelScheduledHoverClear();
      if (hoveredMeta) {
        clearHover();
      }
      document.getElementById("region-tooltip").classList.add("hidden");
      viewer.scene.canvas.style.cursor = "pointer";
      showH3HoverIndicator(movement.endPosition);
      return;
    }
    scheduleHoverClear();
  }

  function drillPickMetadata(position, knownMarkerMeta) {
    var markerMeta = arguments.length > 1 ? knownMarkerMeta : regionMarkerMetaAt(position);
    var picks = viewer.scene.drillPick(position, 64);
    var result = { regionMeta: null, pointMeta: null };
    var fallbackRegionMeta = markerMeta;
    for (var index = 0; index < picks.length; index += 1) {
      var id = picks[index] && picks[index].id;
      if (id && id.regionMeta) {
        if (!fallbackRegionMeta) {
          fallbackRegionMeta = id.regionMeta;
        }
        if (hoveredMeta && id.regionMeta.code === hoveredMeta.code) {
          result.regionMeta = id.regionMeta;
        }
      }
      if (!result.pointMeta && id && id.pointMeta) {
        result.pointMeta = id.pointMeta;
      }
      if (result.regionMeta && result.pointMeta) {
        break;
      }
    }
    if (!result.regionMeta) {
      result.regionMeta = fallbackRegionMeta;
    }
    return result;
  }

  function regionMarkerMetaAt(position) {
    if (!regionMarkersVisible || !regionBillboardCollection || !regionBillboardCollection.show) {
      return null;
    }
    var matchedMeta = null;
    var nearestDistance = Number.POSITIVE_INFINITY;
    regionMarkerStates.forEach(function (markerState) {
      if (!markerState.billboard.show) {
        return;
      }
      var screenPosition = markerState.screenPosition;
      var xDistance = screenPosition.x - position.x;
      var yDistance = screenPosition.y - position.y;
      var distance = Math.sqrt(xDistance * xDistance + yDistance * yDistance);
      var hitRadius = Math.max(22, Number(markerState.billboard.width) * 0.5) + 3;
      if (distance <= hitRadius && distance < nearestDistance) {
        nearestDistance = distance;
        matchedMeta = markerState.meta;
      }
    });
    return matchedMeta;
  }

  function searchSpatialMetaAt(position) {
    if (!searchResultSource || !searchResultSource.show || !searchSpatialEntries.length) {
      return null;
    }
    var picks = viewer.scene.drillPick(position, 16);
    for (var index = 0; index < picks.length; index += 1) {
      var id = picks[index] && picks[index].id;
      if (id && id.searchSpatialMeta) {
        return id.searchSpatialMeta;
      }
    }
    return null;
  }

  function onLeftClick(click) {
    if (selectionMode) {
      if (selectionTool === "circle" && !selectionDrawing && Date.now() >= suppressMapClickUntil) {
        var circleCenter = cartographicAtScreen(click.position);
        if (circleCenter) {
          suppressMapClickUntil = Date.now() + 500;
          applyCircleSelection(circleCenter);
        } else {
          showStatus("请点击地球表面确定圆心", 1400);
        }
      }
      return;
    }
    if (selectionDrawing || Date.now() < suppressMapClickUntil) {
      return;
    }

    var clickedSearchSpatial = searchSpatialMetaAt(click.position);
    if (clickedSearchSpatial) {
      selectSearchSpatialTarget(clickedSearchSpatial.key, "globe", false);
      return;
    }
    if (canOfferH3PointAtScreen(click.position)) {
      queryH3PointAtScreen(click.position);
      return;
    }
    var clickedCityDataset = cityDatasetMetaAt(click.position);
    if (clickedCityDataset) {
      activateCityDataset(clickedCityDataset.datasetId, "globe", false);
      return;
    }
    var interactivePaper = isRegionPaperPointMode();
    var pickResult = drillPickMetadata(click.position, null);
    var clickedPointMeta = pickResult.pointMeta;
    if (interactivePaper) {
      var clickedPaperLocation = cityPaperLocationMetaAt(click.position);
      if (!clickedPaperLocation && clickedPointMeta && clickedPointMeta.cityPaperLocation) {
        clickedPaperLocation = clickedPointMeta;
      }
      if (clickedPaperLocation) {
        activateCityPaperLocation(clickedPaperLocation.locationId, "globe");
        return;
      }
    }
    var markerMeta = regionMarkerMetaAt(click.position);
    if (markerMeta) {
      if (canQueryH3Point() && markerMeta.code === activeDatasetCityCode) {
        queryH3PointAtScreen(click.position);
        return;
      }
      activateRegion(markerMeta);
      return;
    }
    var picked = viewer.scene.pick(click.position);
    var pickedId = picked && picked.id;
    if (pickedId && pickedId.regionMeta) {
      if (canQueryH3Point() && pickedId.regionMeta.code === activeDatasetCityCode) {
        queryH3PointAtScreen(click.position);
        return;
      }
      activateRegion(pickedId.regionMeta);
      return;
    }
    var regionMeta = pickResult.regionMeta;
    if (regionMeta) {
      if (canQueryH3Point() && regionMeta.code === activeDatasetCityCode) {
        queryH3PointAtScreen(click.position);
        return;
      }
      activateRegion(regionMeta);
      return;
    }
    if (!interactivePaper) {
      var backgroundPaper = clickedPointMeta && clickedPointMeta.cityPaperLocation
        ? clickedPointMeta
        : cityPaperLocationMetaAt(click.position);
      if (backgroundPaper) {
        activateCityPaperLocation(backgroundPaper.locationId, "globe");
        return;
      }
      if (clickedPointMeta) {
        showStatus(clickedPointMeta.name + " · " + pointMetaSummary(clickedPointMeta), 1800);
        return;
      }
    }
    if (canQueryH3Point()) {
      queryH3PointAtScreen(click.position);
    }
  }

  function activateRegion(meta) {
    clearHover();
    beginManualNavigation();
    clearSelectionForNavigation();
    if (meta.level === "country" && meta.code === "CHN") {
      showChinaProvinces();
      return;
    }
    if (meta.level === "province") {
      showProvinceCities(meta.code, meta.name, meta.count);
      return;
    }
    selectLeaf(meta);
  }

  function beginManualNavigation(duration) {
    // 行政边界加载完成后才会真正开始相机飞行，因此飞行入口需要重新续锁；
    // 700ms 只覆盖点击瞬间，不足以覆盖 GeoJSON 加载 + 1.25s 飞行。
    var lockDuration = Number(duration) || 700;
    manualNavigationLockUntil = Math.max(
      manualNavigationLockUntil,
      Date.now() + lockDuration
    );
    datasetFlyLockUntil = 0;
    window.clearTimeout(autoLevelTimer);
  }

  function scheduleHoverClear() {
    if (hoverClearTimer) {
      return;
    }
    hoverClearTimer = window.setTimeout(function () {
      hoverClearTimer = null;
      clearHover();
    }, 90);
  }

  function cancelScheduledHoverClear() {
    if (!hoverClearTimer) {
      return;
    }
    window.clearTimeout(hoverClearTimer);
    hoverClearTimer = null;
  }

  function selectLeaf(meta, options) {
    var navigationOptions = options || {};
    clearHover();
    if (selectedMeta && selectedMeta.code !== meta.code) {
      applyRegionStyle(selectedMeta, false);
    }
    selectedMeta = meta;
    applyRegionStyle(meta, true, true);
    if (meta.level === "city") {
      showCityDatasetPanel(meta);
    } else {
      hideDatasetPanel();
      syncStatisticsPanelForLevel();
    }
    if (!navigationOptions.preserveCamera) {
      focusOnRegion(meta, 0.9);
    }
    scheduleAdaptiveH3HeatRefresh(navigationOptions.preserveCamera ? 120 : 180);
    if (!navigationOptions.silent) {
      showStatus(
        meta.name + " · " + formatCount(meta.count) + " 个数据集 · " +
        formatCount(meta.paperCount || 0) + " 篇论文",
        1800
      );
    }
  }

  function applyRegionStyle(meta, active, selected) {
    if (meta.boundaryEntity && meta.boundaryEntity.polygon) {
      var color = selected ? COLORS.selected : COLORS.hover;
      var hovered = Boolean(hoveredMeta && hoveredMeta.code === meta.code);
      var selectedAlpha = meta.level === "city" ? 0.055 : 0.3;
      meta.boundaryEntity.polygon.material = active
        ? Cesium.Color.fromCssColorString(color).withAlpha(selected ? (hovered ? selectedAlpha : 0.025) : 0.26)
        : Cesium.Color.fromCssColorString(COLORS.fill).withAlpha(0.025);
      meta.boundaryEntity.polygon.outlineColor = active
        ? Cesium.Color.fromCssColorString(color)
        : Cesium.Color.fromCssColorString(COLORS.border).withAlpha(0.84);
    }
    if (meta.markerEntity && meta.markerEntity.billboard) {
      meta.markerEntity.billboard.image = markerImage(meta, active, Boolean(selected));
      var markerScale = active ? (selected ? 1.1 : 1.07) : 1;
      meta.markerEntity.billboard.width = Math.round(meta.markerSize * markerScale);
      meta.markerEntity.billboard.height = Math.round(meta.markerSize * markerScale);
    }
    if (active) {
      drawHighlightOutline(meta, Boolean(selected));
    }
    viewer.scene.requestRender();
  }

  function clearHover() {
    cancelScheduledHoverClear();
    var previous = hoveredMeta;
    hoveredMeta = null;
    if (previous && (!selectedMeta || previous.code !== selectedMeta.code)) {
      applyRegionStyle(previous, false);
    }
    if (selectedMeta) {
      applyRegionStyle(selectedMeta, true, true);
    } else {
      clearHighlightOutline();
    }
    viewer.scene.canvas.style.cursor = "default";
    document.getElementById("region-tooltip").classList.add("hidden");
    syncStatisticsPanelForLevel();
  }

  function drawHighlightOutline(meta, selected) {
    clearHighlightOutline();
    if (!highlightPrimitiveRoot || !meta || !meta.geometry) {
      return;
    }
    var color = Cesium.Color.fromCssColorString(selected ? COLORS.selected : COLORS.hover);
    var fineCitySelection = selected && meta.level === "city";
    var selectedHover = selected && hoveredMeta && hoveredMeta.code === meta.code;
    var fillInstances = [];
    var shadowInstances = [];
    var outlineInstances = [];
    outerRings(meta.geometry).forEach(function (ring) {
      var positions = ringCartesianPositions(ring);
      if (positions.length < 3) {
        return;
      }
      fillInstances.push(new Cesium.GeometryInstance({
        geometry: Cesium.PolygonGeometry.fromPositions({
          positions: positions,
          height: fineCitySelection ? 300 : 4000,
          vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            color.withAlpha(selected ? (selectedHover ? (fineCitySelection ? 0.055 : 0.24) : 0) : 0.34)
          )
        }
      }));
      shadowInstances.push(highlightLineInstance(positions, selected ? 4 : 3.6, "#02080c", 0.72));
      outlineInstances.push(highlightLineInstance(positions, selected ? 2.1 : 1.7, color, 0.99));
    });
    addTopHighlightPrimitive(fillInstances);
    addTopHighlightPrimitive(shadowInstances);
    addTopHighlightPrimitive(outlineInstances);
    viewer.scene.primitives.raiseToTop(highlightPrimitiveRoot);
  }

  function ringCartesianPositions(ring) {
    var coordinates = ring.slice();
    if (coordinates.length > 1) {
      var first = coordinates[0];
      var last = coordinates[coordinates.length - 1];
      if (Number(first[0]) === Number(last[0]) && Number(first[1]) === Number(last[1])) {
        coordinates.pop();
      }
    }
    return coordinates.map(function (coordinate) {
      return Cesium.Cartesian3.fromDegrees(Number(coordinate[0]), Number(coordinate[1]), 4000);
    });
  }

  function highlightLineInstance(positions, width, color, alpha) {
    return new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions: positions.concat([positions[0]]),
        width: width,
        vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          typeof color === "string" ? Cesium.Color.fromCssColorString(color).withAlpha(alpha) : color.withAlpha(alpha)
        )
      }
    });
  }

  function addTopHighlightPrimitive(instances) {
    if (!instances.length) {
      return;
    }
    highlightPrimitiveRoot.add(new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({
        flat: true,
        translucent: true,
        closed: false,
        renderState: {
          depthTest: { enabled: false },
          depthMask: false,
          blending: Cesium.BlendingState.ALPHA_BLEND,
          cull: { enabled: false }
        }
      }),
      asynchronous: false,
      allowPicking: false
    }));
  }

  function outerRings(geometry) {
    if (!geometry || !geometry.coordinates) {
      return [];
    }
    if (geometry.type === "Polygon") {
      return geometry.coordinates.length ? [geometry.coordinates[0]] : [];
    }
    if (geometry.type === "MultiPolygon") {
      return geometry.coordinates
        .filter(function (polygon) {
          return polygon.length;
        })
        .map(function (polygon) {
          return polygon[0];
        });
    }
    return [];
  }

  function clearHighlightOutline() {
    if (highlightSource) {
      highlightSource.entities.removeAll();
    }
    if (highlightPrimitiveRoot) {
      highlightPrimitiveRoot.removeAll();
    }
  }

  function showTooltip(meta, position) {
    var tooltip = document.getElementById("region-tooltip");
    if (isCityDetailMode()) {
      tooltip.classList.add("hidden");
      return;
    }
    document.getElementById("region-tooltip-name").textContent = meta.name;
    document.getElementById("region-tooltip-count").textContent = formatCount(meta.count);
    document.getElementById("region-tooltip-unit").textContent = " 个数据集";
    document.getElementById("region-tooltip-paper-count").textContent = formatCount(meta.paperCount || 0);
    document.getElementById("region-tooltip-paper-line").classList.remove("hidden");
    document.getElementById("region-tooltip-hint").textContent = drillHint(meta);
    tooltip.classList.remove("hidden");
    var left = Math.min(position.x + 16, window.innerWidth - 176);
    var top = Math.min(position.y + 16, window.innerHeight - 104);
    tooltip.style.left = Math.max(8, left) + "px";
    tooltip.style.top = Math.max(8, top) + "px";
    viewer.scene.canvas.style.cursor = "pointer";
  }

  function showPointTooltip(meta, position) {
    var tooltip = document.getElementById("region-tooltip");
    document.getElementById("region-tooltip-name").textContent = meta.name;
    document.getElementById("region-tooltip-count").textContent = formatCount(meta.count || 1);
    document.getElementById("region-tooltip-unit").textContent =
      meta.type === "paper" ? " 篇论文" : " 个点数据集";
    document.getElementById("region-tooltip-paper-line").classList.add("hidden");
    document.getElementById("region-tooltip-hint").textContent =
      meta.cityPaperLocation ? (meta.count > 1 ? "点击查看同坐标论文" : "点击关联右侧论文") :
        meta.densityGrid ? "当前网格内的论文数量" :
        meta.type === "paper" ? "关联论文" : "坐标型数据集";
    tooltip.classList.remove("hidden");
    var left = Math.min(position.x + 16, window.innerWidth - 196);
    var top = Math.min(position.y + 16, window.innerHeight - 104);
    tooltip.style.left = Math.max(8, left) + "px";
    tooltip.style.top = Math.max(8, top) + "px";
    viewer.scene.canvas.style.cursor = "pointer";
  }

  function pointMetaSummary(meta) {
    return formatCount(meta.count || 1) + (meta.type === "paper" ? " 篇论文" : " 个点数据集");
  }

  function drillHint(meta) {
    if (meta.level === "country" && meta.code === "CHN") {
      return "点击查看省级分布";
    }
    if (meta.level === "province") {
      return "点击查看城市分布";
    }
    if (meta.level === "city") {
      return "点击聚焦该城市";
    }
    return "当前演示仅开放中国下钻";
  }

  function markerImage(meta, active, selected) {
    var cacheKey = [
      meta.code,
      meta.count,
      meta.paperCount,
      meta.markerSize,
      Math.round(meta.densityRatio * 100),
      active ? "1" : "0",
      selected ? "1" : "0"
    ].join(":");
    if (markerImageCache[cacheKey]) {
      return markerImageCache[cacheKey];
    }
    var size = meta.markerSize;
    var pixelRatio = 2;
    var canvas = document.createElement("canvas");
    canvas.width = Math.ceil(size * pixelRatio);
    canvas.height = Math.ceil(size * pixelRatio);
    var context = canvas.getContext("2d");
    context.scale(pixelRatio, pixelRatio);
    var center = size * 0.5;
    var radius = size * 0.405;
    var ringColor = selected ? "#ffd16a" : active ? "#90fff1" : "#58e8da";
    var countColor = selected ? "#ffe3a0" : active ? "#ffffff" : "#ffd58a";

    var halo = context.createRadialGradient(center, center, radius * 0.55, center, center, size * 0.5);
    halo.addColorStop(0, active ? "rgba(75, 240, 220, 0.2)" : "rgba(55, 222, 210, 0.11)");
    halo.addColorStop(0.72, active ? "rgba(74, 235, 217, 0.12)" : "rgba(54, 215, 202, 0.06)");
    halo.addColorStop(1, "rgba(20, 190, 180, 0)");
    context.fillStyle = halo;
    context.fillRect(0, 0, size, size);

    var fill = context.createRadialGradient(
      center - radius * 0.24,
      center - radius * 0.28,
      radius * 0.08,
      center,
      center,
      radius
    );
    if (selected) {
      fill.addColorStop(0, "rgba(70, 60, 31, 0.98)");
      fill.addColorStop(0.66, "rgba(24, 45, 43, 0.97)");
      fill.addColorStop(1, "rgba(7, 22, 28, 0.99)");
    } else if (active) {
      fill.addColorStop(0, "rgba(25, 91, 87, 0.98)");
      fill.addColorStop(0.64, "rgba(12, 54, 58, 0.98)");
      fill.addColorStop(1, "rgba(6, 23, 30, 0.99)");
    } else {
      fill.addColorStop(0, "rgba(18, 62, 64, 0.97)");
      fill.addColorStop(0.62, "rgba(9, 39, 47, 0.98)");
      fill.addColorStop(1, "rgba(5, 20, 27, 0.99)");
    }
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.fill();

    context.shadowColor = selected ? "rgba(255, 196, 85, 0.62)" : "rgba(75, 239, 222, 0.58)";
    context.shadowBlur = active ? size * 0.11 : size * 0.065;
    context.lineWidth = Math.max(1.4, size * (active ? 0.027 : 0.021));
    context.strokeStyle = ringColor;
    context.stroke();
    context.shadowBlur = 0;

    context.beginPath();
    context.arc(center, center, radius - Math.max(3, size * 0.045), 0, Math.PI * 2);
    context.lineWidth = Math.max(0.7, size * 0.009);
    context.strokeStyle = "rgba(181, 255, 246, 0.24)";
    context.stroke();

    var densityArc = 0.2 + clamp(meta.densityRatio, 0, 1) * 0.68;
    var arcStart = -Math.PI * 0.5;
    var arcEnd = arcStart + Math.PI * 2 * densityArc;
    context.beginPath();
    context.arc(center, center, radius - Math.max(1.8, size * 0.024), arcStart, arcEnd);
    context.lineCap = "round";
    context.lineWidth = Math.max(1.3, size * 0.022);
    context.strokeStyle = selected ? "#fff1b6" : "#ffbc5c";
    context.stroke();
    context.lineCap = "butt";

    context.textAlign = "center";
    context.textBaseline = "middle";
    var displayName = shortName(meta.name);
    var nameSize = clamp(size * (displayName.length >= 4 ? 0.145 : 0.16), 10, 15);
    var datasetText = "数 " + formatCount(meta.count);
    var paperText = "文 " + formatCount(meta.paperCount || 0);
    var countSize = clamp(size * 0.14, 10, 18);
    context.fillStyle = active ? "#dffffa" : "#bdece7";
    context.font = '600 ' + nameSize + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillText(displayName, center, center - size * 0.19);
    context.shadowColor = selected ? "rgba(255, 200, 92, 0.6)" : "rgba(69, 236, 219, 0.38)";
    context.shadowBlur = active ? size * 0.05 : size * 0.025;
    context.fillStyle = countColor;
    context.font = '700 ' + countSize + 'px "DIN Alternate", "Arial Narrow", Arial, sans-serif';
    context.fillText(datasetText, center, center + size * 0.035);
    context.fillStyle = selected ? "#ffe7b0" : "#b7c5ff";
    context.font = '600 ' + Math.max(9, countSize - 1) + 'px "DIN Alternate", "Arial Narrow", Arial, sans-serif';
    context.fillText(paperText, center, center + size * 0.21);
    context.shadowBlur = 0;
    markerImageCache[cacheKey] = canvas;
    return canvas;
  }

  function shortName(name) {
    if (name === "中华人民共和国") {
      return "中国";
    }
    if (name === "中华民国") {
      return "台湾";
    }
    if (name === "朝鲜民主主义人民共和国") {
      return "朝鲜";
    }
    var value = String(name)
      .replace(/自治州$/, "")
      .replace(/(?:蒙古族|维吾尔族|哈萨克族|柯尔克孜族|朝鲜族|土家族|傈僳族|景颇族|达斡尔族|布依族|藏族|回族|苗族|侗族|彝族|傣族|白族|哈尼族|壮族|羌族|瑶族|佤族|拉祜族|纳西族)+$/, "")
      .replace(/壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|地区|省|市|盟$/g, "");
    return value.length > 4 ? value.slice(0, 4) : value;
  }

  function markerSize(count, range) {
    var limits = state.level === "country"
      ? [72, 132]
      : state.level === "province"
        ? [70, 116]
        : [68, 104];
    var min = Number.isFinite(range.min) ? range.min : 0;
    var span = Math.max(range.max, min) - min;
    var ratio = span > 0
      ? (Math.max(count, 0) - min) / span
      : 0.5;
    ratio = Math.max(0, Math.min(1, ratio));
    ratio = Math.pow(ratio, 1.02);
    return Math.round(limits[0] + (limits[1] - limits[0]) * ratio);
  }

  function normalizedValue(value, range) {
    var min = Number.isFinite(range.min) ? Math.max(range.min, 0) : 0;
    var max = Number.isFinite(range.max) ? Math.max(range.max, min) : min;
    var span = Math.sqrt(max) - Math.sqrt(min);
    if (span <= 0) {
      return 0.5;
    }
    return Math.max(0, Math.min(1, (Math.sqrt(Math.max(value, 0)) - Math.sqrt(min)) / span));
  }

  function createMockHeatPoints(geojson, boundaryByCode) {
    if (state.level === "country") {
      return createWorldHeatNetwork(boundaryByCode);
    }

    var nodes = [];
    geojson.features.forEach(function (feature) {
      var properties = feature.properties || {};
      var code = String(properties.regionCode);
      var meta = boundaryByCode[code];
      var center = validCenter(properties.center) || geometryCenter(feature.geometry);
      var bounds = geometryBounds(feature.geometry);
      if (!meta || !center || !bounds) {
        return;
      }
      var densityWeight = 0.18 + Math.pow(meta.densityRatio, 1.25) * 0.82;
      var longitudeSpread = clamp((bounds[2] - bounds[0]) * 0.1, state.level === "province" ? 0.18 : 0.025, state.level === "province" ? 0.58 : 0.12);
      var latitudeSpread = clamp((bounds[3] - bounds[1]) * 0.1, state.level === "province" ? 0.14 : 0.02, state.level === "province" ? 0.46 : 0.1);
      nodes.push({
        code: code,
        longitude: center[0],
        latitude: center[1],
        weight: densityWeight,
        longitudeSpread: longitudeSpread,
        latitudeSpread: latitudeSpread
      });

      var random = seededRandom(stringHash(code + ":settlements"));
      var satelliteCount = (state.level === "province" ? 3 : 2) +
        Math.round(densityWeight * (state.level === "province" ? 5 : 3));
      var added = 0;
      for (var attempt = 0; attempt < satelliteCount * 14 && added < satelliteCount; attempt += 1) {
        var candidate = [
          bounds[0] + random() * (bounds[2] - bounds[0]),
          bounds[1] + random() * (bounds[3] - bounds[1])
        ];
        if (!pointInGeometry(candidate, feature.geometry)) {
          continue;
        }
        nodes.push({
          code: code + "-s" + added,
          longitude: candidate[0],
          latitude: candidate[1],
          weight: densityWeight * (0.28 + random() * 0.46),
          longitudeSpread: longitudeSpread * (0.46 + random() * 0.38),
          latitudeSpread: latitudeSpread * (0.46 + random() * 0.38)
        });
        added += 1;
      }
    });
    return createHeatNetwork(nodes, {
      seed: state.parentCode || state.level,
      grainBase: state.level === "province" ? 54 : 62,
      grainScale: state.level === "province" ? 108 : 126,
      coreRadius: state.level === "province" ? 12 : 10,
      maxLinkDistance: state.level === "province" ? 8.5 : 2.6,
      linksPerNode: 2
    });
  }

  function createWorldHeatNetwork(boundaryByCode) {
    var hubs = [
      [116.40, 39.90, 1.00, "CHN", "china"], [117.20, 39.12, 0.72, "CHN", "china"],
      [121.47, 31.23, 1.00, "CHN", "china"], [120.15, 30.28, 0.91, "CHN", "china"],
      [118.80, 32.06, 0.78, "CHN", "china"], [120.62, 31.30, 0.82, "CHN", "china"],
      [113.26, 23.13, 0.96, "CHN", "china"], [114.06, 22.55, 0.94, "CHN", "china"],
      [113.12, 23.02, 0.72, "CHN", "china"], [114.30, 30.59, 0.84, "CHN", "china"],
      [112.94, 28.23, 0.68, "CHN", "china"], [115.86, 28.68, 0.57, "CHN", "china"],
      [104.07, 30.67, 0.86, "CHN", "china"], [106.55, 29.56, 0.82, "CHN", "china"],
      [108.94, 34.34, 0.72, "CHN", "china"], [113.62, 34.75, 0.70, "CHN", "china"],
      [117.12, 36.65, 0.64, "CHN", "china"], [120.38, 36.07, 0.62, "CHN", "china"],
      [119.30, 26.08, 0.54, "CHN", "china"], [118.09, 24.48, 0.58, "CHN", "china"],
      [102.71, 25.04, 0.53, "CHN", "china"], [106.63, 26.65, 0.48, "CHN", "china"],
      [110.20, 20.04, 0.42, "CHN", "china"], [123.43, 41.80, 0.56, "CHN", "china"],
      [126.53, 45.80, 0.42, "CHN", "china"], [87.62, 43.82, 0.40, "CHN", "china"],
      [139.69, 35.68, 0.96, "JPN", "east-asia"], [135.50, 34.69, 0.76, "JPN", "east-asia"],
      [126.98, 37.57, 0.86, "KOR", "east-asia"], [121.56, 25.04, 0.67, "TWN", "east-asia"],
      [77.10, 28.70, 0.90, "IND", "south-asia"], [72.88, 19.08, 0.86, "IND", "south-asia"],
      [77.59, 12.97, 0.68, "IND", "south-asia"], [88.36, 22.57, 0.62, "IND", "south-asia"],
      [90.41, 23.81, 0.72, "BGD", "south-asia"], [67.01, 24.86, 0.58, "PAK", "south-asia"],
      [106.85, -6.21, 0.79, "IDN", "se-asia"], [100.50, 13.75, 0.58, "THA", "se-asia"],
      [103.82, 1.35, 0.64, "SGP", "se-asia"], [106.63, 10.82, 0.62, "VNM", "se-asia"],
      [120.98, 14.60, 0.62, "PHL", "se-asia"], [101.69, 3.14, 0.52, "MYS", "se-asia"],
      [2.35, 48.86, 0.76, "FRA", "europe"], [-0.13, 51.51, 0.82, "GBR", "europe"],
      [13.41, 52.52, 0.70, "DEU", "europe"], [4.90, 52.37, 0.58, "NLD", "europe"],
      [9.19, 45.46, 0.60, "ITA", "europe"], [12.50, 41.90, 0.54, "ITA", "europe"],
      [-3.70, 40.42, 0.57, "ESP", "europe"], [37.62, 55.75, 0.66, "RUS", "europe"],
      [-74.01, 40.71, 0.92, "USA", "north-america"], [-77.04, 38.91, 0.65, "USA", "north-america"],
      [-87.63, 41.88, 0.70, "USA", "north-america"], [-118.24, 34.05, 0.82, "USA", "north-america"],
      [-122.42, 37.77, 0.72, "USA", "north-america"], [-95.37, 29.76, 0.59, "USA", "north-america"],
      [-79.38, 43.65, 0.59, "CAN", "north-america"], [-99.13, 19.43, 0.74, "MEX", "north-america"],
      [-46.63, -23.55, 0.82, "BRA", "south-america"], [-43.17, -22.91, 0.62, "BRA", "south-america"],
      [-58.38, -34.60, 0.57, "ARG", "south-america"], [-77.04, -12.05, 0.52, "PER", "south-america"],
      [31.24, 30.04, 0.70, "EGY", "africa"], [3.38, 6.52, 0.66, "NGA", "africa"],
      [28.05, -26.20, 0.58, "ZAF", "africa"], [36.82, -1.29, 0.48, "KEN", "africa"],
      [151.21, -33.87, 0.62, "AUS", "oceania"], [144.96, -37.81, 0.52, "AUS", "oceania"]
    ];
    var nodes = hubs.map(function (hub, index) {
      var meta = boundaryByCode[hub[3]];
      var regionalRatio = meta ? 0.28 + meta.densityRatio * 0.72 : 0.46;
      return {
        code: hub[3] + "-" + index,
        countryCode: hub[3],
        group: hub[4],
        longitude: hub[0],
        latitude: hub[1],
        weight: hub[2] * regionalRatio * (hub[3] === "CHN" ? 1.08 : 1),
        longitudeSpread: hub[3] === "CHN" ? 1.7 : 2.2,
        latitudeSpread: hub[3] === "CHN" ? 1.18 : 1.52
      };
    });
    return createHeatNetwork(nodes, {
      seed: "world",
      grainBase: 18,
      grainScale: 38,
      coreRadius: 5,
      maxLinkDistance: 13,
      linksPerNode: 2,
      matchGroups: true
    });
  }

  function createHeatNetwork(nodes, options) {
    var points = [];
    nodes.forEach(function (node) {
      var random = seededRandom(stringHash(options.seed + ":" + node.code));
      addHeatCluster(points, node, random, options);
    });
    addHeatCorridors(points, nodes, options);
    return points;
  }

  function addHeatCluster(points, node, random, options) {
    var strength = clamp(Number(node.weight) || 0, 0.04, 1);
    var coreRadius = options.coreRadius * (0.72 + strength * 0.42);
    points.push({
      longitude: node.longitude,
      latitude: node.latitude,
      weight: Math.min(1, strength * 1.12),
      radius: coreRadius,
      kind: "core"
    });

    var grainCount = Math.round(options.grainBase + options.grainScale * strength);
    for (var index = 0; index < grainCount; index += 1) {
      var angle = random() * Math.PI * 2;
      var distance = Math.pow(random(), 1.7);
      var branch = index % 5;
      if (branch < 3) {
        angle = branch * Math.PI * 2 / 3 + (random() - 0.5) * 0.28;
        distance = 0.12 + random() * 0.92;
      }
      points.push({
        longitude: clamp(node.longitude + Math.cos(angle) * node.longitudeSpread * distance, -179.8, 179.8),
        latitude: clamp(node.latitude + Math.sin(angle) * node.latitudeSpread * distance, -84.8, 84.8),
        weight: strength * (0.18 + random() * 0.42) * (1 - distance * 0.32),
        radius: 1.8 + random() * 2.8,
        kind: "grain"
      });
    }

    var spokeCount = 3 + Math.round(strength * 3);
    for (var spoke = 0; spoke < spokeCount; spoke += 1) {
      var spokeAngle = random() * Math.PI * 2;
      var spokeLength = 0.42 + random() * 0.62;
      var spokeSteps = 7 + Math.round(random() * 8);
      for (var step = 1; step <= spokeSteps; step += 1) {
        var ratio = step / spokeSteps * spokeLength;
        points.push({
          longitude: clamp(node.longitude + Math.cos(spokeAngle) * node.longitudeSpread * ratio, -179.8, 179.8),
          latitude: clamp(node.latitude + Math.sin(spokeAngle) * node.latitudeSpread * ratio, -84.8, 84.8),
          weight: strength * (0.18 + (1 - ratio) * 0.16),
          radius: 1.5 + random() * 1.5,
          kind: "corridor"
        });
      }
    }
  }

  function addHeatCorridors(points, nodes, options) {
    var linked = {};
    nodes.forEach(function (node, nodeIndex) {
      var candidates = nodes.map(function (candidate, candidateIndex) {
        if (candidateIndex === nodeIndex || (options.matchGroups && candidate.group !== node.group)) {
          return null;
        }
        var latitudeScale = Math.cos((node.latitude + candidate.latitude) * Math.PI / 360);
        var longitudeDistance = (node.longitude - candidate.longitude) * Math.max(0.28, latitudeScale);
        var latitudeDistance = node.latitude - candidate.latitude;
        return {
          index: candidateIndex,
          distance: Math.sqrt(longitudeDistance * longitudeDistance + latitudeDistance * latitudeDistance)
        };
      }).filter(function (candidate) {
        return candidate && candidate.distance <= options.maxLinkDistance;
      }).sort(function (left, right) {
        return left.distance - right.distance;
      }).slice(0, options.linksPerNode);

      candidates.forEach(function (candidate) {
        var target = nodes[candidate.index];
        var key = nodeIndex < candidate.index
          ? nodeIndex + ":" + candidate.index
          : candidate.index + ":" + nodeIndex;
        if (linked[key]) {
          return;
        }
        linked[key] = true;
        var random = seededRandom(stringHash(options.seed + ":link:" + key));
        var steps = Math.round(clamp(candidate.distance * (state.level === "country" ? 3.2 : 7), 9, 42));
        for (var step = 1; step < steps; step += 1) {
          if (random() < 0.16) {
            continue;
          }
          var ratio = step / steps;
          var taper = Math.sin(ratio * Math.PI);
          var jitter = (random() - 0.5) * candidate.distance * 0.018;
          points.push({
            longitude: node.longitude + (target.longitude - node.longitude) * ratio + jitter,
            latitude: node.latitude + (target.latitude - node.latitude) * ratio + jitter * 0.55,
            weight: Math.min(node.weight, target.weight) * (0.14 + taper * 0.12),
            radius: 1.35 + random() * 1.55,
            kind: "corridor"
          });
        }
      });
    });
  }

  function heatBoundsForLevel(geojson) {
    if (state.level === "country") {
      return [-180, -90, 180, 90];
    }
    var bounds = [180, 90, -180, -90];
    geojson.features.forEach(function (feature) {
      visitCoordinates(feature.geometry.coordinates, function (coordinate) {
        bounds[0] = Math.min(bounds[0], coordinate[0]);
        bounds[1] = Math.min(bounds[1], coordinate[1]);
        bounds[2] = Math.max(bounds[2], coordinate[0]);
        bounds[3] = Math.max(bounds[3], coordinate[1]);
      });
    });
    var padding = state.level === "province" ? 3 : 0.7;
    return [
      clamp(bounds[0] - padding, -180, 180),
      clamp(bounds[1] - padding, -85, 85),
      clamp(bounds[2] + padding, -180, 180),
      clamp(bounds[3] + padding, -85, 85)
    ];
  }

  function pointsInBounds(points, bounds) {
    return points.filter(function (point) {
      return point.longitude >= bounds[0] && point.longitude <= bounds[2] &&
        point.latitude >= bounds[1] && point.latitude <= bounds[3];
    });
  }

  function pointInGeometry(point, geometry) {
    if (!geometry || !geometry.coordinates) {
      return false;
    }
    if (geometry.type === "Polygon") {
      return pointInRing(point, geometry.coordinates[0]);
    }
    if (geometry.type === "MultiPolygon") {
      return geometry.coordinates.some(function (polygon) {
        return pointInRing(point, polygon[0]);
      });
    }
    return false;
  }

  function pointInRing(point, ring) {
    var inside = false;
    for (var index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      var currentPoint = ring[index];
      var previousPoint = ring[previous];
      var intersects = (currentPoint[1] > point[1]) !== (previousPoint[1] > point[1]) &&
        point[0] < (previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1]) /
          (previousPoint[1] - currentPoint[1] || Number.EPSILON) + currentPoint[0];
      if (intersects) {
        inside = !inside;
      }
    }
    return inside;
  }

  function geometryBounds(geometry) {
    if (!geometry || !geometry.coordinates) {
      return null;
    }
    var bounds = [180, 90, -180, -90];
    visitCoordinates(geometry.coordinates, function (coordinate) {
      bounds[0] = Math.min(bounds[0], coordinate[0]);
      bounds[1] = Math.min(bounds[1], coordinate[1]);
      bounds[2] = Math.max(bounds[2], coordinate[0]);
      bounds[3] = Math.max(bounds[3], coordinate[1]);
    });
    return bounds;
  }

  function stringHash(value) {
    var hash = 2166136261;
    String(value).split("").forEach(function (character) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    });
    return hash >>> 0;
  }

  function seededRandom(seed) {
    var value = seed >>> 0;
    return function () {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mockHeatFilterComponents() {
    var components = [];
    if (filterState.query) {
      components.push("query:" + filterState.query.toLowerCase());
    }
    if (filterState.theme) {
      components.push("theme:" + filterState.theme);
    }
    if (filterState.timeActive) {
      components.push("time:" + timelineFilterSignature());
    }
    if (filterState.source) {
      components.push("source:" + filterState.source);
    }
    if (filterState.publicationStartYear != null && filterState.publicationEndYear != null) {
      components.push("publication:" + filterState.publicationStartYear + ":" + filterState.publicationEndYear);
    }
    return components;
  }

  function loadReferenceHeatImage() {
    if (referenceHeatImagePromise) {
      return referenceHeatImagePromise;
    }
    referenceHeatImagePromise = new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        resolve(image);
      };
      image.onerror = function () {
        reject(new Error("全球 mock 热力纹理加载失败"));
      };
      image.src = MOCK_DENSITY_URL;
    });
    return referenceHeatImagePromise;
  }

  async function filteredReferenceHeatUrl() {
    var components = mockHeatFilterComponents();
    if (!components.length) {
      return MOCK_DENSITY_URL;
    }
    var signature = components.join("|");
    if (filteredReferenceHeatCache[signature]) {
      return filteredReferenceHeatCache[signature];
    }

    var image = await loadReferenceHeatImage();
    var canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || 3600;
    canvas.height = image.naturalHeight || 1800;
    var context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    var mask = renderMockFilterMask(components, signature);
    context.save();
    context.globalCompositeOperation = "destination-in";
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(mask, 0, 0, canvas.width, canvas.height);
    context.restore();

    var dataUrl = canvas.toDataURL("image/png");
    filteredReferenceHeatCache[signature] = dataUrl;
    filteredReferenceHeatOrder.push(signature);
    while (filteredReferenceHeatOrder.length > 4) {
      delete filteredReferenceHeatCache[filteredReferenceHeatOrder.shift()];
    }
    return dataUrl;
  }

  function renderMockFilterMask(components, signature) {
    var canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 240;
    var context = canvas.getContext("2d");
    var image = context.createImageData(canvas.width, canvas.height);
    var data = image.data;
    var signatureSeed = stringHash(signature);
    var componentCount = components.length;
    var temporalComponent = components.find(function (component) {
      return component.indexOf("time:") === 0;
    });

    for (var y = 0; y < canvas.height; y += 1) {
      var latitude = 90 - (y + 0.5) / canvas.height * 180;
      for (var x = 0; x < canvas.width; x += 1) {
        var longitude = (x + 0.5) / canvas.width * 360 - 180;
        var total = 0;
        var minimum = 1;
        var maximum = 0;
        components.forEach(function (component, componentIndex) {
          var affinity = mockSpatialAffinity(longitude, latitude, component, componentIndex);
          total += affinity;
          minimum = Math.min(minimum, affinity);
          maximum = Math.max(maximum, affinity);
        });
        var average = total / componentCount;
        var signatureHubs = mockHubAffinity(
          longitude,
          latitude,
          signatureSeed ^ 0x2c9277b5
        );
        var combined = average * 0.28 + minimum * 0.02 + maximum * 0.18 + signatureHubs * 0.52;
        if (temporalComponent) {
          var temporalAffinity = mockSpatialAffinity(
            longitude,
            latitude,
            temporalComponent,
            componentCount + 2
          );
          combined = combined * 0.68 + temporalAffinity * 0.32;
        }
        var microVariation = valueNoise(
          (longitude + 180) / 4.8,
          (latitude + 90) / 4.8,
          signatureSeed ^ 0x4f1bbcdc
        );
        var macroVariation = valueNoise(
          (longitude + 180) / 21,
          (latitude + 90) / 21,
          signatureSeed ^ 0x6174a3c9
        );
        combined = combined * 0.78 + microVariation * 0.09 + macroVariation * 0.13;

        var lower = 0.24 + Math.min(0.08, (componentCount - 1) * 0.018);
        var retained = smoothStep(lower, 0.6, combined);
        var floorAlpha = Math.max(0.035, 0.08 - (componentCount - 1) * 0.012);
        var peakAlpha = Math.max(0.46, 0.82 - (componentCount - 1) * 0.1);
        var alpha = floorAlpha + Math.pow(retained, 0.82) * (peakAlpha - floorAlpha);
        var offset = (y * canvas.width + x) * 4;
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = Math.round(alpha * 255);
      }
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  function mockSpatialAffinity(longitude, latitude, component, componentIndex) {
    var seed = stringHash(component);
    var detailScale = 8 + (seed % 8) + componentIndex * 0.7;
    var broadScale = 27 + ((seed >>> 7) % 18);
    var detail = valueNoise(
      (longitude + 180) / detailScale,
      (latitude + 90) / detailScale,
      seed
    );
    var broad = valueNoise(
      (longitude + 180) / broadScale,
      (latitude + 90) / broadScale,
      seed ^ 0x7f4a7c15
    );
    var hubs = mockHubAffinity(longitude, latitude, seed);
    var wave = 0.5 + 0.5 * Math.sin(
      Cesium.Math.toRadians(longitude * (0.65 + (seed % 5) * 0.12) + (seed % 360))
    ) * Math.cos(
      Cesium.Math.toRadians(latitude * (1.1 + ((seed >>> 4) % 4) * 0.18))
    );
    return clamp(detail * 0.3 + broad * 0.17 + hubs * 0.47 + wave * 0.06, 0, 1);
  }

  function mockHubAffinity(longitude, latitude, seed) {
    var maximum = 0;
    MOCK_HEAT_HUBS.forEach(function (hub, index) {
      var hubNoise = gridNoise(index, seed & 255, seed);
      if (hubNoise < 0.68) {
        return;
      }
      var longitudeDelta = Math.abs(longitude - hub[0]);
      longitudeDelta = Math.min(longitudeDelta, 360 - longitudeDelta);
      longitudeDelta *= Math.max(0.28, Math.cos(Cesium.Math.toRadians((latitude + hub[1]) * 0.5)));
      var latitudeDelta = latitude - hub[1];
      var radius = 11 + gridNoise(index, 17, seed ^ 0x1f123bb5) * 9;
      var distanceSquared = longitudeDelta * longitudeDelta + latitudeDelta * latitudeDelta;
      var strength = 0.78 + hubNoise * 0.22;
      maximum = Math.max(maximum, Math.exp(-distanceSquared / (2 * radius * radius)) * strength);
    });
    return maximum;
  }

  function valueNoise(x, y, seed) {
    var x0 = Math.floor(x);
    var y0 = Math.floor(y);
    var tx = x - x0;
    var ty = y - y0;
    var sx = tx * tx * (3 - 2 * tx);
    var sy = ty * ty * (3 - 2 * ty);
    var top = lerp(gridNoise(x0, y0, seed), gridNoise(x0 + 1, y0, seed), sx);
    var bottom = lerp(gridNoise(x0, y0 + 1, seed), gridNoise(x0 + 1, y0 + 1, seed), sx);
    return lerp(top, bottom, sy);
  }

  function gridNoise(x, y, seed) {
    var value = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + (seed | 0);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  }

  function lerp(start, end, ratio) {
    return start + (end - start) * ratio;
  }

  function smoothStep(edge0, edge1, value) {
    var ratio = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
    return ratio * ratio * (3 - 2 * ratio);
  }

  function createTransparentHeatCanvas(bounds) {
    var canvas = document.createElement("canvas");
    var longitudeSpan = Math.max(0.001, bounds[2] - bounds[0]);
    var latitudeSpan = Math.max(0.001, bounds[3] - bounds[1]);
    canvas.width = 4;
    canvas.height = Math.max(2, Math.round(canvas.width * latitudeSpan / longitudeSpan));
    return canvas;
  }

  function datasetFilterParameters() {
    var parameters = new URLSearchParams();
    if (filterState.query) {
      parameters.set("query", filterState.query);
    }
    if (filterState.theme) {
      parameters.set("theme", filterState.theme);
    }
    if (filterState.paperTheme) {
      parameters.set("paper_theme", filterState.paperTheme);
    }
    if (filterState.source) {
      parameters.set("source", filterState.source);
    }
    if (filterState.publicationStartYear != null && filterState.publicationEndYear != null) {
      parameters.set("publication_start_year", String(filterState.publicationStartYear));
      parameters.set("publication_end_year", String(filterState.publicationEndYear));
    }
    var temporal = publicTemporalFilter();
    if (temporal) {
      parameters.set("temporal_scope", temporal.scope || temporal.mode || "");
      if (temporal.scope === "human") {
        parameters.set("start_year", String(temporal.startYear));
        parameters.set("end_year", String(temporal.endYear));
      }
    }
    return parameters;
  }

  function realHeatRequestUrl(bounds) {
    var parameters = datasetFilterParameters();
    parameters.set("render", "coverage-v24");
    parameters.set("format", "webp");
    parameters.set("level", state.level);
    parameters.set("h3_grid", h3GridVisible ? "1" : "0");
    parameters.set("bounds", bounds.map(function (value) { return Number(value).toFixed(5); }).join(","));
    // 缓存版本号随版本更新变化，避免浏览器沿用旧版低分辨率热力图缓存。
    parameters.set("v", HEAT_CACHE_VERSION);
    return "./api/dataset-heat?" + parameters.toString();
  }

  async function loadRealHeatImage(bounds, token, sourceToken) {
    if (heatRequestController) {
      heatRequestController.abort();
    }
    heatRequestController = new AbortController();
    var startedAt = performance.now();
    var response = await fetch(realHeatRequestUrl(bounds), {
      signal: heatRequestController.signal,
      cache: "default"
    });
    if (!response.ok) {
      var detail = await response.json().catch(function () { return {}; });
      throw new Error(detail.error || "热力图请求失败: " + response.status);
    }
    var blob = await response.blob();
    if (token !== heatToken || sourceToken !== loadToken) {
      throw new DOMException("Heat request superseded", "AbortError");
    }
    var metrics = {
      datasets: Number(response.headers.get("X-Heat-Datasets")) || 0,
      globalDatasets: Number(response.headers.get("X-Heat-Global-Datasets")) || 0,
      resolution: Number(response.headers.get("X-Heat-Resolution")) || null,
      renderMs: Number(response.headers.get("X-Heat-Render-Ms")) || 0,
      transferMs: Math.round((performance.now() - startedAt) * 10) / 10,
      cache: response.headers.get("X-Heat-Cache") || ""
    };
    var h3Resolution = Number(response.headers.get("X-H3-Resolution"));
    var h3Area = Number(response.headers.get("X-H3-Cell-Area-Km2"));
    metrics.h3Resolution = Number.isFinite(h3Resolution) ? h3Resolution : null;
    metrics.h3CellAreaKm2 = Number.isFinite(h3Area) ? h3Area : null;
    currentH3Resolution = metrics.h3Resolution;
    updateH3ResolutionReadout(metrics.h3Resolution, metrics.h3CellAreaKm2);
    syncCityDatasetCoverageForGridMode();
    window.dispatchEvent(new CustomEvent("geoapp:heatupdated", { detail: metrics }));
    console.info("真实数据集热力图", metrics);
    return URL.createObjectURL(blob);
  }

  function updateH3ResolutionReadout(resolution, areaKm2) {
    var chip = document.getElementById("h3-resolution-chip");
    var value = document.getElementById("h3-resolution-value");
    if (!chip || !value || resolution == null || areaKm2 == null) {
      if (chip) {
        chip.classList.add("hidden");
      }
      return;
    }
    var areaLabel = areaKm2 >= 10
      ? Math.round(areaKm2).toLocaleString("zh-CN") + " km²"
      : areaKm2 >= 1
        ? areaKm2.toFixed(1) + " km²"
        : areaKm2 >= 0.1
          ? areaKm2.toFixed(2) + " km²"
          : Math.round(areaKm2 * 1000000).toLocaleString("zh-CN") + " m²";
    value.textContent = "H3 R" + resolution + " · " + areaLabel;
    chip.classList.remove("hidden");
  }

  async function updateContinuousHeatLayer(bounds, sourceToken, canvas, heatMode, cachedImageUrl) {
    var token = ++heatToken;
    if (token !== heatToken || sourceToken !== loadToken || !viewer || viewer.isDestroyed()) {
      return;
    }
    var useRealHeat = heatMode === "real";
    var completed = false;
    if (useRealHeat) {
      adaptiveHeatBoundsSignature = adaptiveHeatSignature(bounds);
      adaptiveHeatRequestInFlight = true;
    }
    var layerBounds = bounds;
    var imageUrl = cachedImageUrl || canvas.toDataURL("image/png");
    var objectUrl = null;
    try {
      if (useRealHeat) {
        objectUrl = await loadRealHeatImage(bounds, token, sourceToken);
        imageUrl = objectUrl;
      }
      if (token !== heatToken || sourceToken !== loadToken || !viewer || viewer.isDestroyed()) {
        return;
      }
      var provider;
      try {
        provider = await Cesium.SingleTileImageryProvider.fromUrl(imageUrl, {
          rectangle: Cesium.Rectangle.fromDegrees(layerBounds[0], layerBounds[1], layerBounds[2], layerBounds[3])
        });
      } finally {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
      }
      if (token !== heatToken || sourceToken !== loadToken || !viewer || viewer.isDestroyed()) {
        return;
      }
      var previousHeatLayer = heatLayer && !heatLayer.isDestroyed() ? heatLayer : null;
      var previousAlpha = previousHeatLayer ? previousHeatLayer.alpha : 0;
      heatLayer = viewer.imageryLayers.addImageryProvider(provider);
      heatLayer.h3Resolution = (currentH3Resolution != null && Number.isFinite(Number(currentH3Resolution)))
        ? Number(currentH3Resolution)
        : null;
      if (previousHeatLayer) {
        heatLayer.previousH3Resolution = (
          previousHeatLayer.h3Resolution != null &&
          Number.isFinite(Number(previousHeatLayer.h3Resolution))
        )
          ? Number(previousHeatLayer.h3Resolution)
          : heatLayer.h3Resolution;
      }
      var defaultAlpha = useRealHeat
        ? heatLayer.h3Resolution >= 10
          ? 0.34
          : heatLayer.h3Resolution >= 9
            ? 0.40
          : heatLayer.h3Resolution >= 8
            ? 0.46
            : 0.72
        : 0.94;
      completed = true;
    } finally {
      if (useRealHeat) {
        adaptiveHeatRequestInFlight = false;
        // 若该请求仍是"最新"（没有被更新的请求接管）却提前返回或抛错，
        // 清空签名，让下一次相机稳定后的刷新能自动重新发起，而不是卡在
        // 已失效的签名上导致热力图一直不出（需重新缩放才恢复）。
        if (!completed && token === heatToken && sourceToken === loadToken) {
          adaptiveHeatBoundsSignature = "";
        }
      }
    }
    var filterCount = activeFilterCount();
    var targetAlpha = filterCount
      ? Math.max(0.42, defaultAlpha - 0.24 - (filterCount - 1) * 0.11)
      : defaultAlpha;
    heatLayer.geoHeatStyle = {
      alpha: targetAlpha,
      brightness: useRealHeat ? 1.06 : 1.1,
      contrast: useRealHeat ? 1.12 : 1.18,
      saturation: useRealHeat ? 1.12 : 1.2,
      reference: false
    };
    heatLayer.geoTransitionProgress = previousHeatLayer ? 0 : 1;
    applyHeatLayerCameraStyle(heatLayer);
    heatLayer.show = heatVisible && !isPaperTabSelected();
    viewer.imageryLayers.raiseToTop(heatLayer);
    applyTechBaseStyle();
    if (previousHeatLayer) {
      crossfadeHeatLayers(previousHeatLayer, heatLayer, previousAlpha, token);
    } else {
      viewer.scene.requestRender();
    }
  }

  function clearCurrentHeatLayer() {
    if (heatLayer && !heatLayer.isDestroyed() && viewer && !viewer.isDestroyed()) {
      viewer.imageryLayers.remove(heatLayer, true);
    }
    heatLayer = null;
    clearHeatSurface();
    if (viewer && !viewer.isDestroyed()) {
      viewer.scene.requestRender();
    }
  }

  function crossfadeHeatLayers(previousLayer, nextLayer, previousAlpha, token) {
    var startedAt = performance.now();
    var duration = 280;
    function frame(now) {
      if (!viewer || viewer.isDestroyed() || nextLayer.isDestroyed()) {
        return;
      }
      if (token !== heatToken || heatLayer !== nextLayer) {
        if (!previousLayer.isDestroyed() && previousLayer !== heatLayer) {
          viewer.imageryLayers.remove(previousLayer, true);
        }
        return;
      }
      var progress = smoothStep(0, 1, (now - startedAt) / duration);
      nextLayer.geoTransitionProgress = progress;
      applyHeatLayerCameraStyle(nextLayer);
      if (!previousLayer.isDestroyed()) {
        previousLayer.alpha = previousAlpha * (1 - progress);
      }
      viewer.scene.requestRender();
      if (progress < 1) {
        window.requestAnimationFrame(frame);
        return;
      }
      if (!previousLayer.isDestroyed()) {
        viewer.imageryLayers.remove(previousLayer, true);
      }
      nextLayer.geoTransitionProgress = 1;
      applyHeatLayerCameraStyle(nextLayer);
      viewer.scene.requestRender();
    }
    window.requestAnimationFrame(frame);
  }

  function updateHeatLayerForCamera() {
    if (!viewer || viewer.isDestroyed()) {
      return;
    }
    if (heatLayer && !heatLayer.isDestroyed()) {
      applyHeatLayerCameraStyle(heatLayer);
    }
  }

  function applyHeatLayerCameraStyle(layer) {
    if (!layer || layer.isDestroyed() || !viewer || viewer.isDestroyed()) {
      return;
    }
    var style = layer.geoHeatStyle;
    if (!style) {
      return;
    }
    var cartographic = viewer.camera.positionCartographic;
    var cameraHeight = cartographic ? cartographic.height : 0;
    var transitionProgress = layer.geoTransitionProgress == null ? 1 : layer.geoTransitionProgress;
    // 稳态（非过渡动画）、同一图层且相机高度几乎没变化时，样式无需重算，
    // 跳过属性写入，避免相机惯性微动/原地旋转时每帧反复设置影像图层属性。
    // 新生成的图层（heatCameraStyleLayer 不同）必须重新写入样式，否则会沿用
    // Cesium 默认 alpha=1 导致深放大时六边形糊满盖住底图。
    if (heatCameraStyleLayer === layer && transitionProgress >= 1 &&
        heatCameraStyleLastProgress === 1 &&
        heatCameraStyleLastHeight != null &&
        Math.abs(cameraHeight - heatCameraStyleLastHeight) < Math.max(40000, cameraHeight * 0.003)) {
      return;
    }
    heatCameraStyleLayer = layer;
    heatCameraStyleLastHeight = cameraHeight;
    heatCameraStyleLastProgress = transitionProgress;
    var farFactor = smoothStep(15000000, 48000000, cameraHeight);
    var referenceFactor = style.reference ? 1 : 0.85;
    var alpha = clamp(style.alpha + farFactor * 0.06 * referenceFactor, 0, 1);
    var deepZoomAlphaCap = 0.40 + smoothStep(3000000, 9000000, cameraHeight) * 0.32;
    layer.alpha = Math.min(alpha, deepZoomAlphaCap) * transitionProgress;
    layer.brightness = style.brightness + farFactor * 0.16 * referenceFactor;
    layer.contrast = style.contrast + farFactor * 0.09 * referenceFactor;
    layer.saturation = style.saturation + farFactor * 0.06 * referenceFactor;
  }

  function updateHeatSurface(bounds, canvas, imageUrl) {
    if (!heatSurfaceRoot) {
      return;
    }
    if (heatSurfacePrimitive) {
      heatSurfaceRoot.remove(heatSurfacePrimitive);
      heatSurfacePrimitive = null;
    }
    var geometry = createHeatSurfaceGeometry(bounds, canvas);
    var material = Cesium.Material.fromType("Image", {
      image: imageUrl || canvas.toDataURL("image/png"),
      transparent: true
    });
    heatSurfacePrimitive = heatSurfaceRoot.add(new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry: geometry }),
      appearance: new Cesium.MaterialAppearance({
        material: material,
        materialSupport: Cesium.MaterialAppearance.MaterialSupport.TEXTURED,
        flat: true,
        faceForward: true,
        translucent: true,
        closed: false,
        renderState: {
          depthTest: { enabled: true },
          depthMask: false,
          blending: Cesium.BlendingState.ALPHA_BLEND,
          cull: { enabled: false }
        }
      }),
      asynchronous: false,
      allowPicking: false
    }));
    heatSurfaceRoot.show = heatVisible && !isPaperTabSelected();
    viewer.scene.requestRender();
  }

  function clearHeatSurface() {
    if (heatSurfaceRoot && heatSurfacePrimitive) {
      heatSurfaceRoot.remove(heatSurfacePrimitive);
      heatSurfacePrimitive = null;
    }
  }

  function createHeatSurfaceGeometry(bounds, canvas) {
    var longitudeSpan = Math.max(0.001, bounds[2] - bounds[0]);
    var latitudeSpan = Math.max(0.001, bounds[3] - bounds[1]);
    var columns = state.level === "country" ? 216 : 152;
    var rows = Math.round(clamp(columns * latitudeSpan / longitudeSpan, 56, 112));
    var vertexCount = (columns + 1) * (rows + 1);
    var positions = new Float64Array(vertexCount * 3);
    var textureCoordinates = new Float32Array(vertexCount * 2);
    var vertexIntensities = new Float32Array(vertexCount);
    var context = canvas.getContext("2d", { willReadFrequently: true });
    var heatPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    var maximumHeight = state.level === "country" ? 90000 : state.level === "province" ? 42000 : 16000;
    var baseHeight = state.level === "country" ? 3600 : state.level === "province" ? 1800 : 850;
    var positionIndex = 0;
    var textureIndex = 0;

    for (var row = 0; row <= rows; row += 1) {
      var v = row / rows;
      var latitude = bounds[1] + latitudeSpan * v;
      var pixelY = Math.round((1 - v) * (canvas.height - 1));
      for (var column = 0; column <= columns; column += 1) {
        var u = column / columns;
        var longitude = bounds[0] + longitudeSpan * u;
        var pixelX = Math.round(u * (canvas.width - 1));
        var pixelOffset = (pixelY * canvas.width + pixelX) * 4;
        var intensity = heatPixels[pixelOffset + 3] / 255;
        vertexIntensities[row * (columns + 1) + column] = intensity;
        var height = baseHeight + Math.pow(intensity, 1.18) * maximumHeight;
        var position = Cesium.Cartesian3.fromDegrees(longitude, latitude, height);
        positions[positionIndex++] = position.x;
        positions[positionIndex++] = position.y;
        positions[positionIndex++] = position.z;
        textureCoordinates[textureIndex++] = u;
        textureCoordinates[textureIndex++] = v;
      }
    }

    var indexValues = [];
    for (var gridRow = 0; gridRow < rows; gridRow += 1) {
      for (var gridColumn = 0; gridColumn < columns; gridColumn += 1) {
        var lowerLeft = gridRow * (columns + 1) + gridColumn;
        var lowerRight = lowerLeft + 1;
        var upperLeft = lowerLeft + columns + 1;
        var upperRight = upperLeft + 1;
        indexValues.push(lowerLeft, lowerRight, upperRight, lowerLeft, upperRight, upperLeft);
      }
    }
    var indices = new Uint16Array(indexValues);

    var geometry = new Cesium.Geometry({
      attributes: {
        position: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.DOUBLE,
          componentsPerAttribute: 3,
          values: positions
        }),
        st: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
          componentsPerAttribute: 2,
          values: textureCoordinates
        })
      },
      indices: indices,
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(positions)
    });
    return Cesium.GeometryPipeline.computeNormal(geometry);
  }

  function renderHeatCanvas(points, bounds) {
    var canvas = document.createElement("canvas");
    var longitudeSpan = Math.max(0.001, bounds[2] - bounds[0]);
    var latitudeSpan = Math.max(0.001, bounds[3] - bounds[1]);
    canvas.width = 2048;
    canvas.height = Math.round(clamp(canvas.width * latitudeSpan / longitudeSpan, 1024, 2048));
    var context = canvas.getContext("2d", { willReadFrequently: true });
    context.globalCompositeOperation = "lighter";
    var maxWeight = points.reduce(function (max, point) {
      return Math.max(max, Number(point.weight) || 0);
    }, 1);
    points.forEach(function (point) {
      var x = (point.longitude - bounds[0]) / longitudeSpan * canvas.width;
      var y = (bounds[3] - point.latitude) / latitudeSpan * canvas.height;
      var strength = clamp((Number(point.weight) || 0) / maxWeight, 0.01, 1);
      var kind = point.kind || "core";
      var radius = Math.max(0.7, Number(point.radius) || (kind === "core" ? 8 : 1.5));
      if (kind === "core") {
        var gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        var coreAlpha = 0.055 + Math.pow(strength, 0.82) * 0.2;
        gradient.addColorStop(0, "rgba(255,255,255," + coreAlpha + ")");
        gradient.addColorStop(0.2, "rgba(255,255,255," + coreAlpha * 0.88 + ")");
        gradient.addColorStop(0.56, "rgba(255,255,255," + coreAlpha * 0.36 + ")");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = gradient;
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        return;
      }
      var pointAlpha = kind === "corridor"
        ? 0.025 + strength * 0.085
        : 0.035 + Math.pow(strength, 0.8) * 0.125;
      context.fillStyle = "rgba(255,255,255," + pointAlpha + ")";
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    });

    colorizeHeatCanvas(context, canvas.width, canvas.height);
    clearHeatCanvasEdges(context, canvas.width, canvas.height);
    return canvas;
  }

  function clearHeatCanvasEdges(context, width, height) {
    var horizontalEdge = Math.max(64, Math.round(width * 0.08));
    var verticalEdge = Math.max(64, Math.round(height * 0.08));
    context.save();
    context.globalCompositeOperation = "destination-in";
    var horizontalFade = context.createLinearGradient(0, 0, width, 0);
    horizontalFade.addColorStop(0, "rgba(0,0,0,0)");
    horizontalFade.addColorStop(horizontalEdge / width, "rgba(0,0,0,1)");
    horizontalFade.addColorStop(1 - horizontalEdge / width, "rgba(0,0,0,1)");
    horizontalFade.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = horizontalFade;
    context.fillRect(0, 0, width, height);
    var verticalFade = context.createLinearGradient(0, 0, 0, height);
    verticalFade.addColorStop(0, "rgba(0,0,0,0)");
    verticalFade.addColorStop(verticalEdge / height, "rgba(0,0,0,1)");
    verticalFade.addColorStop(1 - verticalEdge / height, "rgba(0,0,0,1)");
    verticalFade.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = verticalFade;
    context.fillRect(0, 0, width, height);
    context.restore();
  }

  function colorizeHeatCanvas(context, width, height) {
    var image = context.getImageData(0, 0, width, height);
    var data = image.data;
    var lookup = heatColorLookup();
    var maximumAlpha = 1;
    for (var alphaIndex = 3; alphaIndex < data.length; alphaIndex += 4) {
      maximumAlpha = Math.max(maximumAlpha, data[alphaIndex]);
    }
    for (var index = 0; index < data.length; index += 4) {
      var intensity = Math.min(255, Math.round(data[index + 3] / maximumAlpha * 255));
      if (intensity < 10) {
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
        data[index + 3] = 0;
        continue;
      }
      var lookupIndex = intensity * 4;
      data[index] = lookup[lookupIndex];
      data[index + 1] = lookup[lookupIndex + 1];
      data[index + 2] = lookup[lookupIndex + 2];
      data[index + 3] = lookup[lookupIndex + 3];
    }
    context.globalCompositeOperation = "source-over";
    context.putImageData(image, 0, 0);
  }

  function heatColorLookup() {
    if (heatColorLookup.cache) {
      return heatColorLookup.cache;
    }
    var stops = [
      { at: 0, color: [44, 61, 190, 0] },
      { at: 0.08, color: [45, 91, 235, 48] },
      { at: 0.2, color: [22, 162, 255, 110] },
      { at: 0.38, color: [0, 234, 245, 190] },
      { at: 0.58, color: [70, 235, 154, 225] },
      { at: 0.78, color: [255, 222, 74, 242] },
      { at: 0.93, color: [255, 116, 38, 250] },
      { at: 1, color: [244, 45, 54, 255] }
    ];
    var lookup = new Uint8ClampedArray(256 * 4);
    for (var value = 0; value < 256; value += 1) {
      var ratio = value / 255;
      var upperIndex = 1;
      while (upperIndex < stops.length - 1 && ratio > stops[upperIndex].at) {
        upperIndex += 1;
      }
      var lower = stops[upperIndex - 1];
      var upper = stops[upperIndex];
      var localRatio = (ratio - lower.at) / (upper.at - lower.at || 1);
      for (var channel = 0; channel < 4; channel += 1) {
        lookup[value * 4 + channel] = Math.round(
          lower.color[channel] + (upper.color[channel] - lower.color[channel]) * localRatio
        );
      }
    }
    heatColorLookup.cache = lookup;
    return lookup;
  }

  function schedulePaperDistributionRefresh() {
    syncMapExpressionForActiveTab();
  }

  function currentHeatBounds(fallbackBounds) {
    var scope = Array.isArray(fallbackBounds) && fallbackBounds.length === 4
      ? fallbackBounds.map(Number)
      : currentMarkerSource && Array.isArray(currentMarkerSource.heatBounds)
        ? currentMarkerSource.heatBounds.map(Number)
        : null;
    if (state.level === "city") {
      var sampledBounds = sampledCameraGroundBounds();
      if (sampledBounds) {
        return intersectViewBounds(sampledBounds, scope) || sampledBounds;
      }
    }
    var rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (rectangle) {
      var west = Cesium.Math.toDegrees(rectangle.west);
      var south = clamp(Cesium.Math.toDegrees(rectangle.south), -90, 90);
      var east = Cesium.Math.toDegrees(rectangle.east);
      var north = clamp(Cesium.Math.toDegrees(rectangle.north), -90, 90);
      var longitudeSpan = east >= west ? east - west : east + 360 - west;
      var latitudeSpan = north - south;
      if ([west, south, east, north].every(Number.isFinite) &&
          longitudeSpan >= 0.0001 && latitudeSpan >= 0.0001) {
        // 跨 180° 经线时 west > east，后端校验 -180<=west<east<=180 会 400，
        // 前端无限重试导致热力图空白。这里回退到数据源范围或全球范围。
        if (west > east) {
          if (scope && scope[0] <= scope[2] && scope[1] < scope[3]) {
            return scope;
          }
          return [-180, -90, 180, 90];
        }
        if (state.level !== "country" && scope && west <= east) {
          if (viewCoversMostOfScope(longitudeSpan, latitudeSpan, scope)) {
            return scope;
          }
          west = Math.max(west, scope[0]);
          south = Math.max(south, scope[1]);
          east = Math.min(east, scope[2]);
          north = Math.min(north, scope[3]);
          if (west < east && south < north) {
            return [west, south, east, north];
          }
          return scope;
        }
        if (state.level === "country" && scope &&
            viewCoversMostOfScope(longitudeSpan, latitudeSpan, scope)) {
          return scope;
        }
        return [west, south, east, north];
      }
    }
    if (scope) {
      return scope;
    }
    return [-180, -90, 180, 90];
  }

  function viewCoversMostOfScope(longitudeSpan, latitudeSpan, scope) {
    if (!Array.isArray(scope) || scope.length !== 4) {
      return false;
    }
    var scopeLongitudeSpan = Math.max(0.0001, scope[2] - scope[0]);
    var scopeLatitudeSpan = Math.max(0.0001, scope[3] - scope[1]);
    return longitudeSpan >= scopeLongitudeSpan * 0.75 &&
           latitudeSpan >= scopeLatitudeSpan * 0.75;
  }

  function sampledCameraGroundBounds() {
    if (!viewer || viewer.isDestroyed()) {
      return null;
    }
    var canvas = viewer.scene.canvas;
    var xRatios = [0.04, 0.5, 0.96];
    var yRatios = [0.04, 0.5, 0.96];
    var coordinates = [];
    yRatios.forEach(function (yRatio) {
      xRatios.forEach(function (xRatio) {
        var coordinate = cartographicAtScreen(new Cesium.Cartesian2(
          canvas.clientWidth * xRatio,
          canvas.clientHeight * yRatio
        ));
        if (coordinate) {
          coordinates.push(coordinate);
        }
      });
    });
    if (coordinates.length >= 2) {
      var bounds = coordinates.reduce(function (result, coordinate) {
        result[0] = Math.min(result[0], coordinate.longitude);
        result[1] = Math.min(result[1], coordinate.latitude);
        result[2] = Math.max(result[2], coordinate.longitude);
        result[3] = Math.max(result[3], coordinate.latitude);
        return result;
      }, [180, 90, -180, -90]);
      if (bounds[2] - bounds[0] < 20 && bounds[3] - bounds[1] < 20) {
        return bounds;
      }
    }
    var focus = cameraFocusCoordinate();
    if (!focus) {
      return null;
    }
    var cameraHeightValue = viewer.camera.positionCartographic ?
      viewer.camera.positionCartographic.height : 0;
    var height = Math.max(1000, Number(cameraHeightValue) || 1000);
    var latitudeSpan = clamp(height / 85000, 0.006, 4);
    var aspect = Math.max(0.5, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    var longitudeScale = Math.max(0.2, Math.cos(Cesium.Math.toRadians(focus.latitude)));
    var longitudeSpan = latitudeSpan * aspect / longitudeScale;
    return [
      clamp(focus.longitude - longitudeSpan * 0.5, -180, 180),
      clamp(focus.latitude - latitudeSpan * 0.5, -89.9, 89.9),
      clamp(focus.longitude + longitudeSpan * 0.5, -180, 180),
      clamp(focus.latitude + latitudeSpan * 0.5, -89.9, 89.9)
    ];
  }

  function intersectViewBounds(bounds, scope) {
    if (!scope || bounds[0] > bounds[2] || scope[0] > scope[2]) {
      return null;
    }
    var result = [
      Math.max(bounds[0], scope[0]),
      Math.max(bounds[1], scope[1]),
      Math.min(bounds[2], scope[2]),
      Math.min(bounds[3], scope[3])
    ];
    return result[0] < result[2] && result[1] < result[3] ? result : null;
  }

  function updatePointOverlays(bounds) {
    var data = suppliedPointData || mockPointData();
    var datasets = data.datasets.filter(function (point) {
      return pointInsideBounds(point, bounds);
    });
    var papers = data.papers.filter(function (point) {
      return pointInsideBounds(point, bounds);
    });
    var visibleById = {};
    datasets.concat(papers).forEach(function (point) {
      visibleById[point.id] = point;
    });
    var links = data.links.filter(function (link) {
      return visibleById[link.sourceId] && visibleById[link.targetId];
    });

    flightLineCollection.removeAll();
    flightTrailCollection.removeAll();
    flightParticleCollection.removeAll();
    pointBillboardCollection.removeAll();
    pulseStates = [];
    flightParticleStates = [];
    populateFlightPrimitives(links, visibleById);
    datasets.forEach(function (point, index) {
      addPointMarker(point, "dataset", index);
    });
    papers.forEach(function (point, index) {
      addPointMarker(point, "paper", datasets.length + index);
    });
    pointBillboardCollection.show = pointVisible;
    flightLineCollection.show = flightVisible;
    flightTrailCollection.show = flightVisible;
    flightParticleCollection.show = flightVisible;
  }

  function addPointMarker(point, type, index) {
    var meta = {
      id: point.id,
      name: point.name,
      type: type,
      count: Math.max(1, Number(point.count) || 1),
      paperIds: Array.isArray(point.paperIds) ? point.paperIds.slice() : [],
      longitude: point.longitude,
      latitude: point.latitude
    };
    var position = Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, 4200);
    if (type === "dataset") {
      var pulseBillboard = pointBillboardCollection.add({
        position: position,
        image: pointSymbolImage("pulse"),
        width: 34,
        height: 34,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: 0,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, levelDistanceLimit()),
        id: { pointMeta: meta }
      });
      pulseStates.push({ billboard: pulseBillboard, phase: index * 0.137 });
    }
    var size = type === "paper"
      ? 19 + Math.min(7, Math.log2(meta.count + 1) * 1.8)
      : 19 + Math.min(5, Math.log2(meta.count + 1) * 1.5);
    pointBillboardCollection.add({
      position: position,
      image: pointSymbolImage(type),
      width: size,
      height: size,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      disableDepthTestDistance: 0,
      scaleByDistance: new Cesium.NearFarScalar(10000, 1.28, 25000000, 0.82),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
        0, type === "paper" ? paperPointDistanceLimit() : levelDistanceLimit()
      ),
      id: { pointMeta: meta }
    });
  }

  function pointSymbolImage(type) {
    if (pointImageCache[type]) {
      return pointImageCache[type];
    }
    var canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    var context = canvas.getContext("2d");
    if (type === "pulse") {
      context.beginPath();
      context.arc(48, 48, 27, 0, Math.PI * 2);
      context.lineWidth = 4;
      context.strokeStyle = "rgba(99, 216, 207, 0.72)";
      context.stroke();
    } else if (type === "paper") {
      var paperGlow = context.createRadialGradient(48, 48, 5, 48, 48, 35);
      paperGlow.addColorStop(0, "rgba(255, 122, 112, 0.86)");
      paperGlow.addColorStop(0.48, "rgba(255, 122, 112, 0.28)");
      paperGlow.addColorStop(1, "rgba(255, 122, 112, 0)");
      context.fillStyle = paperGlow;
      context.fillRect(10, 10, 76, 76);
      context.beginPath();
      context.arc(48, 48, 17, 0, Math.PI * 2);
      context.fillStyle = "#ff7a70";
      context.fill();
      context.lineWidth = 4;
      context.strokeStyle = "rgba(255, 224, 220, 0.92)";
      context.stroke();
      context.beginPath();
      context.arc(48, 48, 24, 0, Math.PI * 2);
      context.lineWidth = 2;
      context.strokeStyle = "rgba(255, 122, 112, 0.58)";
      context.stroke();
    } else {
      var datasetGlow = context.createRadialGradient(48, 48, 4, 48, 48, 36);
      datasetGlow.addColorStop(0, "rgba(99, 216, 207, 0.8)");
      datasetGlow.addColorStop(0.46, "rgba(79, 190, 186, 0.25)");
      datasetGlow.addColorStop(1, "rgba(79, 190, 186, 0)");
      context.fillStyle = datasetGlow;
      context.fillRect(9, 9, 78, 78);
      context.beginPath();
      context.arc(48, 48, 17, 0, Math.PI * 2);
      context.fillStyle = "#63d8cf";
      context.fill();
      context.lineWidth = 4;
      context.strokeStyle = "rgba(191, 239, 237, 0.82)";
      context.stroke();
      context.beginPath();
      context.arc(48, 48, 5, 0, Math.PI * 2);
      context.fillStyle = "rgba(225, 255, 252, 0.88)";
      context.fill();
    }
    pointImageCache[type] = canvas;
    return canvas;
  }

  function populateFlightPrimitives(links, pointsById) {
    var epoch = performance.now();
    links.forEach(function (link, linkIndex) {
      var start = pointsById[link.sourceId];
      var end = pointsById[link.targetId];
      var arc = flightArcPositions(start, end, linkIndex);
      if (arc.positions.length < 2) {
        return;
      }
      var color = Cesium.Color.fromCssColorString(link.color || FLIGHT_COLORS[linkIndex % FLIGHT_COLORS.length]);
      var weight = clamp(Number(link.weight) || 0.42, 0.2, 1);
      var globalLongRange = state.level === "country" && arc.distance > 1200000;
      flightLineCollection.add({
        positions: arc.positions,
        width: (globalLongRange ? 1.55 : 1.2) + weight * 0.32,
        material: Cesium.Material.fromType("PolylineGlow", {
          color: color.withAlpha((globalLongRange ? 0.19 : 0.14) + weight * 0.08),
          glowPower: globalLongRange ? 0.3 : 0.25,
          taperPower: 0.62
        }),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, levelDistanceLimit())
      });
      flightLineCollection.add({
        positions: arc.positions,
        width: (globalLongRange ? 0.72 : 0.56) + weight * 0.16,
        material: Cesium.Material.fromType("Color", {
          color: color.withAlpha(0.28 + weight * 0.12)
        }),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, levelDistanceLimit())
      });
      addFlightParticle(
        arc.positions,
        color,
        epoch,
        arc.duration,
        (linkIndex * 0.137) % 1,
        weight
      );
    });
  }

  function flightArcPositions(start, end, linkIndex) {
    var startCartographic = Cesium.Cartographic.fromDegrees(start.longitude, start.latitude);
    var endCartographic = Cesium.Cartographic.fromDegrees(end.longitude, end.latitude);
    var geodesic = new Cesium.EllipsoidGeodesic(startCartographic, endCartographic);
    var distance = geodesic.surfaceDistance;
    var segments = Math.round(clamp(distance / 130000, 20, 72));
    var fanOffset = ((linkIndex % 5) - 2) * 0.012;
    var minimumHeight = state.level === "country" ? 12000 : state.level === "province" ? 5000 : 1200;
    var maximumHeight = state.level === "country" ? 1300000 : state.level === "province" ? 360000 : 90000;
    var peakHeight = clamp(distance * (0.08 + fanOffset), minimumHeight, maximumHeight);
    var positions = [];
    for (var index = 0; index <= segments; index += 1) {
      var fraction = index / segments;
      var cartographic = geodesic.interpolateUsingFraction(fraction);
      var height = 4500 + Math.sin(Math.PI * fraction) * peakHeight;
      positions.push(Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, height));
    }
    return {
      positions: positions,
      distance: distance,
      duration: clamp(1800 + distance / 2800, 2000, 5200)
    };
  }

  function addFlightParticle(positions, color, epoch, duration, phase, weight) {
    var trail = flightTrailCollection.add({
      positions: [positions[0], positions[0]],
      width: 0.68 + weight * 0.34,
      material: Cesium.Material.fromType("PolylineGlow", {
        color: color.withAlpha(0.52),
        glowPower: 0.28,
        taperPower: 0.72
      }),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, levelDistanceLimit())
    });
    var primitive = flightParticleCollection.add({
      position: positions[0],
      pixelSize: 2 + weight * 0.55,
      color: color.withAlpha(0.76),
      outlineColor: color.withAlpha(0.36),
      outlineWidth: 1,
      disableDepthTestDistance: 0,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, levelDistanceLimit())
    });
    flightParticleStates.push({
      primitive: primitive,
      trail: trail,
      color: color,
      positions: positions,
      epoch: epoch,
      duration: duration,
      phase: phase,
      scratch: new Cesium.Cartesian3()
    });
  }

  function animatePointOverlays() {
    var now = performance.now();
    updatePaperLocationFrontFacing();
    if (cameraMoving) {
      return;
    }
    updateRegionMarkerVisibility(now);
    if (pointVisible) {
      pulseStates.forEach(function (state) {
        var progress = (now / 1900 + state.phase) % 1;
        state.billboard.scale = 0.7 + progress * 0.95;
        state.billboard.color = Cesium.Color.WHITE.withAlpha((1 - progress) * 0.62);
      });
    }
    if (flightVisible) {
      flightParticleStates.forEach(function (state) {
        var progress = ((now - state.epoch) / state.duration + state.phase) % 1;
        var scaled = progress * (state.positions.length - 1);
        var index = Math.min(state.positions.length - 2, Math.floor(scaled));
        state.primitive.position = Cesium.Cartesian3.lerp(
          state.positions[index],
          state.positions[index + 1],
          scaled - index,
          state.scratch
        );
        var trailLength = Math.max(4, Math.round(state.positions.length * 0.12));
        var trailStart = Math.max(0, index - trailLength);
        var trailPositions = state.positions.slice(trailStart, index + 1);
        trailPositions.push(Cesium.Cartesian3.clone(state.primitive.position));
        if (trailPositions.length < 2) {
          trailPositions.unshift(state.positions[0]);
        }
        state.trail.positions = trailPositions;
      });
    }
  }

  function setRegionMarkerShown(markerState, shown) {
    // 只在状态变化时写入 show，避免每帧标记整个 billboard collection 为 dirty 而重复重建（闪现）。
    if (markerState.billboard.show !== shown) {
      markerState.billboard.show = shown;
    }
    markerState.shownByLayout = shown;
  }

  function updateRegionMarkerVisibility(now) {
    if (!viewer || viewer.isDestroyed() ||
        (!regionMarkerStates.length && !cityPaperLocationStates.length)) {
      return;
    }
    if (now && now - lastMarkerLayoutAt < 90) {
      return;
    }
    lastMarkerLayoutAt = now || performance.now();
    var cameraPosition = viewer.camera.positionWC;
    var horizonMargin = state.level === "country" ? 0.035 : 0.008;
    // 滞回带：已显示的圆点要更靠近背后才隐藏，已隐藏的要更明显面向相机才显示，
    // 避免相机惯性微动/缓慢旋转时，地球边缘的圆点反复闪现。
    var hideThreshold = Math.max(0.0, horizonMargin - 0.016);
    var candidates = [];
    regionMarkerStates.forEach(function (markerState) {
      Cesium.Cartesian3.subtract(cameraPosition, markerState.position, markerState.toCamera);
      Cesium.Cartesian3.normalize(markerState.toCamera, markerState.toCamera);
      var facing = Cesium.Cartesian3.dot(markerState.normal, markerState.toCamera);
      var previousFront = markerState.frontFacing;
      var isFrontFacing;
      if (previousFront == null) {
        isFrontFacing = facing > horizonMargin;
      } else if (previousFront) {
        isFrontFacing = facing > hideThreshold;
      } else {
        isFrontFacing = facing > horizonMargin;
      }
      markerState.frontFacing = isFrontFacing;
      var screenPosition = isFrontFacing
        ? Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, markerState.position, markerState.screenPosition)
        : null;
      if (!screenPosition) {
        setRegionMarkerShown(markerState, false);
        return;
      }
      candidates.push(markerState);
    });
    candidates.sort(function (left, right) {
      var leftActive = hoveredMeta && hoveredMeta.code === left.meta.code ||
        selectedMeta && selectedMeta.code === left.meta.code;
      var rightActive = hoveredMeta && hoveredMeta.code === right.meta.code ||
        selectedMeta && selectedMeta.code === right.meta.code;
      if (leftActive !== rightActive) {
        return leftActive ? -1 : 1;
      }
      return right.meta.count - left.meta.count;
    });

    var occupied = [];
    var cameraHeight = viewer.camera.positionCartographic ?
      viewer.camera.positionCartographic.height : 0;
    var overlapRatio = state.level === "country"
      ? countryMarkerOverlapRatio(cameraHeight)
      : state.level === "province"
        ? 0.76
        : 0.7;
    candidates.forEach(function (markerState) {
      var radius = Number(markerState.billboard.width) * 0.5;
      var forced = hoveredMeta && hoveredMeta.code === markerState.meta.code ||
        selectedMeta && selectedMeta.code === markerState.meta.code;
      if (forced) {
        setRegionMarkerShown(markerState, true);
        occupied.push({
          x: markerState.screenPosition.x,
          y: markerState.screenPosition.y,
          radius: radius
        });
        return;
      }
      var overlaps = occupied.some(function (placed) {
        var xDistance = placed.x - markerState.screenPosition.x;
        var yDistance = placed.y - markerState.screenPosition.y;
        var minimumDistance = (placed.radius + radius) * overlapRatio;
        return xDistance * xDistance + yDistance * yDistance < minimumDistance * minimumDistance;
      });
      if (!overlaps) {
        setRegionMarkerShown(markerState, true);
        occupied.push({
          x: markerState.screenPosition.x,
          y: markerState.screenPosition.y,
          radius: radius
        });
        return;
      }
      // 滞回：当前已显示的圆点，只有重叠明显更严重时才隐藏；
      // 当前已隐藏的圆点，需要空间明显空出才重新显示，避免阈值附近来回切换（闪现）。
      if (markerState.shownByLayout) {
        var tightOverlaps = occupied.some(function (placed) {
          var xDistance = placed.x - markerState.screenPosition.x;
          var yDistance = placed.y - markerState.screenPosition.y;
          var minimumDistance = (placed.radius + radius) * overlapRatio * 0.68;
          return xDistance * xDistance + yDistance * yDistance < minimumDistance * minimumDistance;
        });
        if (!tightOverlaps) {
          setRegionMarkerShown(markerState, true);
          occupied.push({
            x: markerState.screenPosition.x,
            y: markerState.screenPosition.y,
            radius: radius
          });
          return;
        }
      }
      setRegionMarkerShown(markerState, false);
    });

    updatePaperLocationFrontFacing();
  }

  function updatePaperLocationFrontFacing() {
    if (!viewer || viewer.isDestroyed() || !cityPaperLocationStates.length ||
        !paperDistributionCollection || !paperDistributionCollection.show) {
      return;
    }
    var camera = viewer.camera;
    var cameraPosition = camera.positionWC;
    // 相机没动时无需重复计算：避免每次 preRender 都对上百个论文点做世界坐标到屏幕
    // 坐标的换算，也能减少对 billboard 的 show 赋值，从而避免整批公交牌反复刷新。
    if (!cameraMoving &&
        paperCameraPosition && paperCameraDirection && paperCameraUp &&
        paperCameraPosition.equalsEpsilon(cameraPosition, Cesium.Math.EPSILON6) &&
        paperCameraDirection.equalsEpsilon(camera.directionWC, Cesium.Math.EPSILON6) &&
        paperCameraUp.equalsEpsilon(camera.upWC, Cesium.Math.EPSILON6)) {
      return;
    }
    paperCameraPosition = Cesium.Cartesian3.clone(cameraPosition, paperCameraPosition);
    paperCameraDirection = Cesium.Cartesian3.clone(camera.directionWC, paperCameraDirection);
    paperCameraUp = Cesium.Cartesian3.clone(camera.upWC, paperCameraUp);
    // 论文点贴着地球表面分布，只应显示在朝向相机的那一侧。若每帧都用固定阈值直接
    // 切换 show，位于视觉地平线附近的点会在相机惯性微动或缓慢旋转时反复闪现。
    // 这里加入滞回带：已经显示的点要退到更靠背后的位置才隐藏，已经隐藏的点要更明显
    // 面向相机才显示，从而消除边缘的“闪动”。
    var horizonMargin = state.level === "country" ? 0.035 : 0.008;
    var hideThreshold = Math.max(0.0, horizonMargin - 0.016);
    // 屏幕坐标在相机滚动时按时间节流刷新（约 70ms 一次），避免每一帧都对上百个
    // 论文点做 worldToWindowCoordinates，造成旋转/缩放时的卡顿。面向判断本身很轻量，
    // 仍每帧执行以保证 show 切换及时；新出现的点（screenPosition 为空）会立即刷新。
    var now = performance.now();
    var recomputeScreens = cameraMoving && (now - lastPaperScreenPositionUpdate >= 70);
    if (recomputeScreens) {
      lastPaperScreenPositionUpdate = now;
      paperLocationGridDirty = true;
    }
    cityPaperLocationStates.forEach(function (locationState) {
      if (!locationState || !locationState.billboard || !locationState.position || !locationState.normal) {
        return;
      }
      Cesium.Cartesian3.subtract(cameraPosition, locationState.position, locationState.toCamera);
      Cesium.Cartesian3.normalize(locationState.toCamera, locationState.toCamera);
      var facing = Cesium.Cartesian3.dot(locationState.normal, locationState.toCamera);
      var previousFront = locationState.frontFacing;
      var frontFacing;
      if (previousFront == null) {
        frontFacing = facing > horizonMargin;
      } else if (previousFront) {
        frontFacing = facing > hideThreshold;
      } else {
        frontFacing = facing > horizonMargin;
      }
      locationState.frontFacing = frontFacing;
      // 仅在状态变化时写入 show，避免每帧标记整个 collection 为 dirty 而重复重建。
      if (locationState.billboard.show !== frontFacing) {
        locationState.billboard.show = frontFacing;
      }
      if (frontFacing && (!cameraMoving || recomputeScreens || !locationState.screenPosition)) {
        locationState.screenPosition = Cesium.SceneTransforms.worldToWindowCoordinates(
          viewer.scene,
          locationState.position,
          locationState.screenPosition
        );
        paperLocationGridDirty = true;
      }
    });
  }

  function countryMarkerOverlapRatio(cameraHeight) {
    if (cameraHeight >= 18000000) {
      return 0.94;
    }
    if (cameraHeight >= 12000000) {
      return 0.86;
    }
    if (cameraHeight >= 8000000) {
      return 0.76;
    }
    return 0.66;
  }

  function pointInsideBounds(point, bounds) {
    return point.longitude >= bounds[0] && point.longitude <= bounds[2] &&
      point.latitude >= bounds[1] && point.latitude <= bounds[3];
  }

  function mockPointData() {
    var mock = {
      datasets: [
        { id: "ds-hz", name: "杭州遥感影像数据集", longitude: 120.15, latitude: 30.28 },
        { id: "ds-nb", name: "宁波海岸带数据集", longitude: 121.55, latitude: 29.87 },
        { id: "ds-wz", name: "温州地质灾害数据集", longitude: 120.69, latitude: 27.99 },
        { id: "ds-jh", name: "金华土地覆盖数据集", longitude: 119.65, latitude: 29.08 },
        { id: "ds-bj", name: "北京城市环境数据集", longitude: 116.4, latitude: 39.9 },
        { id: "ds-sh", name: "上海城市群数据集", longitude: 121.47, latitude: 31.23 },
        { id: "ds-cd", name: "成都平原生态数据集", longitude: 104.07, latitude: 30.67 },
        { id: "ds-gz", name: "珠江三角洲水文数据集", longitude: 113.26, latitude: 23.13 },
        { id: "ds-wh", name: "长江中游气候数据集", longitude: 114.3, latitude: 30.59 },
        { id: "ds-ur", name: "天山冰川观测数据集", longitude: 87.62, latitude: 43.82 },
        { id: "ds-tokyo", name: "东京湾环境数据集", longitude: 139.69, latitude: 35.68 },
        { id: "ds-sg", name: "新加坡海洋数据集", longitude: 103.82, latitude: 1.35 },
        { id: "ds-sydney", name: "悉尼海岸数据集", longitude: 151.21, latitude: -33.86 },
        { id: "ds-london", name: "伦敦城市气候数据集", longitude: -0.12, latitude: 51.5 },
        { id: "ds-sf", name: "旧金山地震数据集", longitude: -122.42, latitude: 37.77 },
        { id: "ds-ny", name: "纽约城市遥感数据集", longitude: -74, latitude: 40.71 }
      ],
      papers: [
        { id: "p-zju", name: "浙江大学相关论文", longitude: 120.09, latitude: 30.3, count: 12 },
        { id: "p-hz", name: "杭州区域研究论文", longitude: 120.22, latitude: 30.18, count: 4 },
        { id: "p-nb", name: "宁波海岸研究论文", longitude: 121.56, latitude: 29.82, count: 7 },
        { id: "p-wz", name: "温州地质研究论文", longitude: 120.65, latitude: 28.02, count: 3 },
        { id: "p-sh", name: "上海交叉研究论文", longitude: 121.43, latitude: 31.15, count: 18 },
        { id: "p-bj", name: "北京地学论文集合", longitude: 116.34, latitude: 39.98, count: 25 },
        { id: "p-nj", name: "南京地学论文集合", longitude: 118.8, latitude: 32.06, count: 8 },
        { id: "p-wh", name: "武汉气候论文集合", longitude: 114.36, latitude: 30.53, count: 11 },
        { id: "p-cd", name: "成都生态论文集合", longitude: 104.05, latitude: 30.66, count: 6 },
        { id: "p-gz", name: "广州水文论文集合", longitude: 113.39, latitude: 23.06, count: 14 },
        { id: "p-tokyo", name: "东京大学相关论文", longitude: 139.75, latitude: 35.71, count: 16 },
        { id: "p-sg", name: "新加坡相关论文", longitude: 103.77, latitude: 1.3, count: 9 },
        { id: "p-mel", name: "墨尔本相关论文", longitude: 144.96, latitude: -37.81, count: 5 },
        { id: "p-ox", name: "牛津相关论文", longitude: -1.25, latitude: 51.75, count: 13 },
        { id: "p-boston", name: "波士顿相关论文", longitude: -71.09, latitude: 42.36, count: 20 },
        { id: "p-la", name: "洛杉矶相关论文", longitude: -118.24, latitude: 34.05, count: 6 }
      ],
      links: [
        { sourceId: "ds-hz", targetId: "p-zju" },
        { sourceId: "ds-hz", targetId: "p-hz" },
        { sourceId: "ds-hz", targetId: "p-sh" },
        { sourceId: "ds-hz", targetId: "p-bj" },
        { sourceId: "ds-hz", targetId: "p-tokyo" },
        { sourceId: "ds-hz", targetId: "p-boston" },
        { sourceId: "ds-nb", targetId: "p-nb" },
        { sourceId: "ds-nb", targetId: "p-sh" },
        { sourceId: "ds-wz", targetId: "p-wz" },
        { sourceId: "ds-wz", targetId: "p-zju" },
        { sourceId: "ds-jh", targetId: "p-zju" },
        { sourceId: "ds-bj", targetId: "p-bj" },
        { sourceId: "ds-bj", targetId: "p-boston" },
        { sourceId: "ds-sh", targetId: "p-sh" },
        { sourceId: "ds-sh", targetId: "p-tokyo" },
        { sourceId: "ds-cd", targetId: "p-cd" },
        { sourceId: "ds-cd", targetId: "p-bj" },
        { sourceId: "ds-gz", targetId: "p-gz" },
        { sourceId: "ds-gz", targetId: "p-sg" },
        { sourceId: "ds-wh", targetId: "p-wh" },
        { sourceId: "ds-wh", targetId: "p-nj" },
        { sourceId: "ds-ur", targetId: "p-bj" },
        { sourceId: "ds-ur", targetId: "p-ox" },
        { sourceId: "ds-tokyo", targetId: "p-tokyo" },
        { sourceId: "ds-tokyo", targetId: "p-boston" },
        { sourceId: "ds-sg", targetId: "p-sg" },
        { sourceId: "ds-sg", targetId: "p-mel" },
        { sourceId: "ds-sydney", targetId: "p-mel" },
        { sourceId: "ds-london", targetId: "p-ox" },
        { sourceId: "ds-london", targetId: "p-boston" },
        { sourceId: "ds-sf", targetId: "p-la" },
        { sourceId: "ds-sf", targetId: "p-boston" },
        { sourceId: "ds-ny", targetId: "p-boston" },
        { sourceId: "ds-ny", targetId: "p-ox" }
      ]
    };
    addMockLocalRelations(mock);
    return sanitizePointData(mock);
  }

  function addMockLocalRelations(mock) {
    var pointsById = {};
    var namedPapers = mock.papers.slice();
    mock.datasets.concat(mock.papers).forEach(function (point) {
      pointsById[point.id] = point;
    });
    mock.links = mock.links.filter(function (link) {
      return pointsById[link.sourceId] && pointsById[link.targetId];
    });

    var linkKeys = {};
    mock.links.forEach(function (link) {
      linkKeys[link.sourceId + ":" + link.targetId] = true;
    });
    mock.datasets.forEach(function (dataset) {
      namedPapers.slice().sort(function (left, right) {
        return mockCoordinateDistance(dataset, left) - mockCoordinateDistance(dataset, right);
      }).filter(function (paper) {
        return mockCoordinateDistance(dataset, paper) <= 16;
      }).slice(0, 3).forEach(function (paper, paperIndex) {
        var key = dataset.id + ":" + paper.id;
        if (!linkKeys[key]) {
          mock.links.push({
            sourceId: dataset.id,
            targetId: paper.id,
            weight: 0.42 + paperIndex * 0.12
          });
          linkKeys[key] = true;
        }
      });
    });

    var offsets = [
      [0.24, 0.12],
      [-0.18, 0.26],
      [0.31, -0.16],
      [-0.33, -0.1],
      [0.08, -0.3],
      [0.38, 0.21],
      [-0.42, 0.18],
      [0.27, 0.35],
      [-0.28, -0.34],
      [0.43, -0.27],
      [-0.05, 0.42],
      [0.56, 0.08],
      [-0.52, -0.22],
      [0.17, 0.58],
      [-0.14, -0.57],
      [0.62, -0.36],
      [-0.64, 0.34],
      [0.48, 0.51]
    ];
    mock.datasets.forEach(function (dataset, datasetIndex) {
      offsets.forEach(function (offset, offsetIndex) {
        var paperId = "p-near-" + dataset.id + "-" + offsetIndex;
        mock.papers.push({
          id: paperId,
          name: dataset.name.replace(/数据集$/, "") + "关联论文",
          longitude: clamp(dataset.longitude + offset[0], -179.8, 179.8),
          latitude: clamp(dataset.latitude + offset[1], -84.8, 84.8),
          count: 2 + ((datasetIndex * 7 + offsetIndex * 5) % 18)
        });
        mock.links.push({
          sourceId: dataset.id,
          targetId: paperId,
          weight: 0.32 + offsetIndex * 0.16
        });
      });
    });
  }

  function mockCoordinateDistance(left, right) {
    var latitudeScale = Math.cos(Cesium.Math.toRadians((left.latitude + right.latitude) * 0.5));
    var longitudeDelta = (left.longitude - right.longitude) * Math.max(0.24, latitudeScale);
    var latitudeDelta = left.latitude - right.latitude;
    return Math.sqrt(longitudeDelta * longitudeDelta + latitudeDelta * latitudeDelta);
  }

  function regionCount(code, level) {
    if (Object.prototype.hasOwnProperty.call(suppliedCounts, String(code))) {
      return Number(suppliedCounts[String(code)]) || 0;
    }
    return 0;
  }

  function regionPaperCount(code) {
    if (Object.prototype.hasOwnProperty.call(suppliedPaperCounts, String(code))) {
      return Number(suppliedPaperCounts[String(code)]) || 0;
    }
    return 0;
  }

  function mockFilterRatio(code, level) {
    if (!hasActiveFilters()) {
      return 1;
    }
    var signature = [
      code,
      level,
      filterState.query,
      filterState.theme,
      timelineFilterSignature(),
      filterState.source,
      filterState.publicationStartYear,
      filterState.publicationEndYear
    ].join(":");
    var hash = stringHash(signature);
    var ratio = 1;
    if (filterState.query) {
      ratio *= 0.1 + (hash % 17) / 100;
    }
    if (filterState.theme) {
      ratio *= 0.34 + ((hash >>> 4) % 18) / 100;
    }
    if (filterState.timeActive) {
      ratio *= temporalMockRatio() * (0.92 + ((hash >>> 12) % 9) / 100);
    }
    if (filterState.source) {
      ratio *= 0.48 + ((hash >>> 16) % 15) / 100;
    }
    if (filterState.publicationStartYear != null && filterState.publicationEndYear != null) {
      ratio *= 0.44;
    }
    return clamp(ratio, 0.015, 1);
  }

  function temporalMockRatio() {
    if (!filterState.timeActive) {
      return 1;
    }
    if (filterState.timeScope === "geologic") {
      var deepSpan = Math.max(0, filterState.timeOlderYears - filterState.timeYoungerYears) /
        (GEOLOGIC_MAX_MA * 1000000);
      return 0.16 + Math.sqrt(deepSpan) * 0.7;
    }
    if (filterState.timeScope === "human") {
      var bounds = timelineViewBounds();
      var humanSpan = Math.max(1, filterState.timeOlderYears - filterState.timeYoungerYears + 1) /
        Math.max(1, bounds.older - bounds.younger + 1);
      return 0.16 + Math.sqrt(humanSpan) * 0.82;
    }
    var logOlder = Math.log10(filterState.timeOlderYears + 1);
    var logYounger = Math.log10(filterState.timeYoungerYears + 1);
    return 0.2 + clamp((logOlder - logYounger) / Math.log10(GEOLOGIC_MAX_MA * 1000000 + 1), 0, 1) * 0.76;
  }

  function regionDensity(code, level, fallbackCount) {
    if (Object.prototype.hasOwnProperty.call(suppliedDensities, String(code))) {
      return Math.max(0, Number(suppliedDensities[String(code)]) || 0);
    }
    return Math.max(0, Number(fallbackCount) || regionCount(code, level));
  }

  function setRegionData(values) {
    suppliedHeatPoints = null;
    return applyRegionData(values);
  }

  function setHeatPoints(points) {
    suppliedHeatPoints = sanitizeHeatPoints(points);
    return refreshCurrentLevel();
  }

  function setPointData(data) {
    suppliedPointData = sanitizePointData(data || {});
    return refreshCurrentLevel();
  }

  function setCityDatasets(cityCode, datasets) {
    suppliedCityDatasets[String(cityCode)] = sanitizeCityDatasets(datasets);
    if (selectedMeta && selectedMeta.code === String(cityCode)) {
      showCityDatasetPanel(selectedMeta);
    }
  }

  function setSearchResults(datasets) {
    suppliedSearchResults = sanitizeCityDatasets(datasets);
    if (selectionBounds) {
      showSelectionResultsPanel();
      return;
    }
    if (filterState.query) {
      abortKeywordSearch();
      keywordSearchState = {
        query: filterState.query,
        datasets: suppliedSearchResults,
        papers: [],
        total: suppliedSearchResults.length,
        loading: false,
        error: ""
      };
      showSearchResultsPanel();
    }
  }

  function setSelectionResult(result) {
    var value = result || {};
    suppliedSelectionResult = {
      datasets: sanitizeCityDatasets(value.datasets || value.results || []),
      statistics: value.statistics || value.stats || null
    };
    if (suppliedSelectionResult.statistics) {
      applyHumanTimelineYearRangeFromStatistics(suppliedSelectionResult.statistics);
    }
    if (selectionBounds) {
      showSelectionResultsPanel();
    }
  }

  function setRegionStats(values) {
    suppliedRegionStats = sanitizeRegionStats(values);
    return refreshCurrentLevel();
  }

  function setFilterResult(result) {
    var value = result || {};
    if (value.temporalExtent || value.timeExtent) {
      setTemporalExtent(value.temporalExtent || value.timeExtent);
    }
    if (value.regionStats || value.statistics) {
      suppliedRegionStats = sanitizeRegionStats(value.regionStats || value.statistics);
    }
    if (value.heatPoints || value.points) {
      suppliedHeatPoints = sanitizeHeatPoints(value.heatPoints || value.points);
    }
    if (value.cityDatasets && typeof value.cityDatasets === "object") {
      Object.keys(value.cityDatasets).forEach(function (cityCode) {
        suppliedCityDatasets[String(cityCode)] = sanitizeCityDatasets(value.cityDatasets[cityCode]);
      });
    }
    if (Array.isArray(value.searchResults)) {
      suppliedSearchResults = sanitizeCityDatasets(value.searchResults);
    }
    if (value.selectionResult || value.spatialSelection) {
      var selectionValue = value.selectionResult || value.spatialSelection;
      suppliedSelectionResult = {
        datasets: sanitizeCityDatasets(selectionValue.datasets || selectionValue.results || []),
        statistics: selectionValue.statistics || selectionValue.stats || null
      };
    }
    if (Object.prototype.hasOwnProperty.call(value, "regions") ||
        Object.prototype.hasOwnProperty.call(value, "regionData")) {
      return applyRegionData(value.regions || value.regionData || []);
    }
    return refreshCurrentLevel();
  }

  function setTemporalExtent(value) {
    if (!value || filterState.timeActive) {
      return;
    }
    var mode = String(value.mode || value.scope || "unified").toLowerCase();
    if (mode === "human") {
      filterState.timeView = "human";
      filterState.timeScope = "human";
      var startYear = normalizeTimelineYear(value.startYear) || humanTimelineYearMin;
      var endYear = normalizeTimelineYear(value.endYear) || humanTimelineYearMax;
      applyHumanTimelineYearRange(startYear, endYear);
      filterState.timeOlderYears = HUMAN_YEAR_MAX - startYear;
      filterState.timeYoungerYears = HUMAN_YEAR_MAX - endYear;
    } else if (mode === "geologic") {
      filterState.timeView = "geologic";
      filterState.timeScope = "geologic";
      filterState.timeOlderYears = clamp(Number(value.olderMa) || GEOLOGIC_MAX_MA, 0, GEOLOGIC_MAX_MA) * 1000000;
      filterState.timeYoungerYears = clamp(Number(value.youngerMa) || 0, 0, GEOLOGIC_MAX_MA) * 1000000;
    } else {
      filterState.timeView = "geologic";
      filterState.timeScope = "geologic";
      filterState.timeOlderYears = temporalBoundaryToAge(value.older, GEOLOGIC_MAX_MA * 1000000);
      filterState.timeYoungerYears = temporalBoundaryToAge(value.younger, 0);
    }
    configureTimelineUi();
  }

  function temporalBoundaryToAge(boundary, fallback) {
    if (!boundary || typeof boundary !== "object") {
      return fallback;
    }
    if (boundary.scale === "calendar" && Number.isFinite(Number(boundary.year))) {
      return Math.max(0, HUMAN_YEAR_MAX - Number(boundary.year));
    }
    if (boundary.scale === "ma" && Number.isFinite(Number(boundary.value))) {
      return clamp(Number(boundary.value), 0, GEOLOGIC_MAX_MA) * 1000000;
    }
    return fallback;
  }

  function sanitizeRegionStats(values) {
    var result = {};
    if (Array.isArray(values)) {
      values.forEach(function (item) {
        if (item && item.regionCode != null) {
          result[String(item.regionCode)] = normalizeRegionStat(item);
        }
      });
      return result;
    }
    if (values && typeof values === "object") {
      Object.keys(values).forEach(function (code) {
        result[String(code)] = normalizeRegionStat(values[code] || {});
      });
    }
    return result;
  }

  function normalizeRegionStat(value) {
    return {
      count: value.count == null ? null : Math.max(0, Number(value.count) || 0),
      totalSize: value.totalSize == null ? null : String(value.totalSize),
      totalSizeBytes: value.totalSizeBytes == null ? null : Math.max(0, Number(value.totalSizeBytes) || 0),
      averageSize: value.averageSize == null ? null : String(value.averageSize),
      averageSizeBytes: value.averageSizeBytes == null ? null : Math.max(0, Number(value.averageSizeBytes) || 0),
      tags: value.tagCounts || (Array.isArray(value.tags) || (value.tags && typeof value.tags === "object")
        ? value.tags
        : value.tags
          ? [value.tags]
          : []),
      formats: value.formats || value.dataFormats || null
    };
  }

  function sanitizePointData(data) {
    var value = data || {};
    var datasets = sanitizeCoordinateRecords(value.datasets || value.datasetPoints || [], "dataset");
    var papers = sanitizeCoordinateRecords(value.papers || value.paperPoints || [], "paper");
    var ids = {};
    datasets.concat(papers).forEach(function (point) {
      ids[point.id] = true;
    });
    var links = (value.links || value.relations || []).map(function (link, index) {
      return {
        id: String(link.id || "link-" + index),
        sourceId: String(link.sourceId != null ? link.sourceId : link.from),
        targetId: String(link.targetId != null ? link.targetId : link.to),
        weight: Math.max(0, Number(link.weight) || 0),
        color: link.color ? String(link.color) : null
      };
    }).filter(function (link) {
      return ids[link.sourceId] && ids[link.targetId] && link.sourceId !== link.targetId;
    });
    return { datasets: datasets, papers: papers, links: links };
  }

  function sanitizeCoordinateRecords(records, type) {
    if (!Array.isArray(records)) {
      return [];
    }
    return records.map(function (record, index) {
      var longitude = Number(record.longitude != null ? record.longitude : record.lon);
      var latitude = Number(record.latitude != null ? record.latitude : record.lat);
      return {
        id: String(record.id || type + "-" + index),
        name: String(record.name || record.title || (type === "paper" ? "论文" : "点数据集")),
        longitude: longitude,
        latitude: latitude,
        count: Math.max(1, Number(record.count) || 1),
        paperIds: Array.isArray(record.paperIds) ? record.paperIds.slice() : []
      };
    }).filter(function (record) {
      return Number.isFinite(record.longitude) && Number.isFinite(record.latitude) &&
        record.longitude >= -180 && record.longitude <= 180 &&
        record.latitude >= -90 && record.latitude <= 90;
    });
  }

  function sanitizeHeatPoints(points) {
    if (!Array.isArray(points)) {
      return [];
    }
    return points.map(function (point) {
      var kind = point.kind === "grain" || point.kind === "corridor" ? point.kind : "core";
      return {
        longitude: Number(point.longitude != null ? point.longitude : point.lon),
        latitude: Number(point.latitude != null ? point.latitude : point.lat),
        weight: Math.max(0, Number(
          point.weight != null ? point.weight : point.density != null ? point.density : point.value
        ) || 0),
        radius: point.radius == null ? null : clamp(Number(point.radius) || 0, 0.7, 48),
        kind: kind
      };
    }).filter(function (point) {
      return Number.isFinite(point.longitude) && Number.isFinite(point.latitude) &&
        point.longitude >= -180 && point.longitude <= 180 &&
        point.latitude >= -90 && point.latitude <= 90;
    });
  }

  function sanitizeCityDatasets(records) {
    if (!Array.isArray(records)) {
      return [];
    }
    return records.map(function (record, index) {
      var tags = Array.isArray(record.tags)
        ? record.tags
        : Array.isArray(record.topics)
          ? record.topics
          : record.topic
            ? [record.topic]
            : [];
      var temporal = normalizeDatasetTemporal(record, String(record.timeRange || record.temporalRange || ""), index);
      return {
        id: String(record.id || "dataset-" + index),
        rawId: record.rawId == null ? null : String(record.rawId),
        source: String(record.source || "legacy"),
        itemType: String(record.itemType || "dataset"),
        name: String(record.name || record.title || "未命名数据集"),
        url: String(record.url || record.datasetUrl || record.dataset_url || ""),
        tags: tags.slice(0, 3).map(String),
        thumbnail: record.thumbnail || record.image || record.preview || null,
        dataType: String(record.dataType || record.type || ""),
        timeRange: String(record.timeRange || record.temporalRange || ""),
        temporalMode: temporal.mode,
        startYear: temporal.startYear,
        endYear: temporal.endYear,
        olderMa: temporal.olderMa,
        youngerMa: temporal.youngerMa,
        resolution: String(record.resolution || record.spatialResolution || ""),
        regionName: String(record.regionName || record.region || record.locationName || ""),
        longitude: Number(record.longitude != null ? record.longitude : record.lon),
        latitude: Number(record.latitude != null ? record.latitude : record.lat),
        coverageBounds: sanitizeDatasetBounds(record.coverageBounds || record.bounds || record.bbox),
        coverage: sanitizeCityDatasetCoverage(record.coverage),
        sizeGB: Math.max(0, Number(record.sizeGB != null ? record.sizeGB : record.sizeGb) || 0),
        format: String(record.format || record.dataFormat || ""),
        knowledge: (Array.isArray(record.knowledge) ? record.knowledge : record.knowledge ? [record.knowledge] : [])
          .map(String)
      };
    });
  }

  function sanitizeCityPapers(records) {
    if (!Array.isArray(records)) {
      return [];
    }
    return records.map(function (record, index) {
      var longitude = record.longitude == null ? Number.NaN : Number(record.longitude);
      var latitude = record.latitude == null ? Number.NaN : Number(record.latitude);
      var rawId = String(record.id || index + 1);
      var subject = String(record.subject || "").trim();
      var tags = Array.isArray(record.tags) ? record.tags.map(String).slice(0, 3) : [];
      if (subject && tags.indexOf(subject) === -1) {
        tags.unshift(subject);
        tags = tags.slice(0, 3);
      }
      return {
        id: "paper-" + rawId,
        rawId: rawId,
        itemType: "paper",
        name: String(record.title || "未命名论文"),
        title: String(record.title || "未命名论文"),
        publicationYear: record.publicationYear == null ? null : Number(record.publicationYear),
        subject: subject,
        tags: tags,
        timeRange: record.publicationYear == null ? "发表时间未标注" : String(record.publicationYear),
        temporalMode: "human",
        startYear: record.publicationYear == null ? null : Number(record.publicationYear),
        endYear: record.publicationYear == null ? null : Number(record.publicationYear),
        regionName: "",
        longitude: longitude,
        latitude: latitude,
        locationId: String(record.locationId || paperLocationId(longitude, latitude)),
        coverage: sanitizeCityDatasetCoverage(record.coverage || [{
          kind: "point", west: longitude, south: latitude, east: longitude, north: latitude
        }])
      };
    });
  }

  function sanitizeCityPaperLocations(records) {
    if (!Array.isArray(records)) {
      return [];
    }
    return records.map(function (record) {
      var longitude = Number(record.longitude);
      var latitude = Number(record.latitude);
      var paperIds = Array.isArray(record.paperIds) ? record.paperIds.map(function (paperId) {
        return "paper-" + String(paperId);
      }) : [];
      return {
        id: String(record.id || paperLocationId(longitude, latitude)),
        longitude: longitude,
        latitude: latitude,
        count: Math.max(1, Number(record.count) || paperIds.length || 1),
        paperIds: paperIds
      };
    }).filter(function (location) {
      return Number.isFinite(location.longitude) && Number.isFinite(location.latitude) &&
        location.longitude >= -180 && location.longitude <= 180 &&
        location.latitude >= -90 && location.latitude <= 90;
    });
  }

  function paperLocationId(longitude, latitude) {
    return Number(longitude).toFixed(8) + ":" + Number(latitude).toFixed(8);
  }

  function paperLocationsFromPapers(papers) {
    var byLocation = {};
    papers.forEach(function (paper) {
      if (!Number.isFinite(paper.longitude) || !Number.isFinite(paper.latitude)) {
        return;
      }
      var locationId = paper.locationId || paperLocationId(paper.longitude, paper.latitude);
      if (!byLocation[locationId]) {
        byLocation[locationId] = {
          id: locationId,
          longitude: paper.longitude,
          latitude: paper.latitude,
          count: 0,
          paperIds: []
        };
      }
      byLocation[locationId].count += 1;
      byLocation[locationId].paperIds.push(paper.id);
    });
    return Object.keys(byLocation).map(function (locationId) {
      return byLocation[locationId];
    });
  }

  function sortCityPapersByLocation(papers, locations) {
    var locationRank = {};
    locations.forEach(function (location, index) {
      locationRank[location.id] = index;
    });
    return papers.slice().sort(function (left, right) {
      var leftRank = Object.prototype.hasOwnProperty.call(locationRank, left.locationId)
        ? locationRank[left.locationId]
        : Number.MAX_SAFE_INTEGER;
      var rightRank = Object.prototype.hasOwnProperty.call(locationRank, right.locationId)
        ? locationRank[right.locationId]
        : Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      var leftYear = Number.isFinite(left.publicationYear) ? left.publicationYear : -Infinity;
      var rightYear = Number.isFinite(right.publicationYear) ? right.publicationYear : -Infinity;
      if (leftYear !== rightYear) {
        return rightYear - leftYear;
      }
      return left.name.localeCompare(right.name, "zh-CN");
    });
  }

  function sanitizeCityDatasetCoverage(values) {
    if (!Array.isArray(values)) {
      return [];
    }
    return values.map(function (coverage) {
      var kind = String(coverage && coverage.kind || "").toLowerCase();
      var west = Number(coverage && coverage.west);
      var south = Number(coverage && coverage.south);
      var east = Number(coverage && coverage.east);
      var north = Number(coverage && coverage.north);
      if ((kind !== "point" && kind !== "bbox") ||
          ![west, south, east, north].every(Number.isFinite) ||
          west < -180 || east > 180 || south < -90 || north > 90 || west > east || south > north) {
        return null;
      }
      return { kind: kind, west: west, south: south, east: east, north: north };
    }).filter(Boolean).slice(0, 12);
  }

  function normalizeDatasetTemporal(record, timeRange, seed) {
    var mode = String(record.temporalMode || record.timeMode || "").toLowerCase();
    var olderMa = finiteTemporalValue(record.olderMa, record.startMa, record.temporalStartMa);
    var youngerMa = finiteTemporalValue(record.youngerMa, record.endMa, record.temporalEndMa);
    if (mode === "geologic" || olderMa != null || youngerMa != null) {
      olderMa = olderMa == null ? GEOLOGIC_MAX_MA : clamp(olderMa, 0, GEOLOGIC_MAX_MA);
      youngerMa = youngerMa == null ? 0 : clamp(youngerMa, 0, GEOLOGIC_MAX_MA);
      var maximumAge = Math.max(olderMa, youngerMa);
      var minimumAge = Math.min(olderMa, youngerMa);
      return {
        mode: "geologic",
        olderMa: maximumAge,
        youngerMa: minimumAge,
        startYear: null,
        endYear: null
      };
    }
    var startYear = finiteTemporalValue(record.startYear, record.yearStart, record.temporalStartYear);
    var endYear = finiteTemporalValue(record.endYear, record.yearEnd, record.temporalEndYear);
    var fallback = mockHumanYears(timeRange, seed);
    return {
      mode: "human",
      startYear: Math.round(startYear == null ? fallback.startYear : startYear),
      endYear: Math.round(endYear == null ? fallback.endYear : endYear),
      olderMa: null,
      youngerMa: null
    };
  }

  function finiteTemporalValue() {
    for (var index = 0; index < arguments.length; index += 1) {
      if (arguments[index] !== "" && arguments[index] != null && Number.isFinite(Number(arguments[index]))) {
        return Number(arguments[index]);
      }
    }
    return null;
  }

  function mockHumanYears(timeRange, seed) {
    var offset = stringHash(String(seed || timeRange)) % 8;
    if (timeRange === "近一年") {
      return { startYear: HUMAN_YEAR_MAX - 1, endYear: HUMAN_YEAR_MAX };
    }
    if (timeRange === "近五年") {
      return { startYear: HUMAN_YEAR_MAX - 5, endYear: HUMAN_YEAR_MAX };
    }
    if (timeRange === "长期序列") {
      return { startYear: 1985 + offset, endYear: HUMAN_YEAR_MAX };
    }
    if (timeRange === "历史归档") {
      return { startYear: 1950 + offset * 3, endYear: 2000 + offset * 2 };
    }
    return { startYear: HUMAN_YEAR_MIN, endYear: HUMAN_YEAR_MAX };
  }

  function sanitizeDatasetBounds(bounds) {
    if (Array.isArray(bounds) && bounds.length >= 4) {
      var values = bounds.slice(0, 4).map(Number);
      if (values.every(Number.isFinite)) {
        return values;
      }
    }
    if (bounds && typeof bounds === "object") {
      var objectValues = [bounds.west, bounds.south, bounds.east, bounds.north].map(Number);
      if (objectValues.every(Number.isFinite)) {
        return objectValues;
      }
    }
    return null;
  }

  function applyRegionData(values) {
    suppliedCounts = {};
    suppliedDensities = {};
    if (Array.isArray(values)) {
      values.forEach(function (item) {
        if (item && item.regionCode != null) {
          suppliedCounts[String(item.regionCode)] = Number(item.count) || 0;
          if (item.density != null) {
            suppliedDensities[String(item.regionCode)] = Number(item.density) || 0;
          }
        }
      });
    } else if (values && typeof values === "object") {
      Object.keys(values).forEach(function (code) {
        var value = values[code];
        if (value && typeof value === "object") {
          suppliedCounts[String(code)] = Number(value.count) || 0;
          if (value.density != null) {
            suppliedDensities[String(code)] = Number(value.density) || 0;
          }
        } else {
          suppliedCounts[String(code)] = Number(value) || 0;
        }
      });
    }
    markerImageCache = {};
    return refreshCurrentLevel();
  }

  async function refreshCurrentLevel() {
    var selectedCityCode = activeDatasetCityCode ||
      (selectedMeta && selectedMeta.level === "city" ? selectedMeta.code : null);
    if (state.level === "country") {
      await loadLevel(DATA_ROOT + "/countries.geojson");
    } else if (state.level === "province") {
      state.path[1].count = regionCount("CHN", "country");
      await loadLevel(DATA_ROOT + "/china-provinces.geojson");
    } else {
      var province = state.path[2];
      province.count = regionCount(province.code, "province");
      await loadLevel(DATA_ROOT + "/china-cities/" + province.code + ".geojson");
    }
    if (selectedCityCode && state.level === "city") {
      restoreSelectedCity(selectedCityCode);
    }
  }

  function restoreSelectedCity(cityCode) {
    var entity = currentBoundarySource && currentBoundarySource.entities.values.find(function (item) {
      return item.regionMeta && item.regionMeta.code === String(cityCode);
    });
    if (!entity || !entity.regionMeta) {
      return;
    }
    selectedMeta = entity.regionMeta;
    applyRegionStyle(selectedMeta, true, true);
    showCityDatasetPanel(selectedMeta);
  }

  function formatCount(value) {
    if (value >= 10000) {
      return (value / 10000).toFixed(1) + "万";
    }
    if (value >= 1000) {
      return (value / 1000).toFixed(1) + "千";
    }
    return String(value);
  }

  function validCenter(value) {
    return Array.isArray(value) && value.length >= 2 &&
      Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))
      ? [Number(value[0]), Number(value[1])]
      : null;
  }

  function geometryCenter(geometry) {
    if (!geometry || !geometry.coordinates) {
      return null;
    }
    var bounds = [180, 90, -180, -90];
    visitCoordinates(geometry.coordinates, function (coordinate) {
      bounds[0] = Math.min(bounds[0], coordinate[0]);
      bounds[1] = Math.min(bounds[1], coordinate[1]);
      bounds[2] = Math.max(bounds[2], coordinate[0]);
      bounds[3] = Math.max(bounds[3], coordinate[1]);
    });
    return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  }

  function visitCoordinates(value, callback) {
    if (typeof value[0] === "number") {
      callback(value);
      return;
    }
    value.forEach(function (child) {
      visitCoordinates(child, callback);
    });
  }

  function levelDistanceLimit() {
    if (state.level === "country") {
      return 34000000;
    }
    if (state.level === "province") {
      return 11000000;
    }
    return 3500000;
  }

  function paperPointDistanceLimit() {
    if (state.level === "country") {
      return 12000000;
    }
    if (state.level === "province") {
      return 6500000;
    }
    return 3500000;
  }

  function focusOnRegion(meta, duration) {
    if (!viewer || viewer.isDestroyed() || !meta) {
      return;
    }
    var flyDuration = typeof duration === "number" ? duration : 0.9;
    if (meta.level === "city" && meta.geometry) {
      var bounds = geometryBounds(meta.geometry);
      if (bounds) {
        flyToBoundsWithPadding(bounds, flyDuration, true);
        return;
      }
    }
    if (meta.boundaryEntity) {
      viewer.flyTo(meta.boundaryEntity, { duration: flyDuration });
    }
  }

  function flyToBoundsWithPadding(bounds, duration, paddedForCity) {
    if (!bounds) {
      return;
    }
    var spanX = bounds[2] - bounds[0];
    var spanY = bounds[3] - bounds[1];
    var minimumSpan = paddedForCity ? 0.12 : 0.06;
    var xPadding = Math.max(minimumSpan, spanX * 0.18);
    var yPadding = Math.max(minimumSpan, spanY * 0.18);
    var west = clamp(bounds[0] - xPadding, -180, 180);
    var south = clamp(bounds[1] - yPadding, -89.9, 89.9);
    var east = clamp(bounds[2] + xPadding, -180, 180);
    var north = clamp(bounds[3] + yPadding, -89.9, 89.9);
    viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(west, south, east, north),
      duration: typeof duration === "number" ? duration : 0.9
    });
  }

  function flyToCurrentSource() {
    if (currentBoundarySource) {
      // 行政边界异步加载完成后才真正开始飞行；点击瞬间的锁可能已过期，
      // 必须在这里重新续锁，防止 moveEnd 按飞行中的高相机高度回退层级。
      beginManualNavigation(2300);
      return viewer.flyTo(currentBoundarySource, { duration: 1.25 });
    }
  }

  function flyToChina() {
    beginManualNavigation(2300);
    return viewer.flyTo(currentBoundarySource, {
      duration: 1.25,
      offset: new Cesium.HeadingPitchRange(0.05, -1.34, 0)
    });
  }

  function goBack() {
    if (state.level === "city") {
      if (activeDatasetCityCode && state.path[2]) {
        var province = state.path[2];
        showProvinceCities(province.code, province.name, province.count, { preserveCamera: true });
        return;
      }
      showChinaProvinces();
    } else if (state.level === "province") {
      returnToWorld();
    }
  }

  function navigateToPathIndex(index) {
    if (index === 0) {
      returnToWorld();
    } else if (index === 1) {
      showChinaProvinces();
    } else if (index === 2 && state.path[2]) {
      var province = state.path[2];
      showProvinceCities(province.code, province.name, province.count);
    }
  }

  function updateDrillUi(regionTotal) {
    var breadcrumb = document.getElementById("drill-breadcrumb");
    breadcrumb.innerHTML = state.path
      .map(function (item, index) {
        var isLast = index === state.path.length - 1;
        return (
          (index ? '<span class="drill-chevron">/</span>' : "") +
          '<button class="drill-crumb" type="button" data-path-index="' + index + '"' +
          (isLast ? " disabled" : "") + ">" + escapeHtml(item.name) + "</button>"
        );
      })
      .join("");
    var meta = defaultStatisticsMeta();
    var datasetTotal = meta ? meta.count : 0;
    var regionUnit = state.level === "country"
      ? "国"
      : state.level === "province"
        ? "省"
        : "市";
    var regionUnitLabel = state.level === "country"
      ? "国家"
      : state.level === "province"
        ? "省份"
        : "城市";
    document.getElementById("drill-summary").classList.toggle("hidden", state.level === "city");
    document.getElementById("drill-dataset-total").textContent = formatCount(datasetTotal);
    document.getElementById("drill-region-total").textContent = formatCount(regionTotal);
    document.getElementById("drill-region-unit").textContent = regionUnit;
    document.getElementById("drill-summary").title =
      "当前范围 " + formatCount(datasetTotal) + " 个数据集，覆盖 " +
      formatCount(regionTotal) + " 个" + regionUnitLabel;
    document.getElementById("drill-back").classList.toggle("hidden", state.level === "country");
  }

  function syncDatasetPanelForLevel() {
    if (selectionBounds) {
      showSelectionResultsPanel();
      return;
    }
    if (filterState.query) {
      showSearchResultsPanel();
      scheduleTimelineRangeForCurrentScope(0);
      return;
    }
    if (activeDatasetCityCode && activeCityPanelData && activeCityPanelData.meta) {
      showCityDatasetPanel(activeCityPanelData.meta);
      return;
    }
    hideDatasetPanel();
    syncStatisticsPanelForLevel();
  }

  function hideDatasetPanel() {
    activeDatasetCityCode = null;
    activeCityPanelData = null;
    clearCityDatasetCoverage();
    renderSelectionSummary(null);
    concealDatasetPanel();
    syncMapExpressionForActiveTab();
  }

  function concealDatasetPanel() {
    clearCityDatasetCoverage();
    document.getElementById("dataset-panel-tabs").classList.add("hidden");
    document.getElementById("dataset-panel").classList.add("hidden");
    document.body.classList.remove("dataset-panel-open");
    syncMapExpressionForActiveTab();
  }

  function syncStatisticsPanelForLevel() {
    if (filterState.query || selectionBounds) {
      return;
    }
    if (state.level === "city" && activeDatasetCityCode) {
      return;
    }
    var meta = defaultStatisticsMeta();
    if (meta) {
      showStatisticsPanel(meta, false);
    }
    syncRegionPaperPoints();
  }

  function defaultStatisticsMeta() {
    if (state.level === "country") {
      return {
        code: "WORLD",
        name: "全球",
        level: "world",
        count: regionCount("WORLD", "world")
      };
    }
    if (state.level === "province") {
      return {
        code: "CHN",
        name: "中国",
        level: "country",
        count: regionCount("CHN", "country")
      };
    }
    if (state.level === "city" && state.path[2]) {
      return {
        code: state.path[2].code,
        name: state.path[2].name,
        level: "province",
        count: regionCount(state.path[2].code, "province")
      };
    }
    return null;
  }

  function showStatisticsPanel(meta, transient) {
    if (!statisticsPanelVisible || !meta || filterState.query || selectionBounds) {
      if (!statisticsPanelVisible) {
        hideStatisticsPanel();
      }
      return;
    }
    var panel = document.getElementById("stats-panel");
    panel.classList.remove("hidden");
    document.body.classList.add("stats-panel-open");
    var signature = statisticsSignature(meta);
    if (statisticsCache[signature]) {
      renderStatisticsPanel(meta, statisticsCache[signature]);
      return;
    }
    renderStatisticsPanel(meta, null);
    loadRegionStatistics(meta, signature);
  }

  function statisticsSignature(meta) {
    return String(meta.code) + "?" + datasetFilterParameters().toString();
  }

  async function loadRegionStatistics(meta, signature) {
    var token = ++statisticsRequestToken;
    statisticsRequestSignature = signature;
    if (statisticsRequestController) {
      statisticsRequestController.abort();
    }
    statisticsRequestController = new AbortController();
    var parameters = datasetFilterParameters();
    parameters.set("region_code", meta.code);
    try {
      var response = await fetch("./api/region-statistics?" + parameters.toString(), {
        signal: statisticsRequestController.signal,
        cache: "default"
      });
      if (!response.ok) {
        var detail = await response.json().catch(function () { return {}; });
        throw new Error(detail.error || "真实统计请求失败: " + response.status);
      }
      var statistics = await response.json();
      statisticsCache[signature] = statistics;
      if (token === statisticsRequestToken && statisticsSignature(meta) === signature) {
        renderStatisticsPanel(meta, statistics);
      }
    } catch (error) {
      if (error && error.name === "AbortError") {
        return;
      }
      console.error("区域真实统计加载失败", error);
      if (token === statisticsRequestToken) {
        renderStatisticsPanel(meta, { total: Math.max(0, Number(meta.count) || 0), error: true });
      }
    } finally {
      if (token === statisticsRequestToken) {
        statisticsRequestController = null;
        statisticsRequestSignature = "";
      }
    }
  }

  function renderStatisticsPanel(meta, statistics) {
    var value = statistics || {};
    var total = value.total == null ? Math.max(0, Number(meta.count) || 0) : Math.max(0, Number(value.total) || 0);
    var topics = Array.isArray(value.topics) ? value.topics : [];
    var paperTopics = Array.isArray(value.paper_topics) ? value.paper_topics : [];
    var mappedPaperTotal = Math.max(0, Number(value.mapped_paper_count) || 0);
    document.getElementById("stats-level").textContent = statisticsLevelLabel(meta);
    document.getElementById("stats-title").textContent = shortName(meta.name) + "数据概览";
    document.getElementById("stats-count").textContent = String(Math.round(total));
    document.getElementById("stats-paper-count").textContent = value.paper_count == null ? "--" : formatCount(value.paper_count);
    document.getElementById("stats-problem-count").textContent = value.problem_count == null
      ? "--"
      : formatCount(value.problem_count);
    document.getElementById("stats-filter-state").classList.toggle("hidden", !hasActiveFilters());
    document.getElementById("stats-dataset-tags").innerHTML = renderStatisticTopics(topics, total);
    document.getElementById("stats-paper-tags").innerHTML = renderStatisticTopics(paperTopics, mappedPaperTotal);
    document.getElementById("stats-dataset-time-range").textContent = formatStatisticYearRange(
      value.dataset_year_start, value.dataset_year_end
    );
    document.getElementById("stats-paper-time-range").textContent = formatStatisticYearRange(
      value.paper_year_start, value.paper_year_end
    );
    applyHumanTimelineYearRangeFromStatistics(value);
  }

  function renderStatisticTopics(topics, total) {
    var visibleTopics = topics.slice(0, 8);
    return visibleTopics.length ? visibleTopics.map(function (tag, index) {
      var count = Math.max(0, Number(tag.count) || 0);
      var percent = total > 0 ? clamp(Math.round(count / total * 100), 0, 100) : 0;
      return (
        '<div class="stats-tag-row">' +
          '<div class="stats-tag-meta"><b class="stats-tag-rank">' +
            String(index + 1).padStart(2, "0") + '</b><span>' + escapeHtml(tag.name) + "</span>" +
            '<strong>' + formatCount(count) + '</strong><small>' + percent + '%</small></div>' +
          '<div class="stats-tag-track" aria-label="' + escapeHtml(tag.name) + "占比 " + percent + '%">' +
            '<i style="width:' + percent + '%"></i>' +
          "</div>" +
        "</div>"
      );
    }).join("") : '<div class="stats-empty-line">暂无主题标注</div>';
  }


  function hideStatisticsPanel() {
    document.getElementById("stats-panel").classList.add("hidden");
    document.body.classList.remove("stats-panel-open");
  }

  function statisticsLevelLabel(meta) {
    return meta.level === "world"
      ? "全球真实数据"
      : meta.level === "province"
        ? "省级真实数据"
        : state.level === "province"
          ? "国家真实数据"
          : "区域真实数据";
  }

  function formatStatisticPercent(value, total) {
    return total > 0 ? Math.round(value / total * 100) + "%" : "0%";
  }

  function formatStatisticYearRange(start, end) {
    var first = start == null || start === "" ? NaN : Number(start);
    var last = end == null || end === "" ? NaN : Number(end);
    if (!Number.isFinite(first) && !Number.isFinite(last)) {
      return "未标注";
    }
    if (!Number.isFinite(first) || first === last) {
      return String(Math.round(last));
    }
    if (!Number.isFinite(last)) {
      return String(Math.round(first));
    }
    return Math.round(first) + "–" + Math.round(last);
  }

  function clearCityDatasetCoverage() {
    activeCityDatasetId = null;
    activeCityPaperLocationId = null;
    cityDatasetById = {};
    cityPaperLocationStates = [];
    invalidatePaperLocationGrid();
    cityPaperLocationById = {};
    paperCameraPosition = null;
    paperCameraDirection = null;
    paperCameraUp = null;
    expandedCityDatasetId = null;
    if (datasetDetailRequestController) {
      datasetDetailRequestController.abort();
      datasetDetailRequestController = null;
    }
    if (cityDatasetCoverageSource) {
      cityDatasetCoverageSource.entities.removeAll();
    }
    if (paperDistributionCollection) {
      paperDistributionCollection.removeAll();
    }
    var list = document.getElementById("city-dataset-list");
    if (list) {
      list.querySelectorAll(".dataset-row.is-active").forEach(function (row) {
        row.classList.remove("is-active");
        var selectButton = row.querySelector(".dataset-row-select");
        if (selectButton) {
          selectButton.setAttribute("aria-pressed", "false");
        }
      });
      list.querySelectorAll(".dataset-row.is-location-active").forEach(function (row) {
        row.classList.remove("is-location-active");
      });
    }
    var locationLegend = document.getElementById("paper-location-legend");
    if (locationLegend) {
      locationLegend.classList.add("hidden");
    }
    if (viewer && !viewer.isDestroyed()) {
      viewer.scene.requestRender();
    }
  }

  function renderCityDatasetCoverage(datasets, hideInactive) {
    clearCityDatasetCoverage();
    if (!cityDatasetCoverageSource || !activeDatasetCityCode) {
      return;
    }
    datasets.forEach(function (dataset) {
      cityDatasetById[dataset.id] = dataset;
      dataset.coverage.forEach(function (coverage, coverageIndex) {
        var isPaper = dataset.itemType === "paper";
        var entity;
        var labelText = dataset.name.length > 32 ? dataset.name.slice(0, 32) + "..." : dataset.name;
        var centerLongitude = (coverage.west + coverage.east) * 0.5;
        var centerLatitude = (coverage.south + coverage.north) * 0.5;
        var label = {
          text: labelText,
          font: "500 12px sans-serif",
          fillColor: Cesium.Color.fromCssColorString(isPaper ? "#fff1ef" : "#fff4dc"),
          outlineColor: Cesium.Color.fromCssColorString("#111a20"),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#101920").withAlpha(0.88),
          backgroundPadding: new Cesium.Cartesian2(8, 5),
          pixelOffset: new Cesium.Cartesian2(0, -22),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: false
        };
        if (coverage.kind === "point") {
          entity = cityDatasetCoverageSource.entities.add({
            id: "city-dataset-" + dataset.id + "-" + coverageIndex,
            position: Cesium.Cartesian3.fromDegrees(coverage.west, coverage.south, 120),
            point: {
              pixelSize: isPaper ? 10 : 8,
              color: Cesium.Color.fromCssColorString(isPaper ? "#ff7a70" : "#4fd1c5").withAlpha(0.9),
              outlineColor: Cesium.Color.fromCssColorString(isPaper ? "#ffd7d2" : "#d9fffa").withAlpha(0.9),
              outlineWidth: isPaper ? 2 : 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: label
          });
        } else {
          entity = cityDatasetCoverageSource.entities.add({
            id: "city-dataset-" + dataset.id + "-" + coverageIndex,
            position: Cesium.Cartesian3.fromDegrees(centerLongitude, centerLatitude, 1600),
            rectangle: {
              coordinates: Cesium.Rectangle.fromDegrees(
                coverage.west, coverage.south, coverage.east, coverage.north
              ),
              material: Cesium.Color.fromCssColorString("#4fd1c5").withAlpha(0.018),
              outline: false,
              height: 18
            },
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArrayHeights([
                coverage.west, coverage.south, 1600,
                coverage.east, coverage.south, 1600,
                coverage.east, coverage.north, 1600,
                coverage.west, coverage.north, 1600,
                coverage.west, coverage.south, 1600
              ]),
              width: 1.5,
              material: Cesium.Color.fromCssColorString("#72d9cf").withAlpha(0.36),
              arcType: Cesium.ArcType.GEODESIC
            },
            point: {
              pixelSize: 1,
              color: Cesium.Color.TRANSPARENT,
              outlineWidth: 0,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              show: false
            },
            label: label
          });
        }
        entity.cityDatasetMeta = {
          datasetId: dataset.id,
          datasetName: dataset.name,
          coverageKind: coverage.kind,
          itemType: dataset.itemType || "dataset"
        };
        entity.show = coverage.kind === "point" ? !hideInactive : false;
      });
    });
    syncCityDatasetCoverageForGridMode();
    viewer.scene.requestRender();
  }

  function syncCityDatasetCoverageForGridMode() {
    if (!cityDatasetCoverageSource || !activeDatasetCityCode || !activeCityPanelData) {
      return;
    }
    var preciseGridMode = canQueryH3Point() && activeH3LayerResolution() >= 8;
    var hideInactive = preciseGridMode || activeCityPanelData.mode === "h3" || Boolean(activeCityDatasetId);
    cityDatasetCoverageSource.entities.values.forEach(function (entity) {
      var active = Boolean(
        activeCityDatasetId && entity.cityDatasetMeta &&
        entity.cityDatasetMeta.datasetId === activeCityDatasetId
      );
      if (active) {
        entity.show = true;
        applyCityDatasetCoverageStyle(entity, true);
      } else if (entity.cityDatasetMeta && entity.cityDatasetMeta.coverageKind === "point") {
        entity.show = !hideInactive;
        applyCityDatasetCoverageStyle(entity, false);
      } else {
        entity.show = false;
        applyCityDatasetCoverageStyle(entity, false);
      }
    });
    if (viewer && !viewer.isDestroyed()) {
      viewer.scene.requestRender();
    }
  }

  function renderCityPaperLocations(locations, papers, locationTotal, paperTotal) {
    clearCityDatasetCoverage();
    if (!paperDistributionCollection) {
      return;
    }
    papers.forEach(function (paper) {
      cityDatasetById[paper.id] = paper;
    });
    locations.forEach(function (location) {
      var paperIds = location.paperIds.filter(function (paperId) {
        return Boolean(cityDatasetById[paperId]);
      });
      var firstPaper = paperIds.length ? cityDatasetById[paperIds[0]] : null;
      var meta = {
        id: "city-paper-location-" + location.id,
        name: location.count > 1 ? "论文共同点位" : (firstPaper ? firstPaper.name : "论文点位"),
        type: "paper",
        cityPaperLocation: true,
        locationId: location.id,
        count: location.count,
        paperIds: paperIds,
        longitude: location.longitude,
        latitude: location.latitude
      };
      var size = paperLocationBillboardSize(location.count, false);
      var position = Cesium.Cartesian3.fromDegrees(location.longitude, location.latitude, 5200);
      var billboard = paperDistributionCollection.add({
        position: position,
        image: paperLocationSymbolImage(location.count, false),
        width: size,
        height: size,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(20000, 1.12, 3000000, 0.82),
        id: { pointMeta: meta }
      });
      var locationState = {
        id: location.id,
        location: location,
        paperIds: paperIds,
        billboard: billboard,
        meta: meta,
        position: position,
        normal: Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(position, new Cesium.Cartesian3()),
        toCamera: new Cesium.Cartesian3(),
        screenPosition: null,
        frontFacing: null
      };
      cityPaperLocationStates.push(locationState);
      cityPaperLocationById[location.id] = locationState;
    });
    invalidatePaperLocationGrid();
    var totalNode = document.getElementById("paper-location-total");
    if (totalNode) {
      var shownLocationTotal = Number.isFinite(Number(locationTotal)) && Number(locationTotal) > 0
        ? Number(locationTotal)
        : locations.length;
      var shownPaperTotal = Number.isFinite(Number(paperTotal)) && Number(paperTotal) > 0
        ? Number(paperTotal)
        : papers.length;
      totalNode.textContent = formatCount(shownLocationTotal) + " 点 / " +
        formatCount(shownPaperTotal) + " 篇";
    }
    syncMapExpressionForActiveTab();
  }

  function paperLocationBillboardSize(count, active) {
    var base = Number(count) > 1 ? 32 : 22;
    return active ? Math.round(base * 1.18) : base;
  }

  function paperLocationSymbolImage(count, active) {
    var safeCount = Math.max(1, Number(count) || 1);
    var key = safeCount + ":" + (active ? "1" : "0");
    if (cityPaperLocationImageCache[key]) {
      return cityPaperLocationImageCache[key];
    }
    var canvas = document.createElement("canvas");
    canvas.width = 72;
    canvas.height = 72;
    var context = canvas.getContext("2d");
    var center = 36;
    var radius = safeCount > 1 ? 25 : 18;
    var accent = active ? [255, 201, 94] : [255, 73, 153];
    var glow = context.createRadialGradient(center, center, 4, center, center, 34);
    glow.addColorStop(0, "rgba(" + accent.join(",") + ",0.96)");
    glow.addColorStop(0.5, "rgba(" + accent.join(",") + ",0.34)");
    glow.addColorStop(1, "rgba(" + accent.join(",") + ",0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, 72, 72);
    context.beginPath();
    context.arc(center, center, radius + 4, 0, Math.PI * 2);
    context.fillStyle = "rgba(3,8,14,0.98)";
    context.fill();
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.fillStyle = "rgb(" + accent.join(",") + ")";
    context.fill();
    context.lineWidth = active ? 3.4 : 2.8;
    context.strokeStyle = active ? "rgba(255,250,230,1)" : "rgba(255,238,247,1)";
    context.stroke();
    if (safeCount > 1) {
      var label = safeCount > 999 ? "999+" : String(Math.round(safeCount));
      context.fillStyle = "#091018";
      context.font = "700 " + (label.length >= 4 ? 16 : label.length === 3 ? 18 : 21) + "px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, center, center + 1);
    }
    cityPaperLocationImageCache[key] = canvas;
    return canvas;
  }

  function updateCityPaperLocationSelection() {
    cityPaperLocationStates.forEach(function (locationState) {
      var active = locationState.id === activeCityPaperLocationId;
      locationState.billboard.image = paperLocationSymbolImage(locationState.location.count, active);
      var size = paperLocationBillboardSize(locationState.location.count, active);
      locationState.billboard.width = size;
      locationState.billboard.height = size;
    });
    if (viewer && !viewer.isDestroyed()) {
      viewer.scene.requestRender();
    }
  }

  function cityDatasetMetaAt(position) {
    if (!cityDatasetCoverageSource || !activeDatasetCityCode) {
      return null;
    }
    var picks = viewer.scene.drillPick(position, 20);
    var fallback = null;
    for (var index = 0; index < picks.length; index += 1) {
      var id = picks[index] && picks[index].id;
      if (!id || !id.cityDatasetMeta) {
        continue;
      }
      if (id.cityDatasetMeta.datasetId === activeCityDatasetId) {
        return id.cityDatasetMeta;
      }
      fallback = fallback || id.cityDatasetMeta;
    }
    return fallback;
  }

  function invalidatePaperLocationGrid() {
    paperLocationGrid = null;
    paperLocationGridDirty = true;
  }

  function ensurePaperLocationGrid() {
    if (paperLocationGrid && !paperLocationGridDirty) {
      return paperLocationGrid;
    }
    paperLocationGridDirty = false;
    if (!viewer || viewer.isDestroyed() || !cityPaperLocationStates.length) {
      paperLocationGrid = null;
      return null;
    }
    var cellSize = 56;
    var width = viewer.scene.canvas.clientWidth;
    var height = viewer.scene.canvas.clientHeight;
    var cols = Math.max(1, Math.ceil(width / cellSize) + 1);
    var rows = Math.max(1, Math.ceil(height / cellSize) + 1);
    var cells = [];
    cityPaperLocationStates.forEach(function (locationState) {
      var screenPosition = locationState.screenPosition;
      if (!screenPosition) {
        return;
      }
      var column = Math.floor(screenPosition.x / cellSize);
      var row = Math.floor(screenPosition.y / cellSize);
      if (column < 0 || row < 0 || column >= cols || row >= rows) {
        return;
      }
      var index = row * cols + column;
      if (!cells[index]) {
        cells[index] = [];
      }
      cells[index].push(locationState);
    });
    paperLocationGrid = {
      cellSize: cellSize,
      cols: cols,
      rows: rows,
      cells: cells
    };
    return paperLocationGrid;
  }

  function cityPaperLocationMetaAt(position) {
    if (!currentPaperPointMode() || !paperDistributionCollection || !paperDistributionCollection.show) {
      return null;
    }
    var grid = ensurePaperLocationGrid();
    if (!grid) {
      return null;
    }
    var matchedMeta = null;
    var nearestDistance = Number.POSITIVE_INFINITY;
    var cellSize = grid.cellSize;
    var centerColumn = Math.floor(position.x / cellSize);
    var centerRow = Math.floor(position.y / cellSize);
    var radiusCells = 2;
    var minColumn = Math.max(0, centerColumn - radiusCells);
    var maxColumn = Math.min(grid.cols - 1, centerColumn + radiusCells);
    var minRow = Math.max(0, centerRow - radiusCells);
    var maxRow = Math.min(grid.rows - 1, centerRow + radiusCells);
    for (var row = minRow; row <= maxRow; row += 1) {
      var rowOffset = row * grid.cols;
      for (var column = minColumn; column <= maxColumn; column += 1) {
        var cell = grid.cells[rowOffset + column];
        if (!cell) {
          continue;
        }
        for (var index = 0; index < cell.length; index += 1) {
          var locationState = cell[index];
          var billboard = locationState.billboard;
          var screenPosition = locationState.screenPosition;
          if (!billboard || !billboard.show || !screenPosition) {
            continue;
          }
          var xDistance = screenPosition.x - position.x;
          var yDistance = screenPosition.y - position.y;
          var distance = Math.sqrt(xDistance * xDistance + yDistance * yDistance);
          var hitRadius = Math.max(11, Number(billboard.width) * 0.5) + 4;
          if (distance <= hitRadius && distance < nearestDistance) {
            matchedMeta = locationState.meta;
            nearestDistance = distance;
          }
        }
      }
    }
    return matchedMeta;
  }

  function onCityDatasetListClick(event) {
    var detailToggle = event.target.closest(".dataset-detail-toggle[data-dataset-id]");
    if (detailToggle && activeDatasetCityCode) {
      toggleCityDatasetDetail(detailToggle.getAttribute("data-dataset-id"));
      return;
    }
    var selectButton = event.target.closest(".dataset-row-select[data-dataset-id]");
    if (!selectButton || !activeDatasetCityCode) {
      return;
    }
    activateCityDataset(selectButton.getAttribute("data-dataset-id"), "list", true);
  }

  function activateCityDataset(datasetId, origin, flyToCoverage) {
    var id = String(datasetId || "");
    var dataset = cityDatasetById[id];
    if (!dataset || !activeDatasetCityCode) {
      return;
    }
    if (dataset.itemType === "paper" && isRegionPaperPointMode()) {
      activateCityPaper(id, origin, flyToCoverage);
      return;
    }
    document.getElementById("region-tooltip").classList.add("hidden");
    activeCityDatasetId = id;
    document.querySelectorAll("#city-dataset-list .dataset-row[data-dataset-id]").forEach(function (row) {
      var active = row.getAttribute("data-dataset-id") === id;
      row.classList.toggle("is-active", active);
      var selectButton = row.querySelector(".dataset-row-select");
      if (selectButton) {
        selectButton.setAttribute("aria-pressed", active ? "true" : "false");
      }
      if (active && origin === "globe") {
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
    cityDatasetCoverageSource.entities.values.forEach(function (entity) {
      var active = entity.cityDatasetMeta.datasetId === id;
      entity.show = active;
      applyCityDatasetCoverageStyle(entity, active);
    });
    if (flyToCoverage) {
      flyToCityDatasetCoverage(dataset);
    }
    showStatus(dataset.name + " · 已定位空间范围", 1800);
    viewer.scene.requestRender();
  }

  function activateCityPaper(paperId, origin, flyToLocation) {
    var id = String(paperId || "");
    var paper = cityDatasetById[id];
    if (!paper || paper.itemType !== "paper") {
      return;
    }
    document.getElementById("region-tooltip").classList.add("hidden");
    activeCityDatasetId = id;
    activeCityPaperLocationId = paper.locationId;
    document.querySelectorAll("#city-dataset-list .dataset-row[data-dataset-id]").forEach(function (row) {
      var rowPaper = cityDatasetById[row.getAttribute("data-dataset-id")];
      var active = row.getAttribute("data-dataset-id") === id;
      var sameLocation = Boolean(rowPaper && rowPaper.itemType === "paper" &&
        rowPaper.locationId === activeCityPaperLocationId);
      row.classList.toggle("is-active", active);
      row.classList.toggle("is-location-active", sameLocation);
      var selectButton = row.querySelector(".dataset-row-select");
      if (selectButton) {
        selectButton.setAttribute("aria-pressed", active ? "true" : "false");
      }
      if (active && origin === "globe") {
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
    updateCityPaperLocationSelection();
    if (flyToLocation) {
      flyToCityDatasetCoverage(paper);
    }
    showStatus(paper.name + " · 已定位论文点位", 1800);
  }

  function activateCityPaperLocation(locationId, origin) {
    var id = String(locationId || "");
    var locationState = cityPaperLocationById[id];
    if (!locationState || !currentPaperPointMode()) {
      return;
    }
    activeCityDatasetId = null;
    activeCityPaperLocationId = id;
    var firstMatchedRow = null;
    document.querySelectorAll("#city-dataset-list .dataset-row[data-dataset-id]").forEach(function (row) {
      var paper = cityDatasetById[row.getAttribute("data-dataset-id")];
      var sameLocation = Boolean(paper && paper.itemType === "paper" && paper.locationId === id);
      row.classList.remove("is-active");
      row.classList.toggle("is-location-active", sameLocation);
      var selectButton = row.querySelector(".dataset-row-select");
      if (selectButton) {
        selectButton.setAttribute("aria-pressed", sameLocation ? "true" : "false");
      }
      if (sameLocation && !firstMatchedRow) {
        firstMatchedRow = row;
      }
    });
    if (origin === "globe" && firstMatchedRow) {
      firstMatchedRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    updateCityPaperLocationSelection();
    showStatus(
      "论文真实点位 · " + formatCount(locationState.location.count) + " 篇论文共用该坐标",
      2000
    );
  }

  function toggleCityDatasetDetail(datasetId) {
    var id = String(datasetId || "");
    if (!cityDatasetById[id]) {
      return;
    }
    if (expandedCityDatasetId === id) {
      setCityDatasetDetailExpanded(id, false);
      expandedCityDatasetId = null;
      return;
    }
    if (expandedCityDatasetId) {
      setCityDatasetDetailExpanded(expandedCityDatasetId, false);
    }
    expandedCityDatasetId = id;
    setCityDatasetDetailExpanded(id, true);
    activateCityDataset(id, "list", false);
    var cachedItem = cityDatasetById[id];
    if (datasetDetailCache[id]) {
      if (cachedItem.itemType === "paper") {
        renderCityPaperDetail(id, datasetDetailCache[id]);
      } else if (cachedItem.itemType === "merged" || cachedItem.source === "merged") {
        renderCityMergedDatasetDetail(id, datasetDetailCache[id]);
      } else {
        renderCityDatasetDetail(id, datasetDetailCache[id]);
      }
      return;
    }
    loadCityDatasetDetail(id);
  }

  function setCityDatasetDetailExpanded(datasetId, expanded) {
    var row = document.querySelector('#city-dataset-list .dataset-row[data-dataset-id="' + datasetId + '"]');
    if (!row) {
      return;
    }
    row.classList.toggle("is-expanded", expanded);
    var toggle = row.querySelector(".dataset-detail-toggle");
    var content = row.querySelector(".dataset-row-detail");
    if (toggle) {
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggle.firstChild.nodeValue = expanded ? "收起详情" : "展开详情";
    }
    if (content) {
      content.classList.toggle("hidden", !expanded);
    }
  }

  async function loadCityDatasetDetail(datasetId) {
    var id = String(datasetId || "");
    var item = cityDatasetById[id];
    var row = document.querySelector('#city-dataset-list .dataset-row[data-dataset-id="' + id + '"]');
    var content = row && row.querySelector(".dataset-row-detail");
    if (!content) {
      return;
    }
    content.innerHTML = '<div class="dataset-detail-state">正在读取完整字段...</div>';
    var token = ++datasetDetailRequestToken;
    if (datasetDetailRequestController) {
      datasetDetailRequestController.abort();
    }
    datasetDetailRequestController = new AbortController();
    try {
      var isMerged = Boolean(item && (item.itemType === "merged" || item.source === "merged"));
      var detailUrl = item && item.itemType === "paper"
        ? "./api/paper-detail?paper_id=" + encodeURIComponent(item.rawId)
        : isMerged
          ? "./api/merged-dataset-detail?dataset_id=" + encodeURIComponent(item.rawId)
          : "./api/dataset-detail?dataset_id=" + encodeURIComponent(id);
      var response = await fetch(detailUrl, {
        signal: datasetDetailRequestController.signal,
        cache: "default"
      });
      if (!response.ok) {
        var errorPayload = await response.json().catch(function () { return {}; });
        throw new Error(errorPayload.error || "详情请求失败: " + response.status);
      }
      var detail = await response.json();
      datasetDetailCache[id] = detail;
      if (token === datasetDetailRequestToken && expandedCityDatasetId === id) {
        if (item && item.itemType === "paper") {
          renderCityPaperDetail(id, detail);
        } else if (isMerged) {
          renderCityMergedDatasetDetail(id, detail);
        } else {
          renderCityDatasetDetail(id, detail);
        }
      }
    } catch (error) {
      if (error && error.name === "AbortError") {
        return;
      }
      console.error("数据集详情加载失败", error);
      if (token === datasetDetailRequestToken && expandedCityDatasetId === id) {
        content.innerHTML = '<div class="dataset-detail-state">详情加载失败，请收起后重试</div>';
      }
    }
  }

  function renderCityDatasetDetail(datasetId, detail) {
    var row = document.querySelector('#city-dataset-list .dataset-row[data-dataset-id="' + datasetId + '"]');
    var content = row && row.querySelector(".dataset-row-detail");
    if (!content) {
      return;
    }
    var sourceUrl = safeExternalUrl(detail.url);
    var papers = Array.isArray(detail.papers) ? detail.papers : [];
    content.innerHTML =
      '<section class="dataset-detail-section">' +
        '<div class="dataset-detail-section-head"><strong>数据集信息</strong><span>数据集自身字段</span></div>' +
        renderDatasetDescriptions(detail.description) +
        '<div class="dataset-detail-fields" style="margin-top:12px">' +
          datasetDetailField("完整时间范围", detail.temporalRange, false) +
          datasetDetailField("坐标系", detail.coordinateSystem || "未注明", false) +
          datasetDetailField("完整覆盖区域", detail.region, true) +
          datasetDetailField("完整经纬度", detail.coordinates || "未标注", true) +
        '</div>' +
        (sourceUrl ? '<a class="dataset-detail-link" href="' + escapeHtml(sourceUrl) +
          '" target="_blank" rel="noopener noreferrer">打开数据集来源</a>' : "") +
      '</section>' +
      '<section class="dataset-detail-section">' +
        '<div class="dataset-detail-section-head"><strong>关联研究</strong><span>' +
          formatCount(detail.paperCount || papers.length) + " 篇论文 · " +
          formatCount(detail.problemCount || 0) + ' 个科学问题</span></div>' +
        (papers.length ? papers.map(renderDatasetPaperDetail).join("") :
          '<div class="dataset-detail-state">暂无关联论文记录</div>') +
      '</section>';
  }

  function renderCityMergedDatasetDetail(datasetId, detail) {
    var row = document.querySelector('#city-dataset-list .dataset-row[data-dataset-id="' + datasetId + '"]');
    var content = row && row.querySelector(".dataset-row-detail");
    if (!content) {
      return;
    }
    var sourceUrl = safeExternalUrl(detail.url || detail.dataOrigin || "");
    var center = detail.center && Number.isFinite(Number(detail.center.lon)) && Number.isFinite(Number(detail.center.lat))
      ? Number(detail.center.lon).toFixed(5) + "°, " + Number(detail.center.lat).toFixed(5) + "°"
      : "";
    var bounds = Array.isArray(detail.bounds) && detail.bounds.length >= 4
      ? detail.bounds.slice(0, 4).map(Number).map(function (value) { return value.toFixed(5) + "°"; }).join(" / ")
      : "";
    var tags = Array.isArray(detail.tags) ? detail.tags.map(String).join(" / ") : "";
    content.innerHTML =
      '<section class="dataset-detail-section">' +
        '<div class="dataset-detail-section-head"><strong>数据集信息</strong><span>合并数据集字段</span></div>' +
        '<div class="dataset-detail-fields">' +
          datasetDetailField("数据集名称", detail.name, false) +
          datasetDetailField("英文名称", detail.nameEn, false) +
          datasetDetailField("来源大类", detail.sourceCategory, false) +
          datasetDetailField("来源子类", detail.sourceSubcategory, false) +
          datasetDetailField("数据分类", detail.datasetClassify, false) +
          datasetDetailField("访问方式", detail.dataAccessMode, false) +
          datasetDetailField("数据大小", detail.dataSize, false) +
          datasetDetailField("数据格式", detail.format, false) +
        '</div>' +
        '<p class="dataset-detail-description">' + escapeHtml(detail.description || "未标注") + '</p>' +
        (detail.descriptionEn ? '<p class="dataset-detail-description">' + escapeHtml(detail.descriptionEn) + '</p>' : "") +
        (sourceUrl ? '<a class="dataset-detail-link" href="' + escapeHtml(sourceUrl) +
          '" target="_blank" rel="noopener noreferrer">打开数据集来源</a>' : "") +
      '</section>' +
      '<section class="dataset-detail-section">' +
        '<div class="dataset-detail-section-head"><strong>空间坐标</strong><span>坐标提取与校验字段</span></div>' +
        '<div class="dataset-detail-fields">' +
          datasetDetailField("坐标状态", detail.coordinateStatus, false) +
          datasetDetailField("输出坐标系", detail.coordinateSystem, false) +
          datasetDetailField("中心点", center, false) +
          datasetDetailField("四至范围", bounds, true) +
          datasetDetailField("覆盖范围", detail.areaRange, true) +
          datasetDetailField("来源覆盖范围", detail.sourceAreaRange, true) +
          datasetDetailField("坐标提取来源", detail.coordinateExtractSource, true) +
          datasetDetailField("坐标校验", detail.coordinateValidation, false) +
          datasetDetailField("坐标说明", detail.coordinateNote, true) +
        '</div>' +
      '</section>' +
      '<section class="dataset-detail-section">' +
        '<div class="dataset-detail-section-head"><strong>来源与更新</strong><span>数据来源与标签字段</span></div>' +
        '<div class="dataset-detail-fields">' +
          datasetDetailField("数据来源名称", detail.dataOriginName, false) +
          datasetDetailField("数据来源地址", detail.dataOrigin || detail.url, true) +
          datasetDetailField("更新时间", detail.updateTime || detail.realUploadTime, false) +
          datasetDetailField("时间线时间", detail.timelineTime, false) +
          datasetDetailField("时间线类型", detail.timelineType, false) +
          datasetDetailField("标签", tags, true) +
        '</div>' +
      '</section>';
  }

  function renderCityPaperDetail(datasetId, detail) {
    var row = document.querySelector('#city-dataset-list .dataset-row[data-dataset-id="' + datasetId + '"]');
    var content = row && row.querySelector(".dataset-row-detail");
    if (!content) {
      return;
    }
    var authors = Array.isArray(detail.authors) && detail.authors.length
      ? detail.authors.join(" / ")
      : "未标注";
    var keywordText = Array.isArray(detail.keywords) && detail.keywords.length
      ? detail.keywords.join(" / ")
      : "未标注";
    var coordinate = Number.isFinite(Number(detail.longitude)) && Number.isFinite(Number(detail.latitude))
      ? Number(detail.longitude).toFixed(5) + "°, " + Number(detail.latitude).toFixed(5) + "°"
      : (detail.coordinate || "未标注");
    content.innerHTML =
      '<section class="dataset-detail-section">' +
        '<div class="dataset-detail-section-head"><strong>论文信息</strong><span>论文自身字段</span></div>' +
        '<div class="dataset-detail-fields">' +
          datasetDetailField("发表年份", detail.publicationYear, false) +
          datasetDetailField("学科主题", detail.subject, false) +
          datasetDetailField("研究对象", detail.studyObject, true) +
          datasetDetailField("作者", authors, true) +
          datasetDetailField("作者机构", detail.affiliation, true) +
          datasetDetailField("关键词", keywordText, true) +
        '</div>' +
      '</section>' +
      '<section class="dataset-detail-section">' +
        '<div class="dataset-detail-section-head"><strong>研究范围与方法</strong><span>时空与方法字段</span></div>' +
        '<div class="dataset-detail-fields">' +
          datasetDetailField("时间主题", detail.timeTheme, false) +
          datasetDetailField("标准化坐标", coordinate, false) +
          datasetDetailField("研究区域", detail.studyArea, true) +
          datasetDetailField("数据来源", detail.dataSources, true) +
          datasetDetailField("样本类型", detail.sampleTypes, true) +
          datasetDetailField("分析技术", detail.analyticalTechniques, true) +
          datasetDetailField("研究方法", detail.researchMethodology, true) +
        '</div>' +
      '</section>' +
      '<section class="dataset-detail-section">' +
        '<div class="dataset-detail-section-head"><strong>主要结论</strong><span>原表摘录</span></div>' +
        '<p class="dataset-detail-description">' + escapeHtml(detail.mainFindings || "未标注") + '</p>' +
      '</section>';
  }

  function renderDatasetDescriptions(value) {
    var descriptions = String(value || "").split(" | ").map(function (item) {
      return item.trim();
    }).filter(Boolean);
    if (!descriptions.length) {
      descriptions = ["暂无数据集描述"];
    }
    return '<div class="dataset-detail-description-block">' +
      '<div class="dataset-detail-description-head"><span>数据集描述</span>' +
        (descriptions.length > 1 ? '<small>' + formatCount(descriptions.length) + ' 条来源记录</small>' : "") +
      '</div>' +
      '<div class="dataset-detail-description-list">' + descriptions.map(function (description) {
        return '<p class="dataset-detail-description">' + escapeHtml(description) + '</p>';
      }).join("") + '</div>' +
    '</div>';
  }

  function datasetDetailField(label, value, wide) {
    return '<div class="dataset-detail-field' + (wide ? " dataset-detail-field-wide" : "") + '">' +
      '<span>' + escapeHtml(label) + '</span><p>' + escapeHtml(value || "未标注") + '</p></div>';
  }

  function renderDatasetPaperDetail(paper) {
    var doi = String(paper.doi || "").trim();
    var doiUrl = doi ? safeExternalUrl("https://doi.org/" + doi) : "";
    var publication = formatPublicationDate(paper.publicationDate || paper.publicationYear);
    var questions = Array.isArray(paper.scientificProblems) ? paper.scientificProblems : [];
    var temporal = detailValueList(paper.useTemporalRanges);
    var regions = detailValueList(paper.useRegions);
    var coordinates = detailValueList(paper.useCoordinates);
    var usageRows = [];
    if (temporal) {
      usageRows.push('<div><span>使用时间</span><p>' + temporal + '</p></div>');
    }
    if (regions) {
      usageRows.push('<div><span>使用区域</span><p>' + regions + '</p></div>');
    }
    if (coordinates) {
      usageRows.push('<div><span>使用坐标</span><p>' + coordinates + '</p></div>');
    }
    return '<article class="dataset-detail-paper">' +
      '<strong class="dataset-detail-paper-title">' + escapeHtml(paper.title || "未命名论文") + '</strong>' +
      '<div class="dataset-detail-paper-meta"><span>' + escapeHtml(publication) + '</span>' +
        (doiUrl ? '<a href="' + escapeHtml(doiUrl) + '" target="_blank" rel="noopener noreferrer">DOI ' +
          escapeHtml(doi) + '</a>' : '<span>DOI 未标注</span>') + '</div>' +
      (questions.length ? questions.map(function (question) {
        return '<div class="dataset-detail-question"><span>科学问题</span><p>' +
          escapeHtml(question) + '</p></div>';
      }).join("") : '<div class="dataset-detail-question"><span>科学问题</span><p>未标注</p></div>') +
      (usageRows.length ? '<div class="dataset-detail-usage">' + usageRows.join("") + '</div>' : "") +
    '</article>';
  }

  function formatPublicationDate(value) {
    var publication = String(value == null ? "" : value).trim();
    if (!publication) {
      return "发表日期未标注";
    }
    return /^\d{4}\.0+$/.test(publication) ? publication.split(".")[0] : publication;
  }

  function detailValueList(values) {
    return Array.isArray(values) ? values.filter(Boolean).map(escapeHtml).join("<br>") : "";
  }

  function safeExternalUrl(value) {
    try {
      var url = new URL(String(value || ""), window.location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch (error) {
      return "";
    }
  }

  function applyCityDatasetCoverageStyle(entity, active) {
    var isPaper = entity.cityDatasetMeta && entity.cityDatasetMeta.itemType === "paper";
    var baseColor = isPaper ? "#ff7a70" : "#4fd1c5";
    if (entity.point) {
      var isPointCoverage = entity.cityDatasetMeta && entity.cityDatasetMeta.coverageKind === "point";
      entity.point.show = isPointCoverage || active;
      entity.point.pixelSize = active ? (entity.rectangle ? 10 : 17) : (isPointCoverage ? (isPaper ? 10 : 7) : 1);
      entity.point.color = Cesium.Color.fromCssColorString(active ? COLORS.selected : baseColor)
        .withAlpha(active ? 1 : 0.34);
      entity.point.outlineColor = Cesium.Color.WHITE.withAlpha(active ? 0.95 : 0.45);
      entity.point.outlineWidth = active ? 3 : 1;
    }
    if (entity.rectangle) {
      entity.rectangle.material = Cesium.Color.fromCssColorString(active ? COLORS.selected : baseColor)
        .withAlpha(active ? 0.12 : 0.012);
    }
    if (entity.polyline) {
      entity.polyline.width = active ? 6 : 1.5;
      entity.polyline.material = active
        ? new Cesium.PolylineGlowMaterialProperty({
          color: Cesium.Color.fromCssColorString(COLORS.selected),
          glowPower: 0.2,
          taperPower: 0.7
        })
        : Cesium.Color.fromCssColorString(isPaper ? "#ff9d95" : "#72d9cf").withAlpha(0.44);
    }
    if (entity.label) {
      entity.label.show = active;
    }
  }

  function flyToCityDatasetCoverage(dataset) {
    if (!dataset.coverage.length) {
      showStatus(dataset.name + " · 暂无可定位坐标", 1800);
      return;
    }
    var bounds = dataset.coverage.reduce(function (extent, coverage) {
      return [
        Math.min(extent[0], coverage.west),
        Math.min(extent[1], coverage.south),
        Math.max(extent[2], coverage.east),
        Math.max(extent[3], coverage.north)
      ];
    }, [180, 90, -180, -90]);
    var minimumSpan = 0.08;
    var longitudePadding = Math.max(minimumSpan, (bounds[2] - bounds[0]) * 0.16);
    var latitudePadding = Math.max(minimumSpan, (bounds[3] - bounds[1]) * 0.16);
    datasetFlyLockUntil = Date.now() + 3200;
    viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(
        clamp(bounds[0] - longitudePadding, -180, 180),
        clamp(bounds[1] - latitudePadding, -89.9, 89.9),
        clamp(bounds[2] + longitudePadding, -180, 180),
        clamp(bounds[3] + latitudePadding, -89.9, 89.9)
      ),
      duration: 0.85
    });
  }

  async function showCityDatasetPanel(meta) {
    if (!meta || !meta.code) {
      return;
    }
    var requestToken = ++cityDatasetRequestToken;
    if (cityDatasetRequestController) {
      cityDatasetRequestController.abort();
    }
    cityDatasetRequestController = new AbortController();
    regionPaperSignature = "";
    regionPaperLocationsActive = false;
    clearCityDatasetCoverage();
    activeDatasetCityCode = meta.code;
    activeCityPanelTab = "datasets";
    activeCityPanelData = {
      mode: "region",
      meta: meta,
      datasets: [],
      papers: [],
      paperLocations: [],
      datasetTotal: Math.max(0, Number(meta.count) || 0),
      paperTotal: Math.max(0, Number(meta.paperCount) || 0),
      paperLocationTotal: 0,
      loading: true
    };
    if (meta.level === "city") {
      state.path = state.path.slice(0, 3).concat([{
        code: meta.code,
        name: meta.name,
        level: "city",
        count: meta.count
      }]);
    }
    updateDrillUi(currentBoundarySource ? currentBoundarySource.entities.values.length : 0);
    renderDatasetPanel({
      kicker: regionDatasetKicker(meta),
      title: shortName(meta.name) + "数据",
      datasets: [],
      totalCount: meta.count,
      emptyTitle: "正在加载数据集",
      emptyText: "正在读取该区域的真实数据",
      footerText: "",
      compact: true,
      cityInteractive: true,
      cityTabs: true
    });
    syncMapExpressionForActiveTab();
    try {
      var parameters = datasetFilterParameters();
      parameters.set("region_code", meta.code);
      parameters.set("limit", meta.level === "city" ? "1000" : "100");
      var responses = await Promise.all([
        fetch("./api/region-datasets?" + parameters.toString(), {
          signal: cityDatasetRequestController.signal,
          cache: "default"
        }),
        fetch("./api/region-papers?" + parameters.toString(), {
          signal: cityDatasetRequestController.signal,
          cache: "default"
        })
      ]);
      for (var responseIndex = 0; responseIndex < responses.length; responseIndex += 1) {
        if (!responses[responseIndex].ok) {
          var detail = await responses[responseIndex].json().catch(function () { return {}; });
          throw new Error(detail.error || "区域数据请求失败: " + responses[responseIndex].status);
        }
      }
      var payloads = await Promise.all(responses.map(function (response) { return response.json(); }));
      if (requestToken !== cityDatasetRequestToken || activeDatasetCityCode !== meta.code) {
        return;
      }
      var datasets = sanitizeCityDatasets(payloads[0].datasets || []);
      var paperLocations = sanitizeCityPaperLocations(payloads[1].locations || []);
      var papers = sortCityPapersByLocation(
        sanitizeCityPapers(payloads[1].papers || []),
        paperLocations
      );
      var totalCount = Math.max(0, Number(payloads[0].total) || 0);
      var paperTotal = Math.max(0, Number(payloads[1].total) || 0);
      var paperLocationTotal = Math.max(0, Number(payloads[1].locationTotal) || 0);
      applyHumanTimelineYearRangeFromStatistics({
        dataset_year_start: payloads[0].dataset_year_start,
        dataset_year_end: payloads[0].dataset_year_end,
        paper_year_start: payloads[1].paper_year_start,
        paper_year_end: payloads[1].paper_year_end
      });
      suppliedCityDatasets[meta.code] = datasets;
      suppliedCounts[meta.code] = totalCount;
      suppliedPaperCounts[meta.code] = paperTotal;
      meta.count = totalCount;
      meta.paperCount = paperTotal;
      if (meta.level === "city" && state.path[3]) {
        state.path[3].count = totalCount;
      }
      markerImageCache = {};
      activeCityPanelData = {
        mode: "region",
        meta: meta,
        datasets: datasets,
        papers: papers,
        paperLocations: paperLocations,
        datasetTotal: totalCount,
        paperTotal: paperTotal,
        paperLocationTotal: paperLocationTotal,
        loading: false
      };
      renderActiveCityTab();
      updateDrillUi(currentBoundarySource ? currentBoundarySource.entities.values.length : 0);
    } catch (error) {
      if (error && error.name === "AbortError") {
        return;
      }
      console.error("区域数据集加载失败", error);
      if (requestToken === cityDatasetRequestToken) {
        renderDatasetPanel({
          kicker: regionDatasetKicker(meta),
          title: shortName(meta.name) + "数据",
          datasets: [],
          totalCount: 0,
          emptyTitle: "区域数据加载失败",
          emptyText: "请稍后重试",
          footerText: "",
          compact: true,
          cityInteractive: true,
          cityTabs: true
        });
      }
    }
  }

  function regionDatasetKicker(meta) {
    return meta && meta.level === "country"
      ? "国家数据目录"
      : meta && meta.level === "province"
        ? "省份数据目录"
        : "城市数据目录";
  }

  function renderActiveCityTab() {
    if (!activeCityPanelData || !activeDatasetCityCode) {
      return;
    }
    if (activeCityPanelData.mode === "search") {
      renderSearchResultsTab();
      return;
    }
    var isPaperTab = activeCityPanelTab === "papers";
    var records = isPaperTab ? activeCityPanelData.papers : activeCityPanelData.datasets;
    var total = isPaperTab ? activeCityPanelData.paperTotal : activeCityPanelData.datasetTotal;
    var itemLabel = isPaperTab ? "论文" : "数据集";
    var isSelection = activeCityPanelData.mode === "selection";
    var isH3Point = activeCityPanelData.mode === "h3";
    var selectionCopy = isSelection ? selectionPanelCopy() : null;
    var selectionSummary = null;
    if (isSelection) {
      var selectionRegionCovered = Math.max(0, Number(activeCityPanelData.regionCoveredTotal) || 0);
      var hasLocalSelectionDatasets = Math.max(0, Number(activeCityPanelData.datasetTotal) || 0) > 0;
      selectionSummary = selectionStatistics(records, selectionBounds, {
        datasetCount: activeCityPanelData.datasetTotal,
        paperCount: activeCityPanelData.paperTotal,
        tags: isPaperTab ? activeCityPanelData.paperTopics : activeCityPanelData.datasetTopics,
        rangeNote: selectionRegionCovered > 0 && !isPaperTab
          ? (!hasLocalSelectionDatasets ? "该范围无独立数据集；另有 " : "另有 ") +
            formatCount(selectionRegionCovered) + " 个区域级数据集覆盖该范围"
          : ""
      });
    } else if (isH3Point) {
      selectionSummary = h3PointStatistics(activeCityPanelData, isPaperTab);
    }
    renderDatasetPanel({
      kicker: isSelection ? selectionCopy.kicker : isH3Point ? "H3 精细网格" : regionDatasetKicker(activeCityPanelData.meta),
      title: isSelection ? selectionCopy.title : isH3Point ? "该网格内数据" : shortName(activeCityPanelData.meta.name) + "数据",
      datasets: records,
      totalCount: total,
      countUnit: isPaperTab ? "篇" : "项",
      emptyTitle: isSelection || isH3Point ? "范围内暂无匹配" + itemLabel : "该区域暂无匹配" + itemLabel,
      emptyText: isPaperTab ? "仅显示坐标严格落在当前范围内的论文" : "调整筛选条件或空间范围后重试",
      footerText: records.length < total
        ? "当前展示 " + records.length + " / " + formatCount(total)
        : "共 " + formatCount(total) + " " + (isPaperTab ? "篇论文" : "个数据集"),
      compact: true,
      cityInteractive: true,
      cityTabs: true,
      selectionSummary: selectionSummary
    });
    if (isSelection) {
      renderCityDatasetCoverage(records, true);
    } else if (isPaperTab && activeCityPanelData.meta &&
        (activeCityPanelData.meta.level === "country" ||
         activeCityPanelData.meta.level === "province" ||
         activeCityPanelData.meta.level === "city")) {
      renderCityPaperLocations(
        isH3Point ? paperLocationsFromPapers(records) : activeCityPanelData.paperLocations || [],
        records,
        activeCityPanelData.paperLocationTotal,
        activeCityPanelData.paperTotal
      );
    } else if (activeCityPanelData.meta && activeCityPanelData.meta.level === "city") {
      renderCityDatasetCoverage(records, isH3Point);
    } else {
      clearCityDatasetCoverage();
    }
    syncMapExpressionForActiveTab();
  }

  function showSearchResultsPanel() {
    var query = filterState.query.trim();
    if (!query) {
      return;
    }
    activeDatasetCityCode = "__search__";
    var state = keywordSearchState && keywordSearchState.query === query ? keywordSearchState : null;
    var loading = !state || state.loading;
    if (!activeCityPanelData || activeCityPanelData.mode !== "search" ||
        activeCityPanelData.query !== query) {
      activeCityPanelTab = "datasets";
    }
    activeCityPanelData = {
      mode: "search",
      meta: null,
      query: query,
      loading: loading,
      error: state && !loading && state.error ? String(state.error) : "",
      datasets: state && !loading ? state.datasets : [],
      papers: state && !loading ? state.papers : [],
      datasetTotal: state && !loading ? state.datasets.length : 0,
      paperTotal: state && !loading ? state.papers.length : 0,
      datasetTopics: [],
      paperTopics: [],
      serverTotal: state && !loading ? state.total : 0
    };
    activeCityPanelData.datasets.concat(activeCityPanelData.papers).forEach(function (record) {
      cityDatasetById[record.id] = record;
    });
    renderActiveCityTab();
  }

  function renderSearchResultsTab() {
    var state = activeCityPanelData;
    var isPaperTab = activeCityPanelTab === "papers";
    var records = isPaperTab ? state.papers : state.datasets;
    var total = isPaperTab ? state.paperTotal : state.datasetTotal;
    var displayQuery = state.query.length > 14 ? state.query.slice(0, 14) + "..." : state.query;
    var emptyTitle = "正在搜索...";
    var emptyText = "正在检索数据集与论文";
    var footerText = "";
    if (!state.loading) {
      if (state.error) {
        emptyTitle = "搜索失败";
        emptyText = state.error;
      } else {
        emptyTitle = "未找到匹配数据";
        emptyText = "尝试更换关键词或减少筛选条件";
        footerText = records.length < total
          ? "当前展示 " + records.length + " / " + formatCount(total)
          : "共 " + formatCount(total) + " " + (isPaperTab ? "篇论文" : "个数据集");
      }
    }
    renderDatasetPanel({
      kicker: "关键词搜索",
      title: "“" + displayQuery + "”结果",
      datasets: records,
      totalCount: total,
      countUnit: isPaperTab ? "篇" : "项",
      emptyTitle: emptyTitle,
      emptyText: emptyText,
      footerText: footerText,
      compact: true,
      cityInteractive: true,
      cityTabs: true
    });
    if (!state.loading && !state.error && records.length) {
      renderCityDatasetCoverage(records, false);
    } else {
      clearCityDatasetCoverage();
    }
    syncMapExpressionForActiveTab();
    var locateHint = document.getElementById("search-locate-hint");
    if (locateHint) {
      if (!state.loading && !state.error && Number(state.serverTotal || 0) === 0) {
        showSearchLocateHint(state.query, locateHint);
      } else {
        locateHint.classList.add("hidden");
      }
    }
  }

  function showSearchLocateHint(query, hintElement) {
    var trimmed = String(query || "").trim();
    if (!trimmed) {
      hintElement.classList.add("hidden");
      return;
    }
    var token = searchActionToken;
    loadLocationIndex().then(function (locations) {
      if (token !== searchActionToken || !activeCityPanelData ||
          activeCityPanelData.mode !== "search" ||
          String(activeCityPanelData.query || "").trim() !== trimmed) {
        hintElement.classList.add("hidden");
        return;
      }
      var target = findLocationTarget(trimmed, locations);
      var hintName = document.getElementById("search-locate-hint-name");
      if (!target || !hintName) {
        hintElement.classList.add("hidden");
        return;
      }
      hintName.textContent = target.name;
      hintElement.classList.remove("hidden");
    }).catch(function () {
      hintElement.classList.add("hidden");
    });
  }

  function selectionPanelCopy() {
    if (selectionCircle) {
      return { kicker: "圆形点选", title: "圆形范围数据", empty: "正在查询圆形范围" };
    }
    if (selectionPolygon) {
      return { kicker: "自由圈选", title: "圈选范围数据", empty: "正在查询圈选范围" };
    }
    return { kicker: "空间框选", title: "框选范围数据", empty: "正在查询框选范围" };
  }

  async function showSelectionResultsPanel() {
    if (!selectionBounds) {
      return;
    }
    var bounds = publicSelectionBounds(selectionBounds);
    var boundsSignature = [bounds.west, bounds.south, bounds.east, bounds.north].join(",");
    var circle = selectionCircle ? publicSelectionCircle(selectionCircle) : null;
    var circleSignature = circle ? [circle.longitude, circle.latitude, circle.radiusKm].join(",") : "";
    var polygon = selectionPolygon ? publicSelectionPolygon(selectionPolygon) : null;
    var polygonSignature = polygon ? polygon.map(function (point) { return point.join(","); }).join(";") : "";
    var copy = selectionPanelCopy();
    var requestToken = ++selectionDatasetRequestToken;
    if (selectionDatasetRequestController) {
      selectionDatasetRequestController.abort();
    }
    selectionDatasetRequestController = new AbortController();
    activeDatasetCityCode = "__selection__";
    activeCityPanelTab = "datasets";
    activeCityPanelData = {
      mode: "selection",
      meta: { code: "__selection__", name: completedSelectionName() + "范围" },
      datasets: [],
      papers: [],
      datasetTotal: 0,
      paperTotal: 0,
      datasetTopics: [],
      paperTopics: [],
      loading: true
    };
    clearCityDatasetCoverage();
    renderDatasetPanel({
      kicker: copy.kicker,
      title: copy.title,
      datasets: [],
      totalCount: 0,
      emptyTitle: copy.empty,
      emptyText: "正在从 CSV 真实数据中计算空间相交结果",
      footerText: "",
      compact: true,
      cityInteractive: true,
      cityTabs: true,
      selectionSummary: selectionStatistics([], selectionBounds, { datasetCount: 0, paperCount: 0 })
    });
    try {
      var parameters = datasetFilterParameters();
      parameters.set("bounds", boundsSignature);
      if (circleSignature) {
        parameters.set("circle", circleSignature);
      }
      if (polygonSignature) {
        parameters.set("polygon", polygonSignature);
      }
      parameters.set("limit", "100");
      var responses = await Promise.all([
        fetch("./api/bounds-datasets?" + parameters.toString(), {
          signal: selectionDatasetRequestController.signal,
          cache: "default"
        }),
        fetch("./api/bounds-papers?" + parameters.toString(), {
          signal: selectionDatasetRequestController.signal,
          cache: "default"
        })
      ]);
      for (var responseIndex = 0; responseIndex < responses.length; responseIndex += 1) {
        if (!responses[responseIndex].ok) {
          var detail = await responses[responseIndex].json().catch(function () { return {}; });
          throw new Error(detail.error || "框选数据请求失败: " + responses[responseIndex].status);
        }
      }
      var payloads = await Promise.all(responses.map(function (response) { return response.json(); }));
      if (requestToken !== selectionDatasetRequestToken || !selectionBounds ||
          Object.values(publicSelectionBounds(selectionBounds)).join(",") !== boundsSignature ||
          (selectionCircle ? Object.values(publicSelectionCircle(selectionCircle)).join(",") : "") !== circleSignature ||
          (selectionPolygon ? publicSelectionPolygon(selectionPolygon).map(function (point) {
            return point.join(",");
          }).join(";") : "") !== polygonSignature) {
        return;
      }
      var datasets = sanitizeCityDatasets(payloads[0].datasets || []);
      var papers = sanitizeCityPapers(payloads[1].papers || []);
      var totalCount = Math.max(0, Number(payloads[0].total) || 0);
      var paperTotal = Math.max(0, Number(payloads[1].total) || 0);
      var paperLocationTotal = Math.max(0, Number(payloads[1].locationTotal) || 0);
      applyHumanTimelineYearRangeFromStatistics({
        dataset_year_start: payloads[0].dataset_year_start,
        dataset_year_end: payloads[0].dataset_year_end,
        paper_year_start: payloads[1].paper_year_start,
        paper_year_end: payloads[1].paper_year_end
      });
      var datasetTopics = Array.isArray(payloads[0].topics) ? payloads[0].topics.map(function (topic) {
        return String(topic.name || topic.value || "").trim();
      }).filter(Boolean) : [];
      var paperTopics = Array.isArray(payloads[1].topics) ? payloads[1].topics.map(function (topic) {
        return String(topic.name || topic.value || "").trim();
      }).filter(Boolean) : [];
      activeCityPanelData = {
        mode: "selection",
        meta: { code: "__selection__", name: completedSelectionName() + "范围" },
        datasets: datasets,
        papers: papers,
        datasetTotal: totalCount,
        paperTotal: paperTotal,
        datasetTopics: datasetTopics,
        paperTopics: paperTopics,
        regionCoveredTotal: Math.max(0, Number(payloads[0].region_covered_total) || 0),
        loading: false
      };
      renderActiveCityTab();
    } catch (error) {
      if (error && error.name === "AbortError") {
        return;
      }
      console.error("框选数据集加载失败", error);
      if (requestToken === selectionDatasetRequestToken && selectionBounds) {
        renderDatasetPanel({
          kicker: copy.kicker,
          title: copy.title,
          datasets: [],
          totalCount: 0,
          emptyTitle: "框选数据加载失败",
          emptyText: "请重新框选或稍后重试",
          footerText: "",
          compact: true,
          cityInteractive: true,
          cityTabs: true,
          selectionSummary: selectionStatistics([], selectionBounds, { datasetCount: 0, paperCount: 0 })
        });
      }
    }
  }

  function datasetSourceLabel(source, itemType) {
    if (itemType === "paper") {
      return "";
    }
    if (source === "海纳数据集" || source === "OneEarth数据集") {
      return source;
    }
    return "科学数据";
  }

  function renderDatasetPanel(options) {
    if (!datasetPanelVisible) {
      concealDatasetPanel();
      return;
    }
    hideStatisticsPanel();
    document.getElementById("dataset-panel").classList.remove("hidden");
    document.body.classList.add("dataset-panel-open");
    var locateHint = document.getElementById("search-locate-hint");
    if (locateHint) {
      locateHint.classList.add("hidden");
    }
    var panelTabs = document.getElementById("dataset-panel-tabs");
    panelTabs.classList.toggle("hidden", !options.cityTabs);
    if (options.cityTabs) {
      document.getElementById("dataset-tab-count").textContent = formatCount(
        activeCityPanelData ? activeCityPanelData.datasetTotal : 0
      );
      document.getElementById("paper-tab-count").textContent = formatCount(
        activeCityPanelData ? activeCityPanelData.paperTotal : 0
      );
      panelTabs.querySelectorAll("[data-city-tab]").forEach(function (button) {
        button.classList.toggle("is-active", button.getAttribute("data-city-tab") === activeCityPanelTab);
      });
    }
    document.querySelector(".dataset-panel-kicker").textContent = options.kicker;
    document.getElementById("dataset-panel-title").textContent = options.title;
    document.getElementById("dataset-panel-count").textContent = formatCount(options.totalCount) + " " +
      (options.countUnit || "项");
    renderSelectionSummary(options.selectionSummary || null);
    var empty = document.getElementById("dataset-panel-empty");
    empty.classList.toggle("hidden", options.datasets.length > 0);
    empty.querySelector("strong").textContent = options.emptyTitle;
    empty.querySelector("span:last-child").textContent = options.emptyText;
    var datasetList = document.getElementById("city-dataset-list");
    var cityInteractive = Boolean(options.cityInteractive);
    datasetList.classList.toggle("dataset-list-compact", Boolean(options.compact));
    datasetList.innerHTML = options.datasets.map(function (dataset, index) {
      var tags = dataset.tags.map(function (tag) {
        return '<span class="dataset-tag">' + escapeHtml(tag) + "</span>";
      }).join("");
      var region = dataset.regionName
        ? '<small class="dataset-region">' + escapeHtml(dataset.regionName) + "</small>"
        : "";
      var timeRange = dataset.timeRange
        ? '<small class="dataset-time">' + escapeHtml(dataset.timeRange) + "</small>"
        : "";
      var sourceLabel = datasetSourceLabel(dataset.source, dataset.itemType);
      var sourceBadge = sourceLabel
        ? '<span class="dataset-source" title="数据来源">' + escapeHtml(sourceLabel) + '</span>'
        : "";
      var thumbnail = options.compact ? "" : (
        '<img class="dataset-thumbnail" src="' + escapeHtml(datasetThumbnail(dataset, index)) +
          '" alt="" loading="lazy">'
      );
      if (cityInteractive) {
        var datasetId = escapeHtml(dataset.id);
        var active = activeCityDatasetId === dataset.id;
        var expanded = expandedCityDatasetId === dataset.id;
        var paperClass = dataset.itemType === "paper" ? " is-paper" : "";
        return (
          '<article class="dataset-row' + paperClass + (active ? " is-active" : "") +
            (expanded ? " is-expanded" : "") + '" data-dataset-id="' + datasetId + '">' +
            '<button class="dataset-row-select" type="button" data-dataset-id="' + datasetId +
              '" aria-pressed="' + (active ? "true" : "false") + '">' +
              '<div class="dataset-row-title">' +
                '<strong class="dataset-name">' + escapeHtml(dataset.name) + '</strong>' +
                sourceBadge +
              '</div>' +
              '<div class="dataset-row-meta">' + timeRange + '</div>' +
              '<div class="dataset-tags">' + tags + '</div>' +
            '</button>' +
            '<div class="dataset-row-actions"><button class="dataset-detail-toggle" type="button" ' +
              'data-dataset-id="' + datasetId + '" aria-expanded="' + (expanded ? "true" : "false") +
              '">' + (expanded ? "收起详情" : "展开详情") + '</button></div>' +
            '<div class="dataset-row-detail' + (expanded ? "" : " hidden") + '"></div>' +
          '</article>'
        );
      }
      return (
        '<article class="dataset-row' +
          '" role="listitem">' +
          thumbnail +
          '<div class="dataset-row-main">' +
            '<div class="dataset-row-title">' +
              '<strong class="dataset-name">' + escapeHtml(dataset.name) + "</strong>" +
              sourceBadge +
            '</div>' +
            '<div class="dataset-row-meta">' + region + timeRange + "</div>" +
            '<div class="dataset-tags">' + tags + "</div>" +
          "</div>" +
        "</article>"
      );
    }).join("");
    var footer = document.getElementById("dataset-panel-footer");
    footer.textContent = options.footerText;
    footer.classList.toggle("hidden", options.datasets.length === 0);
  }

  function renderSelectionSummary(statistics) {
    var summary = document.getElementById("selection-summary");
    var clearButton = document.getElementById("dataset-panel-clear");
    if (!statistics) {
      summary.classList.add("hidden");
      clearButton.classList.add("hidden");
      return;
    }
    summary.classList.remove("hidden");
    clearButton.classList.remove("hidden");
    clearButton.title = activeH3Point
      ? "返回城市数据"
      : selectionCircle ? "清除圆形筛选" : selectionPolygon ? "清除自由圈选" : "清除矩形框选";
    document.getElementById("selection-range-label").textContent = statistics.rangeLabel;
    var rangeNote = document.getElementById("selection-range-note");
    if (rangeNote) {
      if (statistics.rangeNote) {
        rangeNote.textContent = statistics.rangeNote;
        rangeNote.classList.remove("hidden");
      } else {
        rangeNote.textContent = "";
        rangeNote.classList.add("hidden");
      }
    }
    document.getElementById("selection-dataset-count").textContent = formatCount(statistics.datasetCount);
    document.getElementById("selection-paper-count").textContent = formatCount(statistics.paperCount);
    document.getElementById("selection-area-label").textContent = statistics.areaLabel || "框选面积";
    document.getElementById("selection-area").textContent = statistics.area;
    document.getElementById("selection-tags").innerHTML = statistics.tags.length
      ? statistics.tags.map(function (tag) {
        return "<span>" + escapeHtml(tag) + "</span>";
      }).join("")
      : "<span>暂无主题标签</span>";
  }

  function selectionStatistics(datasets, bounds, supplied) {
    var external = supplied || {};
    var tags = Array.isArray(external.tags) ? external.tags.map(String) : topDatasetTags(datasets, 4);
    return {
      datasetCount: external.datasetCount == null
        ? datasets.filter(function (item) { return item.itemType !== "paper"; }).length
        : Math.max(0, Number(external.datasetCount) || 0),
      paperCount: external.paperCount == null
        ? datasets.filter(function (item) { return item.itemType === "paper"; }).length
        : Math.max(0, Number(external.paperCount) || 0),
      area: external.area || formatArea(spatialSelectionAreaKm2(bounds)),
      areaLabel: external.areaLabel || (
        selectionCircle ? "圆形面积" : selectionPolygon ? "圈选面积" : "框选面积"
      ),
      rangeLabel: external.rangeLabel || spatialSelectionRangeLabel(bounds),
      rangeNote: external.rangeNote || "",
      tags: tags.slice(0, 4)
    };
  }

  function h3PointStatistics(panelData, isPaperTab) {
    var payload = panelData.h3 || {};
    var area = Math.max(0, Number(payload.area_km2) || 0);
    var regionCovered = Math.max(0, Number(payload.region_covered_total) || 0);
    var hasLocalDatasets = Math.max(0, Number(panelData.datasetTotal) || 0) > 0;
    return selectionStatistics([], null, {
      datasetCount: panelData.datasetTotal,
      paperCount: panelData.paperTotal,
      area: formatArea(area),
      areaLabel: "格子面积",
      rangeLabel: "H3 R" + (payload.resolution == null ? 8 : payload.resolution) + " 精细网格",
      rangeNote: !hasLocalDatasets && regionCovered > 0
        ? "该格无独立数据集；另有 " + formatCount(regionCovered) + " 个区域级数据集覆盖该格"
        : "",
      tags: isPaperTab ? panelData.paperTopics : panelData.datasetTopics
    });
  }

  function topDatasetTags(datasets, limit) {
    var counts = {};
    datasets.forEach(function (dataset) {
      (dataset.tags || []).forEach(function (tag) {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return Object.keys(counts).sort(function (left, right) {
      return counts[right] - counts[left] || left.localeCompare(right, "zh-CN");
    }).slice(0, limit);
  }

  function formatDatasetSize(sizeGB) {
    if (sizeGB >= 1024) {
      return (sizeGB / 1024).toFixed(sizeGB >= 10240 ? 1 : 2) + " TB";
    }
    return Math.max(0, sizeGB).toFixed(sizeGB >= 100 ? 0 : 1) + " GB";
  }

  function selectionAreaKm2(bounds) {
    if (!bounds) {
      return 0;
    }
    var radius = 6371.0088;
    var west = Cesium.Math.toRadians(bounds.west);
    var east = Cesium.Math.toRadians(bounds.east);
    var south = Cesium.Math.toRadians(bounds.south);
    var north = Cesium.Math.toRadians(bounds.north);
    return Math.abs(radius * radius * (east - west) * (Math.sin(north) - Math.sin(south)));
  }

  function spatialSelectionAreaKm2(bounds) {
    if (selectionCircle) {
      return Math.PI * selectionCircle.radiusKm * selectionCircle.radiusKm;
    }
    if (selectionPolygon) {
      return selectionPolygonAreaKm2(selectionPolygon);
    }
    return selectionAreaKm2(bounds);
  }

  function formatArea(area) {
    if (area >= 1000000) {
      return (area / 1000000).toFixed(2) + " 百万 km²";
    }
    if (area >= 10000) {
      return (area / 10000).toFixed(1) + " 万 km²";
    }
    if (area >= 1) {
      return area.toFixed(area >= 100 ? 0 : 2) + " km²";
    }
    if (area >= 0.01) {
      return (area * 100).toFixed(area >= 0.1 ? 1 : 2) + " ha";
    }
    return Math.round(Math.max(0, area) * 1000000).toLocaleString("zh-CN") + " m²";
  }

  function spatialSelectionRangeLabel(bounds) {
    if (selectionCircle) {
      return "圆心 " + coordinateLabel(selectionCircle.longitude, "W", "E", 4) + " / " +
        coordinateLabel(selectionCircle.latitude, "S", "N", 4) + " · 半径 " +
        formatDistanceKm(selectionCircle.radiusKm);
    }
    if (selectionPolygon) {
      return "闭合区域 · " + selectionPolygon.length + " 个边界点";
    }
    return selectionRangeLabel(bounds);
  }

  function selectionRangeLabel(bounds) {
    var span = Math.max(bounds.east - bounds.west, bounds.north - bounds.south);
    var precision = span < 0.01 ? 5 : span < 1 ? 3 : 1;
    return coordinateLabel(bounds.west, "W", "E", precision) + "–" + coordinateLabel(bounds.east, "W", "E", precision) +
      " / " + coordinateLabel(bounds.south, "S", "N", precision) + "–" + coordinateLabel(bounds.north, "S", "N", precision);
  }

  function coordinateLabel(value, negativeSuffix, positiveSuffix, precision) {
    return Math.abs(value).toFixed(precision == null ? 1 : precision) + "°" +
      (value < 0 ? negativeSuffix : positiveSuffix);
  }

  function datasetIntersectsBounds(dataset, bounds) {
    var coverage = dataset.coverageBounds;
    if (Array.isArray(coverage) && coverage.length >= 4) {
      return coverage[0] <= bounds.east && coverage[2] >= bounds.west &&
        coverage[1] <= bounds.north && coverage[3] >= bounds.south;
    }
    return Number.isFinite(dataset.longitude) && Number.isFinite(dataset.latitude) &&
      dataset.longitude >= bounds.west && dataset.longitude <= bounds.east &&
      dataset.latitude >= bounds.south && dataset.latitude <= bounds.north;
  }

  function createMockCityDatasets(meta) {
    var cityName = shortName(meta.name);
    var sizeProfiles = [84, 18, 42, 3.2, 1.4, 26, 680, 22, 6.4, 38, 112];
    var formatProfiles = ["COG", "NetCDF", "NetCDF", "GeoJSON", "GeoJSON", "NetCDF", "GeoTIFF", "NetCDF", "GeoJSON", "GeoJSON", "GeoTIFF"];
    var templates = [
      ["高分二号城市遥感影像数据集", ["遥感影像", "土地覆盖"], "栅格数据", "近一年", "高分辨率", ["土地利用"]],
      ["夜间灯光年度时序数据集", ["夜间灯光", "城市化"], "时序数据", "长期序列", "中分辨率", ["城市环境", "气候变化"]],
      ["地表温度逐月产品", ["地表温度", "气候变化"], "栅格数据", "近五年", "中分辨率", ["气候变化"]],
      ["城市地表覆盖分类数据集", ["土地覆盖", "分类产品"], "矢量数据", "近一年", "高分辨率", ["土地利用", "城市环境"]],
      ["地质灾害风险分区数据集", ["地质灾害", "风险评估"], "统计产品", "历史归档", "多尺度", ["灾害风险", "地形地貌"]],
      ["PM2.5 空间分布数据集", ["大气环境", "空气质量"], "时序数据", "近五年", "低分辨率", ["城市环境", "气候变化"]],
      ["数字高程模型（DEM）", ["地形地貌", "高程"], "栅格数据", "历史归档", "高分辨率", ["地形地貌"]],
      ["地表水体动态监测数据集", ["水资源", "变化检测"], "时序数据", "近五年", "中分辨率", ["水文水资源"]],
      ["建设用地扩张监测数据集", ["城市扩张", "土地利用"], "矢量数据", "长期序列", "多尺度", ["土地利用", "城市环境"]],
      ["第四纪地层与沉积年代数据集", ["地形地貌", "第四纪地质"], "矢量数据", "地质深时", "多尺度", ["地形地貌"], { temporalMode: "geologic", olderMa: 2.58, youngerMa: 0.0117 }],
      ["中生代构造演化与古地理数据集", ["地质构造", "古地理"], "栅格数据", "地质深时", "中分辨率", ["地形地貌"], { temporalMode: "geologic", olderMa: 252, youngerMa: 66 }]
    ];
    return templates.map(function (template, index) {
      var datasetId = meta.code + "-mock-" + index;
      var temporal = normalizeDatasetTemporal(template[6] || {}, template[3], datasetId);
      return {
        id: datasetId,
        name: cityName + template[0],
        tags: template[1],
        thumbnail: null,
        dataType: template[2],
        timeRange: template[3],
        temporalMode: temporal.mode,
        startYear: temporal.startYear,
        endYear: temporal.endYear,
        olderMa: temporal.olderMa,
        youngerMa: temporal.youngerMa,
        resolution: template[4],
        knowledge: template[5],
        sizeGB: sizeProfiles[index] * (0.86 + (stringHash(meta.code + ":dataset:" + index) % 29) / 100),
        format: formatProfiles[index]
      };
    });
  }

  var MOCK_DATASET_SPATIAL = {
    "global-night-lights": { point: [12, 15], bounds: [-180, -90, 180, 90], sizeGB: 4820, format: "GeoTIFF" },
    "china-gf2": { point: [104, 35], bounds: [73, 18, 135, 54], sizeGB: 2680, format: "COG" },
    "yangtze-water": { point: [108, 30], bounds: [90, 24, 122, 36], sizeGB: 740, format: "NetCDF" },
    "zhejiang-hazard": { point: [120.2, 29.2], bounds: [118, 27, 123, 31], sizeGB: 186, format: "GeoJSON" },
    "tibetan-dem": { point: [88, 33], bounds: [73, 26, 105, 40], sizeGB: 1360, format: "GeoTIFF" },
    "yangtze-heat": { point: [120, 30], bounds: [117, 27, 123, 33], sizeGB: 512, format: "NetCDF" },
    "amazon-landcover": { point: [-64, -6], bounds: [-80, -20, -48, 7], sizeGB: 1180, format: "COG" },
    "europe-temperature": { point: [10, 50], bounds: [-10, 35, 35, 70], sizeGB: 930, format: "NetCDF" },
    "north-america-air": { point: [-100, 40], bounds: [-130, 20, -60, 60], sizeGB: 420, format: "NetCDF" },
    "global-ocean": { point: [-145, -5], bounds: [-180, -90, 180, 90], sizeGB: 3260, format: "NetCDF" },
    "pearl-urban": { point: [113.2, 23], bounds: [111, 21, 116, 25], sizeGB: 248, format: "GeoJSON" },
    "sichuan-earthquake": { point: [103, 30], bounds: [97, 26, 109, 34], sizeGB: 96, format: "GeoJSON" },
    "asia-rainfall": { point: [115, 10], bounds: [92, -10, 141, 28], sizeGB: 860, format: "NetCDF" },
    "arctic-ice": { point: [30, 78], bounds: [-180, 65, 180, 90], sizeGB: 1240, format: "NetCDF" },
    "australia-fire": { point: [134, -25], bounds: [112, -44, 154, -10], sizeGB: 684, format: "COG" },
    "africa-drought": { point: [20, 2], bounds: [-18, -35, 52, 37], sizeGB: 560, format: "NetCDF" },
    "global-soil": { point: [72, -22], bounds: [-180, -90, 180, 90], sizeGB: 2120, format: "GeoTIFF" },
    "global-geology": { point: [28, 12], bounds: [-180, -90, 180, 90], sizeGB: 3460, format: "GeoTIFF" },
    "china-strata": { point: [104, 35], bounds: [73, 18, 135, 54], sizeGB: 840, format: "GeoJSON" },
    "tibet-uplift": { point: [88, 32], bounds: [73, 26, 105, 40], sizeGB: 620, format: "NetCDF" },
    "sichuan-tectonic": { point: [103, 30], bounds: [97, 26, 109, 34], sizeGB: 330, format: "GeoJSON" }
  };

  var MOCK_DATASET_TEMPORAL = {
    "global-geology": { temporalMode: "geologic", olderMa: 4600, youngerMa: 0 },
    "china-strata": { temporalMode: "geologic", olderMa: 541, youngerMa: 2.58 },
    "tibet-uplift": { temporalMode: "geologic", olderMa: 66, youngerMa: 0.01 },
    "sichuan-tectonic": { temporalMode: "geologic", olderMa: 252, youngerMa: 66 }
  };

  function createMockSearchDatasets() {
    return [
      searchDataset("global-night-lights", "全球年度夜间灯光时序数据集", ["夜间灯光", "城市化"], "全球", "时序数据", "长期序列", "中分辨率", ["城市环境", "气候变化"]),
      searchDataset("china-gf2", "中国高分二号遥感影像数据集", ["遥感影像", "土地覆盖"], "中国", "栅格数据", "近五年", "高分辨率", ["土地利用"]),
      searchDataset("yangtze-water", "长江流域地表水体动态监测数据集", ["水资源", "变化检测"], "中国 · 长江流域", "时序数据", "近五年", "中分辨率", ["水文水资源"]),
      searchDataset("zhejiang-hazard", "浙江省地质灾害风险分区数据集", ["地质灾害", "风险评估"], "中国 · 浙江", "矢量数据", "近一年", "高分辨率", ["灾害风险", "地形地貌"]),
      searchDataset("tibetan-dem", "青藏高原数字高程模型 DEM", ["地形地貌", "高程"], "中国 · 青藏高原", "栅格数据", "历史归档", "高分辨率", ["地形地貌"]),
      searchDataset("yangtze-heat", "长三角城市热岛与地表温度数据集", ["地表温度", "城市环境"], "中国 · 长三角", "栅格数据", "近五年", "高分辨率", ["城市环境", "气候变化"]),
      searchDataset("amazon-landcover", "亚马逊流域土地覆盖变化数据集", ["土地覆盖", "森林变化"], "南美洲 · 亚马逊流域", "栅格数据", "长期序列", "中分辨率", ["土地利用", "气候变化"]),
      searchDataset("europe-temperature", "欧洲地表温度逐月格网产品", ["地表温度", "气候变化"], "欧洲", "时序数据", "长期序列", "低分辨率", ["气候变化"]),
      searchDataset("north-america-air", "北美 PM2.5 空间分布数据集", ["大气环境", "空气质量"], "北美洲", "时序数据", "近五年", "低分辨率", ["城市环境", "气候变化"]),
      searchDataset("global-ocean", "全球海洋叶绿素与初级生产力数据集", ["海洋数据", "叶绿素"], "全球海域", "栅格数据", "长期序列", "中分辨率", ["水文水资源", "气候变化"]),
      searchDataset("pearl-urban", "珠江三角洲建设用地扩张数据集", ["土地覆盖", "城市扩张"], "中国 · 粤港澳大湾区", "矢量数据", "长期序列", "多尺度", ["土地利用", "城市环境"]),
      searchDataset("sichuan-earthquake", "四川盆地地震活动与断层分布数据集", ["地质灾害", "断层"], "中国 · 四川", "矢量数据", "历史归档", "多尺度", ["灾害风险", "地形地貌"]),
      searchDataset("asia-rainfall", "东南亚降水与季风时序数据集", ["水资源", "降水"], "东南亚", "时序数据", "长期序列", "低分辨率", ["水文水资源", "气候变化"]),
      searchDataset("arctic-ice", "北极海冰范围与密集度数据集", ["海洋数据", "海冰"], "北极地区", "时序数据", "长期序列", "中分辨率", ["气候变化"]),
      searchDataset("australia-fire", "澳大利亚森林火灾迹地数据集", ["遥感影像", "火灾"], "澳大利亚", "栅格数据", "近五年", "高分辨率", ["灾害风险", "土地利用"]),
      searchDataset("africa-drought", "非洲干旱指数与植被胁迫数据集", ["地表温度", "干旱"], "非洲", "时序数据", "近五年", "低分辨率", ["气候变化", "水文水资源"]),
      searchDataset("global-soil", "全球土壤湿度与蒸散发数据集", ["水资源", "土壤湿度"], "全球", "栅格数据", "长期序列", "低分辨率", ["水文水资源", "气候变化"]),
      searchDataset("global-geology", "全球地质年代与岩性图集", ["地质年代", "岩性"], "全球", "栅格数据", "地质深时", "多尺度", ["地形地貌"]),
      searchDataset("china-strata", "中国区域地层与古生物年代数据集", ["地层", "古生物"], "中国", "矢量数据", "地质深时", "多尺度", ["地形地貌"]),
      searchDataset("tibet-uplift", "青藏高原新生代隆升过程数据集", ["地质构造", "地形地貌"], "中国 · 青藏高原", "时序数据", "地质深时", "中分辨率", ["地形地貌"]),
      searchDataset("sichuan-tectonic", "四川盆地中生代构造演化数据集", ["地质构造", "古地理"], "中国 · 四川", "矢量数据", "地质深时", "多尺度", ["地形地貌"])
    ];
  }

  function searchDataset(id, name, tags, regionName, dataType, timeRange, resolution, knowledge) {
    var spatial = MOCK_DATASET_SPATIAL[id] || {};
    var temporal = normalizeDatasetTemporal(MOCK_DATASET_TEMPORAL[id] || {}, timeRange, id);
    return {
      id: id,
      name: name,
      tags: tags,
      thumbnail: null,
      regionName: regionName,
      dataType: dataType,
      timeRange: timeRange,
      temporalMode: temporal.mode,
      startYear: temporal.startYear,
      endYear: temporal.endYear,
      olderMa: temporal.olderMa,
      youngerMa: temporal.youngerMa,
      resolution: resolution,
      knowledge: knowledge,
      longitude: spatial.point ? spatial.point[0] : NaN,
      latitude: spatial.point ? spatial.point[1] : NaN,
      source: "科学数据",
      coverageBounds: spatial.bounds || null,
      sizeGB: spatial.sizeGB || 0,
      format: spatial.format || ""
    };
  }

  function filterDatasets(datasets) {
    return datasets.filter(function (dataset) {
      return datasetMatchesNonTemporalFilters(dataset) && datasetMatchesTimeline(dataset);
    });
  }

  function datasetMatchesNonTemporalFilters(dataset) {
    var query = filterState.query.toLowerCase();
    var tags = Array.isArray(dataset.tags) ? dataset.tags : [];
    var knowledge = Array.isArray(dataset.knowledge) ? dataset.knowledge : [];
    var searchable = [dataset.name, dataset.regionName, dataset.dataType]
      .concat(tags, knowledge)
      .join(" ")
      .toLowerCase();
    var sourceMatches = !filterState.source || dataset.source === filterState.source;
    return (!query || searchable.indexOf(query) !== -1) &&
      (!filterState.theme || tags.indexOf(filterState.theme) !== -1) &&
      sourceMatches;
  }

  function datasetUnifiedExtent(dataset) {
    if (dataset.temporalMode === "geologic") {
      if (!Number.isFinite(Number(dataset.olderMa)) || !Number.isFinite(Number(dataset.youngerMa))) {
        return null;
      }
      return {
        older: Math.max(Number(dataset.olderMa), Number(dataset.youngerMa)) * 1000000,
        younger: Math.min(Number(dataset.olderMa), Number(dataset.youngerMa)) * 1000000
      };
    }
    if (!Number.isFinite(Number(dataset.startYear)) || !Number.isFinite(Number(dataset.endYear))) {
      return null;
    }
    return {
      older: Math.max(0, HUMAN_YEAR_MAX - Number(dataset.startYear)),
      younger: Math.max(0, HUMAN_YEAR_MAX - Number(dataset.endYear))
    };
  }

  function datasetMatchesTimeline(dataset) {
    if (!filterState.timeActive) {
      return true;
    }
    if (filterState.timeScope === "human" && dataset.temporalMode === "geologic") {
      return false;
    }
    if (filterState.timeScope === "geologic" && dataset.temporalMode !== "geologic") {
      return false;
    }
    var extent = datasetUnifiedExtent(dataset);
    return !!extent && extent.younger <= filterState.timeOlderYears &&
      extent.older >= filterState.timeYoungerYears;
  }

  function datasetThumbnail() {
    return "./assets/dataset-map-thumbnail.png";
  }

  function showStatus(message, duration) {
    var node = document.getElementById("boundary-status");
    node.textContent = message;
    node.classList.remove("hidden");
    window.clearTimeout(showStatus.timer);
    if (duration) {
      showStatus.timer = window.setTimeout(hideStatus, duration);
    }
  }

  function hideStatus() {
    document.getElementById("boundary-status").classList.add("hidden");
  }

  function removeCurrentSources() {
    clearHighlightOutline();
    if (regionBillboardCollection) {
      regionBillboardCollection.removeAll();
    }
    regionMarkerStates = [];
    if (currentBoundarySource) {
      viewer.dataSources.remove(currentBoundarySource, true);
      currentBoundarySource = null;
    }
    if (currentMarkerSource) {
      viewer.dataSources.remove(currentMarkerSource, true);
      currentMarkerSource = null;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.addEventListener("geoapp:ready", init);
  if (window.GeoApp && window.GeoApp.viewer) {
    init({ detail: window.GeoApp });
  }

})();
