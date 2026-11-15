"""
Copies the French (Louis Segond 1910) New Testament recordings from Bible Brain into Supabase Storage.

Bible Brain's license only allows keeping copies of filesets on your key's download list
(GET /download/list). Two Louis Segond 1910 recordings are on it, both 64 kbps MP3 and the same
translation as our French text:
    FRNTLSN2DA  dramatized (several voices, background music), the whole New Testament  [default]
    FRNTLSN1DA  one reader, but only the Gospel of John
Use one per bucket: pick it with --fileset. The recordings must be credited in the app:
    "Audio: Used by Permission Tresorsonore: www.tresorsonore.com"

Each chapter is saved in the public bucket LSG1910_NT_audio, named like the Spanish files
    40_Mat001.mp3   ->  book 40 (Matthew), chapter 1
so app.import_audio can link them to the chapters afterwards.

Run from the backend folder with the venv active:

  python -m app.fetch_bible_brain_audio --check      ask Bible Brain about every chapter and show what is
                                                     missing and how much storage it needs (copies nothing)
  python -m app.fetch_bible_brain_audio              download each chapter and upload it to the bucket
  python -m app.fetch_bible_brain_audio --books John "1 John"    just some books
  python -m app.import_audio --lang fr               then save each chapter's link in chapters.audio_url_fr

Needs in backend/.env (see env.example): BIBLE_BRAIN_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY.

Safe to run again: files already in the bucket are skipped, so an interrupted run just carries on.
"""
import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request

from app.config import settings
from app.import_audio import AUDIO, _storage_headers, list_bucket
from app.services.bible_import import NEW_TESTAMENT

FILESETS = ("FRNTLSN2DA", "FRNTLSN1DA")  # the first is the default
BUCKET = AUDIO["fr"][0]
API = "https://4.dbt.io/api"
FREE_PLAN_GB = 1.0  # Supabase's free plan allows 1 GB of files across all buckets (the database is counted separately)


def file_name(order: int, code: str, chapter: int) -> str:
    """(40, "MAT", 1) -> "40_Mat001.mp3", (46, "1CO", 13) -> "46_1Co013.mp3": the pattern app.import_audio reads."""
    split = 2 if code[0].isdigit() else 1  # keep "1C" of "1CO" upper case, like the Spanish files
    return f"{order}_{code[:split]}{code[split:].lower()}{chapter:03d}.mp3"


# ---------------------------------------------------------------- Bible Brain


def _get_json(url: str) -> dict:
    """GET a Bible Brain URL. Waits and retries once if we hit the rate limit (1500 requests an hour)."""
    for attempt in range(2):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return {"data": []}
            if err.code == 429 and attempt == 0:
                print("  Bible Brain says slow down; waiting a minute...")
                time.sleep(60)
                continue
            if err.code == 401:
                raise SystemExit("Bible Brain refused the key (401). Check BIBLE_BRAIN_API_KEY in backend/.env.")
            raise SystemExit(f"Bible Brain error {err.code} for {url.split('?')[0]}")
    raise SystemExit("Bible Brain kept refusing requests; try again later.")


def chapter_file(fileset: str, code: str, chapter: int) -> dict | None:
    """The chapter's download info ({path, filesize_in_bytes, ...}) or None if Bible Brain has no recording."""
    if not settings.bible_brain_api_key:
        raise SystemExit("BIBLE_BRAIN_API_KEY must be set in backend/.env (your key from 4.dbt.io).")
    query = urllib.parse.urlencode({"v": 4, "key": settings.bible_brain_api_key})
    data = _get_json(f"{API}/download/{fileset}/{code}/{chapter}?{query}").get("data") or []
    # One row per file. A chapter is a single file; take the one that starts at this chapter.
    rows = [r for r in data if r.get("path") and int(r.get("chapter_start") or chapter) == chapter]
    return rows[0] if rows else None


def with_retries(label: str, action):
    """Run action(), trying again a few times if the connection drops (big uploads sometimes do)."""
    for attempt in range(1, 5):
        try:
            return action()
        except (urllib.error.URLError, ConnectionError, TimeoutError) as err:
            if isinstance(err, urllib.error.HTTPError) or attempt == 4:
                raise
            print(f"  {label}: connection problem ({err}); trying again in {10 * attempt} s")
            time.sleep(10 * attempt)


def download(url: str) -> bytes:
    """The MP3 itself. The link is signed and expires after about a day, so it is used straight away."""
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


# ---------------------------------------------------------------- Supabase Storage


def _storage(path: str, body: bytes | None = None, extra: dict | None = None, method: str = "POST"):
    url = f"{settings.supabase_url.rstrip('/')}/storage/v1/{path}"
    headers = {**_storage_headers(), **(extra or {})}
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8") or "null")


