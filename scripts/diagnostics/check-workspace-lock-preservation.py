#!/usr/bin/env python3
"""Check the C0 lock repair against its exact baseline, without third-party parsers.

pnpm's frozen install validates YAML and dependency resolution. This additional
check only reads the known pnpm v9 block layout to protect existing records and
importer versions. It is not a general YAML parser or a build/test substitute.
"""
import json
import re
import subprocess
from pathlib import Path

BASELINE = "c73fca46470caa5675efd2f39d2b187c2da7bb80"
ROOT = Path(__file__).resolve().parents[2]


def mapping_blocks(text, name, indent):
    prefix = " " * indent
    matches = list(re.finditer(r"^" + prefix + r"(\S[^\n]*?):(?:[ \t]*\{\})?[ \t]*\n", text, re.M))
    result = {}
    for index, match in enumerate(matches):
        key = match.group(1).strip("'\"")
        if key in result:
            raise ValueError(f"duplicate {name} key: {key}")
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        result[key] = text[match.start():end].rstrip()
    return result


def section(text, name):
    match = re.search(r"^" + name + r":\n(.*?)(?=^\S|\Z)", text, re.M | re.S)
    if match is None:
        raise ValueError(f"missing section: {name}")
    return mapping_blocks(match.group(1), name, 2)


def versions(text):
    result = {}
    for importer, block in section(text, "importers").items():
        for category, dependencies in mapping_blocks(block, importer, 4).items():
            for name, record in mapping_blocks(dependencies, category, 6).items():
                found = re.findall(r"^        version: (\S.*)$", record, re.M)
                if len(found) != 1:
                    raise ValueError(f"expected one version: {importer}/{name}")
                result[(importer, category, name)] = found[0]
    return result


def verify(before, after):
    counts = {}
    for name in ["packages", "snapshots"]:
        old, new = section(before, name), section(after, name)
        for key, block in old.items():
            if new.get(key) != block:
                raise ValueError(f"removed or changed {name} record: {key}")
        counts[name] = {"preserved": len(old), "added": len(new) - len(old)}
    old_versions, new_versions = versions(before), versions(after)
    for key, version in old_versions.items():
        if new_versions.get(key) != version:
            raise ValueError(f"removed or changed locked version: {key}")
    counts["preserved_importer_versions"] = len(old_versions)
    return counts


def main():
    before = subprocess.check_output(
        ["git", "show", f"{BASELINE}:pnpm-lock.yaml"], cwd=ROOT, text=True
    )
    after = (ROOT / "pnpm-lock.yaml").read_text()
    counts = verify(before, after)
    # Prove the guard rejects missing/changed old records and a version upgrade.
    old_package = next(iter(section(before, "packages").values()))
    old_snapshot = next(iter(section(before, "snapshots").values()))
    old_version = next(iter(versions(before).values()))
    invalid = [
        after.replace(old_package, "", 1),
        after.replace(old_package, old_package + "\n    changed: true", 1),
        after.replace(old_snapshot, "", 1),
        after.replace("        version: " + old_version + "\n",
                      "        version: 0.0.0\n", 1),
    ]
    for index, altered in enumerate(invalid):
        if altered == after:
            raise ValueError(f"negative control {index} did not mutate input")
        try:
            verify(before, altered)
        except ValueError:
            continue
        raise ValueError(f"negative control {index} unexpectedly passed")
    print(json.dumps({"baseline": BASELINE, "status": "PASS", **counts,
                      "negative_controls_rejected": len(invalid)}, sort_keys=True))


if __name__ == "__main__":
    main()
