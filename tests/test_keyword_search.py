import unittest

from heatmap_service import SERVICE as HEATMAP_SERVICE
from merged_dataset_service import SERVICE as MERGED_SERVICE
from paper_service import SERVICE as PAPER_SERVICE


class MergedKeywordSearchTests(unittest.TestCase):
    def test_keyword_search_returns_merged_datasets_with_coverage(self) -> None:
        result = MERGED_SERVICE.keyword_search("大坝", {}, limit=20)
        self.assertGreater(result["total"], 0)
        self.assertTrue(result["datasets"])
        for dataset in result["datasets"]:
            self.assertIn(dataset["source"], {"海纳数据集", "OneEarth数据集"})
            self.assertIn("rawId", dataset)
            self.assertIn("coverage", dataset)
            for coverage in dataset["coverage"]:
                self.assertIn(coverage["kind"], {"point", "bbox"})
                self.assertGreaterEqual(coverage["east"], coverage["west"])
                self.assertGreaterEqual(coverage["north"], coverage["south"])

    def test_keyword_search_respects_source_filter(self) -> None:
        result = MERGED_SERVICE.keyword_search("全球", {"source": "海纳数据集"}, limit=50)
        self.assertGreater(result["total"], 0)
        self.assertTrue(result["datasets"])
        for dataset in result["datasets"]:
            self.assertEqual(dataset["source"], "海纳数据集")

    def test_keyword_search_empty_query_raises(self) -> None:
        with self.assertRaises(ValueError):
            MERGED_SERVICE.keyword_search("   ", {})

    def test_keyword_search_limit_is_honored(self) -> None:
        result = MERGED_SERVICE.keyword_search("数据", {}, limit=5)
        self.assertLessEqual(len(result["datasets"]), 5)


class LegacyKeywordSearchTests(unittest.TestCase):
    def test_keyword_search_returns_scientific_datasets(self) -> None:
        result = HEATMAP_SERVICE.keyword_search("ecosystem", {}, limit=20)
        self.assertGreater(result["total"], 0)
        self.assertTrue(result["datasets"])
        for dataset in result["datasets"]:
            self.assertEqual(dataset["source"], "科学数据")
            self.assertEqual(dataset["itemType"], "dataset")
            self.assertIn("coverage", dataset)

    def test_keyword_search_excludes_merged_sources_when_filtered(self) -> None:
        result = HEATMAP_SERVICE.keyword_search("全球", {"source": "海纳数据集"}, limit=20)
        self.assertEqual(result["total"], 0)
        self.assertEqual(result["datasets"], [])

    def test_keyword_search_empty_query_raises(self) -> None:
        with self.assertRaises(ValueError):
            HEATMAP_SERVICE.keyword_search("", {})


class PaperKeywordSearchTests(unittest.TestCase):
    def test_keyword_search_returns_papers(self) -> None:
        result = PAPER_SERVICE.keyword_search("ecosystem", {}, limit=20)
        self.assertGreater(result["total"], 0)
        self.assertTrue(result["papers"])
        for paper in result["papers"]:
            self.assertTrue(paper["title"])

    def test_unlocated_papers_have_empty_coverage_and_null_coordinates(self) -> None:
        result = PAPER_SERVICE.keyword_search("ecosystem", {}, limit=200)
        unlocated = [paper for paper in result["papers"] if paper["longitude"] is None]
        self.assertTrue(unlocated, "expected at least one unlocated paper in results")
        for paper in unlocated:
            self.assertIsNone(paper["latitude"])
            self.assertEqual(paper["coverage"], [])
        for paper in result["papers"]:
            self.assertEqual(
                paper["longitude"] is None,
                paper["coverage"] == [],
                "longitude/coverage invariant broken",
            )

    def test_keyword_search_empty_query_raises(self) -> None:
        with self.assertRaises(ValueError):
            PAPER_SERVICE.keyword_search("", {})


if __name__ == "__main__":
    unittest.main()
