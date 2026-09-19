#!/usr/bin/env python3
"""Serve the globe UI and proxy dataset searches to the configured MCP server."""

from __future__ import annotations

import concurrent.futures
import json
import gzip
import mimetypes
import os
import select
import socket
import sys
import threading
from collections import OrderedDict
from email.utils import formatdate
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen

from heatmap_service import (
    H3_POINT_QUERY_MAX_BBOX_SPAN,
    HeatmapAborted,
    HeatmapUnavailable,
    SERVICE as HEATMAP_SERVICE,
    circle_polygon,
)
from paper_service import PaperIndexUnavailable, SERVICE as PAPER_SERVICE
from merged_dataset_service import MergedDatasetUnavailable, SERVICE as MERGED_DATASET_SERVICE


ROOT = Path(__file__).resolve().parent
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8001"))
MCP_URL = os.getenv("MCP_URL", "http://10.200.49.5:8001/mcp")
MCP_TIMEOUT_SECONDS = float(os.getenv("MCP_TIMEOUT_SECONDS", "35"))
MAX_REQUEST_BYTES = 64 * 1024
MCP_PROTOCOL_VERSION = "2025-03-26"
PUBLIC_STATIC_FILES = {"/", "/index.html"}
PUBLIC_STATIC_PREFIXES = (
    "/assets/",
    "/css/",
    "/data/boundaries/",
    "/js/",
    "/node_modules/cesium/Build/Cesium/",
)
COMPRESSIBLE_STATIC_SUFFIXES = {".css", ".geojson", ".html", ".js", ".json", ".svg", ".txt", ".xml"}
SOURCE_DATA_FILES = (
    ROOT / "data/source/datasets_scientific.csv",
    ROOT / "data/source/papers_converted_point.csv",
    ROOT / "data/source/dataset_merged_20260909.xlsx",
)
INDEX_DATA_FILES = (
    ROOT / "data/generated/dataset_heat.sqlite",
    ROOT / "data/generated/paper_points.sqlite",
    ROOT / "data/generated/dataset_merged.sqlite",
)


@lru_cache(maxsize=48)
def compressed_static_file(path: str, modified_ns: int, size: int) -> bytes:
    del modified_ns, size
    return gzip.compress(Path(path).read_bytes(), compresslevel=6)


def public_static_path_allowed(raw_path: str) -> bool:
    path = unquote(urlparse(raw_path).path)
    if path in PUBLIC_STATIC_FILES:
        return True
    if "\\" in path or ".." in Path(path).parts or path.endswith("/"):
        return False
    return any(path.startswith(prefix) for prefix in PUBLIC_STATIC_PREFIXES)


def data_storage_summary() -> dict[str, int]:
    source_bytes = sum(path.stat().st_size for path in SOURCE_DATA_FILES if path.is_file())
    index_bytes = sum(path.stat().st_size for path in INDEX_DATA_FILES if path.is_file())
    return {
        "source_bytes": source_bytes,
        "index_bytes": index_bytes,
        "total_bytes": source_bytes + index_bytes,
    }


def spatial_selection_geometry(
    query: dict[str, list[str]],
) -> tuple[list[float], list[list[float]] | None, tuple[float, float, float] | None]:
    raw_polygon = (query.get("polygon") or [""])[0].strip()
    if raw_polygon:
        polygon = []
        for raw_point in raw_polygon.split(";"):
            coordinates = [float(value) for value in raw_point.split(",")]
            if len(coordinates) != 2:
                raise ValueError("自由圈选参数格式不正确")
            longitude, latitude = coordinates
            if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
                raise ValueError("自由圈选坐标超出经纬度限制")
            polygon.append([longitude, latitude])
        while len(polygon) > 1 and polygon[0] == polygon[-1]:
            polygon.pop()
        if not (3 <= len(polygon) <= 96):
            raise ValueError("自由圈选边界点需在 3–96 个之间")
        longitudes = [point[0] for point in polygon]
        latitudes = [point[1] for point in polygon]
        if max(longitudes) - min(longitudes) > 180:
            raise ValueError("暂不支持跨越 180° 经线的自由圈选")
        signed_area = sum(
            polygon[index][0] * polygon[(index + 1) % len(polygon)][1]
            - polygon[(index + 1) % len(polygon)][0] * polygon[index][1]
            for index in range(len(polygon))
        )
        if abs(signed_area) < 1e-10:
            raise ValueError("自由圈选区域面积过小")
        bounds = [min(longitudes), min(latitudes), max(longitudes), max(latitudes)]
        return bounds, polygon, None
    raw_circle = (query.get("circle") or [""])[0].strip()
    if raw_circle:
        values = [float(value) for value in raw_circle.split(",")]
        if len(values) != 3:
            raise ValueError("圆形筛选参数格式不正确")
        _, bounds = circle_polygon(values[0], values[1], values[2])
        return bounds, None, (values[0], values[1], values[2])
    raw_bounds = (query.get("bounds") or [""])[0]
    return [float(value) for value in raw_bounds.split(",")], None, None