def storage_used_bytes() -> int:
    """Total size of every file in every bucket."""
    total = 0
    for bucket in _storage("bucket", method="GET"):
        offset = 0
        while True:
            body = json.dumps({"prefix": "", "limit": 1000, "offset": offset}).encode("utf-8")
            items = _storage(f"object/list/{bucket['id']}", body)
            total += sum((item.get("metadata") or {}).get("size", 0) for item in items if item.get("id"))
            if len(items) < 1000:
                break
            offset += 1000
    return total


def ensure_bucket() -> None:
    """Make the public bucket if it doesn't exist yet (the app streams from public links)."""
    if any(b["id"] == BUCKET for b in _storage("bucket", method="GET")):
        return
    _storage("bucket", json.dumps({"id": BUCKET, "name": BUCKET, "public": True}).encode("utf-8"))
    print(f"Created the public bucket {BUCKET}.")


def bucket_files() -> set[str]:
    try:
        return set(list_bucket(BUCKET))
    except SystemExit:
        return set()  # the bucket doesn't exist yet


def upload(name: str, mp3: bytes) -> None:
    _storage(
        f"object/{BUCKET}/{urllib.parse.quote(name)}",
        mp3,
        {"Content-Type": "audio/mpeg", "x-upsert": "true", "cache-control": "max-age=31536000"},
    )


# ---------------------------------------------------------------- the run


def run(fileset: str, write: bool, only_books: list[str] | None, max_gb: float) -> None:
    books = [b for b in NEW_TESTAMENT if not only_books or b[0].lower() in only_books]
    if not books:
        raise SystemExit(f"No matching books. Choose from: {', '.join(b[0] for b in NEW_TESTAMENT)}")

    have = bucket_files()
    todo: list[tuple[str, str, int, dict]] = []  # (label, file name, size, info)
    missing: list[str] = []
    print(f"Asking Bible Brain about {sum(b[3] for b in books)} chapters of {fileset}...")
    for name, code, order, chapter_count in books:
        for chapter in range(1, chapter_count + 1):
            target = file_name(order, code, chapter)
            if target in have:
                continue
            info = chapter_file(fileset, code, chapter)
            if info is None:
                missing.append(f"{name} {chapter}")
                continue
            todo.append((f"{name} {chapter}", target, int(info.get("filesize_in_bytes") or 0), info))
        print(f"  {name}: done")

    new_bytes = sum(size for _, _, size, _ in todo)
    used = storage_used_bytes()
    after_gb = (used + new_bytes) / 1e9
    print("\n=== Summary ===")
    print(f"Already in {BUCKET}: {len(have)}   to copy: {len(todo)} ({new_bytes / 1e6:.0f} MB)")
    print(f"Storage used now (all buckets): {used / 1e6:.0f} MB   after copying: {after_gb * 1000:.0f} MB")
    if missing:
        print(f"\n{len(missing)} chapters have no French recording on Bible Brain (they will keep text-to-speech):")
        print("  " + ", ".join(missing[:60]) + (" ..." if len(missing) > 60 else ""))

    if after_gb > max_gb:
        print(
            f"\nThat is more than {max_gb:g} GB, the limit this run is allowed (Supabase's free plan is "
            f"{FREE_PLAN_GB:g} GB of files). Free up space, copy only some books with --books, "
            "or raise --max-gb if your plan has more room."
        )
        if write:
            raise SystemExit("Nothing was copied.")
    if not write:
        print("\nNothing was copied. Run without --check to download and upload these files.")
        return

    ensure_bucket()
    for done, (label, target, _, info) in enumerate(todo, start=1):
        mp3 = with_retries(label, lambda: download(info["path"]))
        if len(mp3) < 1000:
            raise SystemExit(f"{label}: the download was only {len(mp3)} bytes, so it is not a recording. Stopped.")
        with_retries(label, lambda: upload(target, mp3))
        print(f"  [{done}/{len(todo)}] {label} -> {target} ({len(mp3) / 1e6:.1f} MB)")
    print(f"\nCopied {len(todo)} files. Now run:  python -m app.import_audio --lang fr --check")


def main() -> None:
    parser = argparse.ArgumentParser(description="Copy the French NT recordings from Bible Brain into Supabase Storage.")
    parser.add_argument("--fileset", choices=FILESETS, default=FILESETS[0],
                        help="which recording: FRNTLSN2DA dramatized, whole NT (default); FRNTLSN1DA one reader, John only")
    parser.add_argument("--check", action="store_true", help="show what would be copied and the storage it needs; copy nothing")
    parser.add_argument("--books", nargs="+", help='only these books, e.g. --books John "1 John"')
    parser.add_argument("--max-gb", type=float, default=FREE_PLAN_GB,
                        help="refuse to go past this much storage in total (default: the free plan's 1 GB)")
    args = parser.parse_args()
    run(args.fileset, write=not args.check, only_books=[b.lower() for b in args.books] if args.books else None, max_gb=args.max_gb)


if __name__ == "__main__":
    main()
