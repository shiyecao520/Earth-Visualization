#!/usr/bin/env python3
"""Build the runtime point index for the independent scientific-paper CSV."""

from __future__ import annotations

import argparse
import csv
import json
import math
import sqlite3
import time
from pathlib import Path
from typing import Any

from build_heat_index import ancestor_codes, load_region_catalog, point_in_region


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "data/source/papers_converted_point.csv"
DEFAULT_OUTPUT = ROOT / "data/generated/paper_points.sqlite"
MIN_PUBLICATION_YEAR = 1800
MAX_PUBLICATION_YEAR = 2100


def compact_text(value: Any, limit: int = 16000) -> str:
    return " ".join(str(value or "").split())[:limit]


def parse_float(value: Any) -> float | None:
    try:
        parsed = float(str(value or "").strip())
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def parse_publication_year(value: Any) -> int | None:
    try:
        year = int(float(str(value or "").strip()))
    except (TypeError, ValueError):
        return None
    return year if MIN_PUBLICATION_YEAR <= year <= MAX_PUBLICATION_YEAR else None


def initialize_database(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=MEMORY;
        CREATE TABLE papers (
          id INTEGER PRIMARY KEY,
          paper_key TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          study_object TEXT NOT NULL,
          authors TEXT NOT NULL,
          affiliation TEXT NOT NULL,
          publication_year INTEGER,
          keywords TEXT NOT NULL,
          time_theme TEXT NOT NULL,
          study_area TEXT NOT NULL,
          coordinate_text TEXT NOT NULL,
          data_sources TEXT NOT NULL,
          sample_types TEXT NOT NULL,
          analytical_techniques TEXT NOT NULL,
          research_methodology TEXT NOT NULL,
          main_findings TEXT NOT NULL,
          subject TEXT NOT NULL,
          longitude REAL,
          latitude REAL
        );
        CREATE TABLE paper_region_memberships (
          region_code TEXT NOT NULL,
          paper_id INTEGER NOT NULL,
          PRIMARY KEY(region_code, paper_id)
        );
        CREATE TABLE paper_topics (
          paper_id INTEGER NOT NULL,
          topic TEXT NOT NULL,
          PRIMARY KEY(paper_id, topic)
        );
        CREATE TABLE region_catalog (
          region_code TEXT PRIMARY KEY,
          parent_code TEXT NOT NULL,
          level TEXT NOT NULL,
          name TEXT NOT NULL
        );
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE VIRTUAL TABLE papers_fts USING fts5(search_text, content='', tokenize='trigram');
        """
    )


def paper_key(row: dict[str, str], row_number: int) -> str:
    for field in ("unique_id", "paper_id", "ID", "id_orig"):
        value = str(row.get(field) or "").strip()
        if value:
            return f"{field}:{value}"
    return f"row:{row_number}"


def build_index(source: Path, output: Path) -> dict[str, int | float]:
    if not source.is_file():
        raise FileNotFoundError(f"Paper CSV not found: {source}")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = output.with_suffix(output.suffix + ".building")
    if temporary_output.exists():
        temporary_output.unlink()

    region_catalog, _ = load_region_catalog()
    regions_by_level = {
        level: [region for region in region_catalog.values() if region["level"] == level]
        for level in ("country", "province", "city")
    }
    connection = sqlite3.connect(temporary_output)
    initialize_database(connection)
    memberships: set[tuple[str, int]] = set()
    stats: dict[str, int | float] = {
        "rows": 0,
        "papers": 0,
        "located_papers": 0,
        "unlocated_papers": 0,
        "invalid_publication_years": 0,
    }
    started = time.perf_counter()

    # The source is predominantly GB18030; replacement is limited to a few malformed bytes.
    with source.open("r", encoding="gb18030", errors="replace", newline="") as handle, connection:
        reader = csv.DictReader(handle)
        expected = {
            "title", "authors", "publication_year", "keywords", "first_category",
            "lng_new", "lat_new", "unique_id",
        }
        if not expected.issubset(reader.fieldnames or []):
            raise ValueError("CSV headers do not match the scientific-paper schema")

        for row_number, row in enumerate(reader, start=1):
            stats["rows"] += 1
            longitude = parse_float(row.get("lng_new"))
            latitude = parse_float(row.get("lat_new"))
            if longitude is None or latitude is None or not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
                longitude = None
                latitude = None
            year = parse_publication_year(row.get("publication_year"))
            if str(row.get("publication_year") or "").strip() and year is None:
                stats["invalid_publication_years"] += 1

            cursor = connection.execute(
                "INSERT INTO papers(paper_key,title,study_object,authors,affiliation,publication_year,"
                "keywords,time_theme,study_area,coordinate_text,data_sources,sample_types,"
                "analytical_techniques,research_methodology,main_findings,subject,longitude,latitude) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    paper_key(row, row_number), compact_text(row.get("title"), 2000) or "Untitled paper",
                    compact_text(row.get("study_object")), compact_text(row.get("authors")),
                    compact_text(row.get("affiliation")), year, compact_text(row.get("keywords")),
                    compact_text(row.get("time_theme")), compact_text(row.get("study_area")),
                    compact_text(row.get("coordinate")), compact_text(row.get("data_sources")),
                    compact_text(row.get("sample_types")), compact_text(row.get("analytical_techniques")),
                    compact_text(row.get("research_methodology")), compact_text(row.get("main_findings")),
                    compact_text(row.get("first_category"), 160), longitude, latitude,
                ),
            )
            current_id = int(cursor.lastrowid)
            stats["papers"] += 1
            subject = compact_text(row.get("first_category"), 160)
            if subject:
                connection.execute(
                    "INSERT OR IGNORE INTO paper_topics(paper_id,topic) VALUES(?,?)",
                    (current_id, subject),
                )

            if longitude is None or latitude is None:
                stats["unlocated_papers"] += 1
            else:
                stats["located_papers"] += 1
                matched_codes: set[str] = set()
                for regions in regions_by_level.values():
                    for region in regions:
                        if point_in_region(longitude, latitude, region):
                            matched_codes.add(str(region["code"]))
                            matched_codes.update(ancestor_codes(str(region["code"]), region_catalog))
                memberships.update((code, current_id) for code in matched_codes if code in region_catalog)

            if row_number % 10000 == 0:
                print(f"Indexed {row_number:,} papers...")

        connection.executemany(
            "INSERT INTO region_catalog(region_code,parent_code,level,name) VALUES(?,?,?,?)",
            [
                (code, str(region["parent_code"]), str(region["level"]), str(region["name"]))
                for code, region in region_catalog.items()
            ],
        )
        connection.executemany(
            "INSERT INTO paper_region_memberships(region_code,paper_id) VALUES(?,?)",
            sorted(memberships),
        )
        stats["region_memberships"] = len(memberships)
        stats["regions"] = len(region_catalog)
        connection.executemany(
            "INSERT INTO metadata(key,value) VALUES(?,?)",
            [(key, str(value)) for key, value in stats.items()],
        )
        connection.execute("CREATE INDEX paper_region_code_idx ON paper_region_memberships(region_code)")
        connection.execute("CREATE INDEX paper_region_paper_idx ON paper_region_memberships(paper_id)")
        connection.execute("CREATE INDEX paper_topics_topic_idx ON paper_topics(topic)")
        connection.execute("CREATE INDEX papers_publication_year_idx ON papers(publication_year)")
        connection.execute(
            "INSERT INTO papers_fts(rowid, search_text) "
            "SELECT id, lower(title || ' ' || study_object || ' ' || keywords || ' ' || "
            "study_area || ' ' || subject || ' ' || main_findings || ' ' || data_sources || ' ' || "
            "sample_types || ' ' || analytical_techniques) FROM papers"
        )
        connection.execute("ANALYZE")

    connection.execute("VACUUM")
    connection.close()
    temporary_output.replace(output)
    stats["seconds"] = round(time.perf_counter() - started, 3)
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    print(json.dumps(build_index(args.source.resolve(), args.output.resolve()), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
