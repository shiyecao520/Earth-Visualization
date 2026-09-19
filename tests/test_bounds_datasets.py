import unittest

from heatmap_service import BOUNDARIES, SERVICE, _rectangle_intersects_rings, circle_polygon


class BoundsDatasetTests(unittest.TestCase):
    bounds = [110.8, 26.7, 115.5, 30.3]

    def test_region_bbox_does_not_create_false_polygon_intersection(self) -> None:
        self.assertFalse(
            _rectangle_intersects_rings(tuple(self.bounds), BOUNDARIES["340000"])
        )

    def test_returned_coverages_stay_inside_selection(self) -> None:
        result = SERVICE.bounds_datasets(self.bounds, {}, limit=100)
        self.assertGreater(result["total"], 0)
        self.assertEqual(len(result["datasets"]), 100)
        west, south, east, north = self.bounds
        for dataset in result["datasets"]:
            self.assertTrue(dataset["coverage"])
            for coverage in dataset["coverage"]:
                if coverage["kind"] == "point":
                    longitude = (coverage["west"] + coverage["east"]) * 0.5
                    latitude = (coverage["south"] + coverage["north"]) * 0.5
                    self.assertLessEqual(west, longitude)
                    self.assertLessEqual(longitude, east)
                    self.assertLessEqual(south, latitude)
                    self.assertLessEqual(latitude, north)
                else:
                    self.assertLessEqual(west, coverage["west"])
                    self.assertLessEqual(coverage["west"], coverage["east"])
                    self.assertLessEqual(coverage["east"], east)
                    self.assertLessEqual(south, coverage["south"])
                    self.assertLessEqual(coverage["south"], coverage["north"])
                    self.assertLessEqual(coverage["north"], north)

    def test_bounds_datasets_expose_temporal_extent(self) -> None:
        result = SERVICE.bounds_datasets(self.bounds, {}, limit=1)

        self.assertIsNotNone(result["dataset_year_start"])
        self.assertIsNotNone(result["dataset_year_end"])
        self.assertLessEqual(result["dataset_year_start"], result["dataset_year_end"])

    def test_circle_query_reduces_the_bounding_box_results(self) -> None:
        _, bounds = circle_polygon(120.2, 30.25, 12)
        rectangle = SERVICE.bounds_datasets(bounds, {}, limit=100)
        circle = SERVICE.bounds_datasets(bounds, {}, limit=100, circle=(120.2, 30.25, 12))

        self.assertGreater(circle["total"], 0)
        self.assertLessEqual(circle["total"], rectangle["total"])

    def test_freehand_polygon_reduces_the_bounding_box_results(self) -> None:
        polygon = [[119.8, 30.0], [120.6, 30.0], [120.45, 30.55], [119.9, 30.4]]
        bounds = [119.8, 30.0, 120.6, 30.55]
        rectangle = SERVICE.bounds_datasets(bounds, {}, limit=100)
        freehand = SERVICE.bounds_datasets(bounds, {}, limit=100, polygon=polygon)

        self.assertGreater(freehand["total"], 0)
        self.assertLessEqual(freehand["total"], rectangle["total"])


if __name__ == "__main__":
    unittest.main()
