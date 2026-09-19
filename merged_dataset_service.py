"""Read-only queries for the merged dataset source workbook index."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
from collections import OrderedDict, defaultdict
from pathlib import Path
from typing import Any

from heatmap_service import (
    BOUNDARIES,
    BOUNDARY_BOUNDS,
    H3_POINT_QUERY_MAX_BBOX_SPAN,
    H3_POINT_QUERY_REGION_MAX_SPAN,
    SELECTION_MIN_REGION_SPAN,
    SELECTION_RELATIVE_FACTOR,
    MEMBERSHIP_MAX_SPAN,
    _circle_intersects_rectangle,
    _circle_intersects_rings,
    _great_circle_distance_km,
    _point_in_geometry,
    _point_in_ring,
    _polygon_intersects_rings,
    _rectangle_intersects_rings,
)


ROOT = Path(__file__).resolve().parent
DATABASE_PATH = ROOT / "data/generated/dataset_merged.sqlite"

DATA_TYPE_TERMS = {
    "raster": ["raster", "tif", "tiff", "geotiff", "影像", "栅格"],
    "vector": ["vector", "shapefile", "shp", "geojson", "矢量"],
    "table": ["csv", "excel", "xlsx", "table", "表格"],
    "grid": ["grid", "netcdf", "nc", "hdf", "grib", "网格"],
}

# Tags from the merged workbook tags column that describe platform/access
# attributes, file formats or generic descriptors instead of an academic subject.
# They stay visible as per-dataset tags, but are excluded from the dataset subject
# aggregation used by the filter options and the region statistics card.
NON_SUBJECT_TOPICS = frozenset({
    "OSS", "公开汇聚", "合作接入", "公共开放", "地理空间对齐", "自研生产", "公开聚合",
    "国家聚类", "OneEarth", "预训练", "高质量语料", "模型评测", "论文", "数据集", "南美洲",
    "TIFF", "ZIP", "CSV", "PNG", "XML", "HDF", "NetCDF", "RAR", "GeoJSON", "JSON", "PDF", "TSV",
    "ASTER", "EarthChem", "GPlates", "Geo H3 Foundation",
    "图像", "栅格数据", "矢量数据", "多波段栅格", "时序栅格",
})


class MergedDatasetUnavailable(RuntimeError):
    pass


class MergedDatasetService:
    def __init__(self, database_path: Path = DATABASE_PATH) -> None:
        self.database_path = database_path
        self.count_cache: OrderedDict[str, dict[str, int]] = OrderedDict()
        self.statistics_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self.keyword_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self.global_dataset_ids: set[int] | None = None
        self.lock = threading.Lock()

    def available(self) -> bool:
        return self.database_path.exists()

    def _connect(self) -> sqlite3.Connection:
        if not self.available():
            raise MergedDatasetUnavailable("Merged dataset index has not been generated")
        connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _value_is_set(value: Any) -> bool:
        return value not in (None, "", "None", "null", "none")

    @staticmethod
    def _is_subject_topic(value: str) -> bool:
        return str(value or "").strip() not in NON_SUBJECT_TOPICS

    def _filter_conditions(self, params: dict[str, Any]) -> tuple[list[str], list[Any]]:
        conditions: list[str] = []
        arguments: list[Any] = []

        if str(params.get("temporal_scope") or "") == "geologic":
            conditions.append("0")
        try:
            if float(params.get("min_size_gb") or 0) > 0:
                conditions.append("0")
        except (TypeError, ValueError):
            pass

        if self._value_is_set(params.get("start_year")) and self._value_is_set(params.get("end_year")):
            conditions.append("0")
        if self._value_is_set(params.get("publication_start_year")) and self._value_is_set(params.get("publication_end_year")):
            conditions.append("0")

        theme = str(params.get("theme") or "").strip()[:160]
        if theme:
            conditions.append(
                "EXISTS(SELECT 1 FROM dataset_topics dtf WHERE dtf.dataset_id=d.id "
                "AND lower(dtf.topic)=lower(?))"
            )
            arguments.append(theme)

        source = str(params.get("source") or "").strip()[:40]
        if source == "科学数据":
            conditions.append("0")
        elif source in ("海纳数据集", "OneEarth数据集"):
            conditions.append("d.source=?")
            arguments.append(source)

        spatial_type = str(params.get("spatial_type") or "").strip()
        if spatial_type == "coordinates":
            conditions.append(
                "EXISTS(SELECT 1 FROM dataset_spatial_profile dsf WHERE dsf.dataset_id=d.id "
                "AND dsf.spatial_class IN ('bbox','point'))"
            )
        elif spatial_type == "named":
            conditions.append(
                "EXISTS(SELECT 1 FROM dataset_spatial_profile dsf WHERE dsf.dataset_id=d.id "
                "AND dsf.spatial_class IN ('region','global'))"
            )
        elif spatial_type == "unlocated":
            conditions.append(
                "EXISTS(SELECT 1 FROM dataset_spatial_profile dsf WHERE dsf.dataset_id=d.id "
                "AND dsf.spatial_class='unlocated')"
            )

        temporal_availability = str(params.get("temporal_availability") or "").strip()
        if temporal_availability == "available":
            conditions.append("0")
        elif temporal_availability == "missing":
            conditions.append("1=1")

        problem_availability = str(params.get("problem_availability") or "").strip()
        if problem_availability == "available":
            conditions.append("0")
        elif problem_availability == "missing":
            conditions.append("1=1")

        searchable = (
            "lower(d.name || ' ' || d.description || ' ' || d.description_en || ' ' || "
            "d.area_range || ' ' || d.source_area_range || ' ' || d.tags_text || ' ' || "
            "d.mapping_tags_text || ' ' || d.dataset_classify || ' ' || d.data_origin_name)"
        )
        search_groups: list[list[str]] = []
        query = str(params.get("query") or "").strip()[:200]
        if query:
            search_groups.append([query])
        data_type = str(params.get("data_type") or "").strip()
        if data_type:
            search_groups.append(DATA_TYPE_TERMS.get(data_type, [data_type]))
        resolution_filter = str(params.get("resolution_filter") or "").strip()
        if resolution_filter:
            search_groups.append([resolution_filter])
        for terms in search_groups:
            conditions.append("(" + " OR ".join("instr(" + searchable + ", ?) > 0" for _ in terms) + ")")
            arguments.extend(term.casefold() for term in terms)
        return conditions, arguments

    @staticmethod
    def _global_coverage_fragment() -> str:
        # Geometries whose extent covers essentially the whole planet. Such datasets have
        # data in every country/province/city, but the membership index intentionally skips
        # them because their span exceeds the per-level thresholds, so they are matched to
        # regions through this fallback instead.
        return (
            "(g.kind='global' OR "
            "(g.kind='bbox' AND g.east-g.west>=300 AND g.north-g.south>=80)) "
            "AND NOT EXISTS(SELECT 1 FROM region_memberships rm_ex "
            "WHERE rm_ex.dataset_id=g.dataset_id)"
        )

    def _global_coverage_dataset_ids(
        self, connection: sqlite3.Connection, conditions: list[str], arguments: list[Any],
    ) -> list[int]:
        where = " AND ".join([self._global_coverage_fragment(), *conditions])
        rows = connection.execute(
            "SELECT DISTINCT g.dataset_id FROM geometries g JOIN datasets d ON d.id=g.dataset_id "
            "WHERE " + where,
            arguments,
        ).fetchall()
        return sorted({int(row[0]) for row in rows})

    def region_counts(self, codes: list[str], params: dict[str, Any]) -> dict[str, int]:
        normalized_codes = list(dict.fromkeys(str(code) for code in codes if code))[:700]
        if not normalized_codes:
            return {}
        signature = json.dumps(
            {"codes": sorted(normalized_codes), "filters": self._filter_conditions(params)},
            sort_keys=True,
        )
        with self.lock:
            cached = self.count_cache.get(signature)
            if cached is not None:
                self.count_cache.move_to_end(signature)
                return dict(cached)

        result = {code: 0 for code in normalized_codes}
        regional_codes = [code for code in normalized_codes if code != "WORLD"]
        connection = self._connect()
        if regional_codes:
            conditions, arguments = self._filter_conditions(params)
            global_ids = self._global_coverage_dataset_ids(connection, conditions, arguments)
            for code in regional_codes:
                result[code] += len(global_ids)
            placeholders = ",".join("?" for _ in regional_codes)
            membership_conditions = [f"rm.region_code IN ({placeholders})", *conditions]
            membership_arguments = [*regional_codes, *arguments]
            rows = connection.execute(
                "SELECT rm.region_code,COUNT(DISTINCT rm.dataset_id) AS dataset_count "
                "FROM region_memberships rm JOIN datasets d ON d.id=rm.dataset_id WHERE "
                + " AND ".join(membership_conditions) + " GROUP BY rm.region_code",
                membership_arguments,
            ).fetchall()
            for row in rows:
                result[str(row["region_code"])] += int(row["dataset_count"])
        if "WORLD" in result:
            conditions, arguments = self._filter_conditions(params)
            where = " WHERE " + " AND ".join(conditions) if conditions else ""
            result["WORLD"] = int(connection.execute(
                "SELECT COUNT(*) FROM datasets d" + where, arguments,
            ).fetchone()[0])
        connection.close()
        with self.lock:
            self.count_cache[signature] = dict(result)
            while len(self.count_cache) > 32:
                self.count_cache.popitem(last=False)
        return result

    def region_statistics(self, region_code: str, params: dict[str, Any]) -> dict[str, Any]:
        code = str(region_code or "").strip()
        if not code:
            raise ValueError("缺少行政区编码")
        signature = json.dumps({"code": code, "filters": self._filter_conditions(params)}, sort_keys=True)
        with self.lock:
            cached = self.statistics_cache.get(signature)
            if cached is not None:
                self.statistics_cache.move_to_end(signature)
                return json.loads(json.dumps(cached))

        conditions, arguments = self._filter_conditions(params)
        connection = self._connect()
        if code == "WORLD":
            selected = "SELECT d.id FROM datasets d"
            if conditions:
                selected += " WHERE " + " AND ".join(conditions)
        else:
            global_ids = self._global_coverage_dataset_ids(connection, conditions, arguments)
            membership_where = " AND ".join(["rm.region_code=?", *conditions])
            selected = (
                "SELECT rm.dataset_id AS id FROM region_memberships rm "
                "JOIN datasets d ON d.id=rm.dataset_id WHERE " + membership_where
            )
            arguments = [code, *arguments]
            if global_ids:
                selected += " UNION " + " UNION ".join("SELECT ? AS id" for _ in global_ids)
                arguments = [*arguments, *global_ids]
        cte = "WITH selected AS (" + selected + ") "

        metrics = connection.execute(
            cte + "SELECT COUNT(*),MIN(d.start_year),MAX(d.end_year) FROM selected s JOIN datasets d ON d.id=s.id",
            arguments,
        ).fetchone()
        spatial_count = int(connection.execute(
            cte + "SELECT COUNT(*) FROM selected s "
            "JOIN dataset_spatial_profile dsp ON dsp.dataset_id=s.id "
            "WHERE dsp.spatial_class!='unlocated'",
            arguments,
        ).fetchone()[0])
        topic_rows = [
            row for row in connection.execute(
                cte + "SELECT dt.topic,COUNT(*) AS topic_count FROM selected s "
                "JOIN dataset_topics dt ON dt.dataset_id=s.id "
                "GROUP BY dt.topic ORDER BY topic_count DESC,dt.topic COLLATE NOCASE",
                arguments,
            ).fetchall()
            if self._is_subject_topic(str(row["topic"]))
        ]
        region_row = connection.execute(
            "SELECT name,level FROM region_catalog WHERE region_code=?", (code,),
        ).fetchone() if code != "WORLD" else ("全球", "world")
        connection.close()

        result = {
            "region_code": code,
            "region_name": str(region_row[0]) if region_row else code,
            "level": str(region_row[1]) if region_row else "",
            "total": int(metrics[0] or 0),
            "spatial_count": spatial_count,
            "temporal_count": 0,
            "dataset_year_start": None,
            "dataset_year_end": None,
            "topics": [{"name": str(row[0]), "count": int(row[1])} for row in topic_rows],
        }
        with self.lock:
            self.statistics_cache[signature] = result
            while len(self.statistics_cache) > 64:
                self.statistics_cache.popitem(last=False)
        return json.loads(json.dumps(result))

    def region_datasets(
        self, region_code: str, params: dict[str, Any], limit: int = 100, offset: int = 0,
    ) -> dict[str, Any]:
        code = str(region_code or "").strip()
        if not code:
            raise ValueError("缺少行政区编码")
        safe_limit = max(1, min(1000, int(limit)))
        safe_offset = max(0, int(offset))
        connection = self._connect()
        conditions, arguments = self._filter_conditions(params)
        global_ids = self._global_coverage_dataset_ids(connection, conditions, arguments)
        membership_conditions = ["rm.region_code=?", *conditions]
        membership_arguments = [code, *arguments]
        where = " AND ".join(membership_conditions)
        membership_total = int(connection.execute(
            "SELECT COUNT(DISTINCT rm.dataset_id) FROM region_memberships rm "
            "JOIN datasets d ON d.id=rm.dataset_id WHERE " + where,
            membership_arguments,
        ).fetchone()[0])
        total = membership_total + len(global_ids)
        columns = (
            "d.id,d.name,d.source_area_range,d.area_range,d.dataset_classify,"
            "d.tags_text,d.upload_time,d.data_origin,d.source "
        )
        all_rows = list(connection.execute(
            "SELECT DISTINCT " + columns +
            "FROM region_memberships rm JOIN datasets d ON d.id=rm.dataset_id WHERE " + where +
            " ORDER BY d.name COLLATE NOCASE",
            membership_arguments,
        ).fetchall())
        if global_ids:
            placeholders = ",".join("?" for _ in global_ids)
            filter_where = " AND ".join(conditions)
            global_sql = (
                "SELECT DISTINCT " + columns +
                "FROM geometries g JOIN datasets d ON d.id=g.dataset_id "
                "WHERE g.dataset_id IN (" + placeholders + ")"
            )
            if filter_where:
                global_sql += " AND " + filter_where
            global_sql += " ORDER BY d.name COLLATE NOCASE"
            all_rows = sorted(
                [*all_rows, *connection.execute(global_sql, [*global_ids, *arguments]).fetchall()],
                key=lambda row: str(row[1] or "").casefold(),
            )
        rows = all_rows[safe_offset:safe_offset + safe_limit]
        region_row = connection.execute(
            "SELECT name,level FROM region_catalog WHERE region_code=?", (code,),
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
            "offset": safe_offset,
            "limit": safe_limit,
            "datasets": [
                {
                    "id": "merged-" + str(row[0]),
                    "rawId": row[0],
                    "source": str(row[8] or "merged"),
                    "itemType": "merged",
                    "name": row[1] or "未命名数据集",
                    "url": str(row[7] or ""),
                    "regionName": self._compact_region_text(
                        str(row[2] or ""), str(row[3] or ""), str(row[4] or ""), region_name,
                    ),
                    "tags": self._compact_tags(str(row[5] or "")),
                    "timeRange": self._format_upload_time(str(row[6] or "")),
                    "startYear": None,
                    "endYear": None,
                    "coverage": coverage_by_dataset.get(int(row[0]), []),
                }
                for row in rows
            ],
        }

    def keyword_search(self, query: str, params: dict[str, Any], limit: int = 50) -> dict[str, Any]:
        """Keyword match across all merged datasets (no region constraint)."""
        raw_query = str(query or "").strip()[:200]
        if not raw_query:
            raise ValueError("缺少搜索关键词")
        safe_limit = max(1, min(200, int(limit)))
        signature = json.dumps(
            {
                "q": raw_query,
                "limit": safe_limit,
                "filters": {key: str(value) for key, value in (params or {}).items()},
            },
            sort_keys=True, ensure_ascii=False,
        )
        with self.lock:
            cached = self.keyword_cache.get(signature)
            if cached is not None:
                self.keyword_cache.move_to_end(signature)
                return json.loads(json.dumps(cached))
        connection = self._connect()
        filter_params = dict(params or {})
        filter_params["query"] = raw_query
        conditions, arguments = self._filter_conditions(filter_params)
        where = " AND ".join(conditions) if conditions else "1=1"
        total = int(connection.execute(
            "SELECT COUNT(*) FROM datasets d WHERE " + where,
            arguments,
        ).fetchone()[0])
        rows = connection.execute(
            "SELECT id,name,source_area_range,area_range,dataset_classify,tags_text,upload_time,data_origin,source "
            "FROM datasets d WHERE " + where +
            " ORDER BY CASE WHEN instr(lower(d.name), ?) > 0 THEN 0 ELSE 1 END,"
            "name COLLATE NOCASE LIMIT ? OFFSET ?",
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
                    "id": "merged-" + str(row[0]),
                    "rawId": row[0],
                    "source": str(row[8] or "merged"),
                    "itemType": "merged",
                    "name": row[1] or "未命名数据集",
                    "url": str(row[7] or ""),
                    "regionName": self._compact_region_text(
                        str(row[2] or ""), str(row[3] or ""), str(row[4] or ""), "",
                    ),
                    "tags": self._compact_tags(str(row[5] or "")),
                    "timeRange": self._format_upload_time(str(row[6] or "")),
                    "startYear": None,
                    "endYear": None,
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
            raise MergedDatasetUnavailable("Merged dataset index has not been generated")
        if len(bounds) != 4:
            raise ValueError("框选范围格式不正确")
        west, south, east, north = map(float, bounds)
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError("框选范围超出经纬度限制")

        conditions, filter_arguments = self._filter_conditions(params)
        safe_limit = max(1, min(100, int(limit)))
        safe_offset = max(0, int(offset))

        connection = self._connect()
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
        total = len(matched_ids)
        rows = []
        topic_rows = []
        if matched_ids:
            placeholders = ",".join("?" for _ in matched_ids)
            rows = connection.execute(
                "SELECT d.id,d.name,d.source_area_range,d.area_range,d.dataset_classify,"
                "d.tags_text,d.upload_time,d.data_origin,d.source "
                "FROM datasets d WHERE d.id IN (" + placeholders + ") "
                "ORDER BY d.name COLLATE NOCASE LIMIT ? OFFSET ?",
                [*matched_ids, safe_limit, safe_offset],
            ).fetchall()
            topic_rows = connection.execute(
                "SELECT dt.topic,COUNT(*) AS topic_count FROM dataset_topics dt "
                "WHERE dt.dataset_id IN (" + placeholders + ") "
                "GROUP BY dt.topic ORDER BY topic_count DESC,dt.topic COLLATE NOCASE LIMIT 4",
                matched_ids,
            ).fetchall()
        connection.close()

        return {
            "bounds": [west, south, east, north],
            "total": total,
            "region_covered_total": len(region_covered_ids),
            "offset": safe_offset,
            "limit": safe_limit,
            "topics": [{"name": str(name), "count": int(count)} for name, count in topic_rows],
            "datasets": [
                {
                    "id": "merged-" + str(row[0]),
                    "rawId": row[0],
                    "source": str(row[8] or "merged"),
                    "itemType": "merged",
                    "name": row[1] or "未命名数据集",
                    "url": str(row[7] or ""),
                    "regionName": self._compact_region_text(
                        str(row[2] or ""), str(row[3] or ""), str(row[4] or ""), "框选范围",
                    ),
                    "tags": self._compact_tags(str(row[5] or "")),
                    "timeRange": self._format_upload_time(str(row[6] or "")),
                    "startYear": None,
                    "endYear": None,
                    "coverage": coverage_by_dataset.get(int(row[0]), []),
                }
                for row in rows
            ],
        }

    def coordinate_geometries(
        self, params: dict[str, Any], bounds: list[float] | tuple[float, float, float, float],
    ) -> list[sqlite3.Row]:
        """返回视野范围内、符合筛选条件的点/面几何（供热力图着色使用）。

        与 heatmap 服务的 _query_geometries 保持相同的语义：排除 global 与超大
        bbox，只保留 kind 为 point/bbox 的坐标几何。热力图城市级精细网格的
        “有数据即着色”据此与点击统计保持一致。
        """
        if not self.available():
            return []
        west, south, east, north = map(float, bounds)
        conditions, arguments = self._filter_conditions(params)
        where = [
            "g.kind != 'global'", "g.east>=?", "g.west<=?", "g.north>=?", "g.south<=?",
            "NOT(g.kind='bbox' AND g.east-g.west>=300 AND g.north-g.south>=140)",
            *conditions,
        ]
        connection = self._connect()
        with self.lock:
            if self.global_dataset_ids is None:
                self.global_dataset_ids = {
                    int(row[0])
                    for row in connection.execute(
                        "SELECT DISTINCT dataset_id FROM geometries "
                        "WHERE kind='global' OR (kind='bbox' AND east-west>=300 AND north-south>=140)"
                    )
                }
        global_ids = self.global_dataset_ids
        rows = connection.execute(
            "SELECT ('merged:' || g.dataset_id) AS dataset_id,g.dataset_id AS raw_dataset_id,"
            "g.kind,g.west,g.south,g.east,g.north,g.region_code "
            "FROM geometries g JOIN datasets d ON d.id=g.dataset_id WHERE "
            + " AND ".join(where),
            [west, east, south, north, *arguments],
        ).fetchall()
        connection.close()
        return [
            row for row in rows
            if row["kind"] in ("point", "bbox")
            and int(row["raw_dataset_id"]) not in global_ids
        ]

    def dataset_detail(self, dataset_id: int) -> dict[str, Any]:
        safe_id = int(dataset_id)
        if safe_id <= 0:
            raise ValueError("数据集编号不正确")
        connection = self._connect()
        row = connection.execute(
            "SELECT * FROM datasets WHERE id=?", (safe_id,),
        ).fetchone()
        if row is None:
            connection.close()
            raise ValueError("数据集不存在")
        topics = [str(value[0]) for value in connection.execute(
            "SELECT topic FROM dataset_topics WHERE dataset_id=? ORDER BY topic COLLATE NOCASE",
            (safe_id,),
        ).fetchall()]
        geometries = connection.execute(
            "SELECT kind,west,south,east,north,region_code FROM geometries "
            "WHERE dataset_id=? ORDER BY CASE kind WHEN 'point' THEN 0 WHEN 'bbox' THEN 1 ELSE 2 END",
            (safe_id,),
        ).fetchall()
        connection.close()

        center = None
        if row["center_lon"] is not None and row["center_lat"] is not None:
            center = {"lon": float(row["center_lon"]), "lat": float(row["center_lat"])}
        bounds = None
        if all(row[column] is not None for column in ("min_lon", "min_lat", "max_lon", "max_lat")):
            bounds = [
                float(row["min_lon"]), float(row["min_lat"]),
                float(row["max_lon"]), float(row["max_lat"]),
            ]

        return {
            "id": safe_id,
            "source": str(row["source"] or ""),
            "name": str(row["name"] or "未命名数据集"),
            "nameEn": str(row["name_en"] or ""),
            "description": str(row["description"] or ""),
            "descriptionEn": str(row["description_en"] or ""),
            "url": str(row["data_origin"] or ""),
            "sourceCategory": str(row["source_category"] or ""),
            "sourceSubcategory": str(row["source_subcategory"] or ""),
            "coordinateStatus": str(row["coordinate_status"] or ""),
            "coordinateSystem": str(row["coordinate_system"] or ""),
            "center": center,
            "bounds": bounds,
            "coordinateExtractSource": str(row["coordinate_extract_source"] or ""),
            "coordinateValidation": str(row["coordinate_validation"] or ""),
            "coordinateNote": str(row["coordinate_note"] or ""),
            "areaRange": str(row["area_range"] or ""),
            "sourceAreaRange": str(row["source_area_range"] or ""),
            "datasetClassify": str(row["dataset_classify"] or ""),
            "tags": topics,
            "dataAccessMode": str(row["data_access_mode"] or ""),
            "dataSize": str(row["data_size"] or ""),
            "dataOrigin": str(row["data_origin"] or ""),
            "dataOriginName": str(row["data_origin_name"] or ""),
            "format": str(row["data_format"] or ""),
            "crs": str(row["crs"] or ""),
            "uploadTime": str(row["upload_time"] or ""),
            "realUploadTime": str(row["real_upload_time"] or ""),
            "updateTime": str(row["update_time"] or ""),
            "timelineTime": str(row["timeline_time"] or ""),
            "timelineType": str(row["timeline_type"] or ""),
            "coverage": [
                {
                    "kind": str(value[0]),
                    "west": float(value[1]),
                    "south": float(value[2]),
                    "east": float(value[3]),
                    "north": float(value[4]),
                    "regionCode": str(value[5] or ""),
                }
                for value in geometries
            ],
        }

    def filter_options(self) -> dict[str, Any]:
        connection = self._connect()
        topic_rows = [
            row for row in connection.execute(
                "SELECT topic,COUNT(*) FROM dataset_topics GROUP BY topic "
                "ORDER BY COUNT(*) DESC,topic COLLATE NOCASE"
            ).fetchall()
            if self._is_subject_topic(str(row[0]))
        ]
        spatial_rows = connection.execute(
            "SELECT spatial_class,COUNT(*) FROM dataset_spatial_profile GROUP BY spatial_class"
        ).fetchall()
        source_rows = connection.execute(
            "SELECT source,COUNT(*) FROM datasets WHERE source<>'' GROUP BY source "
            "ORDER BY COUNT(*) DESC,source COLLATE NOCASE"
        ).fetchall()
        connection.close()
        spatial_counts = {str(kind): int(count) for kind, count in spatial_rows}
        return {
            "topics": [{"value": str(topic), "count": int(count)} for topic, count in topic_rows],
            "sources": [{"value": str(source), "count": int(count)} for source, count in source_rows],
            "spatial": {
                "coordinates": spatial_counts.get("bbox", 0) + spatial_counts.get("point", 0),
                "named": spatial_counts.get("region", 0) + spatial_counts.get("global", 0),
                "unlocated": spatial_counts.get("unlocated", 0),
            },
        }

    @staticmethod
    def _compact_tags(value: str) -> list[str]:
        text = str(value or "").strip()
        parsed: Any = None
        if text.startswith("["):
            try:
                parsed = json.loads(text)
            except (TypeError, ValueError):
                parsed = None
        if isinstance(parsed, list):
            values = [str(item).strip() for item in parsed]
        else:
            values = [item.strip(" [](){}'\"\t\r\n") for item in re.split(r"[,，;；/|]", text.strip("[](){} "))]
        tags: list[str] = []
        for tag in values:
            if not tag or tag.casefold() in {item.casefold() for item in tags}:
                continue
            tags.append(tag[:30])
            if len(tags) == 3:
                break
        return tags

    @staticmethod
    def _compact_region_text(source_area: str, area_range: str, classify: str, fallback: str) -> str:
        for value in (source_area, area_range, classify):
            text = str(value or "").strip()
            if text:
                return text[:60]
        return str(fallback or "")

    @staticmethod
    def _format_upload_time(value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        date = text.split(" ")[0][:10]
        return "更新于 " + date if date else ""


SERVICE = MergedDatasetService()
