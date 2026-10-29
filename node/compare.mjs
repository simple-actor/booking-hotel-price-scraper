// The same destination on two nights from Booking.com, matched hotel by hotel, written to
// prices.csv: each property's total for one night on each date and how many times dearer
// the first date is.
//
//   APIFY_TOKEN=... node compare.mjs Edinburgh 2026-12-31 2027-01-14 [maxHotels]
import { ApifyClient } from 'apify-client';
import { writeFileSync } from 'node:fs';

const [destination, dateA, dateB, max = '600'] = process.argv.slice(2);
if (!dateB) throw new Error('Give a destination and two check-in dates, YYYY-MM-DD');
const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const nextDay = (d) => new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10);
// One night for two in one room; price is Booking's total for exactly that booking.
async function search(checkIn) {
    const run = await client.actor('simple.actor/booking-hotels').call({
        queries: [destination], checkIn, checkOut: nextDay(checkIn),
        adults: 2, rooms: 1, currency: 'GBP', maxHotels: Number(max),
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    // A search that could not be read is a row with type "error"; the run itself stays green.
    for (const r of items.filter((i) => i.type === 'error')) console.error(`${r.error}: ${r.errorDescription}`);
    return items.filter((i) => i.type === 'hotel');
}
const [a, b] = await Promise.all([search(dateA), search(dateB)]);
console.log(`${dateA}: ${a.length} of ${a[0]?.totalResults ?? 0} bookable, ${dateB}: ${b.length} of ${b[0]?.totalResults ?? 0}`);

// hotelId is Booking's own and stable, so it joins the two searches.
const byId = new Map(b.map((h) => [h.hotelId, h]));
const rows = a.filter((h) => byId.has(h.hotelId) && h.price && byId.get(h.hotelId).price).map((h) => ({
    hotelId: h.hotelId, name: h.name, propertyType: h.propertyType, stars: h.stars, reviewScore: h.reviewScore,
    reviewCount: h.reviewCount, [dateA]: h.price, [dateB]: byId.get(h.hotelId).price,
    multiple: (h.price / byId.get(h.hotelId).price).toFixed(2), url: h.url,
})).sort((x, y) => y.multiple - x.multiple);

const columns = ['hotelId', 'name', 'propertyType', 'stars', 'reviewScore', 'reviewCount', dateA, dateB, 'multiple', 'url'];
const cell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
writeFileSync('prices.csv', [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n');

for (const r of rows.filter((x) => x.propertyType === 'Hotel').slice(0, 10)) {
    console.log(`  ${r.multiple}x  £${r[dateA]} vs £${r[dateB]}  ${r.name}`);
}
console.log(`${rows.length} propert(ies) on both dates -> prices.csv`);
