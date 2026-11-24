#!/usr/bin/env python3
"""Fetch the official sensitive-species lists into scripts/sensitive_species.csv.

Governments and BirdLife Australia blur the locations of some species in their
own atlases, to protect nests, roosts and display grounds. The website's species
search follows the same lists: for a species on one, the search names only the
area it was heard in, not the place (the place pages are unchanged). The build
(build_web_metadata.py) reads the CSV this script writes.

The lists come from the Atlas of Living Australia (ALA), which uses them to
generalise its own records and refreshes them monthly:

    dr487  New South Wales Sensitive Species List   applies in AU-NSW
    dr493  Queensland Confidential Species          applies in AU-QLD
    dr494  BirdLife Australia Sensitive Species     applies in AU (everywhere in Australia)

`applies_in` is a country code, or country and state as on sites.csv
(country_code-region_code). Run this again now and then, and when places in a new
state or country are added (Germany has no list here yet):

    python3 scripts/fetch_sensitive_species.py
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.request
from pathlib import Path

LISTS = [
    ("dr487", "AU-NSW", "NSW Sensitive Species List"),
    ("dr493", "AU-QLD", "Queensland Confidential Species"),
    ("dr494", "AU", "BirdLife Australia Sensitive Species List"),
]
ITEMS_URL = "https://lists-ws.ala.org.au/ws/speciesListItems/{uid}?max=10000&includeKVP=true"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "sensitive_species.csv"
FIELDS = ["scientific_name", "common_name", "applies_in", "list", "generalisation"]


def fetch(uid: str) -> list:
    request = urllib.request.Request(ITEMS_URL.format(uid=uid), headers={"User-Agent": "soundscape-atlas-build"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    rows = []
    for uid, applies_in, name in LISTS:
        try:
            items = fetch(uid)
        except OSError as error:
            print(f"error: could not fetch {name} ({uid}): {error}", file=sys.stderr)
            return 1
        for item in items:
            extra = {kv.get("key"): kv.get("value") for kv in item.get("kvpValues") or []}
            scientific = (item.get("name") or extra.get("verbatimScientificName") or "").strip()
            if not scientific:
                continue
            rows.append({
                "scientific_name": scientific,
                "common_name": (item.get("commonName") or extra.get("vernacularName") or "").strip(),
                "applies_in": applies_in,
                "list": f"{name} ({uid})",
                "generalisation": (extra.get("generalisation") or ("10km" if uid == "dr494" else "")).strip(),
            })
        print(f"{name}: {len(items)} taxa")

    rows.sort(key=lambda r: (r["applies_in"], r["scientific_name"].casefold()))
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} rows to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
