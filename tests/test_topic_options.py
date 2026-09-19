import unittest

from heatmap_service import SERVICE


class TopicOptionTests(unittest.TestCase):
    def test_global_statistics_include_every_filter_topic(self) -> None:
        filter_topics = [item["value"] for item in SERVICE.filter_options()["topics"]]
        statistic_topics = [item["name"] for item in SERVICE.region_statistics("WORLD", {})["topics"]]

        self.assertEqual(statistic_topics, filter_topics)


if __name__ == "__main__":
    unittest.main()
