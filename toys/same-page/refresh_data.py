#!/usr/bin/env python3
"""Re-shape an existing Same Page dataset.

This pass uses the cached lead wikitext from build_dataset.py to:

* re-parent inverted triples: if the parent's first sentence says it is a kind
  of one of its items, that item is promoted to parent and paired with a
  sibling from the broader article's lead;
* attach a redacted lead snippet per parent for the progressive context hint;
* drop the old accepted-answer arrays (the game no longer checks guesses).

It is intentionally a local pass: build_dataset.py already cached every parent
lead, so this reads the cache and does not hit the Wikipedia API.

Run:
    py -3 refresh_data.py
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("bd", BASE / "build_dataset.py")
bd = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bd)

DATA_PATH = BASE / "data.json"

HYPERNYM_RE = re.compile(
    r"\bis\s+(?:a|an|the|one of the|a type of|a kind of|a class of)\s+",
    re.IGNORECASE,
)


def canonical_title(title: str) -> str:
    return title[:1].upper() + title[1:] if title else title


def split_sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]


def first_sentence(text: str) -> str:
    parts = split_sentences(text)
    return parts[0] if parts else text


def hypernym_of(sentence: str, item: dict) -> str | None:
    """If the sentence says its subject is a kind of `item`, return the match."""
    terms = []
    for field in ("anchor", "title", "display"):
        value = (item.get(field) or "").strip()
        if len(value) >= 3 and value not in terms:
            terms.append(value)

    for term in terms:
        pattern = re.compile(
            r"\bis\s+(?:a|an|one of the|a type of|a kind of|a class of)\s+"
            r"(?:(?!\b(?:or|and|such|as|like|including)\b)[A-Za-z0-9'\-]+\s+){0,3}"
            + re.escape(term)
            + r"(?!\w)",
            re.IGNORECASE,
        )
        match = pattern.search(sentence)
        if not match:
            continue
        after = sentence[match.end():]
        if re.match(r"\s*(?:,?\s*(?:or|and)\s+)", after, re.IGNORECASE):
            # "a nucleon is a proton or a neutron" is an enumeration, not a
            # statement that a nucleon is a proton.
            continue
        return term
    return None


def build_parsed() -> dict[str, dict]:
    pageviews = bd.fetch_pageviews(bd.DEFAULT_MONTH, refresh=False)
    vital = bd.fetch_vital(refresh=False)

    source: dict[str, dict] = {}
    for title in pageviews:
        source.setdefault(bd.norm_title_key(title), {"title": title, "pool": "trending"})
    for title in vital:
        key = bd.norm_title_key(title)
        if key in source:
            source[key]["pool"] = "evergreen"
        else:
            source[key] = {"title": title, "pool": "evergreen"}

    revisions = bd.fetch_revisions(
        [parent["title"] for parent in source.values()],
        refresh=False,
    )

    parsed: dict[str, dict] = {}
    for original, payload in revisions.items():
        paragraph, links, raw = bd.parse_wikitext_lead(payload["content"])
        if paragraph is None or raw is None:
            continue
        resolved = payload["resolved"]
        key = bd.norm_title_key(resolved)
        pool = source.get(bd.norm_title_key(original), {}).get("pool", "evergreen")
        if key in parsed:
            if pool == "evergreen":
                parsed[key]["pool"] = "evergreen"
            continue
        parsed[key] = {
            "title": resolved,
            "pool": pool,
            "paragraph": paragraph,
            "links": links,
            "hint": bd.make_hint(raw),
        }
    return parsed


LIST_MARKER_RE = re.compile(
    r"\b(?:such as|including|includes|like|e\.g\.,?|for example|namely|"
    r"consists of|comprises|is divided into)\b",
    re.IGNORECASE,
)


def choose_sibling(ap: dict, old_link: dict, old_key: str) -> dict | None:
    """Pick a second child from a list in the broader article's lead.

    Requiring the candidate to sit in the same list as the old parent avoids
    pairing a particle with an unrelated link that merely appears later in the
    sentence.
    """
    p_terms = [term for term in (old_link.get("anchor"), old_link.get("title")) if term]
    sentence = ""
    p_pos = -1
    for candidate in split_sentences(ap["paragraph"]):
        for term in p_terms:
            pos = candidate.casefold().find(term.casefold())
            if pos >= 0:
                sentence = candidate
                p_pos = pos
                break
        if sentence:
            break

    if not sentence or p_pos < 0:
        return None

    markers = list(LIST_MARKER_RE.finditer(sentence, 0, p_pos))
    if not markers:
        return None
    marker = markers[-1]
    end = sentence.find(",", p_pos)
    if end < 0:
        end = len(sentence)
    segment = sentence[marker.end():end]

    segment_p = -1
    for term in p_terms:
        pos = segment.casefold().find(term.casefold())
        if pos >= 0:
            segment_p = pos
            break

    options: list[tuple[int, dict]] = []
    for link in ap["links"]:
        key = bd.norm_title_key(link["title"])
        if key in (old_key, bd.norm_title_key(ap["title"])):
            continue
        if bd.is_bad_name(link["title"], link["title"]):
            continue
        if bd.too_close_to_parent(link["title"], ap["title"]):
            continue
        for term in (link.get("anchor"), link.get("title")):
            if not term:
                continue
            pos = segment.casefold().find(term.casefold())
            if pos >= 0:
                options.append((pos, link))
                break

    after = [(pos, link) for pos, link in options if pos > segment_p]
    if after:
        after.sort(key=lambda pair: pair[0])
        return after[0][1]

    options.sort(key=lambda pair: pair[0])
    return options[0][1] if options else None


def main() -> int:
    with DATA_PATH.open(encoding="utf-8-sig") as fh:
        data = json.load(fh)

    parsed = build_parsed()
    parents = {bd.norm_title_key(parent["title"]): parent for parent in data["parents"]}

    items: dict[str, dict] = {}
    for parent in data["parents"]:
        for pair in parent.get("pairs", []):
            for side in ("one", "two"):
                item = pair[side]
                items.setdefault(bd.norm_title_key(item["title"]), item)

    original_pairs = sum(len(parent.get("pairs", [])) for parent in parents.values())
    new_pairs: dict[str, list[dict]] = {}
    reparented = 0
    removed = 0
    examples: list[tuple[str, str, str, str]] = []

    for key, parent in list(parents.items()):
        pin = parsed.get(key)
        if not pin:
            continue
        fs = first_sentence(pin["paragraph"])
        kept = []

        for pair in parent.get("pairs", []):
            hypernym = None
            for side in ("one", "two"):
                if hypernym_of(fs, pair[side]):
                    hypernym = pair[side]
                    break

            if not hypernym:
                kept.append(pair)
                continue

            a_key = bd.norm_title_key(hypernym["title"])
            ap = parsed.get(a_key)
            if not ap or a_key == key:
                removed += 1
                continue

            old_link = next(
                (
                    link for link in ap["links"]
                    if bd.norm_title_key(link["title"]) == key
                    or bd.norm_title_key(link.get("anchor", "")) == key
                ),
                None,
            )
            if not old_link:
                removed += 1
                continue

            sibling = choose_sibling(ap, old_link, key)
            if not sibling:
                removed += 1
                continue

            old_item = items.get(key) or {
                "title": parent["title"],
                "display": parent["title"],
                "anchor": old_link.get("anchor", ""),
            }
            sibling_title = canonical_title(sibling["title"])
            sibling_item = items.get(bd.norm_title_key(sibling_title)) or {
                "title": sibling_title,
                "display": sibling_title,
                "anchor": sibling.get("anchor", ""),
            }

            if bd.norm_title_key(old_item["title"]) in (a_key, bd.norm_title_key(sibling_item["title"])):
                removed += 1
                continue
            if bd.too_close_to_parent(old_item["title"], ap["title"]):
                removed += 1
                continue
            if bd.too_close_to_parent(sibling_item["title"], ap["title"]):
                removed += 1
                continue

            new_pair = {"one": old_item, "two": sibling_item}
            if bd.pair_is_bad(old_item, sibling_item):
                removed += 1
                continue

            new_pairs.setdefault(a_key, []).append(new_pair)
            reparented += 1
            removed += 1
            if len(examples) < 12:
                examples.append((
                    parent["title"],
                    ap["title"],
                    old_item["title"],
                    sibling_item["title"],
                ))

        parent["pairs"] = kept

    kept_pairs = sum(len(parent.get("pairs", [])) for parent in parents.values())
    reparented = 0
    examples = []

    # Attach new pairs to their promoted parents, creating new parent entries
    # when the broader article was not already in the dataset.
    for a_key, pairs in new_pairs.items():
        ap = parsed[a_key]
        target = parents.get(a_key)
        if target is None:
            target = {
                "title": ap["title"],
                "pool": ap["pool"],
                "pairs": [],
            }
            parents[a_key] = target

        existing = {
            tuple(sorted((bd.norm_title_key(pair["one"]["title"]),
                          bd.norm_title_key(pair["two"]["title"]))))
            for pair in target.get("pairs", [])
        }
        for pair in pairs:
            pair_key = tuple(sorted((
                bd.norm_title_key(pair["one"]["title"]),
                bd.norm_title_key(pair["two"]["title"]),
            )))
            if pair_key in existing or bd.pair_is_bad(pair["one"], pair["two"]):
                continue
            target.setdefault("pairs", []).append(pair)
            existing.add(pair_key)
            reparented += 1
            if len(examples) < 12:
                examples.append((
                    pair["one"]["title"],
                    target["title"],
                    pair["one"]["title"],
                    pair["two"]["title"],
                ))

    # Clean the output, attach hints, and drop the unused accepted answers.
    out = []
    for key, parent in parents.items():
        pairs = []
        seen = set()
        for pair in parent.get("pairs", []):
            pair_key = tuple(sorted((
                bd.norm_title_key(pair["one"]["title"]),
                bd.norm_title_key(pair["two"]["title"]),
            )))
            if pair_key in seen:
                continue
            seen.add(pair_key)
            clean = {}
            for side in ("one", "two"):
                item = pair[side]
                clean[side] = {
                    field: item[field]
                    for field in ("title", "display", "anchor")
                    if item.get(field)
                }
            pairs.append(clean)

        if not pairs:
            continue

        parent["pairs"] = pairs
        pin = parsed.get(key)
        if pin:
            parent["hint"] = pin["hint"]
        out.append(parent)

    out.sort(key=lambda parent: parent["title"].casefold())
    total_pairs = sum(len(parent["pairs"]) for parent in out)

    data["parents"] = out
    data["stats"]["parents"] = len(out)
    data["stats"]["puzzles"] = total_pairs
    data["stats"]["reparented_pairs"] = reparented
    data["stats"]["inverted_pairs_removed"] = original_pairs - kept_pairs
    data["stats"]["hints"] = sum(1 for parent in out if parent.get("hint"))
    data["version"] = hashlib.sha256(
        json.dumps(out, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:10]

    with DATA_PATH.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")

    print("version:", data["version"])
    print("stats:", json.dumps(data["stats"], ensure_ascii=False))
    print("re-parented examples (old parent -> new parent : child, child):")
    for old_parent, new_parent, first, second in examples:
        print(f"  {old_parent} -> {new_parent} : {first}, {second}")
    print("size MB:", round(DATA_PATH.stat().st_size / 1024 / 1024, 2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
