# -*- coding: utf-8 -*-
"""
List the reels in an Instagram data export (reels.json) and, optionally, match them to Muse's reel tags.

    python -I ig_export_reels.py <export_dir> [--muse <csv> ...] [--out <csv>]

Reads ONLY your_instagram_activity/media/reels.json and the media files it names. It never opens
messages, comments, searches or any other part of the export, which holds personal data.

Instagram's export writes UTF-8 text as if it were Latin-1 ("mojibake"); captions are repaired here.
The export has no shortcode, so a reel is matched to Muse's rows by DATE (Muse's posted_at is a date)
and, where several reels share a date, by caption words against Muse's description.
"""
import argparse
import csv
import datetime
import json
import os
import re
import sys


def fix(s):
    try:
        return s.encode("latin1").decode("utf8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        return s


def load_reels(export):
    path = os.path.join(export, "your_instagram_activity", "media", "reels.json")
    data = json.load(open(path, encoding="utf-8"))["ig_reels_media"]
    out = []
    for item in data:
        for m in item["media"]:
            uri = m["uri"]
            full = os.path.normpath(os.path.join(export, uri))
            ts = m["creation_timestamp"]
            out.append({
                "uri": uri,
                "file": full if os.path.exists(full) else "",
                "bytes": os.path.getsize(full) if os.path.exists(full) else 0,
                "ts": ts,
                "date_utc": datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).date().isoformat(),
                "caption": fix(m.get("title", "")),
            })
    return sorted(out, key=lambda r: r["ts"])


WORD = re.compile(r"[a-z]{4,}")


def words(s):
    return set(WORD.findall(s.lower()))


def scan_reel(path, yn, step_s=1.0, side=960):
    """One frame every `step_s` seconds through the whole video; YuNet at a low threshold.
    Returns (frames, frames_with_face, max_faces_in_a_frame, biggest_face_fraction_of_frame_width)."""
    import cv2

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return None
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    n = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    dur = n / fps if fps else 0
    t, frames, with_face, max_faces, biggest = 0.0, 0, 0, 0, 0.0
    while t <= dur:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, bgr = cap.read()
        if not ok:
            break
        h, w = bgr.shape[:2]
        s = side / max(h, w)
        if s < 1:
            bgr = cv2.resize(bgr, (int(w * s), int(h * s)))
            h, w = bgr.shape[:2]
        yn.setInputSize((w, h))
        _, det = yn.detect(bgr)
        faces = [] if det is None else [d for d in det if float(d[-1]) >= 0.5]
        frames += 1
        if faces:
            with_face += 1
            max_faces = max(max_faces, len(faces))
            biggest = max(biggest, max(float(d[2]) for d in faces) / w)
        t += step_s
    cap.release()
    return frames, with_face, max_faces, round(biggest, 3)


