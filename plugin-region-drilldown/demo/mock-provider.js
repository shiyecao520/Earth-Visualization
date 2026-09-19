(function () {
  const REGIONS = {
    country: [
      { code: "CHN", name: "中国", level: "country", parentCode: null, hasChildren: true, childLevel: "province", center: [104.2, 35.0], bounds: [73.5, 18.0, 135.1, 53.6], datasetCount: 1832, paperCount: 396 },
      { code: "USA", name: "美国", level: "country", parentCode: null, hasChildren: false, center: [-98.4, 39.5], bounds: [-125.0, 24.0, -66.5, 49.5], datasetCount: 946, paperCount: 268 },
      { code: "BRA", name: "巴西", level: "country", parentCode: null, hasChildren: false, center: [-52.0, -10.5], bounds: [-74.0, -34.0, -34.0, 5.5], datasetCount: 418, paperCount: 112 },
      { code: "AUS", name: "澳大利亚", level: "country", parentCode: null, hasChildren: false, center: [134.0, -25.0], bounds: [112.0, -44.0, 154.0, -10.0], datasetCount: 326, paperCount: 91 },
      { code: "FRA", name: "法国", level: "country", parentCode: null, hasChildren: false, center: [2.2, 46.2], bounds: [-5.2, 41.2, 9.7, 51.2], datasetCount: 287, paperCount: 83 },
      { code: "JPN", name: "日本", level: "country", parentCode: null, hasChildren: false, center: [138.0, 37.8], bounds: [128.7, 30.8, 146.2, 45.8], datasetCount: 241, paperCount: 76 }
    ],
    province: {
      CHN: [
        { code: "330000", name: "浙江省", level: "province", parentCode: "CHN", hasChildren: true, childLevel: "city", center: [120.15, 29.28], bounds: [118.0, 27.0, 123.0, 31.5], datasetCount: 286, paperCount: 74 },
        { code: "440000", name: "广东省", level: "province", parentCode: "CHN", hasChildren: true, childLevel: "city", center: [113.45, 23.35], bounds: [109.7, 20.2, 117.3, 25.5], datasetCount: 352, paperCount: 106 },
        { code: "510000", name: "四川省", level: "province", parentCode: "CHN", hasChildren: true, childLevel: "city", center: [102.7, 30.6], bounds: [97.1, 26.0, 108.6, 34.3], datasetCount: 168, paperCount: 49 },
        { code: "110000", name: "北京市", level: "province", parentCode: "CHN", hasChildren: false, center: [116.42, 40.19], bounds: [115.4, 39.4, 117.5, 41.1], datasetCount: 324, paperCount: 118 }
      ]
    },
    city: {
      "330000": [
        { code: "330100", name: "杭州市", level: "city", parentCode: "330000", hasChildren: false, center: [119.48, 29.90], bounds: [118.3, 29.1, 120.8, 30.6], datasetCount: 116, paperCount: 32 },
        { code: "330200", name: "宁波市", level: "city", parentCode: "330000", hasChildren: false, center: [121.55, 29.87], bounds: [120.9, 28.8, 122.5, 30.6], datasetCount: 74, paperCount: 21 },
        { code: "330300", name: "温州市", level: "city", parentCode: "330000", hasChildren: false, center: [120.70, 27.99], bounds: [119.7, 27.0, 121.6, 28.8], datasetCount: 46, paperCount: 12 }
      ],
      "440000": [
        { code: "440100", name: "广州市", level: "city", parentCode: "440000", hasChildren: false, center: [113.26, 23.13], bounds: [112.9, 22.5, 114.1, 23.9], datasetCount: 128, paperCount: 42 },
        { code: "440300", name: "深圳市", level: "city", parentCode: "440000", hasChildren: false, center: [114.06, 22.55], bounds: [113.7, 22.4, 114.6, 22.9], datasetCount: 142, paperCount: 51 },
        { code: "441900", name: "东莞市", level: "city", parentCode: "440000", hasChildren: false, center: [113.75, 23.02], bounds: [113.5, 22.7, 114.2, 23.3], datasetCount: 65, paperCount: 18 }
      ],
      "510000": [
        { code: "510100", name: "成都市", level: "city", parentCode: "510000", hasChildren: false, center: [104.07, 30.57], bounds: [102.9, 29.8, 104.9, 31.4], datasetCount: 88, paperCount: 26 },
        { code: "510700", name: "绵阳市", level: "city", parentCode: "510000", hasChildren: false, center: [104.68, 31.47], bounds: [103.8, 30.7, 105.5, 32.3], datasetCount: 36, paperCount: 10 }
      ]
    }
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  window.DemoRegionProvider = {
    async listChildren(request) {
      const level = request.level;
      const parentCode = request.parentCode;
      if (level === "country") {
        return clone(REGIONS.country);
      }
      if (level === "province") {
        return clone(REGIONS.province[parentCode] || []);
      }
      if (level === "city") {
        return clone(REGIONS.city[parentCode] || []);
      }
      return [];
    },

    async getCounts(request) {
      const source = request.level === "country"
        ? REGIONS.country
        : request.level === "province"
          ? (REGIONS.province[request.parentCode] || [])
          : (REGIONS.city[request.parentCode] || []);
      const byCode = {};
      source.forEach((item) => {
        byCode[item.code] = {
          datasetCount: item.datasetCount,
          paperCount: item.paperCount
        };
      });
      return byCode;
    }
  };
})();
