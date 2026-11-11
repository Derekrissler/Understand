"""Summaries over cleaned listings."""


def summarize(rows):
    """Count, average and range of prices per city."""
    by_city = {}
    for r in rows:
        if r["price"] is None:
            continue
        by_city.setdefault(r["city"], []).append(r["price"])
    return [
        {
            "city": city,
            "listings": len(prices),
            "avg_price": round(sum(prices) / len(prices), 2),
            "min_price": min(prices),
            "max_price": max(prices),
        }
        for city, prices in sorted(by_city.items())
    ]
