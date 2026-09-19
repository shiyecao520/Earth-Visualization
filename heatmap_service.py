"""Generate filtered dataset coverage heatmaps from the prebuilt SQLite index."""

from __future__ import annotations

import json
import math
import re
import sqlite3
import struct
import threading
import time
import zlib
from collections import OrderedDict, defaultdict
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Any

try:
    import numpy as np
except ImportError:  # Keep the project runnable in a minimal Python install.
    np = None

try:
    from PIL import Image, ImageDraw
except ImportError:  # PNG remains available when Pillow is not installed.
    Image = None
    ImageDraw = None

try:
    import h3
except ImportError:
    h3 = None


ROOT = Path(__file__).resolve().parent
DATABASE_PATH = ROOT / "data/generated/dataset_heat.sqlite"
BOUNDARY_PATHS = (
    ROOT / "data/boundaries/countries.geojson",
    ROOT / "data/boundaries/china-provinces.geojson",
) + tuple(sorted((ROOT / "data/boundaries/china-cities").glob("*.geojson")))
MEMBERSHIP_MAX_SPAN = {"country": 160.0, "province": 30.0, "city": 8.0}
LEVEL_RESOLUTION = {"country": 0.3, "province": 0.075, "city": 0.02}
LEVEL_LONG_EDGE = {"country": 1200, "province": 900, "city": 640}
BAND_MAX_SPAN = {
    "country": (0.8, 7.0),
    "province": (0.8, 7.0),
    "city": (0.8, 7.0),
}
FIXED_BAND_LIMITS = {
    "point": (0.002, 2.9),
    "local": (0.02, 2.4),
    "medium": (0.05, 2.8),
    "broad": (0.3, 20.0),
}
POINT_LIKE_MAX_SPAN = 0.35
# 城市级 H3 精细网格点击查询中，视为“数据落在该网格内”的最大 bbox 跨度（度）。
# 更大跨度的 bbox 覆盖范围太广，在热力图上只会形成近乎均匀的背景，不会产生可分辨
# 的颜色，因此不应计入网格命中的数据集总数（区域几何同理，单独统计为区域覆盖数）。
H3_POINT_QUERY_MAX_BBOX_SPAN = 1.2
# 区域级数据集（kind='region'）计入“区域覆盖数”的最大 bbox 跨度（度）。
# 国家/大区级区域几何（如中国、长三角）会覆盖视野内几乎每一个网格，计入了也只是
# 恒定噪声；只统计到省级及以下跨度，网格间才能看出差异。
H3_POINT_QUERY_REGION_MAX_SPAN = 8.0
# 框选/圈选相对命中规则：当选择范围跨度较小时，跨度远超选择范围的数据集
# （如全国级区域、全国范围 bbox）应排除出结果列表并单独统计为“区域覆盖”，
# 使不同大小框选的结果数随范围自然变化，而不是恒定为同一个约 4 千的值。
SELECTION_RELATIVE_FACTOR = 4.0
# 框选/圈选中，跨度不大于该值的区域级数据集始终计入结果列表（城市级及以下）。
SELECTION_MIN_REGION_SPAN = 2.0
# 城市级 H3 精细网格中，命中数据集的网格在密度色很淡时使用的最小填充透明度，
# 保证“有数据就有颜色、颜色与点击统计一致”；未命中任何数据集的网格保持透明。
H3_PRESENT_FLOOR_ALPHA = 96
# 城市级精细 H3 网格"命中即着色"的最小透明度随分辨率递减：分辨率越高、
# 六边形在屏幕上占比越大，越不能把底图盖死；同时也避免不同缩放档位之间
# 透明度跳变（高倍率下过浓、低倍率下过淡）。
def _present_floor_alpha(resolution: int) -> int:
    return max(46, H3_PRESENT_FLOOR_ALPHA - max(0, int(resolution) - 6) * 10)


def _h3_count_visual_ratios(present_cells: dict[str, int]) -> dict[str, float]:
    """把 H3 格内数据集数量映射为按等级展开的热力强度。

    城市级视图的计数分布经常是 1、2、3、5 这种极小的离散序列。若直接按
    最大值线性归一化，或按 log(maximum) 归一化，1—2 条数据都会挤在蓝/青
    区间，而 3 条以上又很快进入黄/红区间，肉眼看不出中间层次。这里按“出现
    过的数量等级”做 rank 归一化：例如 1/2/3/4/5 会分别落在色带约
    8%/31%/54%/77%/100%，低、中、高密度都有明确色阶；同时仍严格保持
    “数量越多、颜色越热”的单调关系。
    """
    if not present_cells:
        return {}
    counts = sorted(set(present_cells.values()))
    if len(counts) == 1:
        return {cell: 0.30 for cell in present_cells}
    count_ratios = {
        count: 0.08 + 0.92 * (index / (len(counts) - 1))
        for index, count in enumerate(counts)
    }
    return {cell: count_ratios[count] for cell, count in present_cells.items()}


def _present_fill_alpha(resolution: int, visual_ratio: float) -> int:
    """按热力强度拉开精细网格填充透明度，同时保留深放大的底图可读性。"""
    floor_alpha = _present_floor_alpha(resolution)
    ceiling_alpha = max(108, 180 - max(0, int(resolution) - 6) * 16)
    return round(floor_alpha + (ceiling_alpha - floor_alpha) * max(0.0, min(1.0, visual_ratio)))


H3_MAX_RESOLUTION = {"country": 5, "province": 7, "city": 11}
H3_MAX_VISIBLE_CELLS = {"country": 320000, "province": 180000, "city": 300000}
H3_FINE_GRID_VISIBLE_CELLS = {11: 900, 10: 1200, 9: 2000, 8: 6000}
H3_AVERAGE_AREA_KM2 = {
    0: 4357449.4,
    1: 609788.4,
    2: 86801.8,
    3: 12393.4,
    4: 1770.3,
    5: 252.9,
    6: 36.1,
    7: 5.16,
    8: 0.737,
    9: 0.105,
    10: 0.015,
    11: 0.00215,
}
THEME_TERMS = {
    "遥感影像": ["remote sensing", "satellite", "imagery", "earth observation"],
    "土地覆盖": ["land cover", "land use"],
    "夜间灯光": ["nighttime light", "night light"],
    "地表温度": ["land surface temperature", "surface temperature"],
    "地质灾害": ["geological hazard", "landslide", "earthquake", "hazard"],
    "水资源": ["water resource", "hydrology", "precipitation", "river", "ocean"],
    "大气环境": ["atmosphere", "air quality", "aerosol", "climate"],
}
DATA_TYPE_TERMS = {
    "栅格数据": ["raster", "gridded"],
    "矢量数据": ["vector", "shapefile", "geojson"],
    "时序数据": ["time series", "temporal", "long-term"],
    "统计产品": ["statistics", "statistical", "census"],
}
RESOLUTION_TERMS = {
    "高分辨率": ["high resolution", "fine resolution"],
    "中分辨率": ["medium resolution", "moderate resolution"],
    "低分辨率": ["low resolution", "coarse resolution"],
    "多尺度": ["multi-scale", "multiscale", "multiple resolutions"],
}
COLOR_STOPS = (
    (0.0, (23, 54, 178, 0)), (0.09, (28, 92, 232, 28)),
    (0.2, (15, 174, 255, 98)), (0.38, (0, 238, 239, 184)),
    (0.54, (66, 236, 154, 220)), (0.69, (255, 226, 72, 242)),
    (0.86, (255, 125, 35, 251)), (1.0, (247, 48, 42, 255)),
)
HEAT_VISUAL_WEIGHTS = {
    "country": (1.0, 1.0, 0.96, 0.9),
    "province": (1.0, 0.96, 0.9, 0.78),
    "city": (1.0, 0.84, 0.74, 0.52),
}
HEAT_ALPHA_SCALES = {
    "country": (1.0, 0.92, 0.84, 0.76),
    "province": (1.0, 0.88, 0.78, 0.66),
    "city": (1.0, 0.78, 0.64, 0.48),
}


class HeatmapUnavailable(RuntimeError):
    pass


class HeatmapAborted(RuntimeError):
    """客户端已断开连接（请求被前端新的热力图请求取消）时抛出。"""


def _outer_rings(geometry: dict[str, Any]) -> list[list[list[float]]]:
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") == "Polygon":
        return [coordinates[0]] if coordinates else []
    if geometry.get("type") == "MultiPolygon":
        return [polygon[0] for polygon in coordinates if polygon]
    return []


def _point_in_ring(longitude: float, latitude: float, ring: list[list[float]]) -> bool:
    inside = False
    previous = len(ring) - 1
    for index, current in enumerate(ring):
        before = ring[previous]
        intersects = (current[1] > latitude) != (before[1] > latitude) and longitude < (
            (before[0] - current[0]) * (latitude - current[1]) / (before[1] - current[1] or 1e-12) + current[0]
        )
        if intersects:
            inside = not inside
        previous = index
    return inside


def _point_in_geometry(longitude: float, latitude: float, rings: list[list[list[float]]]) -> bool:
    return any(_point_in_ring(longitude, latitude, ring) for ring in rings)


def _segment_intersects_rectangle(
    start: tuple[float, float], end: tuple[float, float],
    west: float, south: float, east: float, north: float,
) -> bool:
    start_x, start_y = start
    end_x, end_y = end
    if max(start_x, end_x) < west or min(start_x, end_x) > east:
        return False
    if max(start_y, end_y) < south or min(start_y, end_y) > north:
        return False
    if (
        west <= start_x <= east and south <= start_y <= north
        or west <= end_x <= east and south <= end_y <= north
    ):
        return True

    delta_x = end_x - start_x
    delta_y = end_y - start_y
    if delta_x:
        if (start_x - west) * (end_x - west) <= 0:
            latitude = start_y + (west - start_x) * delta_y / delta_x
            if south <= latitude <= north:
                return True
        if (start_x - east) * (end_x - east) <= 0:
            latitude = start_y + (east - start_x) * delta_y / delta_x
            if south <= latitude <= north:
                return True
    if delta_y:
        if (start_y - south) * (end_y - south) <= 0:
            longitude = start_x + (south - start_y) * delta_x / delta_y
            if west <= longitude <= east:
                return True
        if (start_y - north) * (end_y - north) <= 0:
            longitude = start_x + (north - start_y) * delta_x / delta_y
            if west <= longitude <= east:
                return True
    return False


def _polygon_intersects_rectangle(
    polygon: list[list[float]], rectangle: list[list[float]],
) -> bool:
    west = min(float(point[0]) for point in rectangle)
    south = min(float(point[1]) for point in rectangle)
    east = max(float(point[0]) for point in rectangle)
    north = max(float(point[1]) for point in rectangle)
    if any(
        west <= float(point[0]) <= east and south <= float(point[1]) <= north
        for point in polygon
    ):
        return True
    first_rectangle_point = rectangle[0]
    if _point_in_ring(float(first_rectangle_point[0]), float(first_rectangle_point[1]), polygon):
        return True
    return any(
        _segment_intersects_rectangle(
            (float(start[0]), float(start[1])), (float(end[0]), float(end[1])),
            west, south, east, north,
        )
        for start, end in zip(polygon, polygon[1:] + polygon[:1])
    )


def _polygon_intersects_rings(
    polygon: list[list[float]], rings: list[list[list[float]]],
) -> bool:
    if not polygon or not rings:
        return False
    # bbox 命中是热力图与点击查询的最高频路径。轴对齐矩形使用专门算法，
    # 避免每个 bbox 都走通用多边形相交的完整边遍历。
    if len(rings) == 1 and len(rings[0]) == 4:
        rectangle = rings[0]
        x_values = [float(point[0]) for point in rectangle]
        y_values = [float(point[1]) for point in rectangle]
        if (
            len(set(x_values)) <= 2 and len(set(y_values)) <= 2
            and all(
                x_values[index] == x_values[(index + 1) % 4]
                or y_values[index] == y_values[(index + 1) % 4]
                for index in range(4)
            )
        ):
            return _polygon_intersects_rectangle(polygon, rectangle)
    first_polygon_point = polygon[0]
    if _point_in_geometry(float(first_polygon_point[0]), float(first_polygon_point[1]), rings):
        return True
    if any(
        ring and _point_in_ring(float(ring[0][0]), float(ring[0][1]), polygon)
        for ring in rings
    ):
        return True
    polygon_edges = []
    for start, end in zip(polygon, polygon[1:] + polygon[:1]):
        polygon_edges.append((
            start, end,
            min(float(start[0]), float(end[0])), min(float(start[1]), float(end[1])),
            max(float(start[0]), float(end[0])), max(float(start[1]), float(end[1])),
        ))
    polygon_west = min(float(point[0]) for point in polygon)
    polygon_south = min(float(point[1]) for point in polygon)
    polygon_east = max(float(point[0]) for point in polygon)
    polygon_north = max(float(point[1]) for point in polygon)
    for ring in rings:
        if not ring:
            continue
        ring_west = min(float(point[0]) for point in ring)
        ring_south = min(float(point[1]) for point in ring)
        ring_east = max(float(point[0]) for point in ring)
        ring_north = max(float(point[1]) for point in ring)
        if (ring_east < polygon_west or ring_west > polygon_east or
                ring_north < polygon_south or ring_south > polygon_north):
            continue
        for ring_start, ring_end in zip(ring, ring[1:] + ring[:1]):
            edge_west = min(float(ring_start[0]), float(ring_end[0]))
            edge_south = min(float(ring_start[1]), float(ring_end[1]))
            edge_east = max(float(ring_start[0]), float(ring_end[0]))
            edge_north = max(float(ring_start[1]), float(ring_end[1]))
            if (edge_east < polygon_west or edge_west > polygon_east or
                    edge_north < polygon_south or edge_south > polygon_north):
                continue
            for polygon_start, polygon_end, west, south, east, north in polygon_edges:
                if edge_east < west or edge_west > east or edge_north < south or edge_south > north:
                    continue
                if _segments_intersect(
                    (float(polygon_start[0]), float(polygon_start[1])),
                    (float(polygon_end[0]), float(polygon_end[1])),
                    (float(ring_start[0]), float(ring_start[1])),
                    (float(ring_end[0]), float(ring_end[1])),
                ):
                    return True
    return False


