"""The same destination on two nights from Booking.com, matched hotel by hotel, written to
prices.csv: each property's total for one night on each date and how many times dearer
the first date is.

    APIFY_TOKEN=... python compare.py Edinburgh 2026-12-31 2027-01-14 [maxHotels]
"""
import csv
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

from apify_client import ApifyClient

if len(sys.argv) < 4:
    sys.exit("Give a destination and two check-in dates, YYYY-MM-DD")
destination, date_a, date_b = sys.argv[1:4]
max_hotels = int(sys.argv[4]) if len(sys.argv) > 4 else 600
client = ApifyClient(os.environ["APIFY_TOKEN"])


def search(check_in):
    # One night for two in one room; price is Booking's total for exactly that booking.
    check_out = (date.fromisoformat(check_in) + timedelta(days=1)).isoformat()
    run = client.actor("simple.actor/booking-hotels").call(run_input={
        "queries": [destination], "checkIn": check_in, "checkOut": check_out,
        "adults": 2, "rooms": 1, "currency": "GBP", "maxHotels": max_hotels})
    items = list(client.dataset(run.default_dataset_id).iterate_items())
    # A search that could not be read is a row with type "error"; the run itself stays green.
    for r in items:
        if r.get("type") == "error":
            print(f"{r['error']}: {r['errorDescription']}", file=sys.stderr)
    return [r for r in items if r.get("type") == "hotel"]


with ThreadPoolExecutor(2) as pool:
    a, b = pool.map(search, (date_a, date_b))
total = lambda rows: rows[0]["totalResults"] if rows else 0
print(f"{date_a}: {len(a)} of {total(a)} bookable, {date_b}: {len(b)} of {total(b)}")

# hotelId is Booking's own and stable, so it joins the two searches.
by_id = {h["hotelId"]: h for h in b}
rows = []
for h in a:
    other = by_id.get(h["hotelId"])
    if other and h["price"] and other["price"]:
        rows.append({**h, date_a: h["price"], date_b: other["price"], "multiple": round(h["price"] / other["price"], 2)})
rows.sort(key=lambda r: -r["multiple"])

columns = ["hotelId", "name", "propertyType", "stars", "reviewScore", "reviewCount", date_a, date_b, "multiple", "url"]
with open("prices.csv", "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)

for r in [r for r in rows if r["propertyType"] == "Hotel"][:10]:
    print(f"  {r['multiple']:.2f}x  £{r[date_a]} vs £{r[date_b]}  {r['name']}")
print(f"{len(rows)} propert(ies) on both dates -> prices.csv")