def poster_frame(path, yn, step_s=0.5, side=960):
    """A still for a reel: a frame with NO face found (YuNet at 0.3, deliberately jumpy), nearest the middle
    of the video. None when every sampled frame has one. A still is only ever made for a reel Muse called
    face-free, and then only from a frame this check finds clean."""
    import cv2
    from PIL import Image

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return None
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    dur = (cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0) / fps
    times = []
    t = 0.0
    while t <= dur:
        times.append(t)
        t += step_s
    times.sort(key=lambda x: abs(x - dur / 2))
    for t in times:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, bgr = cap.read()
        if not ok:
            continue
        probe = bgr
        s = side / max(bgr.shape[:2])
        if s < 1:
            probe = cv2.resize(bgr, None, fx=s, fy=s)
        yn.setInputSize((probe.shape[1], probe.shape[0]))
        _, det = yn.detect(probe)
        if det is None or len(det) == 0:
            cap.release()
            return Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    cap.release()
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("--posters", help="reel_tags.csv: make a face-free still for each all-'no' reel that matches one export video")
    ap.add_argument("--yunet", help="path to the YuNet model (for --posters)")
    ap.add_argument("--posters-out", help="directory for <shortcode>.webp stills")
    ap.add_argument("--muse", nargs="*", default=[])
    ap.add_argument("--out")
    ap.add_argument("--scan", help="write a per-reel dense face scan CSV (1 frame/second) using the YuNet model at this path")
    ap.add_argument("--scan-out")
    a = ap.parse_args()
    reels = load_reels(a.export)
    if a.posters:
        import cv2

        os.makedirs(a.posters_out, exist_ok=True)
        yn = cv2.FaceDetectorYN.create(a.yunet, "", (320, 320), score_threshold=0.3, nms_threshold=0.3, top_k=50)
        tags = list(csv.DictReader(open(a.posters, encoding="utf-8-sig", newline="")))
        made = skipped_face = skipped_match = 0
        for t in tags:
            if t["identifiable_child_face"].strip().lower() != "no":
                continue
            code = t["ig_permalink"].rstrip("/").split("/")[-1]
            day = datetime.date.fromisoformat(t["posted_at"])
            cand = [r for r in reels if abs((datetime.date.fromisoformat(r["date_utc"]) - day).days) <= 1 and r["file"]]
            if len(cand) != 1:  # no video, or two videos that day: never guess which reel it is
                skipped_match += 1
                continue
            img = poster_frame(cand[0]["file"], yn)
            if img is None:
                skipped_face += 1
                continue
            img.thumbnail((1200, 1200))
            img.save(os.path.join(a.posters_out, code + ".webp"), "WEBP", quality=80)  # no exif/icc passed: metadata dropped
            made += 1
        print(f"posters: {made} made, {skipped_match} reels with no single matching export video, {skipped_face} with no face-free frame")
        return
    if a.scan:
        import cv2

        yn = cv2.FaceDetectorYN.create(a.scan, "", (320, 320), score_threshold=0.5, nms_threshold=0.3, top_k=50)
        out = []
        for i, r in enumerate(reels):
            res = scan_reel(r["file"], yn) if r["file"] else None
            frames, wf, mx, big = res if res else (0, 0, 0, 0.0)
            out.append({"uri": r["uri"], "date_utc": r["date_utc"], "frames": frames, "frames_with_face": wf, "max_faces": mx, "biggest_face_width_frac": big})
            print(f"  {i + 1}/{len(reels)} {r['uri']} frames={frames} with_face={wf}", flush=True)
        with open(a.scan_out, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
            w.writeheader()
            w.writerows(out)
        print("wrote", a.scan_out)
        return
    print(f"{len(reels)} reels in the export; {sum(1 for r in reels if r['file'])} with a file on disk; "
          f"{sum(r['bytes'] for r in reels) / 1e6:.0f} MB; {reels[0]['date_utc']} .. {reels[-1]['date_utc']}")
    muse = {}
    for p in a.muse:
        for row in csv.DictReader(open(p, encoding="utf-8-sig", newline="")):
            code = row["ig_permalink"].rstrip("/").split("/")[-1]
            muse.setdefault(code, []).append(row)
    print(f"{len(muse)} Muse reels")
    matches = {}
    for code, rows in muse.items():
        d = rows[0]["posted_at"]
        day = datetime.date.fromisoformat(d)
        cand = [r for r in reels if abs((datetime.date.fromisoformat(r["date_utc"]) - day).days) <= 1]
        desc = words(" ".join(x["description"] + " " + x["notes"] for x in rows))
        cand.sort(key=lambda r: -len(words(r["caption"]) & desc))
        matches[code] = cand
    exact = sum(1 for c in matches.values() if len(c) == 1)
    none = sum(1 for c in matches.values() if not c)
    many = sum(1 for c in matches.values() if len(c) > 1)
    print(f"match by date +-1 day: unique {exact}, ambiguous {many}, none {none}")
    if a.out:
        with open(a.out, "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["shortcode", "posted_at", "candidates", "best_uri", "best_caption_start"])
            for code, cand in matches.items():
                w.writerow([code, muse[code][0]["posted_at"], len(cand), cand[0]["uri"] if cand else "", (cand[0]["caption"][:60].replace("\n", " ") if cand else "")])
        print("wrote", a.out)


if __name__ == "__main__":
    sys.exit(main())
