# 数据集地球

基于 CesiumJS 1.144 的交互式地球展示页，用于后续在地球上叠加带时空属性的地学数据集。

## 启动

```bash
npm install
python3 -m pip install -r requirements.txt
npm start
```

然后打开 http://localhost:8001。启动服务会同时提供页面和自然语言数据集检索代理。
MCP 地址默认使用 `http://10.200.49.5:8001/mcp`，也可以在启动前通过环境变量覆盖：

```bash
MCP_URL=http://your-mcp-host/mcp npm start
```

## 真实数据集热力图

源数据与运行索引均使用工程内相对路径：

- `data/source/datasets_scientific.csv`：原始 CSV，运行服务不会直接扫描它
- `data/generated/dataset_heat.sqlite`：去重、坐标解析和区域匹配后的运行索引
- `data/source/papers_converted_point.csv`：独立论文原始表，使用 `lng_new` / `lat_new` 作为标准点位
- `data/generated/paper_points.sqlite`：论文点位、学科主题和行政区归属索引

> 仓库包含完整运行数据：两个较大的 SQLite 索引和一个超过 100 MB 的原始 CSV 使用 Git LFS 保存，其余文件使用普通 Git。第一次克隆前请先安装 Git LFS，并执行 `git lfs install`；随后使用 `git clone`，LFS 数据会自动下载。不要直接下载 GitHub 的源码 ZIP，因为它可能只包含 LFS 指针文件。

替换 CSV 后执行以下命令重建索引，再重新启动服务：

```bash
npm run build:data
npm run build:papers
npm start
```

运行时不会读取 Downloads 等电脑绝对路径。`server.py` 也会阻止通过静态地址直接下载 `data/source/` 中的原始 CSV；部署或交付整个工程时，需要同时保留 `data/source/` 与 `data/generated/`。

论文表中没有标准坐标的记录仍计入全球论文总量，但不强行归属到某个国家或城市。落在海洋、南北极等非行政区域的点位同样保留在全球总量中。

热力图表示当前筛选条件下的唯一数据集覆盖密度：

- 点坐标使用小范围高斯核，保证单点可见
- 经纬度范围覆盖 `N` 个网格时，每格贡献 `1/N`，保证单个数据集的总权重不随面积变大
- 坐标缺失但能可靠匹配国家或中国省份的记录，按真实行政边界归一化累计
- 点、小范围面、中范围面和广域名称四层独立拉伸；面积层使用确定性圆形密度纹理，避免把外接矩形画成实心色块
- 全球覆盖数据作为全局基线统计，不涂满地球
- 无法可靠解析、相互矛盾或非地球空间坐标不进入地球热力图

热力结果统一量化为 Uber H3 六边形网格，网格精度会根据当前视野自适应，并将单次可见网格数限制在 90,000 以内。全球视图通常使用 H3 R3，中国视图使用 R4；继续缩放时，服务仅重算当前可见范围，国家、省份和城市可逐级提升到 R5–R9。城市内可进入 R8（平均约 `0.74 km²`）和 R9（平均约 `0.10 km²`）的精细查询。主题、文本和时间筛选会在服务端重新聚合；相同条件命中内存缓存，默认全球与中国视图在服务启动后后台预热。CSV 没有数据大小字段，因此启用最小数据量筛选时，未知大小的数据集不会进入热力图。

天地图 Token 配置在 `js/config.local.js`。该文件已加入 `.gitignore`；部署时请通过域名限制保护 Token，并按部署环境注入配置。

## 合并数据集表（数据集来源与坐标信息）

新增一份独立的合并数据集源表，与上述 CSV 热力图数据并存，互不覆盖：

- `data/source/dataset_merged_20260909.xlsx`：原始工作簿，包含 `海纳数据集` 与 `OneEarth数据集` 两个数据 sheet（共 1162 条记录：海纳 196 + OneEarth 966）
- `data/generated/dataset_merged.sqlite`：由工作簿生成的运行索引，包含完整原始字段、空间坐标几何、行政区归属、标签与空间分类
- `scripts/build_merged_dataset_index.py`：重建该索引的脚本

替换工作簿后执行：

```bash
npm run build:merged
npm start
```

