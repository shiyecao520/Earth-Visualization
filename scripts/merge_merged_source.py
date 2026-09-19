#!/usr/bin/env python3
"""增量合并数据集来源工作簿。

背景：数据源工作簿会被"详情报告"导出整体替换，但导出会丢失部分坐标/校验列。
为避免老记录的空间信息回退，本脚本以工程内的权威工作簿为基底（保留其全部列与老行），
只把新导出文件中"新增的行"（按 sheet + id/datanet_id + 名称判定）追加到对应 sheet。

用法:
  python3 scripts/merge_merged_source.py \
      --base data/source/dataset_merged_20260827.xlsx \
      --new /path/to/dataset_merged数据库详情报告_20260909.xlsx \
      --output data/source/dataset_merged_20260909.xlsx
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError as error:  # pragma: no cover
    raise SystemExit("缺少 openpyxl，请先安装: python3 -m pip install openpyxl") from error

# 参与增量合并的数据 sheet；"统计报告"等只读 sheet 由 --new 原样带过
DATA_SHEETS = ("海纳数据集", "OneEarth数据集")


def read_sheet(path: Path, sheet_name: str) -> tuple[list[str], list[dict[str, object]]]:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        worksheet = workbook[sheet_name]
        iterator = worksheet.iter_rows(values_only=True)
        try:
            headers = [str(header) if header is not None else "" for header in next(iterator)]
        except StopIteration:
            return [], []
        rows: list[dict[str, object]] = []
        for values in iterator:
            row = {
                headers[index]: (values[index] if index < len(values) else None)
                for index in range(len(headers))
            }
            rows.append(row)
        return headers, rows
    finally:
        workbook.close()


def row_key(row: dict[str, object]) -> tuple[str, str]:
    raw_id = row.get("id")
    if raw_id in (None, ""):
        raw_id = row.get("datanet_id") or ""
    return (str(row.get("来源大类") or row.get("source") or ""), str(raw_id), str(row.get("datanet_name") or ""))


def read_report_sheet_rows(path: Path, sheet_name: str) -> list[list[object]]:
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        if sheet_name not in workbook.sheetnames:
            return []
        worksheet = workbook[sheet_name]
        rows: list[list[object]] = []
        for values in worksheet.iter_rows(values_only=True):
            rows.append(list(values))
        return rows
    finally:
        workbook.close()


def copy_report_sheet(target_workbook: openpyxl.Workbook, source_path: Path, sheet_name: str) -> None:
    rows = read_report_sheet_rows(source_path, sheet_name)
    worksheet = target_workbook.create_sheet(title=sheet_name[:31])
    for values in rows:
        worksheet.append(values)


def build_merged_source(base: Path, new: Path, output: Path) -> dict[str, int]:
    merged = openpyxl.Workbook()
    merged.remove(merged.active)

    # 1) 只读 sheet（如“统计报告”）以新导出为准整体带过
    new_workbook = openpyxl.load_workbook(new, read_only=True, data_only=True)
    for sheet_name in new_workbook.sheetnames:
        if sheet_name in DATA_SHEETS:
            continue
        copy_report_sheet(merged, new, sheet_name)
    new_workbook.close()

    stats: dict[str, int] = {}
    for sheet_name in DATA_SHEETS:
        base_headers, base_rows = read_sheet(base, sheet_name)
        _, new_rows = read_sheet(new, sheet_name)
        if not base_headers:
            continue

        new_keys = {row_key(row): row for row in new_rows}
        base_keys = {row_key(row) for row in base_rows}

        added = [new_keys[key] for key in new_keys if key not in base_keys]
        ordered_headers = [header for header in base_headers if header]

        worksheet = merged.create_sheet(title=sheet_name[:31])
        worksheet.append(ordered_headers)
        for row in base_rows:
            worksheet.append([row.get(header) for header in ordered_headers])
        for row in added:
            worksheet.append([row.get(header) for header in ordered_headers])

        stats[sheet_name + "_base"] = len(base_rows)
        stats[sheet_name + "_added"] = len(added)
        stats[sheet_name + "_total"] = len(base_rows) + len(added)

    output.parent.mkdir(parents=True, exist_ok=True)
    merged.save(output)
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True, help="工程内权威基底工作簿")
    parser.add_argument("--new", type=Path, required=True, help="新导出工作簿（含新增行）")
    parser.add_argument("--output", type=Path, required=True, help="合并输出路径")
    args = parser.parse_args()

    stats = build_merged_source(args.base, args.new, args.output)
    for key, value in stats.items():
        print(f"{key}: {value}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
