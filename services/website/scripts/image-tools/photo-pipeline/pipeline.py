# -*- coding: utf-8 -*-
"""
Local photo -> photo-library candidate pipeline. LOCAL tooling; nothing here talks to the
network or to production, and nothing here approves a photo.

    python -I pipeline.py prefilter  [--limit N]
    python -I pipeline.py faces      <list.csv> [--col filename]
    python -I pipeline.py sheet      <list.csv> [--per 12] [--name pilot]
    python -I pipeline.py export     <tags.csv> [--name pilot]

Stages
  prefilter  existing catalog (content_scores_merged.csv + photo_scan_corrected.csv) -> photos only,
             no Haar face, sharp enough, not under/over-exposed, one frame per burst.
  faces      a STRONGER face check than the Haar cascade the first pass used: YuNet (ONNX, via OpenCV)
             at a low threshold + the profile cascade on both orientations. Writes face_flags.csv
             (file,faces,...) which the image tool belt's safety guard also reads.
  sheet      numbered contact sheets so a human (or a vision model) can tag them.
  export     tags.csv (Muse's columns) -> WebP <=1200px with ALL metadata dropped (EXIF/GPS/ICC) and a
             CSV in Muse's column format with a source_key, ready for an importer.

A face found is an automatic REJECT. A face NOT found is not proof of no child: the detector misses
profiles, tiny faces and faces turned away; those are what the human approval step is for.

Run with `python -I` (isolated), from a directory that holds no other scripts. Needs Pillow,
pillow_heif, opencv-python and numpy; the YuNet model at <out>/models/yunet.onnx (opencv_zoo,
face_detection_yunet_2023mar.onnx, 232,589 bytes).
"""
import argparse
import csv
import hashlib
import os
import sys
from datetime import datetime, timedelta

import cv2
import numpy as np
import pillow_heif
from PIL import Image, ImageDraw, ImageOps

pillow_heif.register_heif_opener()

def _primary_root():
    """The primary checkout (the dir holding the real .git), even from a worktree."""
    import subprocess
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        common = subprocess.check_output(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                                         cwd=here, text=True, stderr=subprocess.DEVNULL).strip()
        return os.path.dirname(common)
    except Exception:
        sys.exit("not inside the repository; set IMAGE_TOOLS_OUT / HH_CATALOG_DIR")


SRC = os.environ.get("HH_PHOTO_SRC") or os.path.join(os.path.expanduser("~"), "Pictures", "HostHampton-Content")
OUT = os.environ.get("IMAGE_TOOLS_OUT") or os.path.join(_primary_root(), "audit_scratch", "image-tools")
# The earlier catalog pass (content_scores_merged.csv, photo_scan_corrected.csv) lives in audit_scratch/.
CATALOG = os.environ.get("HH_CATALOG_DIR") or os.path.join(_primary_root(), "audit_scratch")
YUNET = os.path.join(OUT, "models", "yunet.onnx")

# Muse's columns, in Muse's order, plus the two a local file needs instead of an Instagram link.
MUSE_COLS = ["ig_permalink", "slide_index", "media_url", "posted_at", "media_type", "party_type", "venue",
             "theme_slug", "activities", "decor_tags", "description", "identifiable_child_face",
             "people_count", "quality", "confidence", "notes"]
# The phone-album importer on the site reads Muse's columns: ig_permalink = a private album reference (hashed on the server,
# never stored), media_url = items/<file>. We mirror that so one importer serves both.
LOCAL_COLS = MUSE_COLS

# Vocabulary Muse used (242 rows, 5 batches). A tag outside it is a mistake, not a new tag.
PARTY_TYPES = {"in_studio_theme", "mobile_party", "public_event", "not_a_party"}
VENUES = {"studio", "at_home", "outside_venue", "unsure"}
THEMES = {"custom", "trucker-hat-party", "swiftie-party", "glow-party", "kpop-party", "barbie-party",
          "sweets-treats", "spa-party", "toddler-party", "slime-party", "race-car-party",
          "sleep-under-party", "none"}


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path, cols, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def load(path, max_side=None):
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    if max_side and max(img.size) > max_side:
        s = max_side / max(img.size)
        img = img.resize((max(1, int(img.width * s)), max(1, int(img.height * s))), Image.LANCZOS)
    return img


def src_hash(path):
    """Stable id from the file's content (size + first MB), so '(1)' copies of one picture collide."""
    h = hashlib.sha1()
    h.update(str(os.path.getsize(path)).encode())
    with open(path, "rb") as f:
        h.update(f.read(1 << 20))
    return h.hexdigest()[:12]


