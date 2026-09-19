import { createRegionDrilldownCore } from "./core.js";

export function createRegionDrilldown(viewer, options = {}) {
  const Cesium = options.Cesium || (typeof window !== "undefined" ? window.Cesium : null);
  return createRegionDrilldownCore(Cesium, viewer, options);
}
