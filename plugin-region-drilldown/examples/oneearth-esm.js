import { createRegionDrilldown } from "@oneearth/region-drilldown";

export function mountRegionDrilldown(viewer, apiClient) {
  const regionLayer = createRegionDrilldown(viewer, {
    dataProvider: {
      async listChildren({ level, parentCode, filters }) {
        const result = await apiClient.get("/api/regions", {
          params: { level, parentCode, ...filters }
        });
        return result.items;
      },
      async getCounts({ level, parentCode, codes, filters }) {
        const result = await apiClient.post("/api/region-counts", {
          level,
          parentCode,
          codes,
          filters
        });
        return result.counts;
      }
    },
    onRegionClick(region) {
      console.log("OneEarth 收到区域点击", region.code);
    }
  });

  return regionLayer;
}
