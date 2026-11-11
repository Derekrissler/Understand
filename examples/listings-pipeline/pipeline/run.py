"""End-to-end pipeline: scrape -> clean -> summarize -> send to the API."""
import json
import os
import sys
import urllib.request

from scrape import fetch_html, load_sample, parse_listings
from clean import clean_listings
from analyze import summarize

API_URL = os.getenv("LISTINGS_API", "http://localhost:4321")


def push_to_api(rows):
    """POST the cleaned rows to the backend's ingest endpoint."""
    body = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(
        f"{API_URL}/api/ingest", data=body, method="POST", headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


if __name__ == "__main__":
    html = fetch_html() if "--live" in sys.argv else load_sample()
    listings = clean_listings(parse_listings(html))
    print(json.dumps(summarize(listings), indent=2))
    if "--push" in sys.argv:
        print(push_to_api(listings))
