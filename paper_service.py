"""Read-only queries for the independent scientific-paper point index."""

from __future__ import annotations

import ast
import json
import math
import re
import sqlite3
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
DATABASE_PATH = ROOT / "data/generated/paper_points.sqlite"


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


def _point_in_ring(longitude: float, latitude: float, ring: list[list[float]]) -> bool:
    inside = False
    previous = len(ring) - 1
    for index, current in enumerate(ring):
        before = ring[previous]
        intersects = (current[1] > latitude) != (before[1] > latitude) and longitude < (
            (before[0] - current[0]) * (latitude - current[1]) /
            (before[1] - current[1] or 1e-12) + current[0]
        )
        if intersects:
            inside = not inside
        previous = index
    return inside


class PaperIndexUnavailable(RuntimeError):
    pass


class PaperPointService:
    def __init__(self, database_path: Path = DATABASE_PATH) -> None:
        self.database_path = database_path
        self.count_cache: OrderedDict[str, dict[str, int]] = OrderedDict()
        self.statistics_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self.distribution_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self.keyword_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self.lock = threading.Lock()

    def available(self) -> bool:
        return self.database_path.exists()

    def _connect(self) -> sqlite3.Connection:
        if not self.available():
            raise PaperIndexUnavailable("Paper point index has not been generated")
        connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _filter_conditions(params: dict[str, Any], alias: str = "p") -> tuple[list[str], list[Any]]:
        conditions: list[str] = []
        arguments: list[Any] = []
        start = params.get("publication_start_year")
        end = params.get("publication_end_year")
        if start not in (None, "") and end not in (None, ""):
            conditions.extend([f"{alias}.publication_year>=?", f"{alias}.publication_year<=?"])
            arguments.extend([int(start), int(end)])
        topic = str(params.get("paper_theme") or "").strip()[:160]
        if topic:
            conditions.append(
                f"EXISTS(SELECT 1 FROM paper_topics ptf WHERE ptf.paper_id={alias}.id "
                "AND lower(ptf.topic)=lower(?))"
            )
            arguments.append(topic)
        spatial_availability = str(params.get("paper_spatial_availability") or "").strip()
        if spatial_availability == "available":
            conditions.extend([f"{alias}.longitude IS NOT NULL", f"{alias}.latitude IS NOT NULL"])
        elif spatial_availability == "missing":
            conditions.append(f"({alias}.longitude IS NULL OR {alias}.latitude IS NULL)")
        return conditions, arguments

    def region_counts(self, codes: list[str], params: dict[str, Any]) -> dict[str, int]:
        normalized_codes = list(dict.fromkeys(str(code) for code in codes if code))[:700]
        signature = json.dumps(
            {"codes": sorted(normalized_codes), "filters": self._filter_conditions(params)}, sort_keys=True,
        )
        with self.lock:
            cached = self.count_cache.get(signature)
            if cached is not None:
                self.count_cache.move_to_end(signature)
                return dict(cached)
        result = {code: 0 for code in normalized_codes}
        connection = self._connect()
        regional_codes = [code for code in normalized_codes if code != "WORLD"]
        if regional_codes:
            year_conditions, year_arguments = self._filter_conditions(params)
            placeholders = ",".join("?" for _ in regional_codes)
            conditions = [f"prm.region_code IN ({placeholders})", *year_conditions]
            rows = connection.execute(
                "SELECT prm.region_code,COUNT(*) AS paper_count FROM paper_region_memberships prm "
                "JOIN papers p ON p.id=prm.paper_id WHERE " + " AND ".join(conditions) +
                " GROUP BY prm.region_code",
                [*regional_codes, *year_arguments],
            ).fetchall()
            for row in rows:
                result[str(row["region_code"])] = int(row["paper_count"])
        if "WORLD" in result:
            year_conditions, year_arguments = self._filter_conditions(params)
            where = " WHERE " + " AND ".join(year_conditions) if year_conditions else ""
            result["WORLD"] = int(connection.execute(
                "SELECT COUNT(*) FROM papers p" + where, year_arguments,
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
            raise ValueError("Missing region code")
        signature = json.dumps({"code": code, "filters": self._filter_conditions(params)}, sort_keys=True)
        with self.lock:
            cached = self.statistics_cache.get(signature)
            if cached is not None:
                self.statistics_cache.move_to_end(signature)
                return json.loads(json.dumps(cached))
        connection = self._connect()
        conditions, arguments = self._filter_conditions(params)
        if code == "WORLD":
            selected = "SELECT p.id,p.publication_year FROM papers p"
        else:
            selected = (
                "SELECT p.id,p.publication_year FROM paper_region_memberships prm "
                "JOIN papers p ON p.id=prm.paper_id"
            )
            conditions.insert(0, "prm.region_code=?")
            arguments.insert(0, code)
        if conditions:
            selected += " WHERE " + " AND ".join(conditions)
        cte = "WITH selected AS (" + selected + ") "
        metrics = connection.execute(
            cte + "SELECT COUNT(*),MIN(publication_year),MAX(publication_year) FROM selected",
            arguments,
        ).fetchone()
        topics = connection.execute(
            cte + "SELECT pt.topic,COUNT(*) AS topic_count FROM selected s "
            "JOIN paper_topics pt ON pt.paper_id=s.id GROUP BY pt.topic "
            "ORDER BY topic_count DESC,pt.topic COLLATE NOCASE",
            arguments,
        ).fetchall()
        connection.close()
        result = {
            "total": int(metrics[0] or 0),
            "paper_year_start": metrics[1],
            "paper_year_end": metrics[2],
            "topics": [{"name": str(row[0]), "count": int(row[1])} for row in topics],
        }
        with self.lock:
            self.statistics_cache[signature] = result
            while len(self.statistics_cache) > 64:
                self.statistics_cache.popitem(last=False)
        return json.loads(json.dumps(result))

    def region_papers(
        self, region_code: str, params: dict[str, Any], limit: int = 100, offset: int = 0,
        location_limit: int = 10000,
    ) -> dict[str, Any]:
        code = str(region_code or "").strip()
        if not code:
            raise ValueError("Missing region code")
        safe_limit = max(1, min(1000, int(limit)))
        safe_offset = max(0, int(offset))
        safe_location_limit = max(1, min(20000, int(location_limit)))
        conditions, arguments = self._filter_conditions(params)
        world_mode = code == "WORLD"
        if world_mode:
            source = "papers p"
            conditions.extend(["p.longitude IS NOT NULL", "p.latitude IS NOT NULL"])
        else:
            source = "paper_region_memberships prm JOIN papers p ON p.id=prm.paper_id"
            conditions.insert(0, "prm.region_code=?")
            arguments.insert(0, code)
        where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
        connection = self._connect()
        metrics = connection.execute(
            "SELECT COUNT(*),MIN(p.publication_year),MAX(p.publication_year) FROM " + source + where,
            arguments,
        ).fetchone()
        total = int(metrics[0])
        rows = connection.execute(
            "SELECT p.id,p.title,p.publication_year,p.subject,p.keywords,p.longitude,p.latitude "
            "FROM " + source + where +
            " ORDER BY p.publication_year IS NULL,p.publication_year DESC,p.title COLLATE NOCASE "
            "LIMIT ? OFFSET ?",
            [*arguments, safe_limit, safe_offset],
        ).fetchall()
        location_total = int(connection.execute(
            "SELECT COUNT(*) FROM (SELECT p.longitude,p.latitude FROM " + source + where +
            " GROUP BY p.longitude,p.latitude)",
            arguments,
        ).fetchone()[0])
        location_rows = connection.execute(
            "SELECT p.longitude,p.latitude,COUNT(*) AS paper_count,GROUP_CONCAT(p.id) AS paper_ids "
            "FROM " + source + where +
            " GROUP BY p.longitude,p.latitude ORDER BY paper_count DESC,p.latitude,p.longitude "
            "LIMIT ?",
            [*arguments, safe_location_limit],
        ).fetchall()
        region_row = None
        if not world_mode:
            region_row = connection.execute(
                "SELECT name FROM region_catalog WHERE region_code=?", (code,),
            ).fetchone()
        connection.close()
        return {
            "region_code": code,
            "region_name": str(region_row[0]) if region_row else code,
            "total": total,
            "paper_year_start": metrics[1],
            "paper_year_end": metrics[2],
            "locationTotal": location_total,
            "offset": safe_offset,
            "limit": safe_limit,
            "locations": [
                {
                    "id": self._location_id(float(row[0]), float(row[1])),
                    "longitude": float(row[0]),
                    "latitude": float(row[1]),
                    "count": int(row[2]),
                    "paperIds": [int(value) for value in str(row[3] or "").split(",") if value],
                }
                for row in location_rows
            ],
            "papers": [
                {
                    "id": int(row[0]),
                    "title": str(row[1] or "Untitled paper"),
                    "publicationYear": row[2],
                    "subject": str(row[3] or ""),
                    "tags": self._compact_keywords(str(row[4] or "")),
                    "longitude": float(row[5]),
                    "latitude": float(row[6]),
                    "locationId": self._location_id(float(row[5]), float(row[6])),
                    "coverage": [{
                        "kind": "point", "west": float(row[5]), "south": float(row[6]),
                        "east": float(row[5]), "north": float(row[6]),
                    }],
                }
                for row in rows
            ],
        }

    def keyword_search(self, query: str, params: dict[str, Any], limit: int = 50) -> dict[str, Any]:
        """Keyword match across all papers (no region constraint)."""
        raw_query = str(query or "").strip()[:200]
        if not raw_query:
            raise ValueError("Missing search keyword")
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
        conditions, arguments = self._filter_conditions(params or {})
        searchable = (
            "lower(p.title || ' ' || p.study_object || ' ' || p.keywords || ' ' || "
            "p.study_area || ' ' || p.subject || ' ' || p.main_findings || ' ' || "
            "p.data_sources || ' ' || p.sample_types || ' ' || p.analytical_techniques)"
        )
        use_fts = len(raw_query) >= 3 and connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='papers_fts'"
        ).fetchone() is not None
        if use_fts:
            conditions.append(
                "p.id IN (SELECT rowid FROM papers_fts WHERE papers_fts MATCH ?)"
            )
            arguments.append(self._fts_phrase(raw_query))
        else:
            conditions.append("instr(" + searchable + ", ?) > 0")
            arguments.append(raw_query.casefold())
        where = " AND ".join(conditions)
        total = int(connection.execute(
            "SELECT COUNT(*) FROM papers p WHERE " + where,
            arguments,
        ).fetchone()[0])
        rows = connection.execute(
            "SELECT p.id,p.title,p.publication_year,p.subject,p.keywords,p.longitude,p.latitude "
            "FROM papers p WHERE " + where +
            " ORDER BY p.publication_year IS NULL,p.publication_year DESC,p.title COLLATE NOCASE "
            "LIMIT ? OFFSET ?",
            [*arguments, safe_limit, 0],
        ).fetchall()
        connection.close()
        papers: list[dict[str, Any]] = []
        for row in rows:
            longitude = row[5]
            latitude = row[6]
            located = longitude is not None and latitude is not None
            papers.append({
                "id": int(row[0]),
                "title": str(row[1] or "Untitled paper"),
                "publicationYear": row[2],
                "subject": str(row[3] or ""),
                "tags": self._compact_keywords(str(row[4] or "")),
                "longitude": float(longitude) if located else None,
                "latitude": float(latitude) if located else None,
                "locationId": self._location_id(float(longitude), float(latitude)) if located else "",
                "coverage": [{
                    "kind": "point", "west": float(longitude), "south": float(latitude),
                    "east": float(longitude), "north": float(latitude),
                }] if located else [],
            })
        result = {
            "query": raw_query,
            "total": total,
            "papers": papers,
        }
        with self.lock:
            self.keyword_cache[signature] = result
            while len(self.keyword_cache) > 64:
                self.keyword_cache.popitem(last=False)
        return json.loads(json.dumps(result))

    @staticmethod
    def _location_id(longitude: float, latitude: float) -> str:
        return f"{longitude:.8f}:{latitude:.8f}"

    @staticmethod
    def _fts_phrase(query: str) -> str:
        return '"' + str(query).replace('"', '""') + '"'

    def bounds_papers(
        self, bounds: list[float], params: dict[str, Any], limit: int = 100, offset: int = 0,
        polygon: list[list[float]] | None = None,
        circle: tuple[float, float, float] | None = None,
    ) -> dict[str, Any]:
        if len(bounds) != 4:
            raise ValueError("框选范围格式不正确")
        west, south, east, north = map(float, bounds)
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError("框选范围超出经纬度限制")

        safe_limit = max(1, min(100, int(limit)))
        safe_offset = max(0, int(offset))
        conditions, arguments = self._filter_conditions(params)
        conditions.extend([
            "p.longitude IS NOT NULL", "p.latitude IS NOT NULL",
            "p.longitude>=?", "p.longitude<=?", "p.latitude>=?", "p.latitude<=?",
        ])
        arguments.extend([west, east, south, north])
        where = " AND ".join(conditions)
        connection = self._connect()
        if polygon or circle:
            candidates = connection.execute(
                "SELECT p.id,p.longitude,p.latitude FROM papers p WHERE " + where,
                arguments,
            ).fetchall()
            if circle:
                circle_longitude, circle_latitude, circle_radius = circle
                matched_ids = [
                    int(row[0]) for row in candidates
                    if _great_circle_distance_km(
                        circle_longitude, circle_latitude, float(row[1]), float(row[2]),
                    ) <= circle_radius
                ]
            else:
                matched_ids = [
                    int(row[0]) for row in candidates
                    if _point_in_ring(float(row[1]), float(row[2]), polygon)
                ]
            connection.execute("CREATE TEMP TABLE matched_polygon_papers(paper_id INTEGER PRIMARY KEY)")
            connection.executemany(
                "INSERT INTO matched_polygon_papers(paper_id) VALUES(?)",
                ((paper_id,) for paper_id in matched_ids),
            )
            total = len(matched_ids)
            rows = connection.execute(
                "SELECT p.id,p.title,p.publication_year,p.subject,p.keywords,p.longitude,p.latitude "
                "FROM matched_polygon_papers mp JOIN papers p ON p.id=mp.paper_id "
                "ORDER BY p.publication_year IS NULL,p.publication_year DESC,p.title COLLATE NOCASE "
                "LIMIT ? OFFSET ?",
                [safe_limit, safe_offset],
            ).fetchall()
            topic_rows = connection.execute(
                "SELECT pt.topic,COUNT(*) AS topic_count FROM matched_polygon_papers mp "
                "JOIN paper_topics pt ON pt.paper_id=mp.paper_id "
                "GROUP BY pt.topic ORDER BY topic_count DESC,pt.topic COLLATE NOCASE LIMIT 4",
            ).fetchall()
            year_rows = connection.execute(
                "SELECT MIN(p.publication_year),MAX(p.publication_year) "
                "FROM matched_polygon_papers mp JOIN papers p ON p.id=mp.paper_id",
            ).fetchone()
        else:
            total = int(connection.execute(
                "SELECT COUNT(*) FROM papers p WHERE " + where, arguments,
            ).fetchone()[0])
            rows = connection.execute(
                "SELECT p.id,p.title,p.publication_year,p.subject,p.keywords,p.longitude,p.latitude "
                "FROM papers p WHERE " + where +
                " ORDER BY p.publication_year IS NULL,p.publication_year DESC,p.title COLLATE NOCASE "
                "LIMIT ? OFFSET ?",
                [*arguments, safe_limit, safe_offset],
            ).fetchall()
            topic_rows = connection.execute(
                "SELECT pt.topic,COUNT(*) AS topic_count FROM papers p "
                "JOIN paper_topics pt ON pt.paper_id=p.id WHERE " + where +
                " GROUP BY pt.topic ORDER BY topic_count DESC,pt.topic COLLATE NOCASE LIMIT 4",
                arguments,
            ).fetchall()
            year_rows = connection.execute(
                "SELECT MIN(p.publication_year),MAX(p.publication_year) FROM papers p WHERE " + where,
                arguments,
            ).fetchone()
        connection.close()
        return {
            "bounds": [west, south, east, north],
            "total": total,
            "paper_year_start": year_rows[0],
            "paper_year_end": year_rows[1],
            "offset": safe_offset,
            "limit": safe_limit,
            "topics": [{"name": str(name), "count": int(count)} for name, count in topic_rows],
            "papers": [
                {
                    "id": int(row[0]),
                    "title": str(row[1] or "Untitled paper"),
                    "publicationYear": row[2],
                    "subject": str(row[3] or ""),
                    "tags": self._compact_keywords(str(row[4] or "")),
                    "longitude": float(row[5]),
                    "latitude": float(row[6]),
                    "coverage": [{
                        "kind": "point", "west": float(row[5]), "south": float(row[6]),
                        "east": float(row[5]), "north": float(row[6]),
                    }],
                }
                for row in rows
            ],
        }

    def paper_distribution(
        self, bounds: list[float], params: dict[str, Any], cell_size: float = 4.0,
        region_code: str = "",
    ) -> dict[str, Any]:
        if len(bounds) != 4:
            raise ValueError("论文分布范围格式不正确")
        west, south, east, north = map(float, bounds)
        if not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south < north <= 90):
            raise ValueError("论文分布范围超出经纬度限制")
        size = max(0.05, min(10.0, float(cell_size)))
        signature = json.dumps(
            {
                "bounds": [round(value, 4) for value in (west, south, east, north)],
                "cell_size": round(size, 4),
                "region_code": str(region_code or "").strip(),
                "filters": self._filter_conditions(params),
            },
            sort_keys=True,
        )
        with self.lock:
            cached = self.distribution_cache.get(signature)
            if cached is not None:
                self.distribution_cache.move_to_end(signature)
                return json.loads(json.dumps(cached))

        conditions, arguments = self._filter_conditions(params)
        code = str(region_code or "").strip()
        source = "papers p"
        if code:
            source = "paper_region_memberships prm JOIN papers p ON p.id=prm.paper_id"
            conditions.insert(0, "prm.region_code=?")
            arguments.insert(0, code)
        conditions.extend(["p.longitude IS NOT NULL", "p.latitude IS NOT NULL"])
        if west <= east:
            conditions.extend(["p.longitude>=?", "p.longitude<=?"])
            arguments.extend([west, east])
        else:
            conditions.append("(p.longitude>=? OR p.longitude<=?)")
            arguments.extend([west, east])
        conditions.extend(["p.latitude>=?", "p.latitude<=?"])
        arguments.extend([south, north])
        where = " AND ".join(conditions)
        connection = self._connect()
        rows = connection.execute(
            "SELECT CAST((p.longitude + 180.0) / ? AS INTEGER) AS grid_x,"
            "CAST((p.latitude + 90.0) / ? AS INTEGER) AS grid_y,"
            "AVG(p.longitude),AVG(p.latitude),COUNT(*) AS paper_count "
            "FROM " + source + " WHERE " + where +
            " GROUP BY grid_x,grid_y ORDER BY paper_count,grid_y,grid_x",
            [size, size, *arguments],
        ).fetchall()
        connection.close()
        counts = sorted(int(row[4]) for row in rows)

        def percentile(ratio: float) -> int:
            if not counts:
                return 0
            return counts[min(len(counts) - 1, max(0, round((len(counts) - 1) * ratio)))]

        result = {
            "bounds": [west, south, east, north],
            "cell_size": size,
            "region_code": code,
            "total_papers": sum(counts),
            "cell_count": len(rows),
            "quantiles": {
                "p50": percentile(0.5),
                "p90": percentile(0.9),
                "p99": percentile(0.99),
                "max": counts[-1] if counts else 0,
            },
            "cells": [
                {
                    "id": f"{int(row[0])}:{int(row[1])}",
                    "longitude": round(float(row[2]), 5),
                    "latitude": round(float(row[3]), 5),
                    "count": int(row[4]),
                }
                for row in rows
            ],
        }
        with self.lock:
            self.distribution_cache[signature] = result
            while len(self.distribution_cache) > 48:
                self.distribution_cache.popitem(last=False)
        return json.loads(json.dumps(result))

    def paper_detail(self, paper_id: int) -> dict[str, Any]:
        safe_id = int(paper_id)
        if safe_id <= 0:
            raise ValueError("Invalid paper id")
        connection = self._connect()
        row = connection.execute("SELECT * FROM papers WHERE id=?", (safe_id,)).fetchone()
        connection.close()
        if row is None:
            raise ValueError("Paper not found")
        return {
            "id": safe_id,
            "title": str(row["title"] or "Untitled paper"),
            "studyObject": str(row["study_object"] or ""),
            "authors": self._author_list(str(row["authors"] or "")),
            "affiliation": str(row["affiliation"] or ""),
            "publicationYear": row["publication_year"],
            "keywords": self._compact_keywords(str(row["keywords"] or ""), limit=30),
            "timeTheme": str(row["time_theme"] or ""),
            "studyArea": str(row["study_area"] or ""),
            "coordinate": str(row["coordinate_text"] or ""),
            "dataSources": str(row["data_sources"] or ""),
            "sampleTypes": str(row["sample_types"] or ""),
            "analyticalTechniques": str(row["analytical_techniques"] or ""),
            "researchMethodology": str(row["research_methodology"] or ""),
            "mainFindings": str(row["main_findings"] or ""),
            "subject": str(row["subject"] or ""),
            "longitude": row["longitude"],
            "latitude": row["latitude"],
        }

    def filter_options(self) -> dict[str, Any]:
        connection = self._connect()
        topics = connection.execute(
            "SELECT topic,COUNT(*) FROM paper_topics GROUP BY topic ORDER BY COUNT(*) DESC,topic COLLATE NOCASE"
        ).fetchall()
        periods = connection.execute(
            "SELECT CAST(publication_year / 10 AS INTEGER) * 10 AS decade,COUNT(*) "
            "FROM papers WHERE publication_year IS NOT NULL GROUP BY decade ORDER BY decade"
        ).fetchall()
        maximum = connection.execute("SELECT MAX(publication_year) FROM papers").fetchone()[0]
        availability = connection.execute(
            "SELECT COUNT(*),SUM(CASE WHEN longitude IS NOT NULL AND latitude IS NOT NULL THEN 1 ELSE 0 END) "
            "FROM papers"
        ).fetchone()
        connection.close()
        total = int(availability[0] or 0)
        located = int(availability[1] or 0)
        return {
            "topics": [{"value": str(row[0]), "count": int(row[1])} for row in topics],
            "spatial": {"available": located, "missing": total - located},
            "publication_periods": [
                {"start": int(row[0]), "end": min(int(row[0]) + 9, int(maximum)), "count": int(row[1])}
                for row in periods
            ],
        }

    @staticmethod
    def _compact_keywords(value: str, limit: int = 3) -> list[str]:
        values = [item.strip(" [](){}'\"\t\r\n") for item in re.split(r"[,;|]", value)]
        result: list[str] = []
        for item in values:
            if not item or item.casefold() in {existing.casefold() for existing in result}:
                continue
            result.append(item[:80])
            if len(result) == limit:
                break
        return result

    @staticmethod
    def _author_list(value: str) -> list[str]:
        try:
            parsed = ast.literal_eval(value) if value.startswith("[") else None
        except (SyntaxError, ValueError):
            parsed = None
        values = parsed if isinstance(parsed, (list, tuple)) else re.split(r"[,;]", value)
        return [str(item).strip() for item in values if str(item).strip()][:100]


SERVICE = PaperPointService()