def warm_default_heatmaps() -> None:
    if not HEATMAP_SERVICE.available():
        return
    presets = (
        {"level": "country", "bounds": [-180, -90, 180, 90], "format": "webp"},
        {"level": "province", "bounds": [70.50235, 0.82358, 138.09567, 56.56327], "format": "webp"},
    )
    for preset in presets:
        try:
            HEATMAP_SERVICE.render(preset)
        except Exception as error:
            print(f"heatmap warmup failed: {error}")


class McpRequestError(RuntimeError):
    pass


_NL_SEARCH_CACHE: "OrderedDict[str, list[dict[str, Any]]]" = OrderedDict()
_NL_SEARCH_CACHE_LOCK = threading.Lock()
_NL_SEARCH_CACHE_MAX = 64


def parse_mcp_payload(content_type: str, body: bytes) -> dict[str, Any] | None:
    text = body.decode("utf-8", errors="replace").strip()
    if not text:
        return None
    if "text/event-stream" in content_type:
        messages = []
        for line in text.splitlines():
            if not line.startswith("data:"):
                continue
            value = line[5:].strip()
            if value:
                messages.append(json.loads(value))
        return messages[-1] if messages else None
    return json.loads(text)


def mcp_request(
    payload: dict[str, Any] | None,
    session_id: str | None = None,
    method: str = "POST",
) -> tuple[dict[str, Any] | None, str | None]:
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(MCP_URL, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=MCP_TIMEOUT_SECONDS) as response:
            response_body = response.read()
            next_session_id = response.headers.get("Mcp-Session-Id") or session_id
            parsed = parse_mcp_payload(
                response.headers.get("Content-Type", ""),
                response_body,
            )
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise McpRequestError(f"MCP HTTP {error.code}: {detail[:400]}") from error
    except URLError as error:
        raise McpRequestError(f"无法连接 MCP 服务: {error.reason}") from error

    if parsed and parsed.get("error"):
        error = parsed["error"]
        raise McpRequestError(str(error.get("message") or error))
    return parsed, next_session_id


def extract_tool_results(message: dict[str, Any] | None) -> list[dict[str, Any]]:
    result = (message or {}).get("result") or {}
    if result.get("isError"):
        raise McpRequestError("dataset_search 返回错误")

    raw_result = (result.get("structuredContent") or {}).get("result")
    if raw_result is None:
        raw_result = "".join(
            str(block.get("text", ""))
            for block in result.get("content") or []
            if isinstance(block, dict)
        )
    if isinstance(raw_result, str):
        try:
            raw_result = json.loads(raw_result)
        except json.JSONDecodeError as error:
            raise McpRequestError("dataset_search 返回了无法解析的数据") from error
    if isinstance(raw_result, dict):
        raw_result = raw_result.get("results") or raw_result.get("datasets") or []
    if not isinstance(raw_result, list):
        raise McpRequestError("dataset_search 返回结构不符合预期")
    return [item for item in raw_result if isinstance(item, dict)]


def validate_search_arguments(payload: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("query") or payload.get("user_query") or "").strip()
    if not query:
        raise ValueError("请输入数据集检索问题")
    if len(query) > 1000:
        raise ValueError("检索问题不能超过 1000 个字符")

    arguments: dict[str, Any] = {"user_query": query}
    top_k = int(payload.get("top_k") or 5)
    arguments["top_k"] = max(1, min(50, top_k))

    target_year = payload.get("target_year")
    if target_year:
        arguments["target_year"] = str(target_year)[:32]

    target_bbox = payload.get("target_bbox")
    if isinstance(target_bbox, dict):
        keys = ("min_lon", "max_lon", "min_lat", "max_lat")
        if all(key in target_bbox for key in keys):
            bbox = {key: float(target_bbox[key]) for key in keys}
            if (
                -180 <= bbox["min_lon"] <= bbox["max_lon"] <= 180
                and -90 <= bbox["min_lat"] <= bbox["max_lat"] <= 90
            ):
                arguments["target_bbox"] = bbox
    return arguments


