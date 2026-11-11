"""Scrape rental listings from a listings page."""
import re
import urllib.request
from pathlib import Path

try:
    from bs4 import BeautifulSoup
except ImportError:  # keep the demo dependency-free
    BeautifulSoup = None

SAMPLE_PAGE = Path(__file__).parent / "sample_page.html"
LISTINGS_URL = "https://example.com/rentals"


def fetch_html(url=LISTINGS_URL):
    """Download the raw HTML for a listings page."""
    req = urllib.request.Request(url, headers={"User-Agent": "listings-demo/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.read().decode("utf-8", "replace")


def load_sample():
    """Read the saved sample page instead of hitting the network."""
    with open(SAMPLE_PAGE, encoding="utf-8") as f:
        return f.read()


def parse_listings(html):
    """Pull title, price and city out of every .listing card."""
    if BeautifulSoup is not None:
        soup = BeautifulSoup(html, "html.parser")
        rows = []
        for card in soup.select(".listing"):
            title = card.select_one(".title")
            price = card.select_one(".price")
            city = card.select_one(".city")
            rows.append({
                "title": title.decode_contents() if title else None,
                "price": price.get_text() if price else None,
                "city": city.get_text() if city else None,
            })
        return rows

    rows = []
    for block in re.findall(r'<div class="listing">(.*?)</div>\s*(?=<div class="listing">|</main>)', html, re.S):
        def field(name):
            m = re.search(r'<span class="%s">(.*?)</span>' % name, block, re.S)
            return m.group(1) if m else None
        rows.append({"title": field("title"), "price": field("price"), "city": field("city")})
    return rows
