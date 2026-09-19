import * as Cesium from "cesium";
import { createRegionDrilldownCore } from "./core.js";

export function createRegionDrilldown(viewer, options = {}) {
  return createRegionDrilldownCore(Cesium, viewer, options);
}

export { createRegionDrilldownCore };
export default createRegionDrilldown;
