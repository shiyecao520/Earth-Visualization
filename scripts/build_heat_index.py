#!/usr/bin/env python3
"""Build the runtime spatial index used by the dataset coverage heatmap."""

from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "data/source/datasets_scientific.csv"
DEFAULT_OUTPUT = ROOT / "data/generated/dataset_heat.sqlite"
COUNTRIES_PATH = ROOT / "data/boundaries/countries.geojson"
PROVINCES_PATH = ROOT / "data/boundaries/china-provinces.geojson"
CITIES_DIRECTORY = ROOT / "data/boundaries/china-cities"

MEMBERSHIP_MAX_SPAN = {
    "country": 160.0,
    "province": 30.0,
    "city": 8.0,
}

GLOBAL_RE = re.compile(r"\b(global|worldwide|world[- ]?wide|entire world|whole world)\b|全球|全世界", re.I)
NON_EARTH_RE = re.compile(r"\b(mars|martian|moon|lunar|venus|mercury)\b|火星|月球|金星|水星", re.I)
AXIS_LABEL_RE = re.compile(r"\b(longitude|latitude|long\.?|lon\.?|lat\.?)\b|经度|纬度", re.I)
NUMBER_RE = re.compile(
    r"(?<![A-Za-z0-9_-])([+-]?\d+(?:\.\d+)?)\s*"
    r"(?:°|º|degrees?)?\s*"
    r"(?:(\d+(?:\.\d+)?)\s*(?:['′]|minutes?)\s*)?"
    r"(?:(\d+(?:\.\d+)?)\s*(?:[\"″]|seconds?)\s*)?"
    r"([NSEW])?",
    re.I,
)
PAIR_RE = re.compile(r"[\[(]?\s*([+-]?\d+(?:\.\d+)?)\s*[,，]\s*([+-]?\d+(?:\.\d+)?)\s*[\])]?", re.I)
YEAR_RE = re.compile(r"(?<!\d)(1\d{3}|20\d{2}|2100)(?!\d)")

PROVINCE_ENGLISH = {
    "110000": ["Beijing"], "120000": ["Tianjin"], "130000": ["Hebei"],
    "140000": ["Shanxi"], "150000": ["Inner Mongolia"], "210000": ["Liaoning"],
    "220000": ["Jilin"], "230000": ["Heilongjiang"], "310000": ["Shanghai"],
    "320000": ["Jiangsu"], "330000": ["Zhejiang"], "340000": ["Anhui"],
    "350000": ["Fujian"], "360000": ["Jiangxi"], "370000": ["Shandong"],
    "410000": ["Henan"], "420000": ["Hubei"], "430000": ["Hunan"],
    "440000": ["Guangdong"], "450000": ["Guangxi"], "460000": ["Hainan"],
    "500000": ["Chongqing"], "510000": ["Sichuan"], "520000": ["Guizhou"],
    "530000": ["Yunnan"], "540000": ["Tibet", "Xizang"], "610000": ["Shaanxi"],
    "620000": ["Gansu"], "630000": ["Qinghai"], "640000": ["Ningxia"],
    "650000": ["Xinjiang"], "810000": ["Hong Kong"], "820000": ["Macao", "Macau"],
}

COUNTRY_ALIASES = {
    "USA": ["United States", "United States of America", "USA", "U.S.A.", "U.S."],
    "GBR": ["United Kingdom", "Great Britain", "UK", "U.K."],
    "CHN": ["China", "PR China", "P.R. China"],
    "RUS": ["Russia", "Russian Federation"],
    "KOR": ["South Korea", "Republic of Korea"],
    "PRK": ["North Korea", "DPRK"],
    "IRN": ["Iran"],
    "VNM": ["Vietnam", "Viet Nam"],
    "LAO": ["Laos", "Lao PDR"],
    "TWN": ["Taiwan"],
}


