# -*- coding: utf-8 -*-
"""
Fold Muse's per-slice reel tags (5 rows per reel) into ONE row per reel, in Muse's column format.

    python -I reel_aggregate.py <slice.csv> [<slice.csv> ...] --out reel_tags.csv

The reel is the thing a visitor watches, so the child verdict is the WORST of its slices:
any `yes` makes the reel `yes`, else any `unsure` makes it `unsure`, and only a reel whose every
slice says `no` is `no`. (Five frames are a sample of a 20-30 second video, so even `no` is
"no identifiable child in the frames Muse saw".) Tags are the union across slices; party_type,
venue and theme are the most common non-empty value; quality is the median; confidence is the lowest.
"""
import argparse
import collections
import csv
import statistics
import sys

ORDER = {"yes": 2, "unsure": 1, "no": 0}
CONF = {"low": 0, "medium": 1, "high": 2}
COLS = ["ig_permalink", "slide_index", "media_url", "posted_at", "media_type", "party_type", "venue", "theme_slug",
        "activities", "decor_tags", "description", "identifiable_child_face", "people_count", "quality", "confidence", "notes"]


def commonest(vals, skip=("", "none", "unsure", "not_a_party")):
    c = collections.Counter(v for v in vals if v not in skip)
    return c.most_common(1)[0][0] if c else ""


def aggregate(rows):
    verdicts = [r["identifiable_child_face"].strip().lower() for r in rows]
    worst = max(verdicts, key=lambda v: ORDER.get(v, 1))
    uniq = lambda col: list(dict.fromkeys(t for r in rows for t in r[col].split("|") if t))
    quals = [float(r["quality"]) for r in rows if r["quality"]]
    best = max(rows, key=lambda r: (float(r["quality"] or 0), r["description"]))
    people = max(int(r["people_count"] or 0) for r in rows)
    pts = [r["party_type"] for r in rows]
    return {
        "ig_permalink": rows[0]["ig_permalink"],
        "slide_index": "1",
        "media_url": "",
        "posted_at": rows[0]["posted_at"],
        "media_type": "video_thumbnail",
        "party_type": commonest(pts) or "not_a_party",
        "venue": commonest([r["venue"] for r in rows]) or "unsure",
        "theme_slug": commonest([r["theme_slug"] for r in rows]) or "none",
        "activities": "|".join(uniq("activities")),
        "decor_tags": "|".join(uniq("decor_tags")),
        "description": best["description"],
        "identifiable_child_face": worst,
        "people_count": str(people),
        "quality": str(round(statistics.median(quals))) if quals else "",
        "confidence": min((r["confidence"] for r in rows), key=lambda c: CONF.get(c, 1)),
        "notes": f"reel of {len(rows)} sampled frames; child verdicts {dict(collections.Counter(verdicts))}",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slices", nargs="+")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    by = collections.OrderedDict()
    for p in a.slices:
        for r in csv.DictReader(open(p, encoding="utf-8-sig", newline="")):
            by.setdefault(r["ig_permalink"], []).append(r)
    out = [aggregate(v) for v in by.values()]
    with open(a.out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(out)
    c = collections.Counter(r["identifiable_child_face"] for r in out)
    print(f"{len(out)} reels from {sum(len(v) for v in by.values())} slice rows; reel-level child verdict {dict(c)}")


if __name__ == "__main__":
    sys.exit(main())
