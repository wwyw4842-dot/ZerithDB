#!/usr/bin/env python3
"""Require nonempty, successful source and built-package regression reports."""
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


def check_report(path, expected):
    root = ET.parse(path).getroot()
    counts = {
        "tests": len(root.findall(".//testcase")),
        "failures": len(root.findall(".//failure")),
        "errors": len(root.findall(".//error")),
        "skipped": len(root.findall(".//skipped")),
    }
    if counts != {"tests": expected, "failures": 0, "errors": 0, "skipped": 0}:
        raise ValueError(f"Unexpected result for {path.name}: {counts}")
    return counts


def main():
    directory = Path(sys.argv[1])
    result = {
        "source": check_report(directory / "unit.xml", 24),
        "built_package": check_report(directory / "consumers.xml", 6),
    }
    print(json.dumps({"status": "PASS", **result}, sort_keys=True))


if __name__ == "__main__":
    main()
