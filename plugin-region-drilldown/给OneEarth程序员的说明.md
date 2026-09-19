# 给 OneEarth 程序员的交付说明

## 这是什么

这是一个挂载到现有 Cesium Viewer 上的行政区圆圈下钻组件。

它只负责：

1. 在球上显示区域圆圈；
2. 点击圆圈逐级下钻；
3. 返回上一级；
4. 根据经纬度中心点和范围移动相机。

它不负责行政区数据、数据库查询和后端服务。

## 推荐接入方式

OneEarth 已经有 Cesium 球时，复用现有 `viewer`：

```js
import { createRegionDrilldown } from "@oneearth/region-drilldown";

const regionLayer = createRegionDrilldown(viewer, {
  dataProvider: {
    listChildren: async ({ level, parentCode, filters }) => {
      // 返回当前层级的行政区数组
      return await oneEarthApi.listRegions({ level, parentCode, filters });
    },
    getCounts: async ({ codes, level, parentCode, filters }) => {
      // 可选：返回 code -> { datasetCount, paperCount }
      return await oneEarthApi.getRegionCounts({ codes, level, parentCode, filters });
    }
  }
});
```

如果 OneEarth 没有构建工具，可以加载 UMD 版本：

```html
<script src="./vendor/Cesium/Cesium.js"></script>
<script src="./region-drilldown.umd.js"></script>
<script>
  const regionLayer = OneEarthRegionDrilldown.createRegionDrilldown(viewer, {
    dataProvider: oneEarthRegionDataProvider
  });
</script>
```

## 行政区数据由谁提供

由 OneEarth 后端提供。插件要求每个区域至少包含：

```json
{
  "code": "330000",
  "name": "浙江省",
  "level": "province",
  "parentCode": "CHN",
  "hasChildren": true,
  "childLevel": "city",
  "center": [120.15, 29.28],
  "bounds": [118.0, 27.0, 123.0, 31.5],
  "datasetCount": 286,
  "paperCount": 74
}
```

如果只画圆圈，不需要完整行政边界 GeoJSON。

## 生命周期

```js
regionLayer.setVisible(false);
regionLayer.setVisible(true);
regionLayer.setFilters({ theme: "气候变化" });
regionLayer.goHome();
regionLayer.destroy();
```

必须在页面卸载时调用 `destroy()`，它会移除圆圈、点击事件和插件界面，但不会销毁 OneEarth 的 Viewer。
