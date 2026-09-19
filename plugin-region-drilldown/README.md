# OneEarth 行政区圆圈下钻插件

这是一个独立前端插件，用来挂载到 OneEarth 现有的 Cesium 地球上方，实现：

- 全球国家圆圈
- 点击国家进入省级
- 点击省份进入城市
- 返回上一级
- 圆圈显示数据集数量和论文数量
- 点击区域后自动飞行到对应范围
- 支持后端更新行政区数据和数量

插件不包含：

- 行政区权威数据
- 数据集数据库
- 后端服务
- 热力图、检索和详情页

行政区数据由 OneEarth 后端通过 `dataProvider` 提供。

## 目录说明

```text
dist/                         给 OneEarth 程序员使用的插件文件
demo/                         可直接运行的演示页面
docs/                         接入说明
api/                          后端数据接口说明和示例
examples/                     接入代码示例
给OneEarth程序员的说明.md      一页交付说明
```

## 给谁看什么

- 给 OneEarth 前端程序员：`给OneEarth程序员的说明.md`、`docs/接入说明.md`
- 给 OneEarth 后端程序员：`api/后端接口说明.md`
- 先看效果：启动本目录的本地服务器，打开 `demo/index.html`

## 本地预览

在本目录执行：

```bash
python3 -m http.server 8088
```

然后访问：

```text
http://localhost:8088/demo/
```

## 正式接入方式

OneEarth 已有 Cesium Viewer 时，不要创建第二个地球。直接把插件挂到现有 Viewer：

```js
import { createRegionDrilldown } from "@oneearth/region-drilldown";

const regionLayer = createRegionDrilldown(oneEarthViewer, {
  dataProvider: oneEarthRegionDataProvider
});

// 页面销毁时
regionLayer.destroy();
```

插件不会创建、控制或销毁 OneEarth 的 Viewer。