def search_datasets(arguments: dict[str, Any]) -> list[dict[str, Any]]:
    signature = json.dumps(arguments, sort_keys=True, ensure_ascii=False)
    with _NL_SEARCH_CACHE_LOCK:
        cached = _NL_SEARCH_CACHE.get(signature)
        if cached is not None:
            _NL_SEARCH_CACHE.move_to_end(signature)
            return json.loads(json.dumps(cached))
    session_id = None
    try:
        initialize, session_id = mcp_request(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "dataset-earth", "version": "0.1.0"},
                },
            }
        )
        if not initialize or not session_id:
            raise McpRequestError("MCP 会话初始化失败")
        mcp_request(
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            session_id,
        )
        response, _ = mcp_request(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "dataset_search", "arguments": arguments},
            },
            session_id,
        )
        result = extract_tool_results(response)
        with _NL_SEARCH_CACHE_LOCK:
            _NL_SEARCH_CACHE[signature] = result
            while len(_NL_SEARCH_CACHE) > _NL_SEARCH_CACHE_MAX:
                _NL_SEARCH_CACHE.popitem(last=False)
        return json.loads(json.dumps(result))
    finally:
        if session_id:
            try:
                mcp_request(None, session_id, method="DELETE")
            except Exception:
                pass


class DatasetEarthHandler(SimpleHTTPRequestHandler):
    server_version = "DatasetEarth/0.1"
    protocol_version = "HTTP/1.1"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def handle_one_request(self) -> None:
        # The frontend cancels superseded fetches (e.g. rapid timeline dragging),
        # which resets the connection while this handler is reading or writing.
        # Swallow those connection errors so they don't spam the server log.
        try:
            super().handle_one_request()
        except (ConnectionError, TimeoutError):
            self.close_connection = True


    def _client_disconnected(self) -> bool:
        """快速探测客户端连接是否已断开（前端 abort 旧热力请求时连接会被重置）。

        用非阻塞 select + MSG_PEEK 只“看一眼”而不消费数据：连接已关闭时
        recv 返回空字节串，说明该请求已无意义，应立刻中止渲染并把线程让出来。
        """
        try:
            readable, _, _ = select.select([self.connection], [], [], 0)
            if not readable:
                return False
            data = self.connection.recv(1, socket.MSG_PEEK)
            return data == b""
        except (ConnectionError, OSError):
            return True
        except Exception:
            return False

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path.startswith("/data/source/"):
            self.send_error(404)
            return
        if parsed.path.rstrip("/") == "/api/dataset-heat":
            self.serve_dataset_heat(query)
            return
        if parsed.path.rstrip("/") == "/api/region-counts":
            self.serve_region_counts(query)
            return
        if parsed.path.rstrip("/") == "/api/region-statistics":
            self.serve_region_statistics(query)
            return
        if parsed.path.rstrip("/") == "/api/filter-options":
            self.serve_filter_options()
            return
        if parsed.path.rstrip("/") == "/api/region-datasets":
            self.serve_region_datasets(query)
            return
        if parsed.path.rstrip("/") == "/api/region-papers":
            self.serve_region_papers(query)
            return
        if parsed.path.rstrip("/") == "/api/bounds-datasets":
            self.serve_bounds_datasets(query)
            return
        if parsed.path.rstrip("/") == "/api/bounds-papers":
            self.serve_bounds_papers(query)
            return
        if parsed.path.rstrip("/") == "/api/h3-point-query":
            self.serve_h3_point_query(query)
            return
        if parsed.path.rstrip("/") == "/api/paper-distribution":
            self.serve_paper_distribution(query)
            return
        if parsed.path.rstrip("/") == "/api/dataset-detail":
            self.serve_dataset_detail(query)
            return
        if parsed.path.rstrip("/") == "/api/merged-dataset-detail":
            self.serve_merged_dataset_detail(query)
            return
        if parsed.path.rstrip("/") == "/api/paper-detail":
            self.serve_paper_detail(query)
            return
        if parsed.path.rstrip("/") == "/api/keyword-search":
            self.serve_keyword_search(query)
            return
        if not public_static_path_allowed(self.path):
            self.send_error(404)
            return
        self.serve_static_asset(head_only=False)

    def do_HEAD(self) -> None:
        if not public_static_path_allowed(self.path):
            self.send_error(404)
            return
        self.serve_static_asset(head_only=True)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        super().end_headers()

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/api/dataset-search":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                raise ValueError("请求内容为空或过大")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("请求格式不正确")
            arguments = validate_search_arguments(payload)
            results = search_datasets(arguments)
            self.send_json(
                200,
                {
                    "query": arguments["user_query"],
                    "arguments": arguments,
                    "count": len(results),
                    "results": results,
                },
            )
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})
        except McpRequestError as error:
            self.send_json(502, {"error": str(error)})
        except Exception as error:
            print(f"dataset search failed: {error}")
            self.send_json(500, {"error": "数据集检索服务暂时不可用"})

    def serve_static_asset(self, head_only: bool) -> None:
        url_path = unquote(urlparse(self.path).path)
        relative_path = "index.html" if url_path == "/" else url_path.lstrip("/")
        file_path = (ROOT / relative_path).resolve()
        try:
            file_path.relative_to(ROOT)
        except ValueError:
            self.send_error(404)
            return
        if not file_path.is_file():
            self.send_error(404)
            return

        stat = file_path.stat()
        accepts_gzip = "gzip" in self.headers.get("Accept-Encoding", "").lower()
        use_gzip = accepts_gzip and file_path.suffix.lower() in COMPRESSIBLE_STATIC_SUFFIXES and stat.st_size >= 1024
        etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}-{"gz" if use_gzip else "raw"}"'
        cache_control = "no-cache" if file_path.name == "index.html" else "public, max-age=86400"
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", cache_control)
            self.send_header("Vary", "Accept-Encoding")
            self.end_headers()
            return

        compressed = compressed_static_file(str(file_path), stat.st_mtime_ns, stat.st_size) if use_gzip else None
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        if file_path.suffix.lower() == ".geojson":
            content_type = "application/geo+json"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(compressed) if compressed is not None else stat.st_size))
        self.send_header("Last-Modified", formatdate(stat.st_mtime, usegmt=True))
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", cache_control)
        self.send_header("Vary", "Accept-Encoding")
        if compressed is not None:
            self.send_header("Content-Encoding", "gzip")
        self.end_headers()
        if head_only:
            return
        try:
            if compressed is not None:
                self.wfile.write(compressed)
            else:
                with file_path.open("rb") as source:
                    self.copyfile(source, self.wfile)
        except (BrokenPipeError, ConnectionResetError):
            return

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        use_gzip = len(body) >= 1024 and "gzip" in self.headers.get("Accept-Encoding", "").lower()
        response_body = gzip.compress(body, compresslevel=5) if use_gzip else body
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(response_body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Vary", "Accept-Encoding")
            if use_gzip:
                self.send_header("Content-Encoding", "gzip")
            self.end_headers()
            self.wfile.write(response_body)
        except (BrokenPipeError, ConnectionResetError):
            # Timeline dragging intentionally cancels superseded requests.
            return

    def serve_keyword_search(self, query: dict[str, list[str]]) -> None:
        try:
            raw_query = (query.get("query") or [""])[0].strip()
            if not raw_query:
                raise ValueError("缺少搜索关键词")
            limit = int((query.get("limit") or ["50"])[0])
            params = self.dataset_filter_params(query)
            params["query"] = raw_query
            result: dict[str, Any] = {"query": raw_query, "total": 0, "datasets": [], "papers": []}

            def run_source(service, kind: str) -> tuple[str, dict[str, Any]]:
                payload = service.keyword_search(raw_query, params, limit=limit)
                return kind, payload

            tasks: list[concurrent.futures.Future[tuple[str, dict[str, Any]]]] = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
                if HEATMAP_SERVICE.available():
                    tasks.append(executor.submit(run_source, HEATMAP_SERVICE, "legacy"))
                if MERGED_DATASET_SERVICE.available():
                    tasks.append(executor.submit(run_source, MERGED_DATASET_SERVICE, "merged"))
                if PAPER_SERVICE.available():
                    tasks.append(executor.submit(run_source, PAPER_SERVICE, "papers"))
                for future in concurrent.futures.as_completed(tasks):
                    kind, payload = future.result()
                    if kind == "papers":
                        result["papers"].extend(payload.get("papers", []))
                    else:
                        result["datasets"].extend(payload.get("datasets", []))
                    result["total"] += int(payload.get("total") or 0)
            # 名称命中的数据集排在列表前面：只要数据集名称包含完整查询词，
            # 就优先展示（同层级内保持来源原有的相对顺序）。
            name_query = raw_query.casefold()
            result["datasets"].sort(
                key=lambda item: 0 if name_query in str(item.get("name") or "").casefold() else 1
            )
            self.send_json(200, result)
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": str(error)})
        except (PaperIndexUnavailable, MergedDatasetUnavailable) as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"keyword search failed: {error}")
            self.send_json(500, {"error": "关键词搜索失败"})

    def serve_dataset_heat(self, query: dict[str, list[str]]) -> None:
        try:
            raw_bounds = (query.get("bounds") or ["-180,-90,180,90"])[0]
            params = self.dataset_filter_params(query)
            params.update({
                "level": (query.get("level") or ["country"])[0],
                "bounds": [float(value) for value in raw_bounds.split(",")],
                "format": (query.get("format") or ["png"])[0],
                "show_h3_grid": (query.get("h3_grid") or ["1"])[0],
            })
            extra_geometries: list[Any] = []
            if MERGED_DATASET_SERVICE.available():
                try:
                    extra_geometries = MERGED_DATASET_SERVICE.coordinate_geometries(
                        params, params["bounds"],
                    )
                except Exception:
                    extra_geometries = []
            image, metadata = HEATMAP_SERVICE.render(
                params,
                extra_coordinate_geometries=extra_geometries,
                abort_check=self._client_disconnected,
            )
            self.send_response(200)
            self.send_header("Content-Type", str(metadata.get("content_type") or "image/png"))
            self.send_header("Content-Length", str(len(image)))
            self.send_header("Cache-Control", "public, max-age=3600, stale-if-error=86400")
            self.send_header("X-Heat-Datasets", str(metadata["dataset_count"]))
            self.send_header("X-Heat-Global-Datasets", str(metadata["global_count"]))
            self.send_header("X-Heat-Resolution", str(metadata["resolution"]))
            self.send_header("X-H3-Resolution", str(metadata.get("h3_resolution", "")))
            self.send_header("X-H3-Cell-Area-Km2", str(metadata.get("h3_cell_area_km2", "")))
            self.send_header("X-H3-Cell-Count", str(metadata.get("h3_cell_count", "")))
            self.send_header("X-Heat-Render-Ms", str(metadata["render_ms"]))
            self.send_header("X-Heat-Cache", str(metadata["cache"]))
            self.end_headers()
            try:
                self.wfile.write(image)
            except (BrokenPipeError, ConnectionResetError):
                return
        except HeatmapAborted:
            # 客户端已断开，无需也无法回写响应；静默结束该请求。
            self.close_connection = True
            return
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": str(error)})
        except HeatmapUnavailable as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"dataset heatmap failed: {error}")
            self.send_json(500, {"error": "数据集热力图生成失败"})

    @staticmethod
    def dataset_filter_params(query: dict[str, list[str]]) -> dict[str, Any]:
        return {
            "render": (query.get("render") or [""])[0][:32],
            "theme": (query.get("theme") or [""])[0],
            "paper_theme": (query.get("paper_theme") or [""])[0],
            "query": (query.get("query") or [""])[0],
            "data_type": (query.get("data_type") or [""])[0],
            "resolution_filter": (query.get("spatial_resolution") or [""])[0],
            "min_size_gb": (query.get("min_size_gb") or ["0"])[0],
            "temporal_scope": (query.get("temporal_scope") or [""])[0],
            "start_year": (query.get("start_year") or [None])[0],
            "end_year": (query.get("end_year") or [None])[0],
            "spatial_type": (query.get("spatial_type") or [""])[0],
            "source": (query.get("source") or [""])[0],
            "temporal_availability": (query.get("temporal_availability") or [""])[0],
            "problem_availability": (query.get("problem_availability") or [""])[0],
            "paper_spatial_availability": (query.get("paper_spatial_availability") or [""])[0],
            "publication_start_year": (query.get("publication_start_year") or [None])[0],
            "publication_end_year": (query.get("publication_end_year") or [None])[0],
        }

    def serve_filter_options(self) -> None:
        try:
            result = HEATMAP_SERVICE.filter_options()
            if MERGED_DATASET_SERVICE.available():
                merged_options = MERGED_DATASET_SERVICE.filter_options()
                merged_topics: dict[str, int] = {}
                for topic in [*result.get("topics", []), *merged_options.get("topics", [])]:
                    value = str(topic.get("value") or "").strip()
                    if not value:
                        continue
                    merged_topics[value] = merged_topics.get(value, 0) + int(topic.get("count") or 0)
                result["topics"] = [
                    {"value": value, "count": count}
                    for value, count in sorted(
                        merged_topics.items(), key=lambda item: (-item[1], item[0].casefold()),
                    )
                ]
                spatial = result.get("spatial") or {}
                merged_spatial = merged_options.get("spatial") or {}
                result["spatial"] = {
                    key: int(spatial.get(key, 0) or 0) + int(merged_spatial.get(key, 0) or 0)
                    for key in ("coordinates", "named", "unlocated")
                }
                merged_sources = list(merged_options.get("sources") or [])
                existing_sources = {str(item.get("value") or "") for item in (result.get("sources") or [])}
                result["sources"] = [
                    *result.get("sources", []),
                    *[item for item in merged_sources if str(item.get("value") or "") not in existing_sources],
                ]
            if PAPER_SERVICE.available():
                paper_options = PAPER_SERVICE.filter_options()
                periods: dict[int, dict[str, int]] = {}
                for period in [*result.get("publication_periods", []), *paper_options.get("publication_periods", [])]:
                    start = int(period["start"])
                    current = periods.setdefault(start, {"start": start, "end": int(period["end"]), "count": 0})
                    current["end"] = max(current["end"], int(period["end"]))
                    current["count"] += int(period.get("count") or 0)
                result["publication_periods"] = [periods[key] for key in sorted(periods, reverse=True)]
                result["paper_topics"] = paper_options.get("topics", [])
                result["paper_spatial"] = paper_options.get("spatial", {})
            self.send_json(200, result)
        except (HeatmapUnavailable, PaperIndexUnavailable, MergedDatasetUnavailable) as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"filter options failed: {error}")
            self.send_json(500, {"error": "真实筛选项加载失败"})

    def serve_region_counts(self, query: dict[str, list[str]]) -> None:
        try:
            raw_codes = (query.get("codes") or [""])[0]
            codes = [code.strip() for code in raw_codes.split(",") if code.strip()]
            if not codes:
                raise ValueError("缺少行政区编码")
            counts = HEATMAP_SERVICE.region_counts(codes, self.dataset_filter_params(query))
            paper_counts = PAPER_SERVICE.region_counts(codes, self.dataset_filter_params(query))
            if MERGED_DATASET_SERVICE.available():
                merged_counts = MERGED_DATASET_SERVICE.region_counts(codes, self.dataset_filter_params(query))
                for code, count in merged_counts.items():
                    counts[code] = int(counts.get(code, 0) or 0) + int(count)
            self.send_json(200, {"counts": counts, "paper_counts": paper_counts})
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": str(error)})
        except (HeatmapUnavailable, PaperIndexUnavailable, MergedDatasetUnavailable) as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"region counts failed: {error}")
            self.send_json(500, {"error": "区域数据集数量查询失败"})

    def serve_region_datasets(self, query: dict[str, list[str]]) -> None:
        try:
            region_code = (query.get("region_code") or [""])[0]
            limit = int((query.get("limit") or ["50"])[0])
            offset = int((query.get("offset") or ["0"])[0])
            result = HEATMAP_SERVICE.region_datasets(
                region_code, self.dataset_filter_params(query), limit=limit, offset=offset,
            )
            if MERGED_DATASET_SERVICE.available():
                # 合并表与旧表按各自分页后拼接：前端城市层单页请求 limit=1000，offset 恒为 0，
                # 因此当前语义等价于两表取前 N 条混排；若将来前端需要 offset 翻页，需改为按 offset 拆分配额。
                merged = MERGED_DATASET_SERVICE.region_datasets(
                    region_code, self.dataset_filter_params(query), limit=limit, offset=offset,
                )
                result["total"] = int(result.get("total") or 0) + int(merged.get("total") or 0)
                result["datasets"] = [*result.get("datasets", []), *merged.get("datasets", [])]
            self.send_json(200, result)
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": str(error)})
        except (HeatmapUnavailable, MergedDatasetUnavailable) as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"region datasets failed: {error}")
            self.send_json(500, {"error": "区域数据集列表查询失败"})

    def serve_region_papers(self, query: dict[str, list[str]]) -> None:
        try:
            region_code = (query.get("region_code") or [""])[0]
            limit = int((query.get("limit") or ["50"])[0])
            offset = int((query.get("offset") or ["0"])[0])
            location_limit = int((query.get("location_limit") or ["10000"])[0])
            result = PAPER_SERVICE.region_papers(
                region_code, self.dataset_filter_params(query), limit=limit, offset=offset,
                location_limit=location_limit,
            )
            self.send_json(200, result)
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": str(error)})
        except PaperIndexUnavailable as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"region papers failed: {error}")
            self.send_json(500, {"error": "区域论文列表查询失败"})

    def serve_bounds_datasets(self, query: dict[str, list[str]]) -> None:
        try:
            bounds, polygon, circle = spatial_selection_geometry(query)
            limit = int((query.get("limit") or ["100"])[0])
            offset = int((query.get("offset") or ["0"])[0])
            # 框选/圈选采用相对 local_focus 命中规则：跨度远超选择范围的数据集
            # 从结果列表剔除并单独统计为区域覆盖数，避免结果数恒定为约 4 千。
            result = HEATMAP_SERVICE.bounds_datasets(
                bounds, self.dataset_filter_params(query), limit=limit, offset=offset,
                polygon=polygon, circle=circle, local_focus=True, include_local_regions=True,
            )
            if MERGED_DATASET_SERVICE.available():
                merged = MERGED_DATASET_SERVICE.bounds_datasets(
                    bounds, self.dataset_filter_params(query), limit=limit, offset=offset,
                    polygon=polygon, circle=circle, local_focus=True,
                )
                result["total"] = int(result.get("total") or 0) + int(merged.get("total") or 0)
                result["region_covered_total"] = (
                    int(result.get("region_covered_total") or 0)
                    + int(merged.get("region_covered_total") or 0)
                )
                result["datasets"] = [*result.get("datasets", []), *merged.get("datasets", [])]
                merged_topics: dict[str, int] = {}
                for topic in [*result.get("topics", []), *merged.get("topics", [])]:
                    name = str(topic.get("name") or "").strip()
                    if not name:
                        continue
                    merged_topics[name] = merged_topics.get(name, 0) + int(topic.get("count") or 0)
                result["topics"] = [
                    {"name": name, "count": count}
                    for name, count in sorted(
                        merged_topics.items(), key=lambda item: (-item[1], item[0].casefold()),
                    )
                ]
            self.send_json(200, result)
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": str(error)})
        except HeatmapUnavailable as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"bounds datasets failed: {error}")
            self.send_json(500, {"error": "框选范围数据集查询失败"})

    def serve_bounds_papers(self, query: dict[str, list[str]]) -> None:
        try:
            bounds, polygon, circle = spatial_selection_geometry(query)
            limit = int((query.get("limit") or ["100"])[0])
            offset = int((query.get("offset") or ["0"])[0])
            result = PAPER_SERVICE.bounds_papers(
                bounds, self.dataset_filter_params(query), limit=limit, offset=offset,
                polygon=polygon, circle=circle,
            )
            self.send_json(200, result)
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": str(error)})
        except PaperIndexUnavailable as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"bounds papers failed: {error}")
            self.send_json(500, {"error": "框选范围论文查询失败"})

    def serve_h3_point_query(self, query: dict[str, list[str]]) -> None:
        try:
            longitude = float((query.get("longitude") or [""])[0])
            latitude = float((query.get("latitude") or [""])[0])
            resolution = int((query.get("resolution") or ["8"])[0])
            cell = HEATMAP_SERVICE.h3_cell(longitude, latitude, resolution)
            filters = self.dataset_filter_params(query)
            datasets = HEATMAP_SERVICE.bounds_datasets(
                cell["bounds"], filters, limit=100, polygon=cell["boundary"], local_focus=True,
                max_bbox_span=H3_POINT_QUERY_MAX_BBOX_SPAN,
            )
            if MERGED_DATASET_SERVICE.available():
                merged = MERGED_DATASET_SERVICE.bounds_datasets(
                    cell["bounds"], filters, limit=100, polygon=cell["boundary"], local_focus=True,
                    max_bbox_span=H3_POINT_QUERY_MAX_BBOX_SPAN,
                )
                datasets["total"] = int(datasets.get("total") or 0) + int(merged.get("total") or 0)
                datasets["region_covered_total"] = (
                    int(datasets.get("region_covered_total") or 0)
                    + int(merged.get("region_covered_total") or 0)
                )
                datasets["datasets"] = [*datasets.get("datasets", []), *merged.get("datasets", [])]
                merged_topics: dict[str, int] = {}
                for topic in [*datasets.get("topics", []), *merged.get("topics", [])]:
                    name = str(topic.get("name") or "").strip()
                    if not name:
                        continue
                    merged_topics[name] = merged_topics.get(name, 0) + int(topic.get("count") or 0)
                datasets["topics"] = [
                    {"name": name, "count": count}
                    for name, count in sorted(
                        merged_topics.items(), key=lambda item: (-item[1], item[0].casefold()),
                    )
                ]
            papers = PAPER_SERVICE.bounds_papers(
                cell["bounds"], filters, limit=100, polygon=cell["boundary"],
            )
            self.send_json(200, {
                **cell,
                "dataset_total": datasets["total"],
                "region_covered_total": datasets.get("region_covered_total", 0),
                "paper_total": papers["total"],
                "dataset_topics": datasets.get("topics", []),
                "paper_topics": papers.get("topics", []),
                "datasets": datasets.get("datasets", []),
                "papers": papers.get("papers", []),
            })
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": str(error)})
        except (HeatmapUnavailable, PaperIndexUnavailable) as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"H3 point query failed: {error}")
            self.send_json(500, {"error": "H3 网格查询失败"})

    def serve_paper_distribution(self, query: dict[str, list[str]]) -> None:
        try:
            raw_bounds = (query.get("bounds") or ["-180,-90,180,90"])[0]
            bounds = [float(value) for value in raw_bounds.split(",")]
            cell_size = float((query.get("cell_size") or ["4"])[0])
            region_code = (query.get("region_code") or [""])[0]
            result = PAPER_SERVICE.paper_distribution(
                bounds, self.dataset_filter_params(query), cell_size=cell_size,
                region_code=region_code,
            )
            self.send_json(200, result)
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": str(error)})
        except PaperIndexUnavailable as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"paper distribution failed: {error}")
            self.send_json(500, {"error": "论文空间分布查询失败"})

    def serve_region_statistics(self, query: dict[str, list[str]]) -> None:
        try:
            region_code = (query.get("region_code") or [""])[0]
            params = self.dataset_filter_params(query)
            result = HEATMAP_SERVICE.region_statistics(region_code, params)
            if MERGED_DATASET_SERVICE.available():
                merged = MERGED_DATASET_SERVICE.region_statistics(region_code, params)
                result["total"] = int(result.get("total") or 0) + int(merged.get("total") or 0)
                result["spatial_count"] = int(result.get("spatial_count") or 0) + int(merged.get("spatial_count") or 0)
                merged_topics: dict[str, int] = {}
                for topic in [*result.get("topics", []), *merged.get("topics", [])]:
                    name = str(topic.get("name") or "").strip()
                    if not name:
                        continue
                    merged_topics[name] = merged_topics.get(name, 0) + int(topic.get("count") or 0)
                result["topics"] = [
                    {"name": name, "count": count}
                    for name, count in sorted(
                        merged_topics.items(), key=lambda item: (-item[1], item[0].casefold()),
                    )
                ]
                result["merged_dataset_count"] = int(merged.get("total") or 0)
            paper_statistics = PAPER_SERVICE.region_statistics(region_code, params)
            linked_paper_count = int(result.get("paper_count") or 0)
            mapped_paper_count = int(paper_statistics.get("total") or 0)
            if params.get("paper_theme") or params.get("paper_spatial_availability"):
                # The linked-paper table has no comparable paper subject or standardized point status.
                linked_paper_count = 0
            result["linked_paper_count"] = linked_paper_count
            result["mapped_paper_count"] = mapped_paper_count
            result["paper_count"] = linked_paper_count + mapped_paper_count
            result["paper_topics"] = paper_statistics.get("topics", [])
            result["storage"] = data_storage_summary()
            starts = [
                value for value in (result.get("paper_year_start"), paper_statistics.get("paper_year_start"))
                if value is not None
            ]
            ends = [
                value for value in (result.get("paper_year_end"), paper_statistics.get("paper_year_end"))
                if value is not None
            ]
            result["paper_year_start"] = min(starts) if starts else None
            result["paper_year_end"] = max(ends) if ends else None
            self.send_json(200, result)
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": str(error)})
        except (HeatmapUnavailable, PaperIndexUnavailable, MergedDatasetUnavailable) as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"region statistics failed: {error}")
            self.send_json(500, {"error": "区域真实统计查询失败"})

    def serve_dataset_detail(self, query: dict[str, list[str]]) -> None:
        try:
            dataset_id = int((query.get("dataset_id") or ["0"])[0])
            self.send_json(200, HEATMAP_SERVICE.dataset_detail(dataset_id))
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": str(error)})
        except HeatmapUnavailable as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"dataset detail failed: {error}")
            self.send_json(500, {"error": "数据集详情加载失败"})

    def serve_merged_dataset_detail(self, query: dict[str, list[str]]) -> None:
        try:
            dataset_id = int((query.get("dataset_id") or ["0"])[0])
            self.send_json(200, MERGED_DATASET_SERVICE.dataset_detail(dataset_id))
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": str(error)})
        except MergedDatasetUnavailable as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"merged dataset detail failed: {error}")
            self.send_json(500, {"error": "数据集详情加载失败"})

    def serve_paper_detail(self, query: dict[str, list[str]]) -> None:
        try:
            paper_id = int((query.get("paper_id") or ["0"])[0])
            self.send_json(200, PAPER_SERVICE.paper_detail(paper_id))
        except (ValueError, TypeError) as error:
            self.send_json(400, {"error": str(error)})
        except PaperIndexUnavailable as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"paper detail failed: {error}")
            self.send_json(500, {"error": "论文详情加载失败"})


class QuietThreadingHTTPServer(ThreadingHTTPServer):
    """Suppress noisy tracebacks for clients that disconnect mid-request."""

    def handle_error(self, request: Any, client_address: Any) -> None:
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)


if __name__ == "__main__":
    server = QuietThreadingHTTPServer((HOST, PORT), DatasetEarthHandler)
    print(f"Dataset Earth serving at http://{HOST}:{PORT}/")
    print(f"MCP endpoint: {MCP_URL}")
    threading.Thread(target=warm_default_heatmaps, name="heatmap-warmup", daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
