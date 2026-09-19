(async function () {
  window.Cesium.Ion.defaultAccessToken = "";
  const viewer = new window.Cesium.Viewer("cesium-container", {
    baseLayer: false,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: true
  });

  viewer.scene.globe.baseColor = window.Cesium.Color.fromCssColorString("#0B2034");
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.scene.skyAtmosphere.show = true;
  viewer.scene.backgroundColor = window.Cesium.Color.fromCssColorString("#030813");
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 600;

  try {
    const imageryProvider = await window.Cesium.TileMapServiceImageryProvider.fromUrl(
      "./vendor/Cesium/Assets/Textures/NaturalEarthII"
    );
    const layer = viewer.imageryLayers.addImageryProvider(imageryProvider);
    layer.brightness = 0.72;
    layer.contrast = 1.12;
    layer.saturation = 0.7;
  } catch (error) {
    console.warn("演示底图加载失败，将使用纯色地球。", error);
  }

  const plugin = window.OneEarthRegionDrilldown.createRegionDrilldown(viewer, {
    dataProvider: window.DemoRegionProvider,
    initialLevel: "country",
    cameraDuration: 1.1
  });

  plugin.on("regionClick", function (region) {
    console.info("点击区域", region.code, region.name);
  });
  plugin.on("levelChange", function (state) {
    console.info("当前层级", state.level, state.parentCode);
  });

  window.regionDrilldownDemo = { viewer, plugin };
})();
