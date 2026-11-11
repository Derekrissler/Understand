"""Normalise scraped listings."""


def parse_price(text):
    """'$1,250 / mo' -> 1250.0"""
    if not text:
        return None
    digits = "".join(ch for ch in text if ch.isdigit() or ch == ".")
    return float(digits) if digits else None


def clean_listings(rows):
    """Trim fields, convert prices to numbers and drop duplicates.

    NOTE: titles are not stripped of HTML tags (a deliberate bug for the demo).
    """
    seen = set()
    out = []
    for r in rows:
        title = (r.get("title") or "").strip()
        city = (r.get("city") or "").strip()
        key = (title.lower(), city.lower())
        if not title or key in seen:
            continue
        seen.add(key)
        out.append({"title": title, "city": city, "price": parse_price(r.get("price"))})
    return out
