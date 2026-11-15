#!/usr/bin/env python3
"""Build Same Page's puzzle dataset from Wikipedia.

Same Page is a static two-player game. Each puzzle is a parent Wikipedia
article plus two names linked from the article's lead. This script does all
the network work up front so the browser only has to read data.json.

The Wikimedia API rate-limits this host to roughly 10 requests per minute, so
the builder batches aggressively: article wikitext is fetched 20 pages per
request, and item info plus redirect aliases are fetched 50 titles per request.

Usage:
    py -3 build_dataset.py
    py -3 build_dataset.py --limit 30 --pairs 3 --verbose
    py -3 build_dataset.py --month 2026-10 --refresh

Raw API responses are cached in .cache/ (gzip) so an interrupted run can
resume without refetching. The cache is safe to delete.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import html
import json
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

API = "https://en.wikipedia.org/w/api.php"
PAGEVIEWS = (
    "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/"
    "en.wikipedia/all-access/{year}/{month:02d}/all-days"
)
VITAL = "https://en.wikipedia.org/wiki/Wikipedia:Vital_articles/data/{key}.json?action=raw"
VITAL_KEYS = [chr(c) for c in range(ord("A"), ord("Z") + 1)] + ["others"]

DEFAULT_MONTH = "2026-10"
MIN_ARTICLE_BYTES = 3000
DEFAULT_PAIRS = 3
PARENT_SIMILARITY = 0.85
MAX_ALIASES = 8
REVISION_BATCH = 20
INFO_BATCH = 50
REQUESTS_PER_MINUTE = 9.0
USER_AGENT = "SamePageGameBuilder/1.0"
CACHE_DIR = Path(__file__).resolve().parent / ".cache"

NAMESPACE_PREFIXES = {
    "file", "image", "category", "help", "wikipedia", "portal", "special",
    "template", "talk", "draft", "module", "mediawiki", "user", "book",
    "timedtext", "file talk", "category talk", "template talk",
    "wikipedia talk", "portal talk", "help talk", "module talk",
    "mediawiki talk", "user talk", "draft talk", "book talk",
}

LIST_PREFIXES = (
    "List of ", "Lists of ", "Index of ", "Outline of ", "Timeline of ",
    "Glossary of ", "Bibliography of ", "Deaths in ",
)

ADULT_TITLES = {
    "pornhub", "sex", "sexual intercourse", "pornography", "masturbation",
    ".xxx", "xxx (film series)", "xnxx", "xvideos", "onlyfans", "hentai",
    "erotic", "erotica", "nudity", "nude", "incest", "rape", "bestiality",
    "pedophilia", "child pornography", "adult film", "pornographic film",
    "sex position", "orgasm", "prostitution", "striptease", "sexual arousal",
    "human sexual activity", "sexual orientation", "sexual abuse",
    "child sexual abuse", "sexual assault", "sexual violence",
}

ADULT_RE = re.compile(
    r"\b(?:sex|porn|pornographic|erotic|erotica|hentai|nudity|nude|"
    r"masturbation|orgasm|prostitution|striptease|incest|bestiality|"
    r"pedophilia|rape|onlyfans|xnxx|xvideos|sexual abuse|sexual assault|"
    r"sexual violence|child sexual abuse)\b",
    re.IGNORECASE,
)

DEMONYMS = {
    "american", "british", "english", "french", "german", "italian",
    "spanish", "portuguese", "dutch", "belgian", "swiss", "austrian",
    "polish", "russian", "ukrainian", "irish", "scottish", "welsh",
    "canadian", "australian", "new zealander", "indian", "chinese",
    "japanese", "korean", "vietnamese", "thai", "indonesian", "filipino",
    "mexican", "brazilian", "argentine", "chilean", "peruvian", "colombian",
    "venezuelan", "cuban", "egyptian", "nigerian", "kenyan",
    "south african", "ethiopian", "moroccan", "turkish", "iranian", "iraqi",
    "israeli", "saudi", "pakistani", "bangladeshi", "afghan", "greek",
    "roman", "swedish", "norwegian", "danish", "finnish", "icelandic",
    "czech", "slovak", "hungarian", "romanian", "bulgarian", "serbian",
    "croatian", "bosnian", "albanian", "georgian", "armenian",
    "azerbaijani", "kazakh", "uzbek", "nepalese", "sri lankan", "burmese",
}

GENERIC_NAMES = {
    "film", "movie", "actor", "actress", "singer", "songwriter", "musician",
    "rapper", "album", "song", "single", "band", "group", "artist", "writer",
    "author", "novelist", "poet", "director", "producer", "company",
    "organization", "organisation", "university", "college", "school", "city",
    "town", "village", "municipality", "county", "state", "province",
    "country", "government", "political party", "newspaper", "magazine",
    "website", "television", "series", "program", "show", "video game",
    "game", "software", "operating system", "service", "product", "brand",
    "genre", "style", "novel", "footballer", "basketball player", "baseball player",
    "athlete", "player", "coach", "team", "league", "competition",
    "championship", "president", "prime minister", "king", "queen",
    "popular music", "president of the united states",
    "vice president of the united states",
}

GENERIC_ADJECTIVES = {
    "economic", "political", "social", "cultural", "military", "religious",
    "scientific", "technical", "legal", "physical", "chemical", "biological",
    "historical", "geographical", "mathematical", "philosophical", "medical",
    "industrial", "agricultural", "commercial", "financial", "governmental",
    "national", "international", "local", "regional", "global", "public",
    "private", "official", "formal", "informal",
}

ORDINAL_RE = re.compile(
    r"^(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|"
    r"eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|"
    r"seventeenth|eighteenth|nineteenth|twentieth|\d+(?:st|nd|rd|th))$",
    re.IGNORECASE,
)

DATE_RE = re.compile(
    r"^(?:\d{1,4}(?:\s*(?:BC|BCE|AD|CE))?|\d{3,4}s|"
    r"(?:January|February|March|April|May|June|July|August|September|"
    r"October|November|December)(?:\s+\d{1,2})?(?:,?\s+\d{4})?)$",
    re.IGNORECASE,
)
YEAR_IN_RE = re.compile(r"^\d{4}\s+in\s+", re.IGNORECASE)

PAIR_STOPWORDS = {
    "the", "of", "and", "in", "a", "an", "for", "to", "on", "with", "by",
    "from", "at", "as", "is", "are",
}


# ---------------------------------------------------------------------------
# HTTP + cache
# ---------------------------------------------------------------------------

class RateLimiter:
    def __init__(self, per_minute: float):
        self.interval = 60.0 / per_minute
        self.lock = threading.Lock()
        self.next_at = 0.0

    def wait(self) -> None:
        with self.lock:
            now = time.monotonic()
            delay = max(0.0, self.next_at - now)
            self.next_at = max(now, self.next_at) + self.interval
        if delay:
            time.sleep(delay)


LIMITER = RateLimiter(REQUESTS_PER_MINUTE)


def _cache_path(url: str) -> Path:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:28]
    return CACHE_DIR / f"{digest}.gz"


def fetch_text(url: str, *, refresh: bool = False, retries: int = 5) -> str:
    path = _cache_path(url)
    if path.exists() and not refresh:
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            return fh.read()

    headers = {
        "User-Agent": USER_AGENT,
        "Accept-Encoding": "identity",
        "Accept": "application/json, text/plain, */*",
    }
    last_error: Exception | None = None
    for attempt in range(retries):
        LIMITER.wait()
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as resp:
                text = resp.read().decode("utf-8")
            path.parent.mkdir(parents=True, exist_ok=True)
            with gzip.open(path, "wt", encoding="utf-8") as fh:
                fh.write(text)
            return text
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code in (429, 503):
                retry_after = exc.headers.get("Retry-After")
                delay = int(retry_after) if retry_after and retry_after.isdigit() else 20
                print(f"  rate limited ({exc.code}), waiting {delay}s", flush=True)
                time.sleep(delay)
                continue
            if exc.code == 404:
                raise
            time.sleep(2 ** attempt)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            time.sleep(2 ** attempt)
    raise RuntimeError(f"request failed after {retries} tries: {url}") from last_error


def fetch_json(url: str, *, refresh: bool = False) -> dict:
    return json.loads(fetch_text(url, refresh=refresh))


def url_for(*, action: str, **params) -> str:
    query = {"action": action, "format": "json", "formatversion": "2"}
    query.update(params)
    return f"{API}?{urllib.parse.urlencode(query)}"


def chunks(seq: list[str], size: int):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def norm_title_key(title: str) -> str:
    return re.sub(r"\s+", " ", (title or "").replace("_", " ")).strip().casefold()


# ---------------------------------------------------------------------------
# Wikitext lead parsing
# ---------------------------------------------------------------------------

def remove_templates(text: str) -> str:
    """Drop balanced {{...}} blocks, including nested templates."""
    out: list[str] = []
    depth = 0
    i = 0
    while i < len(text):
        if text.startswith("{{", i):
            depth += 1
            i += 2
        elif text.startswith("}}", i) and depth:
            depth -= 1
            i += 2
        else:
            if depth == 0:
                out.append(text[i])
            i += 1
    return "".join(out)


def remove_tables(text: str) -> str:
    """Drop balanced {| ... |} wikitext tables, including nested tables."""
    out: list[str] = []
    depth = 0
    i = 0
    while i < len(text):
        if text.startswith("{|", i):
            depth += 1
            i += 2
        elif text.startswith("|}", i) and depth:
            depth -= 1
            i += 2
        else:
            if depth == 0:
                out.append(text[i])
            i += 1
    return "".join(out)


def remove_namespace_links(text: str) -> str:
    """Drop [[File:...]], [[Image:...]], [[Category:...]] and their captions."""
    prefixes = {"file", "image", "category"}
    out: list[str] = []
    i = 0
    while True:
        start = text.find("[[", i)
        if start < 0:
            out.append(text[i:])
            break
        out.append(text[i:start])
        depth, j = 1, start + 2
        while j < len(text) and depth:
            if text.startswith("[[", j):
                depth += 1
                j += 2
            elif text.startswith("]]", j):
                depth -= 1
                j += 2
            else:
                j += 1
        inner = text[start + 2:j - 2]
        target = inner.split("|", 1)[0].split("#", 1)[0].strip()
        prefix = target.split(":", 1)[0].strip().lower() if ":" in target else ""
        if prefix not in prefixes:
            out.append(text[start:j])
        i = j
    return "".join(out)


def strip_markup(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    value = value.replace("'''", "").replace("''", "")
    value = re.sub(
        r"\[\[([^\]]+)\]\]",
        lambda m: m.group(1).split("|")[-1],
        value,
    )
    value = re.sub(r"\{\{[^{}]*\}\}", "", value)
    value = html.unescape(value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def extract_wikilinks(text: str) -> list[dict]:
    links: list[dict] = []
    seen: set[str] = set()
    i = 0
    while True:
        start = text.find("[[", i)
        if start < 0:
            break
        depth, j = 1, start + 2
        while j < len(text) and depth:
            if text.startswith("[[", j):
                depth += 1
                j += 2
            elif text.startswith("]]", j):
                depth -= 1
                j += 2
            else:
                j += 1
        inner = text[start + 2:j - 2]
        i = j
        target = inner.split("|", 1)[0].split("#", 1)[0].strip()
        if not target:
            continue
        prefix = target.split(":", 1)[0].strip().lower() if ":" in target else ""
        if prefix in NAMESPACE_PREFIXES:
            continue
        anchor = inner.split("|", 1)[1] if "|" in inner else target
        anchor = strip_markup(anchor)
        if not anchor:
            anchor = target
        if target in seen:
            continue
        seen.add(target)
        links.append({"title": target, "anchor": anchor})
    return links


def parse_wikitext_lead(content: str) -> tuple[str | None, list[dict], str | None]:
    content = re.sub(r"<!--.*?-->", "", content, flags=re.S)
    lead = re.split(r"\n==+\s*[^=\n]+\s*==+", content, maxsplit=1)[0]
    lead = remove_tables(lead)
    lead = remove_templates(lead)
    lead = re.sub(r"<ref[^>]*>.*?</ref>", "", lead, flags=re.S | re.I)
    lead = re.sub(r"<ref[^>]*/>", "", lead, flags=re.I)
    lead = re.sub(r"<gallery.*?</gallery>", "", lead, flags=re.S | re.I)
    lead = re.sub(r"__[A-Z]+__", "", lead)
    lead = remove_namespace_links(lead)

    for paragraph in re.split(r"\n\s*\n", lead):
        text = paragraph.strip()
        if not text or text.startswith(("*", "#", "|", "{|", "{{")):
            continue
        links = extract_wikilinks(text)
        if len(links) >= 2:
            return strip_markup(text), links, text
    return None, [], None


def make_hint(raw_paragraph: str) -> str:
    """Return the lead paragraph with every linked name blanked out."""
    text = re.sub(r"\[\[([^\]]+)\]\]", "_____", raw_paragraph)
    text = strip_markup(text)
    months = (
        r"(?:January|February|March|April|May|June|July|August|September|"
        r"October|November|December)"
    )
    text = re.sub(rf"(\d{{4}})(?={months}\s*\d)", r"\1 – ", text)
    text = re.sub(rf"({months})(?=\d)", r"\1 ", text)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"_{3,}", "_____", text)
    return text.strip()


# ---------------------------------------------------------------------------
# Source lists
# ---------------------------------------------------------------------------

def is_adult_text(value: str) -> bool:
    return bool(ADULT_RE.search(value))


def is_namespace_title(title: str) -> bool:
    if ":" not in title:
        return False
    prefix = title.split(":", 1)[0].strip().lower()
    return prefix in NAMESPACE_PREFIXES


def is_list_title(title: str) -> bool:
    return title.startswith(LIST_PREFIXES)


def keep_pageview_title(title: str) -> bool:
    if title == "Main Page":
        return False
    if is_namespace_title(title):
        return False
    if is_list_title(title):
        return False
    if title.casefold() in ADULT_TITLES or is_adult_text(title):
        return False
    if DATE_RE.match(title) or YEAR_IN_RE.match(title):
        return False
    return True


def fetch_pageviews(month: str, *, refresh: bool) -> list[str]:
    year, mon = month.split("-")
    url = PAGEVIEWS.format(year=year, month=int(mon))
    data = fetch_json(url, refresh=refresh)
    articles = data["items"][0]["articles"]
    titles = []
    seen = set()
    for entry in articles:
        title = entry["article"].replace("_", " ")
        if not keep_pageview_title(title):
            continue
        key = norm_title_key(title)
        if key in seen:
            continue
        seen.add(key)
        titles.append(title)
    return titles


def fetch_vital(*, refresh: bool) -> list[str]:
    titles = []
    seen = set()
    for key in VITAL_KEYS:
        url = VITAL.format(key=key)
        try:
            text = fetch_text(url, refresh=refresh).lstrip("﻿")
            payload = json.loads(text)
        except Exception as exc:
            print(f"warning: could not read Vital data {key}: {exc}", file=sys.stderr)
            continue
        for title, meta in payload.items():
            try:
                level = int(meta.get("level", 99))
            except (TypeError, ValueError):
                continue
            if level > 3:
                continue
            norm = norm_title_key(title)
            if norm in seen:
                continue
            seen.add(norm)
            titles.append(title)
    return titles


# ---------------------------------------------------------------------------
# Candidate filtering
# ---------------------------------------------------------------------------

def is_bad_name(display: str, title: str) -> bool:
    disp = re.sub(r"\s+", " ", display or "").strip()
    if len(disp) < 2:
        return True
    low = disp.casefold()
    title_low = title.casefold()
    if low in ADULT_TITLES or title_low in ADULT_TITLES:
        return True
    if is_adult_text(disp) or is_adult_text(title):
        return True
    if low in DEMONYMS or title_low in DEMONYMS:
        return True
    if low in GENERIC_NAMES or title_low in GENERIC_NAMES:
        return True
    if low in GENERIC_ADJECTIVES or title_low in GENERIC_ADJECTIVES:
        return True
    if ORDINAL_RE.match(disp) or ORDINAL_RE.match(title):
        return True
    if DATE_RE.match(disp) or DATE_RE.match(title):
        return True
    if YEAR_IN_RE.match(title):
        return True
    if is_list_title(title):
        return True
    if title.startswith("Deaths in "):
        return True
    if disp.isdigit():
        return True
    if is_namespace_title(title):
        return True
    return False


def page_is_usable(info: dict | None) -> bool:
    if not info:
        return False
    if info.get("missing"):
        return False
    if info.get("redirect"):
        return False
    if "disambiguation" in (info.get("pageprops") or {}):
        return False
    try:
        length = int(info.get("length", 0))
    except (TypeError, ValueError):
        length = 0
    return length >= MIN_ARTICLE_BYTES


# ---------------------------------------------------------------------------
# Batched API calls
# ---------------------------------------------------------------------------

def fetch_revisions(titles: list[str], *, refresh: bool) -> dict[str, dict]:
    """Fetch full wikitext for many pages. Returns original -> {resolved, content}."""
    results: dict[str, dict] = {}
    unique = sorted(set(titles))
    print(f"  fetching wikitext for {len(unique)} parents in batches of {REVISION_BATCH}...", flush=True)

    def fetch_batch(batch: list[str]) -> None:
        if not batch:
            return
        url = url_for(
            action="query",
            prop="revisions",
            rvprop="content",
            rvslots="main",
            titles="|".join(batch),
            redirects="1",
        )
        try:
            data = fetch_json(url, refresh=refresh)
        except Exception as exc:
            if len(batch) == 1:
                print(f"  warning: wikitext failed for {batch[0]!r}: {exc}", file=sys.stderr)
                return
            mid = len(batch) // 2
            fetch_batch(batch[:mid])
            fetch_batch(batch[mid:])
            return
        if "error" in data:
            if len(batch) == 1:
                print(f"  warning: wikitext error for {batch[0]!r}: {data['error'].get('info')}", file=sys.stderr)
                return
            mid = len(batch) // 2
            fetch_batch(batch[:mid])
            fetch_batch(batch[mid:])
            return

        query = data.get("query", {})
        pages = {page.get("title", ""): page for page in query.get("pages", [])}
        normalized = {
            norm_title_key(item.get("from", "")): item.get("to", "")
            for item in query.get("normalized", [])
        }
        redirects = {
            norm_title_key(item.get("from", "")): item.get("to", "")
            for item in query.get("redirects", [])
        }

        for requested in batch:
            resolved = normalized.get(norm_title_key(requested), requested)
            resolved = redirects.get(norm_title_key(resolved), resolved)
            page = pages.get(resolved)
            if not page:
                for key, value in pages.items():
                    if norm_title_key(key) == norm_title_key(resolved):
                        page = value
                        break
            if not page or page.get("missing"):
                continue
            revisions = page.get("revisions") or []
            if not revisions:
                continue
            content = (revisions[0].get("slots") or {}).get("main", {}).get("content")
            if not content:
                continue
            results[requested] = {
                "resolved": page.get("title", resolved),
                "content": content,
            }

    for index, batch in enumerate(list(chunks(unique, REVISION_BATCH)), 1):
        fetch_batch(batch)
        if index % 10 == 0:
            print(f"    {index} wikitext batches done", flush=True)
    return results


def fetch_item_data(titles: list[str], *, refresh: bool) -> dict[str, dict]:
    """Fetch info, pageprops, and redirect aliases for candidate item titles."""
    data: dict[str, dict] = {}
    unique = sorted(set(titles))
    print(f"  fetching info + aliases for {len(unique)} names in batches of {INFO_BATCH}...", flush=True)

    def fetch_batch(batch: list[str]) -> None:
        if not batch:
            return
        url = url_for(
            action="query",
            prop="info|pageprops|redirects",
            rdlimit="10",
            titles="|".join(batch),
        )
        try:
            payload = fetch_json(url, refresh=refresh)
        except Exception as exc:
            if len(batch) == 1:
                print(f"  warning: item data failed for {batch[0]!r}: {exc}", file=sys.stderr)
                return
            mid = len(batch) // 2
            fetch_batch(batch[:mid])
            fetch_batch(batch[mid:])
            return
        if "error" in payload:
            if len(batch) == 1:
                print(f"  warning: item data error for {batch[0]!r}: {payload['error'].get('info')}", file=sys.stderr)
                return
            mid = len(batch) // 2
            fetch_batch(batch[:mid])
            fetch_batch(batch[mid:])
            return

        query = payload.get("query", {})
        for page in query.get("pages", []):
            title = page.get("title", "")
            if not title:
                continue
            aliases = []
            for redirect in page.get("redirects", []):
                alias = redirect.get("title", "")
                if alias and not is_namespace_title(alias):
                    aliases.append(alias)
            page["_aliases"] = aliases
            data[title] = page
        for item in query.get("normalized", []):
            if item.get("to") in data:
                data.setdefault(item.get("from", ""), data[item["to"]])
        for item in query.get("redirects", []):
            if item.get("to") in data:
                data.setdefault(item.get("from", ""), data[item["to"]])

    for index, batch in enumerate(list(chunks(unique, INFO_BATCH)), 1):
        fetch_batch(batch)
        if index % 10 == 0:
            print(f"    {index} item-data batches done", flush=True)
    return data


def lookup_item(data: dict[str, dict], title: str) -> dict | None:
    if title in data:
        return data[title]
    low = title.casefold()
    for key, value in data.items():
        if key.casefold() == low:
            return value
    return None


# ---------------------------------------------------------------------------
# Pair construction
# ---------------------------------------------------------------------------

def norm_for_pair(value: str) -> str:
    value = re.sub(r"\s*\([^)]*\)\s*$", "", value or "")
    value = value.casefold()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def related(a: str, b: str) -> bool:
    na, nb = norm_for_pair(a), norm_for_pair(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    if len(na) < len(nb):
        na, nb = nb, na
    return f" {nb} " in f" {na} "


def token_set(value: str) -> set[str]:
    return {word for word in norm_for_pair(value).split() if word not in PAIR_STOPWORDS}


def token_overlap_bad(a: str, b: str) -> bool:
    left, right = token_set(a), token_set(b)
    if len(left) < 2 or len(right) < 2:
        return False
    shared = left & right
    return len(shared) >= 2 and len(shared) / len(left | right) >= 0.5


def pair_is_bad(a: dict, b: dict) -> bool:
    if related(a["title"], b["title"]):
        return True
    if token_overlap_bad(a["title"], b["title"]):
        return True
    return False


def too_close_to_parent(name: str, parent: str) -> bool:
    """Reject names that are basically the parent word itself.

    "Good" under the parent "Goods" gives the answer away, as do names
    that only change a word's form ("Monarch" / "Monarchy") or repeat
    the parent inside a longer title ("Rome" under "Ancient Rome").
    """
    if related(name, parent) or token_overlap_bad(name, parent):
        return True
    return SequenceMatcher(
        None, norm_for_pair(name), norm_for_pair(parent)
    ).ratio() >= PARENT_SIMILARITY


def make_pairs(items: list[dict], count: int, rng: random.Random) -> list[dict]:
    if len(items) < 2:
        return []
    pairs: list[dict] = []
    seen: set[tuple[str, str]] = set()

    if len(items) <= 40:
        candidates = []
        for i, first in enumerate(items):
            for second in items[i + 1:]:
                if pair_is_bad(first, second):
                    continue
                candidates.append((first, second))
        rng.shuffle(candidates)
        for first, second in candidates[:count]:
            pairs.append({"one": first, "two": second})
        return pairs

    attempts = 0
    max_attempts = max(200, count * 60)
    while len(pairs) < count and attempts < max_attempts:
        attempts += 1
        first, second = rng.sample(items, 2)
        key = tuple(sorted((first["title"], second["title"])))
        if key in seen or pair_is_bad(first, second):
            continue
        seen.add(key)
        pairs.append({"one": first, "two": second})
    return pairs


def build_answers(title: str, anchor: str, aliases: list[str]) -> list[str]:
    answers = {title, anchor}
    base = re.sub(r"\s*\([^)]*\)\s*$", "", title).strip()
    if base:
        answers.add(base)
    if "," in title:
        answers.add(title.split(",", 1)[0].strip())
    for alias in aliases[:MAX_ALIASES]:
        answers.add(alias)
    return sorted(a for a in answers if a)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Build Same Page puzzle data")
    parser.add_argument("--month", default=DEFAULT_MONTH, help="pageviews month, YYYY-MM")
    parser.add_argument("--pairs", type=int, default=DEFAULT_PAIRS, help="pairs per parent")
    parser.add_argument("--limit", type=int, default=0, help="sample this many parents")
    parser.add_argument("--refresh", action="store_true", help="ignore the response cache")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--output", default=str(Path(__file__).resolve().with_name("data.json")))
    args = parser.parse_args()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    started = time.time()

    print("Fetching source lists...", flush=True)
    pageview_titles = fetch_pageviews(args.month, refresh=args.refresh)
    vital_titles = fetch_vital(refresh=args.refresh)
    print(f"  pageviews: {len(pageview_titles)} usable parents")
    print(f"  vital:     {len(vital_titles)} usable parents")

    parents: dict[str, dict] = {}
    for title in pageview_titles:
        parents.setdefault(norm_title_key(title), {"title": title, "pool": "trending"})
    for title in vital_titles:
        key = norm_title_key(title)
        if key in parents:
            parents[key]["pool"] = "evergreen"
        else:
            parents[key] = {"title": title, "pool": "evergreen"}

    parent_list = list(parents.values())
    if args.limit:
        rng = random.Random(20261115)
        parent_list = rng.sample(parent_list, min(args.limit, len(parent_list)))
    parent_list.sort(key=lambda p: p["title"].casefold())
    print(f"Union pool: {len(parent_list)} parents queued", flush=True)

    revisions = fetch_revisions([p["title"] for p in parent_list], refresh=args.refresh)

    parsed: dict[str, dict] = {}
    candidate_titles: set[str] = set()
    for parent in parent_list:
        payload = revisions.get(parent["title"])
        if not payload:
            continue
        paragraph, links, _ = parse_wikitext_lead(payload["content"])
        if paragraph is None:
            continue
        parsed[parent["title"]] = {
            "resolved": payload["resolved"],
            "pool": parent["pool"],
            "links": links,
        }
        for link in links:
            if not is_bad_name(link["title"], link["title"]):
                candidate_titles.add(link["title"])

    print(f"Parsed {len(parsed)} usable leads; {len(candidate_titles)} unique candidates")

    item_data = fetch_item_data(sorted(candidate_titles), refresh=args.refresh)

    # Resolve canonical parent titles (the revisions API follows redirects)
    # and drop duplicates.
    unique_parents: dict[str, dict] = {}
    for original, payload in parsed.items():
        resolved = payload["resolved"]
        if is_adult_text(resolved) or resolved.casefold() in ADULT_TITLES:
            continue
        key = norm_title_key(resolved)
        if key not in unique_parents:
            unique_parents[key] = {
                "title": resolved,
                "pool": payload["pool"],
                "links": payload["links"],
            }
        elif payload["pool"] == "evergreen":
            unique_parents[key]["pool"] = "evergreen"

    output_parents = []
    total_pairs = 0
    dropped_no_links = 0

    for key in sorted(unique_parents, key=lambda k: unique_parents[k]["title"].casefold()):
        parent = unique_parents[key]
        parent_title = parent["title"]
        rng = random.Random(int(hashlib.sha256(key.encode("utf-8")).hexdigest(), 16))
        items_by_title: dict[str, dict] = {}

        for link in parent["links"]:
            title = link["title"]
            anchor = link["anchor"]
            if is_bad_name(title, title):
                continue
            if too_close_to_parent(title, parent_title):
                continue
            info = lookup_item(item_data, title)
            if not page_is_usable(info):
                continue
            canonical = info.get("title") or title
            if too_close_to_parent(canonical, parent_title):
                continue
            if canonical in items_by_title:
                continue
            items_by_title[canonical] = {
                "title": canonical,
                "display": canonical,
                "anchor": anchor,
            }

        if len(items_by_title) < 2:
            dropped_no_links += 1
            continue

        pairs = make_pairs(list(items_by_title.values()), max(1, args.pairs), rng)
        if not pairs:
            dropped_no_links += 1
            continue

        output_parents.append({
            "title": parent_title,
            "pool": parent["pool"],
            "pairs": pairs,
        })
        total_pairs += len(pairs)
        if args.verbose and len(output_parents) <= 12:
            sample = pairs[0]
            print(
                f"  {parent_title} ({parent['pool']}): "
                f"{sample['one']['display']} + {sample['two']['display']}",
                flush=True,
            )

    # Add accepted-answer variants, including redirect aliases.
    for parent in output_parents:
        for pair in parent["pairs"]:
            for side in ("one", "two"):
                item = pair[side]
                info = lookup_item(item_data, item["title"]) or {}
                aliases = info.get("_aliases", [])
                item["answers"] = build_answers(item["title"], item.get("anchor", item["title"]), aliases)

    version = hashlib.sha256(
        json.dumps(
            output_parents,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:10]

    payload = {
        "version": version,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": {
            "pageviews": f"en.wikipedia top 1000, {args.month}, filtered",
            "vital": "Wikipedia:Vital articles levels 1-3 (English titles)",
        },
        "stats": {
            "parents": len(output_parents),
            "puzzles": total_pairs,
            "dropped_parents": dropped_no_links,
        },
        "parents": output_parents,
    }

    output_path = Path(args.output)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    size_mb = output_path.stat().st_size / (1024 * 1024)
    elapsed = time.time() - started
    print()
    print(f"Wrote {output_path} ({size_mb:.2f} MB)")
    print(
        f"Parents: {len(output_parents)}  Puzzles: {total_pairs}  "
        f"Dropped: {dropped_no_links}"
    )
    print(f"Elapsed: {elapsed / 60:.1f} min")

    if total_pairs == 0:
        print("error: no puzzles were generated", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