def _great_circle_distance_km(
    first_longitude: float, first_latitude: float, second_longitude: float, second_latitude: float,
) -> float:
    latitude_delta = math.radians(second_latitude - first_latitude)
    longitude_delta = math.radians(second_longitude - first_longitude)
    first_latitude_radians = math.radians(first_latitude)
    second_latitude_radians = math.radians(second_latitude)
    value = (
        math.sin(latitude_delta * 0.5) ** 2
        + math.cos(first_latitude_radians) * math.cos(second_latitude_radians)
        * math.sin(longitude_delta * 0.5) ** 2
    )
    return 6371.0088 * 2 * math.asin(min(1.0, math.sqrt(value)))


def _circle_intersects_rectangle(
    longitude: float, latitude: float, radius_km: float,
    rectangle: tuple[float, float, float, float] | list[float],
) -> bool:
    west, south, east, north = map(float, rectangle)
    closest_longitude = min(east, max(west, longitude))
    closest_latitude = min(north, max(south, latitude))
    return _great_circle_distance_km(
        longitude, latitude, closest_longitude, closest_latitude,
    ) <= radius_km


def _circle_intersects_rings(
    longitude: float, latitude: float, radius_km: float, rings: list[list[list[float]]],
) -> bool:
    if _point_in_geometry(longitude, latitude, rings):
        return True
    longitude_scale = 111.320 * max(0.05, math.cos(math.radians(latitude)))
    latitude_scale = 110.574
    radius_squared = radius_km * radius_km
    for ring in rings:
        if not ring:
            continue
        previous = ring[-1]
        for current in ring:
            start_x = (float(previous[0]) - longitude) * longitude_scale
            start_y = (float(previous[1]) - latitude) * latitude_scale
            end_x = (float(current[0]) - longitude) * longitude_scale
            end_y = (float(current[1]) - latitude) * latitude_scale
            delta_x = end_x - start_x
            delta_y = end_y - start_y
            denominator = delta_x * delta_x + delta_y * delta_y
            ratio = 0.0 if denominator == 0 else max(
                0.0, min(1.0, -(start_x * delta_x + start_y * delta_y) / denominator),
            )
            closest_x = start_x + delta_x * ratio
            closest_y = start_y + delta_y * ratio
            if closest_x * closest_x + closest_y * closest_y <= radius_squared:
                return True
            previous = current
    return False


def _surface_area_km2(bounds: tuple[float, float, float, float] | list[float]) -> float:
    west, south, east, north = bounds
    radius = 6371.0088
    longitude_span = math.radians(max(0.0, east - west))
    latitude_factor = abs(math.sin(math.radians(north)) - math.sin(math.radians(south)))
    return radius * radius * longitude_span * latitude_factor


def circle_polygon(
    longitude: float, latitude: float, radius_km: float, segments: int = 96,
) -> tuple[list[list[float]], list[float]]:
    center_longitude = float(longitude)
    center_latitude = float(latitude)
    radius = float(radius_km)
    if not (-180 <= center_longitude <= 180 and -90 <= center_latitude <= 90):
        raise ValueError("圆心坐标超出经纬度限制")
    if not (0.05 <= radius <= 5000):
        raise ValueError("圆形半径需在 0.05–5000 km 之间")
    count = max(36, min(180, int(segments)))
    earth_radius_km = 6371.0088
    angular_distance = radius / earth_radius_km
    center_latitude_radians = math.radians(center_latitude)
    center_longitude_radians = math.radians(center_longitude)
    boundary: list[list[float]] = []
    for index in range(count):
        bearing = index / count * math.tau
        point_latitude = math.asin(
            math.sin(center_latitude_radians) * math.cos(angular_distance)
            + math.cos(center_latitude_radians) * math.sin(angular_distance) * math.cos(bearing)
        )
        point_longitude = center_longitude_radians + math.atan2(
            math.sin(bearing) * math.sin(angular_distance) * math.cos(center_latitude_radians),
            math.cos(angular_distance) - math.sin(center_latitude_radians) * math.sin(point_latitude),
        )
        normalized_longitude = (math.degrees(point_longitude) + 540) % 360 - 180
        boundary.append([normalized_longitude, math.degrees(point_latitude)])
    longitudes = [point[0] for point in boundary]
    latitudes = [point[1] for point in boundary]
    if max(longitudes) - min(longitudes) > 180:
        raise ValueError("暂不支持跨越 180° 经线的圆形筛选")
    return boundary, [min(longitudes), min(latitudes), max(longitudes), max(latitudes)]


def _h3_resolution_for_view(level: str, bounds: tuple[float, float, float, float] | list[float]) -> int:
    resolution = H3_MAX_RESOLUTION.get(level, 4)
    area = _surface_area_km2(bounds)
    cell_budget = H3_MAX_VISIBLE_CELLS.get(level, 120000)
    while resolution > 0 and area / H3_AVERAGE_AREA_KM2[resolution] > cell_budget:
        resolution -= 1
    while (
        level == "city" and resolution > 7
        and area / H3_AVERAGE_AREA_KM2[resolution]
        > H3_FINE_GRID_VISIBLE_CELLS[resolution]
    ):
        resolution -= 1
    return resolution


@lru_cache(maxsize=64)
def _h3_cells_for_bounds(
    west: float, south: float, east: float, north: float, resolution: int,
) -> tuple[str, ...]:
    if h3 is None:
        return ()
    if east - west >= 359.0 and south <= -89.0 and north >= 89.0:
        return tuple(h3.uncompact_cells(h3.get_res0_cells(), resolution))
    clipped = (
        max(-179.999999, west), max(-89.999999, south),
        min(179.999999, east), min(89.999999, north),
    )
    polygon = h3.LatLngPoly([
        (clipped[1], clipped[0]),
        (clipped[1], clipped[2]),
        (clipped[3], clipped[2]),
        (clipped[3], clipped[0]),
    ])
    try:
        cells = h3.h3shape_to_cells_experimental(polygon, resolution, contain="overlap")
    except (AttributeError, TypeError):
        cells = h3.polygon_to_cells(polygon, resolution)
    if not cells:
        center = h3.latlng_to_cell((south + north) * 0.5, (west + east) * 0.5, resolution)
        cells = [center]
    return tuple(cells)


def _h3_cell_details(longitude: float, latitude: float, resolution: int) -> dict[str, Any]:
    if h3 is None:
        raise HeatmapUnavailable("H3 网格依赖尚未安装")
    if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
        raise ValueError("查询坐标超出经纬度限制")
    safe_resolution = max(0, min(11, int(resolution)))
    cell = h3.latlng_to_cell(latitude, longitude, safe_resolution)
    boundary_latlng = h3.cell_to_boundary(cell)
    boundary = [[float(lon), float(lat)] for lat, lon in boundary_latlng]
    longitudes = [point[0] for point in boundary]
    latitudes = [point[1] for point in boundary]
    return {
        "cell": cell,
        "resolution": safe_resolution,
        "area_km2": round(float(h3.cell_area(cell)), 4),
        "center": [float(longitude), float(latitude)],
        "boundary": boundary,
        "bounds": [min(longitudes), min(latitudes), max(longitudes), max(latitudes)],
    }


def _h3_quantize_pixels(
    pixels: bytes, width: int, height: int,
    bounds: tuple[float, float, float, float] | list[float], resolution: int,
    show_grid: bool = True,
    present_cells: dict[str, int] | None = None,
) -> tuple[bytes, int]:
    if h3 is None or Image is None or ImageDraw is None:
        return pixels, 0
    west, south, east, north = bounds
    cells = _h3_cells_for_bounds(
        round(west, 5), round(south, 5), round(east, 5), round(north, 5), resolution,
    )
    if not cells:
        return pixels, 0
    source = None if present_cells is not None else Image.frombytes("RGBA", (width, height), pixels)
    source_pixels = source.load() if source is not None else None
    target = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(target, "RGBA")

    def pixel_position(longitude: float, latitude: float) -> tuple[float, float]:
        return (
            (longitude - west) / (east - west) * width,
            (north - latitude) / (north - south) * height,
        )

    def sample(longitude: float, latitude: float) -> tuple[int, int, int, int]:
        x, y = pixel_position(longitude, latitude)
        column = min(width - 1, max(0, int(x)))
        row = min(height - 1, max(0, int(y)))
        return source_pixels[column, row]

    # 向量化中心采样：一次性算出所有网格中心的像素坐标与 alpha，
    # 省去逐个网格调用 sample() 的开销（后者在省份/城市层级是主要耗时）。
    # 计数着色模式不再读取平滑热力图像素，可直接跳过这段采样。
    _source_arr = None
    if np is not None and present_cells is None:
        _source_arr = np.frombuffer(pixels, dtype=np.uint8).reshape(height, width, 4)

    center_lats = [0.0] * len(cells)
    center_lons = [0.0] * len(cells)
    for index, cell in enumerate(cells):
        latitude, longitude = h3.cell_to_latlng(cell)
        center_lats[index] = latitude
        center_lons[index] = longitude

    if _source_arr is not None:
        px = np.asarray(center_lons, dtype=np.float64)
        py = np.asarray(center_lats, dtype=np.float64)
        columns = np.clip(((px - west) / (east - west) * width).astype(int), 0, width - 1)
        rows = np.clip(((north - py) / (north - south) * height).astype(int), 0, height - 1)
        center_alpha = _source_arr[rows, columns, 3]
    else:
        center_alpha = [] if present_cells is not None else [
                sample(center_lons[index], center_lats[index])[3]
                for index in range(len(cells))
            ]

    rendered = 0
    present_cell_ratios = (
        _h3_count_visual_ratios(present_cells)
        if present_cells is not None else {}
    )
    for index, cell in enumerate(cells):
        center_latitude = center_lats[index]
        center_longitude = center_lons[index]
        if present_cells is not None and cell not in present_cells:
            # 精细网格下“是否着色”与点击查询的命中统计完全一致：未命中任何
            # 数据集的网格保持透明（避免热力模糊把颜色糊进没有数据的格子）。
            continue
        if present_cells is None and center_alpha[index] < 3:
            # 空网格（密度几乎为 0）直接跳过，不再计算边界，显著减少高分辨率下的耗时。
            continue
        boundary_latlng = h3.cell_to_boundary(cell)
        normalized_boundary = []
        for latitude, longitude in boundary_latlng:
            while longitude - center_longitude > 180:
                longitude -= 360
            while longitude - center_longitude < -180:
                longitude += 360
            normalized_boundary.append((longitude, latitude))
        points = [pixel_position(longitude, latitude) for longitude, latitude in normalized_boundary]
        if present_cells is not None:
            color_ratio = present_cell_ratios[cell]
            color = _heat_color(color_ratio)
            fill_alpha = _present_fill_alpha(resolution, color_ratio)
            color = (color[0], color[1], color[2], fill_alpha)
        else:
            samples = [sample(center_longitude, center_latitude)]
            if resolution > 4:
                samples.extend(
                    sample(
                        center_longitude + (longitude - center_longitude) * 0.58,
                        center_latitude + (latitude - center_latitude) * 0.58,
                    )
                    for longitude, latitude in normalized_boundary[::2]
                )
            color = max(samples, key=lambda value: value[3])
        # 计数着色分支的填充透明度已按强度计算；平滑热力分支沿用原始 alpha。
        outline = None
        if show_grid:
            if present_cells is not None:
                # 精细网格描边跟随热力色，而不是固定青色。固定青色会让低、中、
                # 高密度格都被同一层网格线包裹，进一步削弱层次感。
                outline_ratio = 0.50 if resolution >= 10 else 0.62
                outline_alpha = max(30, round(color[3] * outline_ratio))
                outline = (color[0], color[1], color[2], outline_alpha)
            else:
                outline = (color[0], color[1], color[2], max(76, color[3]))
                if resolution >= 7:
                    # 精细网格：描边仅作网格参考，透明度随分辨率降低而递减，
                    # 避免在深放大时青色网格铺满、掩盖热力色。
                    outline = (148, 255, 241, min(color[3], max(40, 96 - (resolution - 6) * 14)))
        draw.polygon(points, fill=color, outline=outline)
        rendered += 1
    return target.tobytes(), rendered


def _orientation(
    first: tuple[float, float], second: tuple[float, float], third: tuple[float, float],
) -> float:
    return (
        (second[0] - first[0]) * (third[1] - first[1])
        - (second[1] - first[1]) * (third[0] - first[0])
    )


def _point_on_segment(
    point: tuple[float, float], start: tuple[float, float], end: tuple[float, float],
) -> bool:
    epsilon = 1e-10
    return (
        abs(_orientation(start, end, point)) <= epsilon
        and min(start[0], end[0]) - epsilon <= point[0] <= max(start[0], end[0]) + epsilon
        and min(start[1], end[1]) - epsilon <= point[1] <= max(start[1], end[1]) + epsilon
    )