# ── prefilter ─────────────────────────────────────────────────────────────────────────────────
def cmd_prefilter(a):
    scores = read_csv(os.path.join(CATALOG, "content_scores_merged.csv"))
    dates = {r["filename"]: r["capture_date"] for r in read_csv(os.path.join(CATALOG, "photo_scan_corrected.csv"))}
    stats = {"scored": len(scores)}
    photos = [r for r in scores if r["type"] == "photo"]
    stats["photos"] = len(photos)
    nf = [r for r in photos if int(float(r["faces"])) == 0]
    stats["no_haar_face"] = len(nf)
    ok = [r for r in nf if float(r["sharpness"]) >= a.min_sharp and a.min_bright <= float(r["brightness"]) <= a.max_bright]
    stats["sharp_and_exposed"] = len(ok)
    for r in ok:
        r["capture_date"] = dates.get(r["filename"], "")
    ok.sort(key=lambda r: r["capture_date"])
    clusters, cur, last = [], [], None
    for r in ok:
        try:
            t = datetime.fromisoformat(r["capture_date"])
        except ValueError:
            t = None
        if cur and t is not None and last is not None and (t - last) <= timedelta(seconds=a.burst_secs):
            cur.append(r)
        else:
            if cur:
                clusters.append(cur)
            cur = [r]
        last = t
    if cur:
        clusters.append(cur)
    keep = []
    for c in clusters:
        best = max(c, key=lambda r: float(r["sharpness"]))
        best["burst_size"] = len(c)
        keep.append(best)
    stats["after_burst_dedupe"] = len(keep)
    stats["burst_frames_dropped"] = len(ok) - len(keep)
    write_csv(os.path.join(OUT, "photo-pilot", "prefilter.csv"),
              ["filename", "capture_date", "sharpness", "brightness", "width", "height", "burst_size"], keep)
    for k, v in stats.items():
        print(f"{k:24s}{v}")
    print("wrote", os.path.join(OUT, "photo-pilot", "prefilter.csv"))


# ── faces ─────────────────────────────────────────────────────────────────────────────────────
def make_detectors():
    if not os.path.exists(YUNET):
        sys.exit(f"missing {YUNET} (opencv_zoo face_detection_yunet_2023mar.onnx)")
    yn = cv2.FaceDetectorYN.create(YUNET, "", (320, 320), score_threshold=0.3, nms_threshold=0.3, top_k=50)
    prof = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
    return yn, prof


def count_faces(path, yn, prof):
    img = load(path, 1280)
    bgr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]
    yn.setInputSize((w, h))
    _, det = yn.detect(bgr)
    scores = [] if det is None else [float(d[-1]) for d in det]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    p = len(prof.detectMultiScale(gray, 1.1, 5, minSize=(40, 40)))
    p += len(prof.detectMultiScale(cv2.flip(gray, 1), 1.1, 5, minSize=(40, 40)))
    # Conservative on purpose: any YuNet hit >=0.3 counts, and a profile hit counts when YuNet found nothing.
    faces = len(scores) + (1 if (p > 0 and not scores) else 0)
    return faces, len(scores), p, max(scores) if scores else 0.0


def cmd_faces(a):
    rows = read_csv(a.list)
    yn, prof = make_detectors()
    out = []
    for i, r in enumerate(rows):
        fn = r[a.col]
        path = os.path.join(SRC, fn)
        try:
            faces, ny, p, mx = count_faces(path, yn, prof)
        except Exception as e:  # unreadable is NOT "no faces": flag it
            faces, ny, p, mx = -1, 0, 0, 0.0
            print("unreadable", fn, type(e).__name__)
        out.append({"file": fn, "faces": faces, "yunet": ny, "profile": p, "max_score": f"{mx:.2f}"})
        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{len(rows)}", flush=True)
    # APPEND-merge into the shared flags file the tool belt's safety guard reads.
    path = os.path.join(OUT, "face_flags.csv")
    have = {r["file"].lower(): r for r in read_csv(path)} if os.path.exists(path) else {}
    for r in out:
        have[r["file"].lower()] = r
    write_csv(path, ["file", "faces", "yunet", "profile", "max_score"], list(have.values()))
    clean = sum(1 for r in out if r["faces"] == 0)
    print(f"checked {len(out)}: {clean} with no face found, {sum(1 for r in out if r['faces'] > 0)} flagged, "
          f"{sum(1 for r in out if r['faces'] < 0)} unreadable -> {path}")


