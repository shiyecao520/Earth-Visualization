import unittest

from scripts.build_heat_index import parse_coordinate_extents


class CoordinateParserTests(unittest.TestCase):
    def test_shared_south_west_suffix_applies_to_full_range(self) -> None:
        value = "Latitude: ~12.5588°–13.1926° S, Longitude: ~70.0993°–71.5880° W"
        self.assertEqual(
            parse_coordinate_extents(value),
            [("bbox", -71.588, -13.1926, -70.0993, -12.5588)],
        )

    def test_unlabelled_dms_ranges_form_one_bbox(self) -> None:
        value = "111°53′E–114°15′E, 27°51′N–28°41′N"
        self.assertEqual(
            parse_coordinate_extents(value),
            [("bbox", 111.883333, 27.85, 114.25, 28.683333)],
        )

    def test_coordinate_labels_ignore_wgs84_and_epsg_numbers(self) -> None:
        value = (
            "[Southwest Corner]: Approximate latitude ~42°N, longitude ~12°E; "
            "[Northeast Corner]: Approximate latitude ~43.5°N, longitude ~13.5°E "
            "(based on WGS84 Pseudo Mercator EPSG 3857 coordinates)"
        )
        self.assertEqual(
            parse_coordinate_extents(value),
            [
                ("point", 12.0, 42.0, 12.0, 42.0),
                ("point", 13.5, 43.5, 13.5, 43.5),
            ],
        )


if __name__ == "__main__":
    unittest.main()
