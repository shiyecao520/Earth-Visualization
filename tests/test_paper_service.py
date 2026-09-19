import sqlite3
import unittest

from heatmap_service import BOUNDARIES, _point_in_geometry, _point_in_ring, circle_polygon
from paper_service import DATABASE_PATH, SERVICE, _great_circle_distance_km


class PaperServiceTests(unittest.TestCase):
    def test_global_total_matches_index_and_includes_unmapped_papers(self) -> None:
        connection = sqlite3.connect(DATABASE_PATH)
        indexed_total = int(connection.execute("SELECT COUNT(*) FROM papers").fetchone()[0])
        mapped_total = int(connection.execute(
            "SELECT COUNT(DISTINCT paper_id) FROM paper_region_memberships"
        ).fetchone()[0])
        connection.close()

        counts = SERVICE.region_counts(["WORLD"], {})
        self.assertEqual(counts["WORLD"], indexed_total)
        self.assertGreater(indexed_total, mapped_total)

    def test_city_papers_are_real_points_inside_the_city(self) -> None:
        result = SERVICE.region_papers("330100", {}, limit=20)
        self.assertGreater(result["total"], 0)
        self.assertTrue(result["papers"])
        for paper in result["papers"]:
            self.assertEqual(paper["coverage"][0]["kind"], "point")
            self.assertTrue(
                _point_in_geometry(paper["longitude"], paper["latitude"], BOUNDARIES["330100"])
            )
            self.assertTrue(paper["locationId"])

    def test_city_paper_locations_preserve_exact_coordinate_counts(self) -> None:
        result = SERVICE.region_papers("330100", {}, limit=1000)

        self.assertGreater(result["total"], 0)
        self.assertLess(len(result["locations"]), result["total"])
        self.assertEqual(sum(location["count"] for location in result["locations"]), result["total"])
        self.assertEqual(
            {paper["locationId"] for paper in result["papers"]},
            {location["id"] for location in result["locations"]},
        )
        self.assertTrue(any(location["count"] > 1 for location in result["locations"]))

    def test_region_papers_location_limit_caps_locations_but_keeps_totals(self) -> None:
        full = SERVICE.region_papers("WORLD", {}, limit=5)
        capped = SERVICE.region_papers("WORLD", {}, limit=5, location_limit=200)

        self.assertGreater(full["locationTotal"], 200)
        self.assertEqual(capped["locationTotal"], full["locationTotal"])
        self.assertEqual(capped["total"], full["total"])
        self.assertEqual(len(capped["locations"]), 200)
        # 按 count 排序截取：最靠前的点位应保留且 counts 单调不增
        counts = [location["count"] for location in capped["locations"]]
        self.assertEqual(counts, sorted(counts, reverse=True))

    def test_region_papers_location_limit_does_not_affect_paper_list(self) -> None:
        default = SERVICE.region_papers("330100", {}, limit=50)
        capped = SERVICE.region_papers("330100", {}, limit=50, location_limit=5)

        self.assertEqual(len(default["papers"]), 50)
        self.assertEqual(len(capped["papers"]), 50)
        self.assertEqual(len(capped["locations"]), 5)
        self.assertEqual(capped["locationTotal"], len(default["locations"]))

    def test_paper_detail_exposes_display_fields_without_source_paths(self) -> None:
        paper = SERVICE.region_papers("330100", {}, limit=1)["papers"][0]
        detail = SERVICE.paper_detail(paper["id"])
        self.assertTrue(detail["title"])
        self.assertIn("authors", detail)
        self.assertIn("mainFindings", detail)
        self.assertNotIn("filePath", detail)

    def test_subject_filter_changes_paper_counts_and_topics(self) -> None:
        params = {"paper_theme": "Earth Sciences"}
        counts = SERVICE.region_counts(["WORLD", "CHN"], params)
        statistics = SERVICE.region_statistics("WORLD", params)

        self.assertEqual(counts["WORLD"], 36695)
        self.assertLessEqual(counts["CHN"], counts["WORLD"])
        self.assertEqual(statistics["topics"], [{"name": "Earth Sciences", "count": 36695}])

    def test_unlocated_filter_keeps_papers_out_of_regional_counts(self) -> None:
        options = SERVICE.filter_options()["spatial"]
        counts = SERVICE.region_counts(
            ["WORLD", "CHN", "330000", "330100"],
            {"paper_spatial_availability": "missing"},
        )

        self.assertEqual(counts["WORLD"], options["missing"])
        self.assertGreater(counts["WORLD"], 0)
        self.assertEqual(counts["CHN"], 0)
        self.assertEqual(counts["330000"], 0)
        self.assertEqual(counts["330100"], 0)

    def test_region_papers_expose_publication_year_extent(self) -> None:
        result = SERVICE.region_papers("330100", {}, limit=1)
        connection = sqlite3.connect(DATABASE_PATH)
        expected = connection.execute(
            "SELECT MIN(p.publication_year),MAX(p.publication_year) "
            "FROM papers p JOIN paper_region_memberships prm ON prm.paper_id=p.id "
            "WHERE prm.region_code=?",
            ("330100",),
        ).fetchone()
        connection.close()

        self.assertEqual(result["paper_year_start"], expected[0])
        self.assertEqual(result["paper_year_end"], expected[1])
        self.assertLessEqual(result["paper_year_start"], result["paper_year_end"])

    def test_bounds_papers_expose_publication_year_extent(self) -> None:
        bounds = [119.0, 29.0, 121.0, 31.0]
        result = SERVICE.bounds_papers(bounds, {}, limit=1)
        connection = sqlite3.connect(DATABASE_PATH)
        expected = connection.execute(
            "SELECT MIN(publication_year),MAX(publication_year) FROM papers "
            "WHERE longitude IS NOT NULL AND latitude IS NOT NULL "
            "AND longitude>=? AND longitude<=? AND latitude>=? AND latitude<=?",
            (bounds[0], bounds[2], bounds[1], bounds[3]),
        ).fetchone()
        connection.close()

        self.assertEqual(result["paper_year_start"], expected[0])
        self.assertEqual(result["paper_year_end"], expected[1])

    def test_bounds_papers_are_strictly_inside_selection(self) -> None:
        bounds = [119.0, 29.0, 121.0, 31.0]
        result = SERVICE.bounds_papers(bounds, {}, limit=100)

        self.assertGreater(result["total"], 0)
        self.assertTrue(result["papers"])
        for paper in result["papers"]:
            self.assertGreaterEqual(paper["longitude"], bounds[0])
            self.assertLessEqual(paper["longitude"], bounds[2])
            self.assertGreaterEqual(paper["latitude"], bounds[1])
            self.assertLessEqual(paper["latitude"], bounds[3])
            self.assertEqual(paper["coverage"][0]["kind"], "point")

    def test_circle_papers_are_strictly_inside_the_circle(self) -> None:
        _, bounds = circle_polygon(120.2, 30.25, 25)
        result = SERVICE.bounds_papers(bounds, {}, limit=100, circle=(120.2, 30.25, 25))

        self.assertGreater(result["total"], 0)
        for paper in result["papers"]:
            self.assertLessEqual(
                _great_circle_distance_km(120.2, 30.25, paper["longitude"], paper["latitude"]),
                25,
            )

    def test_freehand_papers_are_strictly_inside_the_polygon(self) -> None:
        polygon = [[119.8, 30.0], [120.6, 30.0], [120.45, 30.55], [119.9, 30.4]]
        result = SERVICE.bounds_papers(
            [119.8, 30.0, 120.6, 30.55], {}, limit=100, polygon=polygon,
        )

        self.assertGreater(result["total"], 0)
        for paper in result["papers"]:
            self.assertTrue(_point_in_ring(paper["longitude"], paper["latitude"], polygon))

    def test_bounds_papers_respect_theme_and_publication_filters(self) -> None:
        params = {
            "paper_theme": "Earth Sciences",
            "publication_start_year": 2020,
            "publication_end_year": 2020,
        }
        result = SERVICE.bounds_papers([-180, -90, 180, 90], params, limit=100)

        self.assertGreater(result["total"], 0)
        self.assertTrue(result["papers"])
        self.assertTrue(all(paper["publicationYear"] == 2020 for paper in result["papers"]))
        self.assertEqual(result["topics"][0]["name"], "Earth Sciences")

    def test_distribution_preserves_all_located_papers(self) -> None:
        connection = sqlite3.connect(DATABASE_PATH)
        located = int(connection.execute(
            "SELECT COUNT(*) FROM papers WHERE longitude IS NOT NULL AND latitude IS NOT NULL"
        ).fetchone()[0])
        connection.close()

        result = SERVICE.paper_distribution([-180, -90, 180, 90], {}, cell_size=4)
        self.assertEqual(result["total_papers"], located)
        self.assertEqual(sum(cell["count"] for cell in result["cells"]), located)
        self.assertLess(result["cell_count"], 2000)
        self.assertGreater(result["quantiles"]["p99"], result["quantiles"]["p50"])

    def test_distribution_respects_paper_filters(self) -> None:
        params = {
            "paper_theme": "Earth Sciences",
            "publication_start_year": 2020,
            "publication_end_year": 2020,
        }
        result = SERVICE.paper_distribution([-180, -90, 180, 90], params, cell_size=4)
        expected = SERVICE.bounds_papers([-180, -90, 180, 90], params, limit=1)["total"]
        self.assertEqual(result["total_papers"], expected)

    def test_distribution_respects_administrative_region(self) -> None:
        result = SERVICE.paper_distribution(
            [-180, -90, 180, 90], {}, cell_size=1, region_code="CHN",
        )
        expected = SERVICE.region_counts(["CHN"], {})["CHN"]
        self.assertEqual(result["total_papers"], expected)


if __name__ == "__main__":
    unittest.main()