# ── contact sheets ────────────────────────────────────────────────────────────────────────────
def cmd_sheet(a):
    rows = read_csv(a.list)
    outdir = os.path.join(OUT, "photo-pilot", "sheets")
    os.makedirs(outdir, exist_ok=True)
    cols = 4
    cell_w, cell_h = 400, 400
    n = 0
    for s in range(0, len(rows), a.per):
        chunk = rows[s:s + a.per]
        nrows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cell_w, nrows * (cell_h + 22)), (24, 24, 24))
        d = ImageDraw.Draw(sheet)
        for i, r in enumerate(chunk):
            img = load(os.path.join(SRC, r["filename"]), 800)
            img.thumbnail((cell_w - 6, cell_h - 6))
            x, y = (i % cols) * cell_w, (i // cols) * (cell_h + 22)
            sheet.paste(img, (x + 3, y + 3))
            d.text((x + 6, y + cell_h + 4), f"#{s + i + 1}  {r['filename']}", fill=(235, 235, 235))
        p = os.path.join(outdir, f"{a.name}_{s // a.per + 1:02d}.jpg")
        sheet.save(p, quality=82)
        n += 1
        print("sheet", p)
    print(f"{n} sheet(s)")


# ── export ────────────────────────────────────────────────────────────────────────────────────
def cmd_export(a):
    tags = read_csv(a.tags)
    flags_path = os.path.join(OUT, "face_flags.csv")
    if not os.path.exists(flags_path):
        sys.exit("run `faces` first: export refuses photos with no face check on record")
    flags = {r["file"].lower(): int(r["faces"]) for r in read_csv(flags_path)}
    # posted_at defaults to the capture date the earlier catalog pass recorded (date only; no time).
    captured = {}
    for src in (os.path.join(CATALOG, "photo_scan_corrected.csv"),):
        if os.path.exists(src):
            captured = {r["filename"]: r["capture_date"][:10] for r in read_csv(src)}
    webp_dir = os.path.join(OUT, "photo-pilot", a.name + "-webp")
    os.makedirs(webp_dir, exist_ok=True)
    out, refused = [], []
    for t in tags:
        fn = t["filename"]
        n = flags.get(fn.lower())
        if n is None or n != 0:
            refused.append((fn, "no face check on record" if n is None else f"face check found {n}"))
            continue
        if (t.get("identifiable_child_face") or "").lower() != "no":
            refused.append((fn, "tagger did not say identifiable_child_face=no"))
            continue
        if t.get("party_type") not in PARTY_TYPES or t.get("venue") not in VENUES or t.get("theme_slug") not in THEMES:
            refused.append((fn, "tag outside Muse's vocabulary"))
            continue
        path = os.path.join(SRC, fn)
        h = src_hash(path)
        img = load(path)
        img.thumbnail((1200, 1200), Image.LANCZOS)
        dest = os.path.join(webp_dir, f"local-{h}.webp")
        img.save(dest, "WEBP", quality=80)  # no exif=, no icc_profile=  ->  metadata dropped
        chk = Image.open(dest)
        if chk.getexif() or chk.info.get("exif") or chk.info.get("icc_profile"):
            sys.exit(f"metadata survived the re-encode on {fn}; refusing")
        row = {c: t.get(c, "") for c in MUSE_COLS}
        row.update({"ig_permalink": f"studio-library-{a.name}", "media_url": f"items/{os.path.basename(dest)}", "slide_index": "1",
                    "media_type": "image", "posted_at": (t.get("posted_at") or captured.get(fn, ""))[:10]})
        out.append(row)
    write_csv(os.path.join(OUT, "photo-pilot", a.name + "-album.csv"), LOCAL_COLS, out)
    print(f"exported {len(out)} of {len(tags)}; refused {len(refused)}")
    for fn, why in refused:
        print("  refused", fn, "-", why)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prefilter")
    p.add_argument("--min-sharp", type=float, default=300)
    p.add_argument("--min-bright", type=float, default=80)
    p.add_argument("--max-bright", type=float, default=210)
    p.add_argument("--burst-secs", type=int, default=90)
    p.set_defaults(fn=cmd_prefilter)
    p = sub.add_parser("faces")
    p.add_argument("list")
    p.add_argument("--col", default="filename")
    p.set_defaults(fn=cmd_faces)
    p = sub.add_parser("sheet")
    p.add_argument("list")
    p.add_argument("--per", type=int, default=12)
    p.add_argument("--name", default="pilot")
    p.set_defaults(fn=cmd_sheet)
    p = sub.add_parser("export")
    p.add_argument("tags")
    p.add_argument("--name", default="pilot")
    p.set_defaults(fn=cmd_export)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
