import unittest

from server import public_static_path_allowed, spatial_selection_geometry


class PublicStaticAccessTests(unittest.TestCase):
    def test_browser_assets_are_public(self) -> None:
        self.assertTrue(public_static_path_allowed("/"))
        self.assertTrue(public_static_path_allowed("/index.html?v=1"))
        self.assertTrue(public_static_path_allowed("/css/style.css"))
        self.assertTrue(public_static_path_allowed("/js/admin-explorer.js"))
        self.assertTrue(public_static_path_allowed("/assets/dataset-map-thumbnail.png"))
        self.assertTrue(public_static_path_allowed("/data/boundaries/countries.geojson"))
        self.assertTrue(public_static_path_allowed("/node_modules/cesium/Build/Cesium/Cesium.js"))

    def test_internal_project_files_are_private(self) -> None:
        self.assertFalse(public_static_path_allowed("/server.py"))
        self.assertFalse(public_static_path_allowed("/README.md"))
        self.assertFalse(public_static_path_allowed("/data/generated/dataset_heat.sqlite"))
        self.assertFalse(public_static_path_allowed("/scripts/build_heat_index.py"))
        self.assertFalse(public_static_path_allowed("/tests/test_bounds_datasets.py"))
        self.assertFalse(public_static_path_allowed("/assets/"))
        self.assertFalse(public_static_path_allowed("/assets/%2e%2e/server.py"))

    def test_freehand_polygon_query_is_validated_and_bounded(self) -> None:
        bounds, polygon, circle = spatial_selection_geometry({
            "polygon": ["119.8,30;120.6,30;120.45,30.55;119.9,30.4;119.8,30"],
        })

        self.assertEqual(bounds, [119.8, 30.0, 120.6, 30.55])
        self.assertEqual(len(polygon or []), 4)
        self.assertIsNone(circle)


if __name__ == "__main__":
    unittest.main()