def _segments_intersect(
    first_start: tuple[float, float], first_end: tuple[float, float],
    second_start: tuple[float, float], second_end: tuple[float, float],
) -> bool:
    first_orientation = _orientation(first_start, first_end, second_start)
    second_orientation = _orientation(first_start, first_end, second_end)
    third_orientation = _orientation(second_start, second_end, first_start)
    fourth_orientation = _orientation(second_start, second_end, first_end)
    epsilon = 1e-10
    if (
        (first_orientation > epsilon and second_orientation < -epsilon
         or first_orientation < -epsilon and second_orientation > epsilon)
        and (third_orientation > epsilon and fourth_orientation < -epsilon
             or third_orientation < -epsilon and fourth_orientation > epsilon)
    ):
        return True
    return (
        _point_on_segment(second_start, first_start, first_end)
        or _point_on_segment(second_end, first_start, first_end)
        or _point_on_segment(first_start, second_start, second_end)
        or _point_on_segment(first_end, second_start, second_end)
    )


def _rectangle_intersects_rings(
    bounds: tuple[float, float, float, float], rings: list[list[list[float]]],
) -> bool:
    west, south, east, north = bounds
    corners = ((west, south), (east, south), (east, north), (west, north))
    if any(_point_in_geometry(longitude, latitude, rings) for longitude, latitude in corners):
        return True
    rectangle_edges = tuple(zip(corners, corners[1:] + corners[:1]))
    for ring in rings:
        points = [(float(point[0]), float(point[1])) for point in ring]
        if any(west <= longitude <= east and south <= latitude <= north for longitude, latitude in points):
            return True
        for start, end in zip(points, points[1:] + points[:1]):
            if any(
                _segments_intersect(start, end, edge_start, edge_end)
                for edge_start, edge_end in rectangle_edges
            ):
                return True
    return False


def _load_boundaries() -> dict[str, list[list[list[float]]]]:
    boundaries: dict[str, list[list[list[float]]]] = {}
    for path in BOUNDARY_PATHS:
        collection = json.loads(path.read_text(encoding="utf-8"))
        for feature in collection["features"]:
            code = str((feature.get("properties") or {}).get("regionCode") or "")
            if code:
                boundaries[code] = _outer_rings(feature["geometry"])
    return boundaries


BOUNDARIES = _load_boundaries()


def _rings_bounds(rings: list[list[list[float]]]) -> tuple[float, float, float, float] | None:
    coordinates = [coordinate for ring in rings for coordinate in ring]
    if not coordinates:
        return None
    return (
        min(float(coordinate[0]) for coordinate in coordinates),
        min(float(coordinate[1]) for coordinate in coordinates),
        max(float(coordinate[0]) for coordinate in coordinates),
        max(float(coordinate[1]) for coordinate in coordinates),
    )


BOUNDARY_BOUNDS = {
    code: bounds
    for code, rings in BOUNDARIES.items()
    if (bounds := _rings_bounds(rings)) is not None
}


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def _encode_png(width: int, height: int, pixels: bytes) -> bytes:
    stride = width * 4
    raw = b"".join(b"\x00" + pixels[row * stride:(row + 1) * stride] for row in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + _png_chunk(b"IDAT", zlib.compress(raw, 6))
        + _png_chunk(b"IEND", b"")
    )


def _encode_webp(width: int, height: int, pixels: bytes) -> bytes | None:
    if Image is None:
        return None
    output = BytesIO()
    Image.frombytes("RGBA", (width, height), pixels).save(
        output, "WEBP", quality=72, method=3, exact=True,
    )
    return output.getvalue()


def _heat_color(ratio: float) -> tuple[int, int, int, int]:
    if ratio < 0.025:
        return 0, 0, 0, 0
    upper = 1
    while upper < len(COLOR_STOPS) - 1 and ratio > COLOR_STOPS[upper][0]:
        upper += 1
    lower_stop, lower_color = COLOR_STOPS[upper - 1]
    upper_stop, upper_color = COLOR_STOPS[upper]
    local = (ratio - lower_stop) / (upper_stop - lower_stop or 1)
    return tuple(round(lower_color[channel] + (upper_color[channel] - lower_color[channel]) * local) for channel in range(4))


def _blur(values: list[float], width: int, height: int, passes: int = 1) -> list[float]:
    current = values
    for _ in range(max(1, passes)):
        horizontal = [0.0] * len(current)
        output = [0.0] * len(current)
        for row in range(height):
            offset = row * width
            for column in range(width):
                left = offset + max(0, column - 1)
                center = offset + column
                right = offset + min(width - 1, column + 1)
                horizontal[center] = current[left] * 0.25 + current[center] * 0.5 + current[right] * 0.25
        for row in range(height):
            previous = max(0, row - 1) * width
            current_row = row * width
            following = min(height - 1, row + 1) * width
            for column in range(width):
                output[current_row + column] = (
                    horizontal[previous + column] * 0.25
                    + horizontal[current_row + column] * 0.5
                    + horizontal[following + column] * 0.25
                )
        current = output
    return current


def _box_blur(values: list[float], width: int, height: int, radius: int) -> list[float]:
    if radius <= 0:
        return values
    horizontal = [0.0] * len(values)
    output = [0.0] * len(values)
    window = radius * 2 + 1
    for row in range(height):
        offset = row * width
        running = sum(values[offset + min(width - 1, max(0, delta))] for delta in range(-radius, radius + 1))
        for column in range(width):
            horizontal[offset + column] = running / window
            removed = min(width - 1, max(0, column - radius))
            added = min(width - 1, max(0, column + radius + 1))
            running += values[offset + added] - values[offset + removed]
    for column in range(width):
        running = sum(horizontal[min(height - 1, max(0, delta)) * width + column] for delta in range(-radius, radius + 1))
        for row in range(height):
            output[row * width + column] = running / window
            removed = min(height - 1, max(0, row - radius))
            added = min(height - 1, max(0, row + radius + 1))
            running += horizontal[added * width + column] - horizontal[removed * width + column]
    return output


def _blur_array(values: list[float], width: int, height: int, passes: int = 1):
    array = np.asarray(values, dtype=np.float64).reshape(height, width)
    for _ in range(max(1, passes)):
        padded = np.pad(array, ((0, 0), (1, 1)), mode="edge")
        horizontal = padded[:, :-2] * 0.25 + array * 0.5 + padded[:, 2:] * 0.25
        padded = np.pad(horizontal, ((1, 1), (0, 0)), mode="edge")
        array = padded[:-2, :] * 0.25 + horizontal * 0.5 + padded[2:, :] * 0.25
    return array


def _box_blur_array(values: list[float], width: int, height: int, radius: int):
    array = np.asarray(values, dtype=np.float64).reshape(height, width)
    if radius <= 0:
        return array
    window = radius * 2 + 1
    padded_x = np.pad(array, ((0, 0), (radius, radius)), mode="edge")
    cumulative_x = np.pad(np.cumsum(padded_x, axis=1), ((0, 0), (1, 0)))
    horizontal = (cumulative_x[:, window:] - cumulative_x[:, :-window]) / window
    padded_y = np.pad(horizontal, ((radius, radius), (0, 0)), mode="edge")
    cumulative_y = np.pad(np.cumsum(padded_y, axis=0), ((1, 0), (0, 0)))
    return (cumulative_y[window:, :] - cumulative_y[:-window, :]) / window


def _percentile(values: list[float], ratio: float) -> float:
    nonzero = sorted(value for value in values if value > 0)
    if not nonzero:
        return 1.0
    return nonzero[min(len(nonzero) - 1, round((len(nonzero) - 1) * ratio))]


def _band_limits(values: list[float], low_ratio: float, high_ratio: float) -> tuple[float, float]:
    low = _percentile(values, low_ratio)
    high = max(low + 1e-6, _percentile(values, high_ratio))
    return low, high


def _view_band_limits(
    values, fallback: tuple[float, float], low_ratio: float, high_ratio: float,
) -> tuple[float, float]:
    if np is not None and isinstance(values, np.ndarray):
        nonzero = values[values > 0]
        if nonzero.size < 16:
            return fallback
        low = float(np.percentile(nonzero, low_ratio * 100))
        high = float(np.percentile(nonzero, high_ratio * 100))
    else:
        nonzero = [value for value in values if value > 0]
        if len(nonzero) < 16:
            return fallback
        low, high = _band_limits(nonzero, low_ratio, high_ratio)
    if not math.isfinite(low) or not math.isfinite(high) or high <= low + 1e-9:
        return fallback
    return max(1e-9, low), high


def _band_strength(value: float, limits: tuple[float, float], gamma: float) -> float:
    low, high = limits
    ratio = _clamp((value - low) / (high - low), 0.0, 1.0)
    ratio = ratio * ratio * (3 - 2 * ratio)
    return math.pow(ratio, gamma)