运行时不会读取工作簿的电脑绝对路径；部署或交付时同样需要保留 `data/source/dataset_merged_20260909.xlsx` 与 `data/generated/dataset_merged.sqlite`。

新表与原有数据集的接入方式：

- 全球、国家、省份层级的右侧统计卡片：字段统计（总量、空间覆盖、主题）会把新表记录并入统计
- 城市层级右侧数据/论文列表：筛选命中时，新表记录与原有数据集记录混排展示
- 列表收起时显示字段与原有数据集列表一致（名称、来源、标签、时间等）；展开详情时展示新表的专属字段（数据集信息、空间坐标提取与校验、来源与更新），与原数据集详情字段不同
- 框选范围与城市内 H3 精细网格查询同样会把新表命中记录混入数据集列表
- 新表没有年份、数据量、地质时间等字段，因此对应筛选条件对合并表不生效，记录在满足其余条件时仍会进入列表

## 已提供

- 鼠标拖拽旋转地球，滚轮缩放，右键拖拽平移
- 搜索框支持自然语言地名定位，例如输入“帮我定位到杭州”后自动飞行并进入对应行政区层级
- 输入研究问题并按 Enter，可通过 MCP 检索相关数据集，在右侧查看可关闭的推荐结果卡片
- 天地图影像、天地图矢量、暗色及离线底图切换，底图透明度调节
- 经纬网格、大气层、星空背景开关
- 全球国家、中国省级及省内城市三级行政边界下钻
- 城市定位后点击地图可查询 H3 R8/R9 精细网格，并在右侧查看格子内的数据集与论文
- 基于真实数据集覆盖范围的动态密度热力层、单区域 hover/选中高亮、模拟数据集数量气泡及返回上级
- 贯通人类纪年与地质深时的连续时间轴，支持语义缩放、结果自动聚焦及统计/热力/气泡/列表联动
- 左下角相机经纬度与高度读数
- `window.GeoApp` 公共 API，之后挂数据集使用
- `window.AdminExplorer.setRegionData([{ regionCode, count, density }])` 可按行政代码替换当前筛选结果

筛选条件变化后，将区域统计和经纬度热点一起传给页面，即可原地更新热力纹理、气泡数值和尺寸，不会改变相机位置：

```js
window.AdminExplorer.setFilterResult({
  regions: [
    { regionCode: "330100", count: 128, density: 0.82 },
    { regionCode: "330200", count: 76, density: 0.46 }
  ],
  heatPoints: [
    { longitude: 120.15, latitude: 30.28, weight: 0.92 },
    { longitude: 121.55, latitude: 29.87, weight: 0.64 }
  ],
});
```

`regions` 用于行政区气泡数字和尺寸，`heatPoints` 用于生成不受行政边界限制的连续热力纹理。热力也可以通过 `setHeatPoints(points)` 更新，旧接口 `setRegionCounts` 继续兼容。

时间轴变化时，`geoapp:filterchange` 事件中的 `filters.temporal` 使用统一结构，两个边界可以分别属于地质年龄或公历年份：

```js
{
  mode: "unified",
  scope: "unified",
  older: { scale: "ma", value: 66 },
  younger: { scale: "calendar", year: 2016 }
}
```

当范围完全位于人类纪年或地质深时时，事件还会附带 `startYear/endYear` 或 `olderMa/youngerMa` 兼容字段。后端返回的数据集仍使用 `temporalMode: "human"` 加年份范围，或 `temporalMode: "geologic"` 加 Ma 范围。筛选结果的实际时间跨度可通过 `setFilterResult({ temporalExtent })` 或 `setTemporalExtent(extent)` 传回，时间轴会自动聚焦，但不会额外增加筛选条件。

## 说明

页面优先加载本地 `node_modules` 中的 Cesium；本地缺失时自动回退到 CDN。

## 完整下载与直接预览

- 需要完整源码和运行数据时，直接 `git clone` 本仓库，并确保本机已安装 Git LFS。
- 需要在 Linux x86_64 服务器上直接运行、无需安装 Python 或前端依赖时，请从 [Latest Release](https://github.com/shiyecao520/Earth-Visualization/releases/latest) 下载完整部署包。
- Release 中包含已验证的 Linux 单文件程序和部署说明；首次启动约需 30–90 秒完成数据解压与热力图预热。
