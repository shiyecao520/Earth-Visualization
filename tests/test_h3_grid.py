import unittest

from heatmap_service import (
    H3_POINT_QUERY_MAX_BBOX_SPAN,
    SERVICE as HEATMAP_SERVICE,
    _h3_resolution_for_view,
    _h3_count_visual_ratios,
    h3,
)
from paper_service import SERVICE as PAPER_SERVICE
from merged_dataset_service import SERVICE as MERGED_DATASET_SERVICE


@unittest.skipIf(h3 is None, "h3 dependency is not installed")
class H3GridTests(unittest.TestCase):
    def test_resolution_adapts_from_global_to_local_view(self) -> None:
        self.assertEqual(_h3_resolution_for_view("country", [-180, -90, 180, 90]), 4)
        self.assertEqual(_h3_resolution_for_view("province", [70.5, 0.8, 138.1, 56.6]), 5)
        self.assertEqual(_h3_resolution_for_view("city", [96.65, 25.34, 109.25, 35.02]), 7)
        self.assertEqual(_h3_resolution_for_view("city", [116.0, 39.0, 117.2, 40.0]), 7)
        self.assertEqual(_h3_resolution_for_view("city", [103.71, 31.55, 104.48, 31.94]), 8)
        self.assertEqual(_h3_resolution_for_view("city", [116.39, 39.9, 116.41, 39.92]), 10)
        self.assertEqual(_h3_resolution_for_view("city", [116.397, 39.907, 116.4, 39.91]), 11)

    def test_city_grid_count_levels_are_visually_separated(self) -> None:
        cells = {"a": 1, "b": 1, "c": 2, "d": 3, "e": 4, "f": 5}
        ratios = _h3_count_visual_ratios(cells)
        self.assertEqual(ratios["a"], ratios["b"])
        self.assertLess(ratios["a"], ratios["c"])
        self.assertLess(ratios["c"], ratios["d"])
        self.assertLess(ratios["d"], ratios["e"])
        self.assertLess(ratios["e"], ratios["f"])
        # 1—5 条数据应覆盖低、中、高色带，而不是全部压在暖色区间。
        self.assertAlmostEqual(ratios["a"], 0.08)
        self.assertAlmostEqual(ratios["c"], 0.31)
        self.assertAlmostEqual(ratios["e"], 0.77)
        self.assertAlmostEqual(ratios["f"], 1.0)

    def test_h3_cell_query_uses_true_hexagon_for_papers(self) -> None:
        cell = HEATMAP_SERVICE.h3_cell(116.397, 39.908, 8)
        result = PAPER_SERVICE.bounds_papers(
            cell["bounds"], {}, limit=100, polygon=cell["boundary"],
        )
        for paper in result["papers"]:
            paper_cell = h3.latlng_to_cell(paper["latitude"], paper["longitude"], 8)
            self.assertEqual(paper_cell, cell["cell"])

    def test_h3_cell_metadata_is_complete(self) -> None:
        cell = HEATMAP_SERVICE.h3_cell(116.397, 39.908, 8)
        self.assertEqual(cell["resolution"], 8)
        self.assertEqual(len(cell["boundary"]), 6)
        self.assertGreater(cell["area_km2"], 0.4)
        self.assertLess(cell["area_km2"], 1.0)
        fine_cell = HEATMAP_SERVICE.h3_cell(116.397, 39.908, 11)
        self.assertEqual(fine_cell["resolution"], 11)
        self.assertGreater(fine_cell["area_km2"], 0.001)
        self.assertLess(fine_cell["area_km2"], 0.004)

    def test_h3_cell_counts_match_point_query_totals(self) -> None:
        bounds = [116.39, 39.90, 116.41, 39.92]
        resolution = _h3_resolution_for_view("city", bounds)
        query_params = HEATMAP_SERVICE._normalize_filter_params({})
        query_params["bounds"] = bounds
        geometries = HEATMAP_SERVICE._query_geometries(query_params)[0]
        if MERGED_DATASET_SERVICE.available():
            geometries.extend(MERGED_DATASET_SERVICE.coordinate_geometries(query_params, bounds))
        counts = HEATMAP_SERVICE._h3_present_cells(
            {"bounds": bounds}, resolution, geometries,
        )
        self.assertTrue(counts)
        checked = 0
        for cell, expected_total in counts.items():
            latitude, longitude = h3.cell_to_latlng(cell)
            cell_details = HEATMAP_SERVICE.h3_cell(longitude, latitude, resolution)
            result = HEATMAP_SERVICE.bounds_datasets(
                cell_details["bounds"], {}, limit=100,
                polygon=cell_details["boundary"], local_focus=True,
                max_bbox_span=H3_POINT_QUERY_MAX_BBOX_SPAN,
            )
            if MERGED_DATASET_SERVICE.available():
                merged_result = MERGED_DATASET_SERVICE.bounds_datasets(
                    cell_details["bounds"], {}, limit=100,
                    polygon=cell_details["boundary"], local_focus=True,
                    max_bbox_span=H3_POINT_QUERY_MAX_BBOX_SPAN,
                )
                result["total"] += merged_result["total"]
            self.assertEqual(result["total"], expected_total)
            checked += 1
            if checked >= 5:
                break


if __name__ == "__main__":
    unittest.main()