def geometry_bounds(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
    west, south, east, north = 180.0, 90.0, -180.0, -90.0

    def visit(value: Any) -> None:
        nonlocal west, south, east, north
        if isinstance(value, list) and len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
            west = min(west, float(value[0]))
            south = min(south, float(value[1]))
            east = max(east, float(value[0]))
            north = max(north, float(value[1]))
            return
        if isinstance(value, list):
            for child in value:
                visit(child)

    visit(geometry.get("coordinates"))
    return west, south, east, north


def outer_rings(geometry: dict[str, Any]) -> list[list[list[float]]]:
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") == "Polygon":
        return [coordinates[0]] if coordinates else []
    if geometry.get("type") == "MultiPolygon":
        return [polygon[0] for polygon in coordinates if polygon]
    return []


def load_region_catalog() -> tuple[dict[str, dict[str, Any]], list[tuple[str, str, bool]]]:
    catalog: dict[str, dict[str, Any]] = {}
    aliases: list[tuple[str, str, bool]] = []
    boundary_paths = [(COUNTRIES_PATH, False), (PROVINCES_PATH, True)]
    boundary_paths.extend((path, True) for path in sorted(CITIES_DIRECTORY.glob("*.geojson")))
    for path, is_subnational in boundary_paths:
        collection = json.loads(path.read_text(encoding="utf-8"))
        for feature in collection["features"]:
            properties = feature.get("properties") or {}
            code = str(properties.get("regionCode") or "")
            if not code or code in catalog:
                continue
            level = str(properties.get("level") or ("province" if is_subnational else "country"))
            parent_code = str(properties.get("parentCode") or ("CHN" if level == "province" else ""))
            catalog[code] = {
                "code": code,
                "name": str(properties.get("name") or properties.get("nameEn") or code),
                "level": level,
                "parent_code": parent_code,
                "bounds": geometry_bounds(feature["geometry"]),
                "rings": outer_rings(feature["geometry"]),
            }
            names = [properties.get("name"), properties.get("nameEn")]
            if level == "province":
                names.extend(PROVINCE_ENGLISH.get(code, []))
                chinese = str(properties.get("name") or "")
                names.append(re.sub(r"省|市|自治区|特别行政区$", "", chinese))
            elif level == "city":
                chinese = str(properties.get("name") or "")
                names.append(re.sub(r"市|地区|自治州|盟|林区$", "", chinese))
            else:
                names.extend(COUNTRY_ALIASES.get(code, []))
            for name in names:
                normalized = str(name or "").strip()
                if len(normalized) >= 2:
                    aliases.append((normalized, code, is_subnational))
    aliases.sort(key=lambda item: len(item[0]), reverse=True)
    return catalog, aliases


def point_in_ring(longitude: float, latitude: float, ring: list[list[float]]) -> bool:
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


def point_in_region(longitude: float, latitude: float, region: dict[str, Any]) -> bool:
    west, south, east, north = region["bounds"]
    return west <= longitude <= east and south <= latitude <= north and any(
        point_in_ring(longitude, latitude, ring) for ring in region["rings"]
    )


def bounds_intersect(left: tuple[float, float, float, float], right: tuple[float, float, float, float]) -> bool:
    return left[2] >= right[0] and left[0] <= right[2] and left[3] >= right[1] and left[1] <= right[3]


def ancestor_codes(code: str, catalog: dict[str, dict[str, Any]]) -> list[str]:
    ancestors = []
    current = catalog.get(code)
    while current and current.get("parent_code"):
        parent_code = str(current["parent_code"])
        if parent_code in ancestors:
            break
        ancestors.append(parent_code)
        current = catalog.get(parent_code)
    return ancestors


def alias_present(text: str, alias: str) -> bool:
    if re.search(r"[\u4e00-\u9fff]", alias):
        return alias in text
    escaped = re.escape(alias).replace(r"\ ", r"[\s-]+")
    return re.search(r"(?<![A-Za-z])" + escaped + r"(?![A-Za-z])", text, re.I) is not None


def resolve_regions(text: str, aliases: list[tuple[str, str, bool]]) -> list[str]:
    value = str(text or "").strip()
    if not value:
        return []
    if GLOBAL_RE.search(value):
        return ["GLOBAL"]
    matches: list[tuple[str, bool]] = []
    seen: set[str] = set()
    for alias, code, is_subnational in aliases:
        if code in seen or not alias_present(value, alias):
            continue
        seen.add(code)
        matches.append((code, is_subnational))
    if any(is_subnational for _, is_subnational in matches):
        matches = [item for item in matches if item[0] != "CHN"]
    return [code for code, _ in matches]


def coordinate_value(match: re.Match[str]) -> float:
    degrees = float(match.group(1))
    minutes = float(match.group(2) or 0)
    seconds = float(match.group(3) or 0)
    sign = -1 if degrees < 0 else 1
    value = abs(degrees) + minutes / 60 + seconds / 3600
    hemisphere = (match.group(4) or "").upper()
    if hemisphere in ("S", "W"):
        sign = -1
    elif hemisphere in ("N", "E"):
        sign = 1
    return sign * value


def axis_values(segment: str) -> list[float]:
    matches = list(NUMBER_RE.finditer(segment))
    hemispheres = {
        str(match.group(4) or "").upper()
        for match in matches
        if match.group(4)
    }
    shared_hemisphere = next(iter(hemispheres)) if len(hemispheres) == 1 else ""
    values = []
    for match in matches:
        value = coordinate_value(match)
        if not match.group(4) and shared_hemisphere:
            value = abs(value) * (-1 if shared_hemisphere in ("S", "W") else 1)
        values.append(value)
    return values


def labeled_axis_ranges(text: str) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
    matches = list(AXIS_LABEL_RE.finditer(text))
    longitudes: list[tuple[float, float]] = []
    latitudes: list[tuple[float, float]] = []
    for index, match in enumerate(matches):
        label = match.group(0).lower()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        segment = text[match.end():end]
        segment = re.split(r"[;；|\n()]", segment, maxsplit=1)[0]
        values = axis_values(segment)[:2]
        if not values:
            continue
        value_range = (min(values), max(values))
        if "lat" in label or "纬" in label:
            latitudes.append(value_range)
        else:
            longitudes.append(value_range)
    return longitudes, latitudes


def parse_coordinate_extents(text: str) -> list[tuple[str, float, float, float, float]]:
    value = str(text or "").strip()
    if not value:
        return []
    longitudes, latitudes = labeled_axis_ranges(value)
    extents: list[tuple[str, float, float, float, float]] = []
    if longitudes and latitudes:
        pair_count = max(len(longitudes), len(latitudes))
        for index in range(pair_count):
            lon_range = longitudes[min(index, len(longitudes) - 1)]
            lat_range = latitudes[min(index, len(latitudes) - 1)]
            extents.append(("", lon_range[0], lat_range[0], lon_range[1], lat_range[1]))
    else:
        hemisphere_matches = [match for match in NUMBER_RE.finditer(value) if match.group(4)]
        hemispheric = [(coordinate_value(match), (match.group(4) or "").upper()) for match in hemisphere_matches]
        lon_values = [number for number, hemisphere in hemispheric if hemisphere in ("E", "W")]
        lat_values = [number for number, hemisphere in hemispheric if hemisphere in ("N", "S")]
        if lon_values and lat_values:
            axes = ["lon" if hemisphere in ("E", "W") else "lat" for _, hemisphere in hemispheric]
            grouped_range = (
                len(hemispheric) == 4
                and axes in (["lon", "lon", "lat", "lat"], ["lat", "lat", "lon", "lon"])
                and re.search(r"(?:[-–—]|\bto\b|至)", value[hemisphere_matches[0].end():hemisphere_matches[1].start()], re.I)
                and re.search(r"(?:[-–—]|\bto\b|至)", value[hemisphere_matches[2].end():hemisphere_matches[3].start()], re.I)
            )
            if grouped_range and len(lon_values) == 2 and len(lat_values) == 2:
                extents.append(("", min(lon_values), min(lat_values), max(lon_values), max(lat_values)))
            elif len(lon_values) == len(lat_values) and len(lon_values) > 1:
                extents.extend(("point", lon, lat, lon, lat) for lon, lat in zip(lon_values, lat_values))
            else:
                extents.append(("", min(lon_values), min(lat_values), max(lon_values), max(lat_values)))
        else:
            pair = PAIR_RE.search(value)
            if pair:
                lon, lat = float(pair.group(1)), float(pair.group(2))
                extents.append(("point", lon, lat, lon, lat))

    valid: list[tuple[str, float, float, float, float]] = []
    seen: set[tuple[float, float, float, float]] = set()
    for kind, west, south, east, north in extents:
        if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
            continue
        rounded = tuple(round(number, 6) for number in (west, south, east, north))
        if rounded in seen:
            continue
        seen.add(rounded)
        span = max(east - west, north - south)
        valid.append((kind or ("point" if span <= 0.0001 else "bbox"), *rounded))
    return valid


def parse_year_range(value: str) -> tuple[int | None, int | None]:
    years = [int(year) for year in YEAR_RE.findall(str(value or ""))]
    return (min(years), max(years)) if years else (None, None)


def parse_topic_tags(value: str) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    parsed: Any = None
    if text.startswith("["):
        try:
            parsed = ast.literal_eval(text)
        except (ValueError, SyntaxError):
            parsed = None
    values = parsed if isinstance(parsed, (list, tuple, set)) else re.split(r"[,，;；/|]", text)
    topics: list[str] = []
    for value in values:
        topic = str(value or "").strip(" [](){}'\"\t\r\n")[:80]
        if topic and topic.casefold() not in {item.casefold() for item in topics}:
            topics.append(topic)
    return topics


def paper_identity(row: dict[str, str]) -> tuple[str, str, str, int | None]:
    doi = str(row.get("doi") or "").strip()
    title = str(row.get("title") or "").strip()
    source = doi.casefold() or " ".join(title.casefold().split())
    key = hashlib.sha1(source.encode("utf-8")).hexdigest() if source else ""
    years = YEAR_RE.findall(str(row.get("publication_date") or ""))
    publication_year = int(years[0]) if years else None
    return key, title[:1000], doi[:500], publication_year


def dataset_key(row: dict[str, str]) -> str:
    name = " ".join(str(row.get("dataset_name") or "").casefold().split())
    url = str(row.get("dataset_url") or "").strip().casefold().rstrip("/")
    source = f"{name}|{url}" if name or url else str(row.get("id") or "")
    return hashlib.sha1(source.encode("utf-8")).hexdigest()


def normalized_text(value: Any) -> str:
    return " ".join(str(value or "").split())


def scientific_problem_identity(row: dict[str, str]) -> tuple[str, str]:
    problem = normalized_text(row.get("scientific_problem"))
    key = hashlib.sha1(problem.casefold().encode("utf-8")).hexdigest() if problem else ""
    return key, problem


def usage_record_key(
    source_dataset_key: str, paper_key: str, problem_key: str, row: dict[str, str],
) -> str:
    values = [
        source_dataset_key, paper_key, problem_key,
        normalized_text(row.get("paper_use_temporal_range")),
        normalized_text(row.get("paper_use_spatio_region")),
        normalized_text(row.get("paper_use_spatio_coords")),
        normalized_text(row.get("publication_date")),
    ]
    return hashlib.sha1("|".join(values).casefold().encode("utf-8")).hexdigest()


def initialize_database(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=MEMORY;
        CREATE TABLE datasets (
          id INTEGER PRIMARY KEY,
          dataset_key TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          description TEXT NOT NULL,
          temporal_text TEXT NOT NULL,
          region_text TEXT NOT NULL,
          coordinates_text TEXT NOT NULL,
          coordinate_system TEXT NOT NULL,
          topics TEXT NOT NULL,
          start_year INTEGER,
          end_year INTEGER
        );
        CREATE TABLE geometries (
          id INTEGER PRIMARY KEY,
          dataset_id INTEGER NOT NULL,
          kind TEXT NOT NULL,
          west REAL NOT NULL,
          south REAL NOT NULL,
          east REAL NOT NULL,
          north REAL NOT NULL,
          region_code TEXT NOT NULL DEFAULT '',
          UNIQUE(dataset_id, kind, west, south, east, north, region_code)
        );
        CREATE TABLE region_catalog (
          region_code TEXT PRIMARY KEY,
          parent_code TEXT NOT NULL,
          level TEXT NOT NULL,
          name TEXT NOT NULL
        );
        CREATE TABLE region_memberships (
          region_code TEXT NOT NULL,
          dataset_id INTEGER NOT NULL,
          match_kind TEXT NOT NULL,
          PRIMARY KEY(region_code, dataset_id)
        );
        CREATE TABLE dataset_topics (
          dataset_id INTEGER NOT NULL,
          topic TEXT NOT NULL,
          PRIMARY KEY(dataset_id, topic)
        );
        CREATE TABLE dataset_papers (
          dataset_id INTEGER NOT NULL,
          paper_key TEXT NOT NULL,
          title TEXT NOT NULL,
          doi TEXT NOT NULL,
          publication_year INTEGER,
          PRIMARY KEY(dataset_id, paper_key)
        );
        CREATE TABLE scientific_problems (
          problem_key TEXT PRIMARY KEY,
          problem_text TEXT NOT NULL
        );
        CREATE TABLE dataset_problem_links (
          dataset_id INTEGER NOT NULL,
          problem_key TEXT NOT NULL,
          PRIMARY KEY(dataset_id, problem_key)
        );
        CREATE TABLE dataset_usage_records (
          id INTEGER PRIMARY KEY,
          record_key TEXT NOT NULL UNIQUE,
          dataset_id INTEGER NOT NULL,
          paper_key TEXT NOT NULL,
          problem_key TEXT NOT NULL,
          paper_title TEXT NOT NULL,
          doi TEXT NOT NULL,
          publication_year INTEGER,
          publication_date TEXT NOT NULL,
          paper_use_temporal_range TEXT NOT NULL,
          paper_use_spatio_region TEXT NOT NULL,
          paper_use_spatio_coords TEXT NOT NULL
        );
        CREATE TABLE dataset_spatial_profile (
          dataset_id INTEGER PRIMARY KEY,
          spatial_class TEXT NOT NULL
        );
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE VIRTUAL TABLE datasets_fts USING fts5(search_text, content='', tokenize='trigram');
        """
    )


def merge_text(previous: str, incoming: str, limit: int = 12000) -> str:
    incoming = str(incoming or "").strip()
    if not incoming or incoming.casefold() in previous.casefold():
        return previous
    return (previous + " | " + incoming).strip(" |")[:limit]


def build_index(source: Path, output: Path) -> dict[str, int | float]:
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    region_catalog, aliases = load_region_catalog()
    connection = sqlite3.connect(output)
    initialize_database(connection)
    dataset_ids: dict[str, int] = {}
    stats = {
        "rows": 0, "datasets": 0, "coordinate_rows": 0, "coordinate_geometries": 0,
        "region_rows": 0, "region_geometries": 0, "global_rows": 0, "unresolved_rows": 0,
        "non_earth_rows": 0,
    }
    started = time.perf_counter()

    with source.open("r", encoding="utf-8-sig", newline="") as handle, connection:
        reader = csv.DictReader(handle)
        expected = {
            "dataset_name", "dataset_url", "dataset_description", "dataset_spatio_region",
            "dataset_spatio_coords", "dataset_temporal_range", "research_topic_tags",
            "scientific_problem", "title", "doi",
        }
        if not expected.issubset(reader.fieldnames or []):
            raise ValueError("CSV headers do not match the dataset scientific schema")
        for row in reader:
            stats["rows"] += 1
            key = dataset_key(row)
            start_year, end_year = parse_year_range(row.get("dataset_temporal_range", ""))
            if key not in dataset_ids:
                cursor = connection.execute(
                    "INSERT INTO datasets(dataset_key,name,url,description,temporal_text,region_text,coordinates_text,coordinate_system,topics,start_year,end_year) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        key, str(row.get("dataset_name") or "").strip(), str(row.get("dataset_url") or "").strip(),
                        str(row.get("dataset_description") or "").strip(), str(row.get("dataset_temporal_range") or "").strip(),
                        str(row.get("dataset_spatio_region") or "").strip(), str(row.get("dataset_spatio_coords") or "").strip(),
                        str(row.get("coordinate_system") or "").strip(), str(row.get("research_topic_tags") or "").strip(),
                        start_year, end_year,
                    ),
                )
                dataset_ids[key] = int(cursor.lastrowid)
                stats["datasets"] += 1
            else:
                dataset_id = dataset_ids[key]
                previous = connection.execute(
                    "SELECT description,temporal_text,region_text,coordinates_text,coordinate_system,topics,start_year,end_year "
                    "FROM datasets WHERE id=?", (dataset_id,)
                ).fetchone()
                connection.execute(
                    "UPDATE datasets SET description=?,temporal_text=?,region_text=?,coordinates_text=?,coordinate_system=?,"
                    "topics=?,start_year=?,end_year=? WHERE id=?",
                    (
                        merge_text(previous[0], row.get("dataset_description", "")),
                        merge_text(previous[1], row.get("dataset_temporal_range", "")),
                        merge_text(previous[2], row.get("dataset_spatio_region", "")),
                        merge_text(previous[3], row.get("dataset_spatio_coords", "")),
                        merge_text(previous[4], row.get("coordinate_system", "")),
                        merge_text(previous[5], row.get("research_topic_tags", "")),
                        min(value for value in (previous[6], start_year) if value is not None) if previous[6] is not None or start_year is not None else None,
                        max(value for value in (previous[7], end_year) if value is not None) if previous[7] is not None or end_year is not None else None,
                        dataset_id,
                    ),
                )
            dataset_id = dataset_ids[key]
            for topic in parse_topic_tags(row.get("research_topic_tags", "")):
                connection.execute(
                    "INSERT OR IGNORE INTO dataset_topics(dataset_id,topic) VALUES(?,?)",
                    (dataset_id, topic),
                )
            paper_key, paper_title, paper_doi, publication_year = paper_identity(row)
            if paper_key:
                connection.execute(
                    "INSERT OR IGNORE INTO dataset_papers(dataset_id,paper_key,title,doi,publication_year) "
                    "VALUES(?,?,?,?,?)",
                    (dataset_id, paper_key, paper_title, paper_doi, publication_year),
                )
            problem_key, problem_text = scientific_problem_identity(row)
            if problem_key:
                connection.execute(
                    "INSERT OR IGNORE INTO scientific_problems(problem_key,problem_text) VALUES(?,?)",
                    (problem_key, problem_text),
                )
                connection.execute(
                    "INSERT OR IGNORE INTO dataset_problem_links(dataset_id,problem_key) VALUES(?,?)",
                    (dataset_id, problem_key),
                )
            connection.execute(
                "INSERT OR IGNORE INTO dataset_usage_records("
                "record_key,dataset_id,paper_key,problem_key,paper_title,doi,publication_year,"
                "publication_date,paper_use_temporal_range,paper_use_spatio_region,paper_use_spatio_coords"
                ") VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (
                    usage_record_key(key, paper_key, problem_key, row), dataset_id, paper_key, problem_key,
                    paper_title, paper_doi, publication_year,
                    str(row.get("publication_date") or "").strip(),
                    str(row.get("paper_use_temporal_range") or "").strip(),
                    str(row.get("paper_use_spatio_region") or "").strip(),
                    str(row.get("paper_use_spatio_coords") or "").strip(),
                ),
            )
            coordinate_system = str(row.get("coordinate_system") or "")
            region_text = str(row.get("dataset_spatio_region") or "")
            if NON_EARTH_RE.search(coordinate_system + " " + region_text):
                stats["non_earth_rows"] += 1
                continue

            if GLOBAL_RE.search(region_text):
                stats["region_rows"] += 1
                stats["global_rows"] += 1
                before = connection.total_changes
                connection.execute(
                    "INSERT OR IGNORE INTO geometries(dataset_id,kind,west,south,east,north,region_code) VALUES(?,'global',-180,-90,180,90,'GLOBAL')",
                    (dataset_id,),
                )
                stats["region_geometries"] += connection.total_changes - before
                continue

            extents = parse_coordinate_extents(row.get("dataset_spatio_coords", ""))
            if extents:
                stats["coordinate_rows"] += 1
                for kind, west, south, east, north in extents:
                    before = connection.total_changes
                    connection.execute(
                        "INSERT OR IGNORE INTO geometries(dataset_id,kind,west,south,east,north,region_code) VALUES(?,?,?,?,?,?, '')",
                        (dataset_id, kind, west, south, east, north),
                    )
                    stats["coordinate_geometries"] += connection.total_changes - before
                continue

            region_codes = resolve_regions(region_text, aliases)
            if not region_codes:
                stats["unresolved_rows"] += 1
                continue
            stats["region_rows"] += 1
            for code in region_codes:
                geometry = ("region", *region_catalog[code]["bounds"], code)
                before = connection.total_changes
                connection.execute(
                    "INSERT OR IGNORE INTO geometries(dataset_id,kind,west,south,east,north,region_code) VALUES(?,?,?,?,?,?,?)",
                    (dataset_id, *geometry),
                )
                stats["region_geometries"] += connection.total_changes - before

            if stats["rows"] % 10000 == 0:
                print(f"Indexed {stats['rows']:,} rows...")

        connection.executemany(
            "INSERT INTO region_catalog(region_code,parent_code,level,name) VALUES(?,?,?,?)",
            [
                (code, region["parent_code"], region["level"], region["name"])
                for code, region in region_catalog.items()
            ],
        )

        membership_rows: dict[tuple[str, int], str] = {}

        def add_membership(code: str, dataset_id: int, kind: str) -> None:
            if code not in region_catalog:
                return
            membership_rows.setdefault((code, dataset_id), kind)
            for ancestor in ancestor_codes(code, region_catalog):
                if ancestor in region_catalog:
                    membership_rows.setdefault((ancestor, dataset_id), "ancestor")

        global_dataset_ids = {
            int(row[0]) for row in connection.execute(
                "SELECT DISTINCT dataset_id FROM geometries WHERE kind='global' "
                "OR (kind='bbox' AND east-west>=300 AND north-south>=140)"
            )
        }
        coordinate_rows = connection.execute(
            "SELECT dataset_id,kind,west,south,east,north,region_code FROM geometries WHERE kind!='global'"
        ).fetchall()
        regions_by_level = {
            level: [region for region in region_catalog.values() if region["level"] == level]
            for level in MEMBERSHIP_MAX_SPAN
        }
        for dataset_id, kind, west, south, east, north, region_code in coordinate_rows:
            if int(dataset_id) in global_dataset_ids:
                continue
            if kind == "region":
                add_membership(str(region_code), int(dataset_id), "name")
                continue
            geometry_extent = (float(west), float(south), float(east), float(north))
            if kind == "point":
                longitude = (float(west) + float(east)) * 0.5
                latitude = (float(south) + float(north)) * 0.5
                for regions in regions_by_level.values():
                    for region in regions:
                        if point_in_region(longitude, latitude, region):
                            add_membership(region["code"], int(dataset_id), "point")
                continue
            maximum_span = max(float(east) - float(west), float(north) - float(south))
            for level, maximum_allowed in MEMBERSHIP_MAX_SPAN.items():
                if maximum_span > maximum_allowed:
                    continue
                for region in regions_by_level[level]:
                    if bounds_intersect(geometry_extent, region["bounds"]):
                        add_membership(region["code"], int(dataset_id), "bbox")

        connection.executemany(
            "INSERT INTO region_memberships(region_code,dataset_id,match_kind) VALUES(?,?,?)",
            [(code, dataset_id, kind) for (code, dataset_id), kind in membership_rows.items()],
        )
        stats["region_memberships"] = len(membership_rows)
        stats["regions"] = len(region_catalog)
        connection.execute(
            "INSERT INTO dataset_spatial_profile(dataset_id,spatial_class) "
            "SELECT d.id,CASE "
            "WHEN MAX(CASE WHEN g.kind='global' THEN 1 ELSE 0 END)=1 THEN 'global' "
            "WHEN MAX(CASE WHEN g.kind='bbox' THEN 1 ELSE 0 END)=1 THEN 'bbox' "
            "WHEN MAX(CASE WHEN g.kind='point' THEN 1 ELSE 0 END)=1 THEN 'point' "
            "WHEN MAX(CASE WHEN g.kind='region' THEN 1 ELSE 0 END)=1 THEN 'region' "
            "ELSE 'unlocated' END "
            "FROM datasets d LEFT JOIN geometries g ON g.dataset_id=d.id GROUP BY d.id"
        )
        stats["topic_links"] = int(connection.execute("SELECT COUNT(*) FROM dataset_topics").fetchone()[0])
        stats["paper_links"] = int(connection.execute("SELECT COUNT(*) FROM dataset_papers").fetchone()[0])
        stats["scientific_problems"] = int(connection.execute("SELECT COUNT(*) FROM scientific_problems").fetchone()[0])
        stats["problem_links"] = int(connection.execute("SELECT COUNT(*) FROM dataset_problem_links").fetchone()[0])
        stats["usage_records"] = int(connection.execute("SELECT COUNT(*) FROM dataset_usage_records").fetchone()[0])

        connection.executemany(
            "INSERT INTO metadata(key,value) VALUES(?,?)",
            [(key, str(value)) for key, value in stats.items()],
        )
        connection.execute("CREATE INDEX geometries_bounds_idx ON geometries(west,east,south,north)")
        connection.execute("CREATE INDEX geometries_east_bounds_idx ON geometries(east,west,south,north)")
        connection.execute("CREATE INDEX geometries_dataset_idx ON geometries(dataset_id)")
        connection.execute("CREATE INDEX region_memberships_region_idx ON region_memberships(region_code)")
        connection.execute("CREATE INDEX region_memberships_dataset_idx ON region_memberships(dataset_id)")
        connection.execute("CREATE INDEX dataset_topics_topic_idx ON dataset_topics(topic)")
        connection.execute("CREATE INDEX dataset_papers_key_idx ON dataset_papers(paper_key)")
        connection.execute("CREATE INDEX dataset_papers_year_idx ON dataset_papers(publication_year)")
        connection.execute("CREATE INDEX dataset_problem_links_problem_idx ON dataset_problem_links(problem_key)")
        connection.execute("CREATE INDEX dataset_usage_dataset_idx ON dataset_usage_records(dataset_id)")
        connection.execute("CREATE INDEX dataset_usage_paper_idx ON dataset_usage_records(paper_key)")
        connection.execute("CREATE INDEX dataset_spatial_class_idx ON dataset_spatial_profile(spatial_class)")
        connection.execute("CREATE INDEX datasets_time_idx ON datasets(start_year,end_year)")
        connection.execute(
            "INSERT INTO datasets_fts(rowid, search_text) "
            "SELECT id, lower(name || ' ' || description || ' ' || region_text || ' ' || topics) "
            "FROM datasets"
        )
        connection.execute("ANALYZE")
    connection.execute("VACUUM")
    connection.close()
    stats["seconds"] = round(time.perf_counter() - started, 3)
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    stats = build_index(args.source.resolve(), args.output.resolve())
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
