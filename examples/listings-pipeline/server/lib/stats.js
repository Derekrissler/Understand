/** Average price and count per city. */
function computeStats(rows) {
  const byCity = {}
  for (const r of rows) {
    if (typeof r.price !== 'number') continue
    const c = (byCity[r.city] ||= { city: r.city, count: 0, total: 0 })
    c.count++
    c.total += r.price
  }
  return Object.values(byCity).map((c) => ({ city: c.city, count: c.count, avgPrice: Math.round(c.total / c.count) }))
}

module.exports = { computeStats }