def _hash_noise(x: int, y: int, seed: int) -> float:
    value = (x * 374761393 + y * 668265263 + seed * 2246822519) & 0xFFFFFFFF
    value = ((value ^ (value >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((value ^ (value >> 16)) & 0xFFFFFFFF) / 0xFFFFFFFF


_PARTICLE_TEXTURE_BUCKET = 64


def _particle_canonical_size(width: int, height: int) -> tuple[int, int]:
    """把粒子纹理尺寸按固定桶取整，让相近的请求复用同一个缓存的纹理。"""
    bucket = _PARTICLE_TEXTURE_BUCKET
    canonical_width = ((width + bucket - 1) // bucket) * bucket
    canonical_height = ((height + bucket - 1) // bucket) * bucket
    return canonical_width, canonical_height


@lru_cache(maxsize=40)
def _particle_texture_cached(
    width: int, height: int, spacing: int, radius: float, seed: int,
) -> bytes:
    """在指定的 (width,height) 上生成稳定的软圆点纹理（原始算法）。

    只按“桶尺寸”缓存一次，之后对不同 bounds 的请求直接切片复用，
    避免每次缩放都重新生成整幅粒子纹理（高分辨率下这一步曾是主要热点）。
    """
    if np is not None:
        texture = np.zeros((height, width), dtype=np.uint8)
        stamp_radius = math.ceil(radius * 2.2)
        for tile_y in range(-1, math.ceil(height / spacing) + 1):
            for tile_x in range(-1, math.ceil(width / spacing) + 1):
                center_x = tile_x * spacing + _hash_noise(tile_x, tile_y, seed) * spacing
                center_y = tile_y * spacing + _hash_noise(tile_x, tile_y, seed + 31) * spacing
                first_column = max(0, math.floor(center_x) - stamp_radius)
                last_column = min(width - 1, math.floor(center_x) + stamp_radius)
                first_row = max(0, math.floor(center_y) - stamp_radius)
                last_row = min(height - 1, math.floor(center_y) + stamp_radius)
                if first_column > last_column or first_row > last_row:
                    continue
                columns = np.arange(first_column, last_column + 1, dtype=np.float64) + 0.5 - center_x
                rows = np.arange(first_row, last_row + 1, dtype=np.float64) + 0.5 - center_y
                stamp = np.rint(255 * np.exp(
                    -(rows[:, None] ** 2 + columns[None, :] ** 2) / (2 * radius * radius)
                )).astype(np.uint8)
                target = texture[first_row:last_row + 1, first_column:last_column + 1]
                np.maximum(target, stamp, out=target)
        return texture.tobytes()
    texture = bytearray(width * height)
    stamp_radius = math.ceil(radius * 2.2)
    for tile_y in range(-1, math.ceil(height / spacing) + 1):
        for tile_x in range(-1, math.ceil(width / spacing) + 1):
            center_x = tile_x * spacing + _hash_noise(tile_x, tile_y, seed) * spacing
            center_y = tile_y * spacing + _hash_noise(tile_x, tile_y, seed + 31) * spacing
            first_column = max(0, math.floor(center_x) - stamp_radius)
            last_column = min(width - 1, math.floor(center_x) + stamp_radius)
            first_row = max(0, math.floor(center_y) - stamp_radius)
            last_row = min(height - 1, math.floor(center_y) + stamp_radius)
            for row in range(first_row, last_row + 1):
                for column in range(first_column, last_column + 1):
                    distance_squared = (column + 0.5 - center_x) ** 2 + (row + 0.5 - center_y) ** 2
                    value = round(255 * math.exp(-distance_squared / (2 * radius * radius)))
                    index = row * width + column
                    if value > texture[index]:
                        texture[index] = value
    return bytes(texture)


def _particle_texture(width: int, height: int, spacing: int, radius: float, seed: int) -> bytes:
    """返回尺寸为 (width,height) 的稳定软圆点纹理。

    先生成按桶取整的缓存纹理，再切片成实际尺寸；切片对最终像素值无影响，
    因为粒子中心只取决于网格索引，与画布总尺寸无关（左上角区域完全一致）。
    """
    canonical_width, canonical_height = _particle_canonical_size(width, height)
    full = _particle_texture_cached(canonical_width, canonical_height, spacing, radius, seed)
    if canonical_width == width and canonical_height == height:
        return full
    if np is not None:
        array = np.frombuffer(full, dtype=np.uint8).reshape(canonical_height, canonical_width)
        return array[:height, :width].copy().tobytes()
    out = bytearray(width * height)
    for row in range(height):
        start = row * canonical_width
        out[row * width:(row + 1) * width] = full[start:start + width]
    return bytes(out)



def _compose_heat_pixels(
    point_grid, local_grid, medium_grid, broad_grid,
    width: int, height: int, point_limits, local_limits, medium_limits, broad_limits,
    local_texture: bytes, medium_texture: bytes, broad_texture: bytes, level: str,
) -> bytes:
    def strength(values, limits, gamma):
        ratio = np.clip((values - limits[0]) / (limits[1] - limits[0]), 0.0, 1.0)
        return np.power(ratio * ratio * (3 - 2 * ratio), gamma)

    point_strength = strength(point_grid, point_limits, 0.9)
    local_strength = strength(local_grid, local_limits, 1.04)
    medium_strength = strength(medium_grid, medium_limits, 1.1)
    broad_strength = strength(broad_grid, broad_limits, 1.16)
    local_visual = local_strength * np.frombuffer(local_texture, dtype=np.uint8).reshape(height, width) / 255
    medium_visual = medium_strength * np.frombuffer(medium_texture, dtype=np.uint8).reshape(height, width) / 255
    broad_visual = broad_strength * np.frombuffer(broad_texture, dtype=np.uint8).reshape(height, width) / 255
    weights = np.asarray(HEAT_VISUAL_WEIGHTS[level], dtype=np.float64)[:, None, None]
    candidates = np.stack((point_strength, local_visual, medium_visual, broad_visual)) * weights
    selected = np.argmax(candidates, axis=0)
    ratio = np.take_along_axis(candidates, selected[None, :, :], axis=0)[0]
    alpha_scale = np.take(np.asarray(HEAT_ALPHA_SCALES[level]), selected)

    stop_positions = np.asarray([stop[0] for stop in COLOR_STOPS])
    stop_colors = np.asarray([stop[1] for stop in COLOR_STOPS], dtype=np.float64)
    pixels = np.empty((height, width, 4), dtype=np.float64)
    for channel in range(4):
        pixels[:, :, channel] = np.interp(ratio, stop_positions, stop_colors[:, channel])
    pixels[:, :, 3] *= alpha_scale
    pixels[ratio < 0.025] = 0

    if level != "country":
        columns = np.arange(width, dtype=np.float64) + 0.5
        rows = np.arange(height, dtype=np.float64) + 0.5
        edge_x = np.minimum(columns, width - columns) / max(1.0, width * 0.065)
        edge_y = np.minimum(rows, height - rows) / max(1.0, height * 0.065)
        edge = np.clip(np.minimum(edge_y[:, None], edge_x[None, :]), 0.0, 1.0)
        edge = edge * edge * (3 - 2 * edge)
        pixels[:, :, 3] *= edge
    return np.rint(np.clip(pixels, 0, 255)).astype(np.uint8).tobytes()


class DatasetHeatmapService:
    def __init__(self, database_path: Path = DATABASE_PATH, cache_size: int = 64) -> None:
        self.database_path = database_path
        self.cache_size = cache_size
        self.cache: OrderedDict[str, tuple[bytes, dict[str, Any]]] = OrderedDict()
        self.region_cache: OrderedDict[str, dict[str, int]] = OrderedDict()
        self.statistics_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self.keyword_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self.global_dataset_ids: set[int] | None = None
        self.lock = threading.Lock()
        # 允许少量并发渲染：前端缩放时旧请求会被 abort，新请求不应被旧请求
        # 的渲染锁阻塞（否则热力图会一直等不到渲染完成）。用信号量限制并发即可。
        self.render_semaphore = threading.Semaphore(2)

    def available(self) -> bool:
        return self.database_path.exists()

    def render(
        self, params: dict[str, Any],
        extra_coordinate_geometries: list[Any] | None = None,
        abort_check: Any | None = None,
    ) -> tuple[bytes, dict[str, Any]]:
        if not self.available():
            raise HeatmapUnavailable("真实热力索引尚未生成")
        normalized = self._normalize_params(params)
        signature = json.dumps(normalized, sort_keys=True, ensure_ascii=False)
        with self.lock:
            cached = self.cache.get(signature)
            if cached:
                self.cache.move_to_end(signature)
                metadata = dict(cached[1], cache="hit")
                return cached[0], metadata
        with self.render_semaphore:
            # 并发下再次查缓存，避免同一签名被重复渲染。
            with self.lock:
                cached = self.cache.get(signature)
                if cached:
                    self.cache.move_to_end(signature)
                    return cached[0], dict(cached[1], cache="hit")
            self._check_abort(abort_check)
            image, metadata = self._render_uncached(normalized, extra_coordinate_geometries, abort_check)
            with self.lock:
                self.cache[signature] = (image, metadata)
                self.cache.move_to_end(signature)
                while len(self.cache) > self.cache_size:
                    self.cache.popitem(last=False)
            return image, dict(metadata, cache="miss")

    @staticmethod
    def _check_abort(abort_check: Any | None) -> None:
        """若客户端已断开，则抛出 HeatmapAborted 以立即终止当前渲染。"""
        if abort_check is None:
            return
        try:
            if abort_check():
                raise HeatmapAborted("客户端已断开，取消热力图渲染")
        except HeatmapAborted:
            raise
        except Exception:
            # 探活失败时按“未断开”处理，避免误取消正常请求。
            pass

    def _normalize_params(self, params: dict[str, Any]) -> dict[str, Any]:
        level = str(params.get("level") or "country")
        if level not in LEVEL_RESOLUTION:
            level = "country"
        bounds = [float(value) for value in params.get("bounds", (-180, -90, 180, 90))]
        if len(bounds) != 4:
            raise ValueError("热力范围格式不正确")
        west, south, east, north = bounds
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError("热力范围超出经纬度限制")
        start_year = params.get("start_year")
        end_year = params.get("end_year")
        publication_start_year = params.get("publication_start_year")
        publication_end_year = params.get("publication_end_year")
        spatial_type = str(params.get("spatial_type") or "")[:24]
        source = str(params.get("source") or "")[:40]
        if source == "论文抽取":
            source = "科学数据"
        temporal_availability = str(params.get("temporal_availability") or "")[:24]
        problem_availability = str(params.get("problem_availability") or "")[:24]
        show_h3_grid = str(params.get("show_h3_grid", "1")).lower() not in {"0", "false", "off"}
        return {
            "level": level,
            "bounds": [round(west, 5), round(south, 5), round(east, 5), round(north, 5)],
            "format": "webp" if str(params.get("format") or "").lower() == "webp" and Image is not None else "png",
            "show_h3_grid": show_h3_grid,
            "render": str(params.get("render") or "coverage-v1")[:32],
            "theme": str(params.get("theme") or "")[:80],
            "query": str(params.get("query") or "")[:120],
            "data_type": str(params.get("data_type") or "")[:80],
            "resolution_filter": str(params.get("resolution_filter") or "")[:80],
            "min_size_gb": float(params.get("min_size_gb") or 0),
            "temporal_scope": str(params.get("temporal_scope") or "")[:24],
            "start_year": int(start_year) if start_year not in (None, "") else None,
            "end_year": int(end_year) if end_year not in (None, "") else None,
            "spatial_type": spatial_type if spatial_type in {"coordinates", "named", "unlocated"} else "",
            "source": source if source in {"科学数据", "海纳数据集", "OneEarth数据集"} else "",
            "temporal_availability": temporal_availability if temporal_availability in {"available", "missing"} else "",
            "problem_availability": problem_availability if problem_availability in {"available", "missing"} else "",
            "publication_start_year": int(publication_start_year) if publication_start_year not in (None, "") else None,
            "publication_end_year": int(publication_end_year) if publication_end_year not in (None, "") else None,
        }

    def _normalize_filter_params(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._normalize_params({
            **params,
            "level": params.get("level") or "country",
            "bounds": params.get("bounds") or [-180, -90, 180, 90],
        })

    def h3_cell(self, longitude: float, latitude: float, resolution: int = 8) -> dict[str, Any]:
        return _h3_cell_details(float(longitude), float(latitude), int(resolution))

    def _dataset_filter_conditions(
        self, params: dict[str, Any], include_query: bool = True,
    ) -> tuple[list[str], list[Any]]:
        conditions: list[str] = []
        arguments: list[Any] = []
        if params["temporal_scope"] == "geologic" or params["min_size_gb"] > 0:
            conditions.append("0")
        elif params["start_year"] is not None and params["end_year"] is not None:
            conditions.extend(["d.start_year IS NOT NULL", "d.end_year IS NOT NULL", "d.end_year >= ?", "d.start_year <= ?"])
            arguments.extend([params["start_year"], params["end_year"]])
        if params["theme"]:
            conditions.append(
                "EXISTS(SELECT 1 FROM dataset_topics dtf WHERE dtf.dataset_id=d.id AND lower(dtf.topic)=lower(?))"
            )
            arguments.append(params["theme"])
        if params.get("source") in {"海纳数据集", "OneEarth数据集"}:
            conditions.append("0")
        if params["spatial_type"] == "coordinates":
            conditions.append(
                "EXISTS(SELECT 1 FROM dataset_spatial_profile dsf WHERE dsf.dataset_id=d.id "
                "AND dsf.spatial_class IN ('bbox','point'))"
            )
        elif params["spatial_type"] == "named":
            conditions.append(
                "EXISTS(SELECT 1 FROM dataset_spatial_profile dsf WHERE dsf.dataset_id=d.id "
                "AND dsf.spatial_class IN ('region','global'))"
            )
        elif params["spatial_type"] == "unlocated":
            conditions.append(
                "EXISTS(SELECT 1 FROM dataset_spatial_profile dsf WHERE dsf.dataset_id=d.id "
                "AND dsf.spatial_class='unlocated')"
            )
        if params["temporal_availability"] == "available":
            conditions.extend(["d.start_year IS NOT NULL", "d.end_year IS NOT NULL"])
        elif params["temporal_availability"] == "missing":
            conditions.append("(d.start_year IS NULL OR d.end_year IS NULL)")
        if params["problem_availability"] == "available":
            conditions.append("EXISTS(SELECT 1 FROM dataset_problem_links dpf WHERE dpf.dataset_id=d.id)")
        elif params["problem_availability"] == "missing":
            conditions.append("NOT EXISTS(SELECT 1 FROM dataset_problem_links dpf WHERE dpf.dataset_id=d.id)")
        if params["publication_start_year"] is not None and params["publication_end_year"] is not None:
            conditions.append(
                "EXISTS(SELECT 1 FROM dataset_papers dpy WHERE dpy.dataset_id=d.id "
                "AND dpy.publication_year>=? AND dpy.publication_year<=?)"
            )
            arguments.extend([params["publication_start_year"], params["publication_end_year"]])
        searchable = "lower(d.name || ' ' || d.description || ' ' || d.region_text || ' ' || d.topics)"
        search_groups = []
        if include_query and params["query"]:
            search_groups.append([params["query"]])
        if params["data_type"]:
            search_groups.append(DATA_TYPE_TERMS.get(params["data_type"], [params["data_type"]]))
        if params["resolution_filter"]:
            search_groups.append(RESOLUTION_TERMS.get(params["resolution_filter"], [params["resolution_filter"]]))
        for search_terms in search_groups:
            conditions.append("(" + " OR ".join("instr(" + searchable + ", ?) > 0" for _ in search_terms) + ")")
            arguments.extend(term.casefold() for term in search_terms)
        return conditions, arguments

    def filter_options(self) -> dict[str, Any]:
        if not self.available():
            raise HeatmapUnavailable("真实数据索引尚未生成")
        connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri=True)
        topic_rows = connection.execute(
            "SELECT topic,COUNT(*) FROM dataset_topics GROUP BY topic "
            "ORDER BY COUNT(*) DESC,topic COLLATE NOCASE"
        ).fetchall()
        publication_rows = connection.execute(
            "SELECT CAST(publication_year / 10 AS INTEGER) * 10 AS decade,"
            "COUNT(DISTINCT dataset_id) FROM dataset_papers WHERE publication_year IS NOT NULL "
            "GROUP BY decade ORDER BY decade DESC"
        ).fetchall()
        maximum_publication_year = connection.execute(
            "SELECT MAX(publication_year) FROM dataset_papers"
        ).fetchone()[0]
        availability = connection.execute(
            "SELECT COUNT(*),"
            "SUM(CASE WHEN start_year IS NOT NULL AND end_year IS NOT NULL THEN 1 ELSE 0 END),"
            "SUM(CASE WHEN EXISTS(SELECT 1 FROM dataset_problem_links dpl WHERE dpl.dataset_id=d.id) "
            "THEN 1 ELSE 0 END) FROM datasets d"
        ).fetchone()
        spatial_rows = connection.execute(
            "SELECT spatial_class,COUNT(*) FROM dataset_spatial_profile GROUP BY spatial_class"
        ).fetchall()
        connection.close()
        spatial_counts = {str(kind): int(count) for kind, count in spatial_rows}
        total = int(availability[0] or 0)
        temporal_count = int(availability[1] or 0)
        problem_count = int(availability[2] or 0)
        publication_maximum = int(maximum_publication_year or 0)
        return {
            "topics": [{"value": str(topic), "count": int(count)} for topic, count in topic_rows],
            "sources": [{"value": "科学数据", "count": total}],
            "spatial": {
                "coordinates": spatial_counts.get("bbox", 0) + spatial_counts.get("point", 0),
                "named": spatial_counts.get("region", 0) + spatial_counts.get("global", 0),
                "unlocated": spatial_counts.get("unlocated", 0),
            },
            "temporal": {"available": temporal_count, "missing": total - temporal_count},
            "problems": {"available": problem_count, "missing": total - problem_count},
            "publication_periods": [
                {
                    "start": int(decade),
                    "end": min(int(decade) + 9, publication_maximum),
                    "count": int(count),
                }
                for decade, count in publication_rows
            ],
        }

    def region_counts(self, codes: list[str], params: dict[str, Any]) -> dict[str, int]:
        if not self.available():
            raise HeatmapUnavailable("真实数据索引尚未生成")
        normalized_codes = list(dict.fromkeys(str(code) for code in codes if code))[:700]
        if not normalized_codes:
            return {}
        normalized = self._normalize_filter_params(params)
        signature = json.dumps({"codes": sorted(normalized_codes), "filters": normalized}, sort_keys=True, ensure_ascii=False)
        with self.lock:
            cached = self.region_cache.get(signature)
            if cached is not None:
                self.region_cache.move_to_end(signature)
                return dict(cached)
        connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri=True)
        result = {code: 0 for code in normalized_codes}
        regional_codes = [code for code in normalized_codes if code != "WORLD"]
        if regional_codes:
            conditions, arguments = self._dataset_filter_conditions(normalized)
            placeholders = ",".join("?" for _ in regional_codes)
            conditions.insert(0, f"rm.region_code IN ({placeholders})")
            arguments = [*regional_codes, *arguments]
            query = (
                "SELECT rm.region_code,COUNT(DISTINCT rm.dataset_id) AS dataset_count "
                "FROM region_memberships rm JOIN datasets d ON d.id=rm.dataset_id WHERE "
                + " AND ".join(conditions)
                + " GROUP BY rm.region_code"
            )
            for code, count in connection.execute(query, arguments):
                result[str(code)] = int(count)
        if "WORLD" in result:
            world_conditions, world_arguments = self._dataset_filter_conditions(normalized)
            world_where = " WHERE " + " AND ".join(world_conditions) if world_conditions else ""
            result["WORLD"] = int(connection.execute(
                "SELECT COUNT(*) FROM datasets d" + world_where,
                world_arguments,
            ).fetchone()[0])
        connection.close()
        with self.lock:
            self.region_cache[signature] = result
            self.region_cache.move_to_end(signature)
            while len(self.region_cache) > 32:
                self.region_cache.popitem(last=False)
        return dict(result)

    def region_statistics(self, region_code: str, params: dict[str, Any]) -> dict[str, Any]:
        if not self.available():
            raise HeatmapUnavailable("真实数据索引尚未生成")
        code = str(region_code or "").strip()
        if not code:
            raise ValueError("缺少行政区编码")
        normalized = self._normalize_filter_params(params)
        signature = json.dumps({"code": code, "filters": normalized}, sort_keys=True, ensure_ascii=False)
        with self.lock:
            cached = self.statistics_cache.get(signature)
            if cached is not None:
                self.statistics_cache.move_to_end(signature)
                return json.loads(json.dumps(cached, ensure_ascii=False))

        conditions, arguments = self._dataset_filter_conditions(normalized)
        if code == "WORLD":
            selected_sql = "SELECT d.id,d.start_year,d.end_year FROM datasets d"
        else:
            selected_sql = (
                "SELECT d.id,d.start_year,d.end_year FROM region_memberships rm "
                "JOIN datasets d ON d.id=rm.dataset_id"
            )
            conditions.insert(0, "rm.region_code=?")
            arguments.insert(0, code)
        if conditions:
            selected_sql += " WHERE " + " AND ".join(conditions)
        selected_cte = "WITH selected AS (" + selected_sql + ") "

        connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri=True)
        metrics = connection.execute(
            selected_cte +
            "SELECT COUNT(*),"
            "SUM(CASE WHEN start_year IS NOT NULL AND end_year IS NOT NULL THEN 1 ELSE 0 END),"
            "MIN(start_year),MAX(end_year) FROM selected",
            arguments,
        ).fetchone()
        paper_metrics = connection.execute(
            selected_cte +
            "SELECT COUNT(DISTINCT dp.paper_key),MIN(dp.publication_year),MAX(dp.publication_year) "
            "FROM selected s JOIN dataset_papers dp ON dp.dataset_id=s.id",
            arguments,
        ).fetchone()
        problem_metrics = connection.execute(
            selected_cte +
            "SELECT COUNT(DISTINCT dpl.problem_key),COUNT(DISTINCT dpl.dataset_id) "
            "FROM selected s JOIN dataset_problem_links dpl ON dpl.dataset_id=s.id",
            arguments,
        ).fetchone()
        spatial_count = int(connection.execute(
            selected_cte +
            "SELECT COUNT(*) FROM selected s JOIN dataset_spatial_profile dsp ON dsp.dataset_id=s.id "
            "WHERE dsp.spatial_class!='unlocated'",
            arguments,
        ).fetchone()[0])
        topic_rows = connection.execute(
            selected_cte +
            "SELECT dt.topic,COUNT(*) AS topic_count FROM selected s "
            "JOIN dataset_topics dt ON dt.dataset_id=s.id "
            "GROUP BY dt.topic ORDER BY topic_count DESC,dt.topic COLLATE NOCASE",
            arguments,
        ).fetchall()
        region_row = connection.execute(
            "SELECT name,level FROM region_catalog WHERE region_code=?", (code,)
        ).fetchone() if code != "WORLD" else ("全球", "world")
        connection.close()

        total = int(metrics[0] or 0)
        temporal_count = int(metrics[1] or 0)
        result = {
            "region_code": code,
            "region_name": str(region_row[0]) if region_row else code,
            "level": str(region_row[1]) if region_row else "",
            "total": total,
            "paper_count": int(paper_metrics[0] or 0),
            "problem_count": int(problem_metrics[0] or 0),
            "problem_dataset_count": int(problem_metrics[1] or 0),
            "spatial_count": spatial_count,
            "temporal_count": temporal_count,
            "dataset_year_start": metrics[2],
            "dataset_year_end": metrics[3],
            "paper_year_start": paper_metrics[1],
            "paper_year_end": paper_metrics[2],
            "topics": [{"name": str(name), "count": int(count)} for name, count in topic_rows],
        }
        with self.lock:
            self.statistics_cache[signature] = result
            self.statistics_cache.move_to_end(signature)
            while len(self.statistics_cache) > 64:
                self.statistics_cache.popitem(last=False)
        return json.loads(json.dumps(result, ensure_ascii=False))

    def region_datasets(
        self, region_code: str, params: dict[str, Any], limit: int = 50, offset: int = 0,
    ) -> dict[str, Any]:
        if not self.available():
            raise HeatmapUnavailable("真实数据索引尚未生成")
        code = str(region_code or "").strip()
        if not code:
            raise ValueError("缺少行政区编码")
        normalized = self._normalize_filter_params(params)
        conditions, arguments = self._dataset_filter_conditions(normalized)
        conditions.insert(0, "rm.region_code=?")
        arguments.insert(0, code)
        where = " AND ".join(conditions)
        connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri=True)
        total_row = connection.execute(
            "SELECT COUNT(DISTINCT rm.dataset_id),MIN(d.start_year),MAX(d.end_year) "
            "FROM region_memberships rm JOIN datasets d ON d.id=rm.dataset_id WHERE " + where,
            arguments,
        ).fetchone()
        total = int(total_row[0])
        dataset_year_start = total_row[1]
        dataset_year_end = total_row[2]
        safe_limit = max(1, min(100, int(limit)))
        safe_offset = max(0, int(offset))
        rows = connection.execute(
            "SELECT DISTINCT d.id,d.name,d.url,d.region_text,d.topics,d.start_year,d.end_year "
            "FROM region_memberships rm JOIN datasets d ON d.id=rm.dataset_id WHERE " + where +
            " ORDER BY d.end_year IS NULL,d.end_year DESC,d.name COLLATE NOCASE LIMIT ? OFFSET ?",
            [*arguments, safe_limit, safe_offset],
        ).fetchall()
        region_row = connection.execute(
            "SELECT name,level FROM region_catalog WHERE region_code=?", (code,)
        ).fetchone()
        dataset_ids = [int(row[0]) for row in rows]
        coverage_by_dataset: dict[int, list[dict[str, Any]]] = defaultdict(list)
        region_rings = BOUNDARIES.get(code, [])
        region_bounds = BOUNDARY_BOUNDS.get(code)
        region_level = str(region_row[1]) if region_row else "city"
        maximum_span = MEMBERSHIP_MAX_SPAN.get(region_level, 8.0)
        if dataset_ids and region_bounds:
            placeholders = ",".join("?" for _ in dataset_ids)
            geometry_rows = connection.execute(
                "SELECT dataset_id,kind,west,south,east,north,region_code FROM geometries "
                f"WHERE dataset_id IN ({placeholders}) AND kind!='global' "
                "ORDER BY dataset_id,CASE kind WHEN 'point' THEN 0 WHEN 'bbox' THEN 1 ELSE 2 END,"
                "(east-west)*(north-south)",
                dataset_ids,
            ).fetchall()
            region_west, region_south, region_east, region_north = region_bounds
            seen_coverage: dict[int, set[tuple[Any, ...]]] = defaultdict(set)
            for dataset_id, kind, west, south, east, north, geometry_region_code in geometry_rows:
                dataset_id = int(dataset_id)
                if len(coverage_by_dataset[dataset_id]) >= 12:
                    continue
                west, south, east, north = map(float, (west, south, east, north))
                include = False
                if kind == "point":
                    longitude = (west + east) * 0.5
                    latitude = (south + north) * 0.5
                    include = _point_in_geometry(longitude, latitude, region_rings)
                elif kind == "bbox":
                    span = max(east - west, north - south)
                    include = span <= maximum_span and not (
                        east < region_west or west > region_east or
                        north < region_south or south > region_north
                    )
                elif kind == "region":
                    include = str(geometry_region_code) == code
                if not include:
                    continue
                coverage_kind = "point" if kind == "point" else "bbox"
                key = (coverage_kind, west, south, east, north)
                if key in seen_coverage[dataset_id]:
                    continue
                seen_coverage[dataset_id].add(key)
                coverage_by_dataset[dataset_id].append({
                    "kind": coverage_kind,
                    "west": west,
                    "south": south,
                    "east": east,
                    "north": north,
                })
        connection.close()
        region_name = str(region_row[0]) if region_row else code
        return {
            "region_code": code,
            "region_name": region_name,
            "total": total,
            "dataset_year_start": dataset_year_start,
            "dataset_year_end": dataset_year_end,
            "offset": safe_offset,
            "limit": safe_limit,
            "datasets": [
                {
                    "id": row[0],
                    "name": row[1] or "未命名数据集",
                    "url": row[2] or "",
                    "regionName": self._compact_region_text(row[3], region_name),
                    "tags": self._compact_tags(row[4]),
                    "timeRange": self._format_year_range(row[5], row[6]),
                    "startYear": row[5],
                    "endYear": row[6],
                    "coverage": coverage_by_dataset.get(int(row[0]), []),
                }
                for row in rows
            ],
        }

    def keyword_search(self, query: str, params: dict[str, Any], limit: int = 50) -> dict[str, Any]:
        """Keyword match across all legacy paper-extracted datasets (no region constraint)."""
        if not self.available():
            raise HeatmapUnavailable("真实数据索引尚未生成")
        raw_query = str(query or "").strip()[:200]
        if not raw_query:
            raise ValueError("缺少搜索关键词")
        safe_limit = max(1, min(200, int(limit)))
        normalized = self._normalize_filter_params({**params, "query": raw_query})
        signature = json.dumps(
            {"q": raw_query, "limit": safe_limit, "filters": normalized},
            sort_keys=True, ensure_ascii=False,
        )
        with self.lock:
            cached = self.keyword_cache.get(signature)
            if cached is not None:
                self.keyword_cache.move_to_end(signature)
                return json.loads(json.dumps(cached))
        connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri=True)
        conditions, arguments = self._dataset_filter_conditions(normalized, include_query=False)
        searchable = "lower(d.name || ' ' || d.description || ' ' || d.region_text || ' ' || d.topics)"
        use_fts = len(raw_query) >= 3 and connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='datasets_fts'"
        ).fetchone() is not None
        if use_fts:
            conditions.append(
                "d.id IN (SELECT rowid FROM datasets_fts WHERE datasets_fts MATCH ?)"
            )
            arguments.append(self._fts_phrase(raw_query))
        else:
            conditions.append("instr(" + searchable + ", ?) > 0")
            arguments.append(raw_query.casefold())
        where = " AND ".join(conditions) if conditions else "1=1"
        total = int(connection.execute(
            "SELECT COUNT(*) FROM datasets d WHERE " + where, arguments,
        ).fetchone()[0])
        rows = connection.execute(
            "SELECT d.id,d.name,d.url,d.region_text,d.topics,d.start_year,d.end_year "
            "FROM datasets d WHERE " + where +
            " ORDER BY CASE WHEN instr(lower(d.name), ?) > 0 THEN 0 ELSE 1 END,"
            "d.end_year IS NULL,d.end_year DESC,d.name COLLATE NOCASE LIMIT ? OFFSET ?",
            [*arguments, raw_query.casefold(), safe_limit, 0],
        ).fetchall()
        dataset_ids = [int(row[0]) for row in rows]
        coverage_by_dataset: dict[int, list[dict[str, Any]]] = defaultdict(list)
        if dataset_ids:
            placeholders = ",".join("?" for _ in dataset_ids)
            geometry_rows = connection.execute(
                "SELECT dataset_id,kind,west,south,east,north FROM geometries "
                f"WHERE dataset_id IN ({placeholders}) AND kind!='global' "
                "ORDER BY dataset_id,CASE kind WHEN 'point' THEN 0 WHEN 'bbox' THEN 1 ELSE 2 END,"
                "(east-west)*(north-south)",
                dataset_ids,
            ).fetchall()
            seen_coverage: dict[int, set[tuple[Any, ...]]] = defaultdict(set)
            for dataset_id, kind, west, south, east, north in geometry_rows:
                dataset_id = int(dataset_id)
                if len(coverage_by_dataset[dataset_id]) >= 12:
                    continue
                if kind not in ("point", "bbox"):
                    continue
                west, south, east, north = map(float, (west, south, east, north))
                if kind == "bbox" and max(east - west, north - south) > 30.0:
                    continue
                coverage_kind = "point" if kind == "point" else "bbox"
                key = (coverage_kind, west, south, east, north)
                if key in seen_coverage[dataset_id]:
                    continue
                seen_coverage[dataset_id].add(key)
                coverage_by_dataset[dataset_id].append({
                    "kind": coverage_kind,
                    "west": west,
                    "south": south,
                    "east": east,
                    "north": north,
                })
        connection.close()
        result = {
            "query": raw_query,
            "total": total,
            "datasets": [
                {
                    "id": row[0],
                    "rawId": row[0],
                    "source": "科学数据",
                    "itemType": "dataset",
                    "name": row[1] or "未命名数据集",
                    "url": row[2] or "",
                    "regionName": self._compact_region_text(row[3], "全球"),
                    "tags": self._compact_tags(row[4]),
                    "timeRange": self._format_year_range(row[5], row[6]),
                    "startYear": row[5],
                    "endYear": row[6],
                    "coverage": coverage_by_dataset.get(int(row[0]), []),
                }
                for row in rows
            ],
        }
        with self.lock:
            self.keyword_cache[signature] = result
            while len(self.keyword_cache) > 64:
                self.keyword_cache.popitem(last=False)
        return json.loads(json.dumps(result))

    def bounds_datasets(
        self, bounds: list[float], params: dict[str, Any], limit: int = 100, offset: int = 0,
        polygon: list[list[float]] | None = None,
        circle: tuple[float, float, float] | None = None,
        local_focus: bool = False,
        include_local_regions: bool = False,
        max_bbox_span: float | None = None,
    ) -> dict[str, Any]:
        if not self.available():
            raise HeatmapUnavailable("真实数据索引尚未生成")
        if len(bounds) != 4:
            raise ValueError("框选范围格式不正确")
        west, south, east, north = map(float, bounds)
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError("框选范围超出经纬度限制")

        normalized = self._normalize_filter_params(params)
        conditions, filter_arguments = self._dataset_filter_conditions(normalized)
        safe_limit = max(1, min(100, int(limit)))
        safe_offset = max(0, int(offset))

        connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri=True)
        geometry_where = [
            "g.kind!='global'", "g.east>=?", "g.west<=?", "g.north>=?", "g.south<=?",
            "NOT(g.kind='bbox' AND g.east-g.west>=300 AND g.north-g.south>=140)",
            *conditions,
        ]
        geometry_arguments = [west, east, south, north, *filter_arguments]
        if max_bbox_span is not None:
            safe_max_bbox_span = max(0.0, float(max_bbox_span))
            geometry_where.append(
                "NOT(g.kind='bbox' AND (g.east-g.west>? OR g.north-g.south>?))"
            )
            geometry_arguments.extend([safe_max_bbox_span, safe_max_bbox_span])
        geometry_rows = connection.execute(
            "SELECT g.dataset_id,g.kind,g.west,g.south,g.east,g.north,g.region_code "
            "FROM geometries g JOIN datasets d ON d.id=g.dataset_id WHERE "
            + " AND ".join(geometry_where),
            geometry_arguments,
        ).fetchall()
        if local_focus:
            with self.lock:
                if self.global_dataset_ids is None:
                    self.global_dataset_ids = {
                        int(row[0])
                        for row in connection.execute(
                            "SELECT DISTINCT dataset_id FROM geometries "
                            "WHERE kind='global' OR (kind='bbox' AND east-west>=300 AND north-south>=140)"
                        )
                    }

        selection_bounds = (west, south, east, north)
        selection_span = max(east - west, north - south)
        circle_longitude, circle_latitude, circle_radius = circle or (0.0, 0.0, 0.0)
        coverage_by_dataset: dict[int, list[dict[str, Any]]] = defaultdict(list)
        seen_coverage: dict[int, set[tuple[Any, ...]]] = defaultdict(set)
        region_intersections: dict[str, bool] = {}
        region_polygon_intersections: dict[str, bool] = {}
        region_circle_intersections: dict[str, bool] = {}
        region_covered_ids: set[int] = set()
        for dataset_id, kind, geometry_west, geometry_south, geometry_east, geometry_north, region_code in geometry_rows:
            dataset_id = int(dataset_id)
            if local_focus and dataset_id in self.global_dataset_ids:
                continue
            geometry_west, geometry_south, geometry_east, geometry_north = map(
                float, (geometry_west, geometry_south, geometry_east, geometry_north)
            )
            if kind == "region":
                code = str(region_code)
                if code not in region_intersections:
                    rings = BOUNDARIES.get(code, [])
                    region_intersections[code] = (
                        not rings or _rectangle_intersects_rings(selection_bounds, rings)
                    )
                if not region_intersections[code]:
                    continue
            elif kind == "point":
                longitude = (geometry_west + geometry_east) * 0.5
                latitude = (geometry_south + geometry_north) * 0.5
                if not (west <= longitude <= east and south <= latitude <= north):
                    continue

            if local_focus and kind == "bbox" and max(
                geometry_east - geometry_west, geometry_north - geometry_south,
            ) > max(selection_span * SELECTION_RELATIVE_FACTOR, H3_POINT_QUERY_MAX_BBOX_SPAN):
                continue

            if circle:
                if kind == "point":
                    if _great_circle_distance_km(
                        circle_longitude, circle_latitude, longitude, latitude,
                    ) > circle_radius:
                        continue
                elif kind == "bbox":
                    if not _circle_intersects_rectangle(
                        circle_longitude, circle_latitude, circle_radius,
                        (geometry_west, geometry_south, geometry_east, geometry_north),
                    ):
                        continue
                elif kind == "region":
                    code = str(region_code)
                    if code not in region_circle_intersections:
                        region_rings = BOUNDARIES.get(code, [])
                        region_circle_intersections[code] = (
                            not region_rings
                            or _circle_intersects_rings(
                                circle_longitude, circle_latitude, circle_radius, region_rings,
                            )
                        )
                    if not region_circle_intersections[code]:
                        continue

            if polygon:
                if kind == "point":
                    if not _point_in_ring(longitude, latitude, polygon):
                        continue
                elif kind == "bbox":
                    rectangle = [
                        [geometry_west, geometry_south], [geometry_east, geometry_south],
                        [geometry_east, geometry_north], [geometry_west, geometry_north],
                    ]
                    if not _polygon_intersects_rings(polygon, [rectangle]):
                        continue
                elif kind == "region":
                    code = str(region_code)
                    if code not in region_polygon_intersections:
                        region_rings = BOUNDARIES.get(code, [])
                        region_polygon_intersections[code] = (
                            not region_rings
                            or _polygon_intersects_rings(polygon, region_rings)
                        )
                    if not region_polygon_intersections[code]:
                        continue

            if local_focus and kind == "region":
                region_span = max(
                    geometry_east - geometry_west, geometry_north - geometry_south,
                )
                if include_local_regions:
                    if region_span > max(
                        selection_span * SELECTION_RELATIVE_FACTOR, SELECTION_MIN_REGION_SPAN,
                    ):
                        region_covered_ids.add(dataset_id)
                        continue
                else:
                    if region_span <= H3_POINT_QUERY_REGION_MAX_SPAN:
                        region_covered_ids.add(dataset_id)
                    continue

            coverage_kind = "point" if kind == "point" else "bbox"
            if coverage_kind == "point":
                longitude = (geometry_west + geometry_east) * 0.5
                latitude = (geometry_south + geometry_north) * 0.5
                clipped = (longitude, latitude, longitude, latitude)
            else:
                clipped = (
                    max(west, geometry_west), max(south, geometry_south),
                    min(east, geometry_east), min(north, geometry_north),
                )
            key = (coverage_kind, *clipped)
            if key in seen_coverage[dataset_id]:
                continue
            seen_coverage[dataset_id].add(key)
            if len(coverage_by_dataset[dataset_id]) < 12:
                coverage_by_dataset[dataset_id].append({
                    "kind": coverage_kind,
                    "west": clipped[0],
                    "south": clipped[1],
                    "east": clipped[2],
                    "north": clipped[3],
                })

        matched_ids = list(coverage_by_dataset)
        connection.execute("CREATE TEMP TABLE matched_bounds(dataset_id INTEGER PRIMARY KEY)")
        connection.executemany(
            "INSERT INTO matched_bounds(dataset_id) VALUES(?)",
            ((dataset_id,) for dataset_id in matched_ids),
        )
        total = len(matched_ids)
        dataset_year_row = connection.execute(
            "SELECT MIN(d.start_year),MAX(d.end_year) "
            "FROM datasets d JOIN matched_bounds mb ON mb.dataset_id=d.id",
        ).fetchone()
        rows = connection.execute(
            "SELECT d.id,d.name,d.url,d.region_text,d.topics,d.start_year,d.end_year "
            "FROM datasets d JOIN matched_bounds mb ON mb.dataset_id=d.id "
            " ORDER BY d.end_year IS NULL,d.end_year DESC,d.name COLLATE NOCASE LIMIT ? OFFSET ?",
            [safe_limit, safe_offset],
        ).fetchall()
        topic_rows = connection.execute(
            "SELECT dt.topic,COUNT(*) AS topic_count FROM matched_bounds mb "
            "JOIN dataset_topics dt ON dt.dataset_id=mb.dataset_id "
            "GROUP BY dt.topic ORDER BY topic_count DESC,dt.topic COLLATE NOCASE LIMIT 4",
        ).fetchall()
        connection.close()

        return {
            "bounds": [west, south, east, north],
            "total": total,
            "region_covered_total": len(region_covered_ids),
            "dataset_year_start": dataset_year_row[0],
            "dataset_year_end": dataset_year_row[1],
            "offset": safe_offset,
            "limit": safe_limit,
            "topics": [{"name": str(name), "count": int(count)} for name, count in topic_rows],
            "datasets": [
                {
                    "id": row[0],
                    "name": row[1] or "未命名数据集",
                    "url": row[2] or "",
                    "regionName": self._compact_region_text(row[3], "框选范围"),
                    "tags": self._compact_tags(row[4]),
                    "timeRange": self._format_year_range(row[5], row[6]),
                    "startYear": row[5],
                    "endYear": row[6],
                    "coverage": coverage_by_dataset.get(int(row[0]), []),
                }
                for row in rows
            ],
        }

    def dataset_detail(self, dataset_id: int) -> dict[str, Any]:
        if not self.available():
            raise HeatmapUnavailable("真实数据索引尚未生成")
        safe_id = int(dataset_id)
        if safe_id <= 0:
            raise ValueError("数据集编号不正确")
        connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri=True)
        row = connection.execute(
            "SELECT id,name,url,description,temporal_text,region_text,coordinates_text,"
            "coordinate_system,start_year,end_year FROM datasets WHERE id=?",
            (safe_id,),
        ).fetchone()
        if row is None:
            connection.close()
            raise ValueError("数据集不存在")
        topics = [str(value[0]) for value in connection.execute(
            "SELECT topic FROM dataset_topics WHERE dataset_id=? ORDER BY topic COLLATE NOCASE",
            (safe_id,),
        ).fetchall()]
        usage_rows = connection.execute(
            "SELECT dur.paper_key,dur.paper_title,dur.doi,dur.publication_year,dur.publication_date,"
            "dur.paper_use_temporal_range,dur.paper_use_spatio_region,dur.paper_use_spatio_coords,"
            "sp.problem_text FROM dataset_usage_records dur "
            "LEFT JOIN scientific_problems sp ON sp.problem_key=dur.problem_key "
            "WHERE dur.dataset_id=? ORDER BY dur.publication_year IS NULL,dur.publication_year DESC,"
            "dur.paper_title COLLATE NOCASE,dur.id",
            (safe_id,),
        ).fetchall()
        problem_count = int(connection.execute(
            "SELECT COUNT(*) FROM dataset_problem_links WHERE dataset_id=?", (safe_id,)
        ).fetchone()[0])
        connection.close()

        papers_by_key: dict[str, dict[str, Any]] = {}

        def append_unique(values: list[str], value: Any) -> None:
            text = str(value or "").strip()
            if text and text.casefold() not in {item.casefold() for item in values}:
                values.append(text)

        for usage in usage_rows:
            paper_key = str(usage[0] or "")
            paper = papers_by_key.setdefault(paper_key, {
                "paperKey": paper_key,
                "title": str(usage[1] or "未命名论文"),
                "doi": str(usage[2] or ""),
                "publicationYear": usage[3],
                "publicationDate": str(usage[4] or ""),
                "scientificProblems": [],
                "useTemporalRanges": [],
                "useRegions": [],
                "useCoordinates": [],
            })
            append_unique(paper["scientificProblems"], usage[8])
            append_unique(paper["useTemporalRanges"], usage[5])
            append_unique(paper["useRegions"], usage[6])
            append_unique(paper["useCoordinates"], usage[7])

        return {
            "id": int(row[0]),
            "name": str(row[1] or "未命名数据集"),
            "url": str(row[2] or ""),
            "description": str(row[3] or ""),
            "temporalRange": str(row[4] or "") or self._format_year_range(row[8], row[9]),
            "region": str(row[5] or ""),
            "coordinates": str(row[6] or ""),
            "coordinateSystem": str(row[7] or ""),
            "topics": topics,
            "paperCount": len(papers_by_key),
            "problemCount": problem_count,
            "papers": list(papers_by_key.values()),
        }

    @staticmethod
    def _fts_phrase(query: str) -> str:
        return '"' + str(query).replace('"', '""') + '"'

    @staticmethod
    def _fts_phrase(query: str) -> str:
        return '"' + str(query).replace('"', '""') + '"'

    @staticmethod
    def _compact_tags(value: str) -> list[str]:
        text = str(value or "").replace(" | ", ",")
        parts = re.split(r"[,，;；/|]", text.strip("[](){} "))
        tags = []
        for part in parts:
            tag = part.strip("[](){} '\"\t\r\n")
            if not tag or tag.casefold() in {item.casefold() for item in tags}:
                continue
            tags.append(tag[:30])
            if len(tags) == 3:
                break
        return tags

    @staticmethod
    def _compact_region_text(value: str, fallback: str) -> str:
        first = re.split(r"\s*\|\s*|[;；]", str(value or ""), maxsplit=1)[0].strip()
        return (first or fallback)[:80]

    @staticmethod
    def _format_year_range(start_year: int | None, end_year: int | None) -> str:
        if start_year is None and end_year is None:
            return "时间未标注"
        if start_year == end_year or start_year is None:
            return str(end_year)
        if end_year is None:
            return str(start_year)
        return f"{start_year}-{end_year}"

    def _render_uncached(
        self, params: dict[str, Any],
        extra_coordinate_geometries: list[Any] | None = None,
        abort_check: Any | None = None,
    ) -> tuple[bytes, dict[str, Any]]:
        started = time.perf_counter()
        west, south, east, north = params["bounds"]
        h3_resolution = _h3_resolution_for_view(params["level"], params["bounds"])
        base_resolution = LEVEL_RESOLUTION[params["level"]]
        view_span = max(east - west, north - south)
        adaptive_resolution = view_span / LEVEL_LONG_EDGE[params["level"]]
        # 热力图分辨率应随缩放自适应：越放大图像越精细，而不是固定在一个粗粒度，
        # 否则缩放到国家/省份层级时图片会被拉伸得模糊。
        # - 国家/省份层级且关了 H3 网格时，直接渲染平滑热力（不经 H3 量化），此时
        #   分辨率只需让图幅长边接近 LEVEL_LONG_EDGE 像素即可，既清晰又不至于过大。
        # - 城市级、或开着 H3 网格时，六边形需要可见，因此以“六边形在图上保持约
        #   3.5（城市级 4.2）像素宽”作为精细下界，避免六边形缩成亚像素失去意义。
        use_quantization = params["level"] == "city" or params["show_h3_grid"]
        if use_quantization:
            if params["level"] == "city":
                h3_pixel_resolution = math.sqrt(H3_AVERAGE_AREA_KM2[h3_resolution]) / 111.0 / 4.2
                minimum_resolution = min(0.0015, h3_pixel_resolution)
            else:
                h3_pixel_resolution = math.sqrt(H3_AVERAGE_AREA_KM2[h3_resolution]) / 111.0 / 3.5
                minimum_resolution = h3_pixel_resolution
            resolution = max(minimum_resolution, min(base_resolution, adaptive_resolution))
        else:
            # 平滑热力，长边约 LEVEL_LONG_EDGE 像素；再设一个约 1800 像素的
            # 图幅上界，避免极端放大时生成过大的图片拖慢渲染。
            resolution = max(view_span / 1800.0, min(base_resolution, adaptive_resolution))
        width = max(1, math.ceil((east - west) / resolution))
        height = max(1, math.ceil((north - south) / resolution))
        actual_x = (east - west) / width
        actual_y = (north - south) / height
        # 城市级精细网格已经改为“每格唯一数据集数量”直接着色，不再读取平滑热力场。
        # 因此无需查询/遍历 region 与 global 行，也无需计算多尺度平滑网格。
        city_grid_mode = params["level"] == "city"
        coordinate_geometries, region_counts, global_count, dataset_count = self._query_geometries(
            params, coordinate_only=city_grid_mode,
        )
        self._check_abort(abort_check)
        if extra_coordinate_geometries:
            coordinate_geometries = [*coordinate_geometries, *extra_coordinate_geometries]

        # legacy 与 merged 两个索引的 dataset_id 都从 1 开始，直接用 int 会把
        # 不同来源的同号数据集合并，导致精细网格颜色和点击总数不一致。
        # 统一转成字符串；merged 服务返回 "merged:<id>"，legacy 保持 "<id>"。
        by_dataset: dict[str, list[Any]] = defaultdict(list)
        for geometry in coordinate_geometries:
            by_dataset[str(geometry["dataset_id"])].append(geometry)

        if city_grid_mode:
            present_cells = self._h3_present_cells(params, h3_resolution, coordinate_geometries)
            self._check_abort(abort_check)
            pixels, h3_cell_count = _h3_quantize_pixels(
                bytearray(width * height * 4), width, height, params["bounds"], h3_resolution,
                params["show_h3_grid"], present_cells=present_cells,
            )
            self._check_abort(abort_check)
            image = _encode_webp(width, height, pixels) if params["format"] == "webp" else None
            content_type = "image/webp" if image is not None else "image/png"
            if image is None:
                image = _encode_png(width, height, pixels)
            return image, {
                "width": width, "height": height, "resolution": round(resolution, 6),
                "h3_resolution": h3_resolution,
                "h3_cell_area_km2": H3_AVERAGE_AREA_KM2[h3_resolution],
                "h3_cell_count": h3_cell_count,
                "content_type": content_type,
                "dataset_count": len(by_dataset), "global_count": 0,
                "coordinate_dataset_count": len(by_dataset), "region_code_count": 0,
                "point_range": [0.0, 0.0], "local_range": [0.0, 0.0],
                "medium_range": [0.0, 0.0], "broad_range": [0.0, 0.0],
                "render_ms": round((time.perf_counter() - started) * 1000, 1),
            }

        # 网格累加数组尽量用 numpy，便于对 __apply_difference / __raster_region 做向量化，
        # 否则高分辨率（自适应分辨率后图片变大）下纯 Python 双重循环会拖慢渲染。
        if np is not None:
            point_grid = np.zeros(width * height, dtype=np.float64)
            local_grid = np.zeros(width * height, dtype=np.float64)
            medium_grid = np.zeros(width * height, dtype=np.float64)
            broad_grid = np.zeros(width * height, dtype=np.float64)
        else:
            point_grid = [0.0] * (width * height)
            local_grid = [0.0] * (width * height)
            medium_grid = [0.0] * (width * height)
            broad_grid = [0.0] * (width * height)
        if np is not None:
            local_difference = np.zeros((width + 1) * (height + 1), dtype=np.float64)
            medium_difference = np.zeros((width + 1) * (height + 1), dtype=np.float64)
            broad_difference = np.zeros((width + 1) * (height + 1), dtype=np.float64)
        else:
            local_difference = [0.0] * ((width + 1) * (height + 1))
            medium_difference = [0.0] * ((width + 1) * (height + 1))
            broad_difference = [0.0] * ((width + 1) * (height + 1))
        detail_max_span, medium_max_span = BAND_MAX_SPAN[params["level"]]
        for geometries in by_dataset.values():
            point_contributions: dict[int, float] = {}
            bboxes = []
            for geometry_index, geometry in enumerate(geometries):
                if geometry_index % 24 == 0:
                    self._check_abort(abort_check)
                maximum_span = max(
                    float(geometry["east"]) - float(geometry["west"]),
                    float(geometry["north"]) - float(geometry["south"]),
                )
                if geometry["kind"] == "point" or maximum_span <= POINT_LIKE_MAX_SPAN:
                    self._raster_point(geometry, point_contributions, width, height, west, north, actual_x, actual_y)
                else:
                    bboxes.append(geometry)
            for index, contribution in point_contributions.items():
                point_grid[index] += min(1.0, contribution)
            retained_bboxes = self._remove_contained_bboxes(bboxes)
            geometry_weight = 1.0 / max(1, len(retained_bboxes))
            for bbox_index, geometry in enumerate(retained_bboxes):
                if bbox_index % 24 == 0:
                    self._check_abort(abort_check)
                clipped_width = max(0.0, min(east, float(geometry["east"])) - max(west, float(geometry["west"])))
                clipped_height = max(0.0, min(north, float(geometry["north"])) - max(south, float(geometry["south"])))
                is_view_baseline = (
                    clipped_width / (east - west) >= 0.72
                    and clipped_height / (north - south) >= 0.72
                )
                maximum_span = max(
                    float(geometry["east"]) - float(geometry["west"]),
                    float(geometry["north"]) - float(geometry["south"]),
                )
                if not is_view_baseline and maximum_span <= detail_max_span:
                    target_grid = local_grid
                    target_difference = local_difference
                elif not is_view_baseline and maximum_span <= medium_max_span:
                    target_grid = medium_grid
                    target_difference = medium_difference
                else:
                    target_grid = broad_grid
                    target_difference = broad_difference
                self._raster_bbox(
                    geometry, geometry_weight, target_grid, target_difference,
                    width, height, west, south, east, north, actual_x, actual_y,
                )

        self._apply_difference(local_grid, local_difference, width, height)
        self._apply_difference(medium_grid, medium_difference, width, height)
        self._apply_difference(broad_grid, broad_difference, width, height)

        for region_code, count in region_counts.items():
            rings = BOUNDARIES.get(region_code)
            if not rings:
                continue
            self._raster_region(rings, count, broad_grid, width, height, west, south, east, north, actual_x, actual_y)

        point_grid = _blur_array(point_grid, width, height, 1) if np is not None else _blur(point_grid, width, height, 1)
        area_blur_radius = min(40, max(1, round(0.35 / max(actual_x, actual_y))))
        if np is not None:
            local_grid = _box_blur_array(local_grid, width, height, area_blur_radius)
            medium_grid = _box_blur_array(medium_grid, width, height, area_blur_radius)
            broad_grid = _box_blur_array(broad_grid, width, height, area_blur_radius)
        else:
            local_grid = _box_blur(local_grid, width, height, area_blur_radius)
            medium_grid = _box_blur(medium_grid, width, height, area_blur_radius)
            broad_grid = _box_blur(broad_grid, width, height, area_blur_radius)
        cell_area = max(1e-9, actual_x * actual_y)
        inverse_cell_area = 1.0 / cell_area
        if np is not None:
            local_grid *= inverse_cell_area
            medium_grid *= inverse_cell_area
            broad_grid *= inverse_cell_area
        else:
            local_grid = [value * inverse_cell_area for value in local_grid]
            medium_grid = [value * inverse_cell_area for value in medium_grid]
            broad_grid = [value * inverse_cell_area for value in broad_grid]
        low_ratio, high_ratio = {
            "country": (0.4, 0.985),
            "province": (0.34, 0.985),
            "city": (0.2, 0.99),
        }[params["level"]]
        point_limits = _view_band_limits(
            point_grid, FIXED_BAND_LIMITS["point"], max(0.08, low_ratio - 0.14), high_ratio,
        )
        local_limits = _view_band_limits(
            local_grid, FIXED_BAND_LIMITS["local"], low_ratio, high_ratio,
        )
        medium_limits = _view_band_limits(
            medium_grid, FIXED_BAND_LIMITS["medium"], low_ratio, high_ratio,
        )
        broad_limits = _view_band_limits(
            broad_grid, FIXED_BAND_LIMITS["broad"], low_ratio, high_ratio,
        )
        self._check_abort(abort_check)
        local_texture = _particle_texture(width, height, 7, 4.2, 17)
        medium_texture = _particle_texture(width, height, 10, 3.4, 43)
        broad_texture = _particle_texture(width, height, 12, 2.6, 79)
        if np is not None:
            pixels = _compose_heat_pixels(
                point_grid, local_grid, medium_grid, broad_grid,
                width, height, point_limits, local_limits, medium_limits, broad_limits,
                local_texture, medium_texture, broad_texture, params["level"],
            )
        else:
            fallback_pixels = bytearray(width * height * 4)
            for index, point_value in enumerate(point_grid):
                row, column = divmod(index, width)
                point_strength = _band_strength(point_value, point_limits, 0.9)
                local_strength = _band_strength(local_grid[index], local_limits, 1.04)
                medium_strength = _band_strength(medium_grid[index], medium_limits, 1.1)
                broad_strength = _band_strength(broad_grid[index], broad_limits, 1.16)
                local_visual = local_strength * (local_texture[index] / 255)
                medium_visual = medium_strength * (medium_texture[index] / 255)
                broad_visual = broad_strength * (broad_texture[index] / 255)
                weights = HEAT_VISUAL_WEIGHTS[params["level"]]
                candidates = (
                    (point_strength * weights[0], HEAT_ALPHA_SCALES[params["level"]][0]),
                    (local_visual * weights[1], HEAT_ALPHA_SCALES[params["level"]][1]),
                    (medium_visual * weights[2], HEAT_ALPHA_SCALES[params["level"]][2]),
                    (broad_visual * weights[3], HEAT_ALPHA_SCALES[params["level"]][3]),
                )
                ratio, alpha_scale = max(candidates, key=lambda candidate: candidate[0])
                color = list(_heat_color(ratio))
                color[3] = round(color[3] * alpha_scale)
                if params["level"] != "country" and color[3]:
                    edge_x = min(column + 0.5, width - column - 0.5) / max(1.0, width * 0.065)
                    edge_y = min(row + 0.5, height - row - 0.5) / max(1.0, height * 0.065)
                    edge = _clamp(min(edge_x, edge_y), 0.0, 1.0)
                    edge = edge * edge * (3 - 2 * edge)
                    color[3] = round(color[3] * edge)
                fallback_pixels[index * 4:index * 4 + 4] = bytes(color)
            pixels = bytes(fallback_pixels)
        present_cells = (
            self._h3_present_cells(params, h3_resolution, coordinate_geometries)
            if params["level"] == "city" else None
        )
        self._check_abort(abort_check)
        if use_quantization:
            pixels, h3_cell_count = _h3_quantize_pixels(
                pixels, width, height, params["bounds"], h3_resolution,
                params["show_h3_grid"], present_cells=present_cells,
            )
        else:
            h3_cell_count = 0
        self._check_abort(abort_check)
        image = _encode_webp(width, height, pixels) if params["format"] == "webp" else None
        content_type = "image/webp" if image is not None else "image/png"
        if image is None:
            image = _encode_png(width, height, pixels)
        metadata = {
            "width": width, "height": height, "resolution": round(resolution, 6),
            "h3_resolution": h3_resolution,
            "h3_cell_area_km2": H3_AVERAGE_AREA_KM2[h3_resolution],
            "h3_cell_count": h3_cell_count,
            "content_type": content_type,
            "dataset_count": dataset_count, "global_count": global_count,
            "coordinate_dataset_count": len(by_dataset), "region_code_count": len(region_counts),
            "point_range": [round(value, 5) for value in point_limits],
            "local_range": [round(value, 5) for value in local_limits],
            "medium_range": [round(value, 3) for value in medium_limits],
            "broad_range": [round(value, 3) for value in broad_limits],
            "render_ms": round((time.perf_counter() - started) * 1000, 1),
        }
        return image, metadata

    def _query_geometries(
        self, params: dict[str, Any], coordinate_only: bool = False,
    ) -> tuple[list[sqlite3.Row], dict[str, int], int, int]:
        west, south, east, north = params["bounds"]
        conditions = ["g.east >= ?", "g.west <= ?", "g.north >= ?", "g.south <= ?"]
        if coordinate_only:
            conditions.extend([
                "g.kind IN ('point','bbox')",
                "NOT(g.kind='bbox' AND g.east-g.west>=300 AND g.north-g.south>=140)",
            ])
        arguments: list[Any] = [west, east, south, north]
        filter_conditions, filter_arguments = self._dataset_filter_conditions(params)
        conditions.extend(filter_conditions)
        arguments.extend(filter_arguments)
        query = (
            "SELECT g.dataset_id,g.kind,g.west,g.south,g.east,g.north,g.region_code "
            "FROM geometries g JOIN datasets d ON d.id=g.dataset_id WHERE " + " AND ".join(conditions)
        )
        connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        rows = connection.execute(query, arguments).fetchall()
        connection.close()
        if coordinate_only:
            # 保留与点击查询一致的排除规则：同一数据集只要存在 global/超大 bbox，
            # 其附带局部 bbox 也不参与城市精细网格计数。
            with self.lock:
                if self.global_dataset_ids is None:
                    global_connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri=True)
                    self.global_dataset_ids = {
                        int(row[0])
                        for row in global_connection.execute(
                            "SELECT DISTINCT dataset_id FROM geometries "
                            "WHERE kind='global' OR (kind='bbox' AND east-west>=300 AND north-south>=140)"
                        )
                    }
                    global_connection.close()
                global_ids = self.global_dataset_ids
            rows = [
                row for row in rows
                if int(row["dataset_id"]) not in global_ids
            ]
            return rows, {}, len(global_ids), len({int(row["dataset_id"]) for row in rows})
        all_datasets: set[int] = set()
        global_datasets: set[int] = set()
        for row in rows:
            dataset_id = int(row["dataset_id"])
            all_datasets.add(dataset_id)
            if row["kind"] == "global" or (
                row["kind"] == "bbox"
                and float(row["east"]) - float(row["west"]) >= 300
                and float(row["north"]) - float(row["south"]) >= 140
            ):
                global_datasets.add(dataset_id)
        coordinate_rows: list[sqlite3.Row] = []
        region_datasets: dict[str, set[int]] = defaultdict(set)
        for row in rows:
            dataset_id = int(row["dataset_id"])
            if dataset_id in global_datasets:
                continue
            if row["kind"] == "region":
                region_datasets[str(row["region_code"])].add(dataset_id)
            elif row["kind"] != "global":
                coordinate_rows.append(row)
        return coordinate_rows, {code: len(ids) for code, ids in region_datasets.items()}, len(global_datasets), len(all_datasets)

    def _h3_present_cells(
        self, params: dict[str, Any], resolution: int,
        coordinate_geometries: list[Any],
    ) -> dict[str, int]:
        """返回精细网格中每个 H3 单元格命中的唯一数据集数量。

        与 H3 点击查询（bounds_datasets local_focus=True）使用同一套命中规则：
        点数据按所在 H3 单元格；bbox 数据按与单元格多边形相交（跨度不超过
        H3_POINT_QUERY_MAX_BBOX_SPAN）。这样热力图上有颜色 ⇔ 点击该网格会返回数据集，
        且颜色等级与点击返回的数据集数量一致。
        """
        if h3 is None or resolution < 0:
            return {}
        west, south, east, north = map(float, params["bounds"])
        cells = _h3_cells_for_bounds(
            round(west, 5), round(south, 5), round(east, 5), round(north, 5), resolution,
        )
        cell_lookup = set(cells)
        # 与点击查询（bounds_datasets local_focus=True）完全一致：bbox 用“面与
        # H3 六边形精确相交”判定命中，而不是只看外接矩形重叠（后者会把仅擦边、
        # 实际点击却查不到数据的网格也误判为命中）。
        cell_polygons: dict[str, list[list[float]]] = {}

        def cell_polygon(cell: str) -> list[list[float]]:
            polygon = cell_polygons.get(cell)
            if polygon is None:
                polygon = [[float(longitude), float(latitude)] for latitude, longitude in h3.cell_to_boundary(cell)]
                cell_polygons[cell] = polygon
            return polygon

        cell_span = math.sqrt(H3_AVERAGE_AREA_KM2[resolution]) / 111.0 * 1.6
        present: dict[str, set[str]] = defaultdict(set)
        for geometry in coordinate_geometries:
            kind = str(geometry["kind"])
            if kind == "point":
                latitude = (float(geometry["south"]) + float(geometry["north"])) * 0.5
                longitude = (float(geometry["west"]) + float(geometry["east"])) * 0.5
                cell = h3.latlng_to_cell(latitude, longitude, resolution)
                if cell in cell_lookup:
                    present[cell].add(str(geometry["dataset_id"]))
            elif kind == "bbox":
                geometry_west, geometry_south, geometry_east, geometry_north = map(
                    float, (geometry["west"], geometry["south"], geometry["east"], geometry["north"])
                )
                if max(geometry_east - geometry_west, geometry_north - geometry_south) > H3_POINT_QUERY_MAX_BBOX_SPAN:
                    continue
                clipped = (
                    max(geometry_west, west), max(geometry_south, south),
                    min(geometry_east, east), min(geometry_north, north),
                )
                if clipped[0] >= clipped[2] or clipped[1] >= clipped[3]:
                    continue
                rectangle = [
                    [geometry_west, geometry_south], [geometry_east, geometry_south],
                    [geometry_east, geometry_north], [geometry_west, geometry_north],
                ]
                # 候选窗口向外扩约 1.6 个 H3 网格边长，把仅擦着 bbox 边缘的
                # 六边形也纳入候选，再逐个用精确相交过滤。
                candidates = _h3_cells_for_bounds(
                    max(-180.0, clipped[0] - cell_span), max(-90.0, clipped[1] - cell_span),
                    min(180.0, clipped[2] + cell_span), min(90.0, clipped[3] + cell_span),
                    resolution,
                )
                for cell in candidates:
                    if cell not in cell_lookup:
                        continue
                    if _polygon_intersects_rings(cell_polygon(cell), [rectangle]):
                        present[cell].add(str(geometry["dataset_id"]))
        return {cell: len(dataset_ids) for cell, dataset_ids in present.items()}

    def _raster_point(
        self, geometry: sqlite3.Row, contributions: dict[int, float], width: int, height: int,
        west: float, north: float, cell_x: float, cell_y: float,
    ) -> None:
            center_lon = (float(geometry["west"]) + float(geometry["east"])) * 0.5
            center_lat = (float(geometry["south"]) + float(geometry["north"])) * 0.5
            center_column = (center_lon - west) / cell_x
            center_row = (north - center_lat) / cell_y
            cell_span = max(cell_x, cell_y)
            sigma = min(12.0, max(0.85, 0.12 / max(0.0001, cell_span)))
            radius = max(3, math.ceil(sigma * 3))
            for row in range(max(0, math.floor(center_row) - radius), min(height, math.floor(center_row) + radius + 1)):
                for column in range(max(0, math.floor(center_column) - radius), min(width, math.floor(center_column) + radius + 1)):
                    distance_squared = (column + 0.5 - center_column) ** 2 + (row + 0.5 - center_row) ** 2
                    value = math.exp(-distance_squared / (2 * sigma * sigma))
                    index = row * width + column
                    contributions[index] = max(contributions.get(index, 0.0), value)

    def _remove_contained_bboxes(self, geometries: list[sqlite3.Row]) -> list[sqlite3.Row]:
        retained = []
        for candidate in geometries:
            if any(
                float(container["west"]) <= float(candidate["west"])
                and float(container["south"]) <= float(candidate["south"])
                and float(container["east"]) >= float(candidate["east"])
                and float(container["north"]) >= float(candidate["north"])
                for container in geometries if container is not candidate
            ):
                continue
            retained.append(candidate)
        return retained

    def _raster_bbox(
        self, geometry: sqlite3.Row, geometry_weight: float,
        _grid: list[float], difference: list[float], width: int, height: int,
        west: float, south: float, east: float, north: float, cell_x: float, cell_y: float,
    ) -> None:
        geometry_west = max(west, float(geometry["west"]))
        geometry_east = min(east, float(geometry["east"]))
        geometry_south = max(south, float(geometry["south"]))
        geometry_north = min(north, float(geometry["north"]))
        if geometry_west >= geometry_east or geometry_south >= geometry_north:
            return
        first_column = max(0, math.floor((geometry_west - west) / cell_x))
        last_column = min(width - 1, math.floor((geometry_east - west) / cell_x))
        first_row = max(0, math.floor((north - geometry_north) / cell_y))
        last_row = min(height - 1, math.floor((north - geometry_south) / cell_y))
        geometry_columns = max(1, math.ceil((float(geometry["east"]) - float(geometry["west"])) / cell_x))
        geometry_rows = max(1, math.ceil((float(geometry["north"]) - float(geometry["south"])) / cell_y))
        contribution = geometry_weight / (geometry_columns * geometry_rows)
        stride = width + 1
        column_end = last_column + 1
        row_end = last_row + 1
        difference[first_row * stride + first_column] += contribution
        difference[first_row * stride + column_end] -= contribution
        difference[row_end * stride + first_column] -= contribution
        difference[row_end * stride + column_end] += contribution

    def _apply_difference(self, grid: list[float], difference: list[float], width: int, height: int) -> None:
        # 向量化二维前缀和：difference 是 (height+1, width+1) 的稀疏差分，
        # 两次前缀和即得到每个网格的覆盖值。仅用 numpy，纯 Python 路径保持原逻辑。
        if np is not None and isinstance(grid, np.ndarray) and isinstance(difference, np.ndarray):
            diff = difference.reshape(height + 1, width + 1)
            accumulated = np.cumsum(np.cumsum(diff, axis=0), axis=1)
            grid.reshape(height, width)[:, :] += accumulated[:height, :width]
            return
        stride = width + 1
        for row in range(height):
            running = 0.0
            for column in range(width):
                index = row * stride + column
                above = difference[(row - 1) * stride + column] if row else 0.0
                difference[index] += above
                running += difference[index]
                grid[row * width + column] += running

    def _raster_region(
        self, rings: list[list[list[float]]], count: int, grid: list[float], width: int, height: int,
        west: float, south: float, east: float, north: float, cell_x: float, cell_y: float,
    ) -> None:
        # 用 PIL 多边形填充生成区域掩码，再一次性读出被覆盖的网格索引，
        # 取代逐行扫描线 + 逐列追加的纯 Python 实现（后者在高分辨率下成为热点）。
        if np is not None and Image is not None and isinstance(grid, np.ndarray):
            mask = Image.new("L", (width, height), 0)
            draw = ImageDraw.Draw(mask)
            for ring in rings:
                points = [
                    ((float(longitude) - west) / cell_x, (north - float(latitude)) / cell_y)
                    for longitude, latitude in ring
                ]
                if len(points) >= 3:
                    draw.polygon(points, fill=255)
            covered = np.flatnonzero(np.frombuffer(mask.tobytes(), dtype=np.uint8))
            if covered.size:
                grid[covered] += count / covered.size
            return
        ring_west = min(point[0] for ring in rings for point in ring)
        ring_east = max(point[0] for ring in rings for point in ring)
        ring_south = min(point[1] for ring in rings for point in ring)
        ring_north = max(point[1] for ring in rings for point in ring)
        first_column = max(0, math.floor((max(west, ring_west) - west) / cell_x))
        last_column = min(width - 1, math.floor((min(east, ring_east) - west) / cell_x))
        first_row = max(0, math.floor((north - min(north, ring_north)) / cell_y))
        last_row = min(height - 1, math.floor((north - max(south, ring_south)) / cell_y))
        covered_indices: list[int] = []
        for row in range(first_row, last_row + 1):
            latitude = north - (row + 0.5) * cell_y
            intervals = []
            for ring in rings:
                intersections = []
                previous = ring[-1]
                for current in ring:
                    if (current[1] > latitude) != (previous[1] > latitude):
                        longitude = current[0] + (latitude - current[1]) * (previous[0] - current[0]) / (previous[1] - current[1])
                        intersections.append(longitude)
                    previous = current
                intersections.sort()
                intervals.extend(zip(intersections[0::2], intersections[1::2]))
            for interval_west, interval_east in intervals:
                start = max(first_column, math.ceil((interval_west - west) / cell_x - 0.5))
                end = min(last_column, math.floor((interval_east - west) / cell_x - 0.5))
                for column in range(start, end + 1):
                    covered_indices.append(row * width + column)
        contribution = count / max(1, len(covered_indices))
        for index in covered_indices:
            grid[index] += contribution


SERVICE = DatasetHeatmapService()
