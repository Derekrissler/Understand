// Listings API + static frontend.
const express = require('express')
const path = require('path')
const { readListings, writeListings } = require('./lib/store')
const { computeStats } = require('./lib/stats')
const adminRouter = require('./routes/admin')

const app = express()
const PORT = process.env.PORT || 4321

app.use(express.json({ limit: '5mb' }))
app.use(express.static(path.join(__dirname, '..', 'web')))
app.use('/api/admin', adminRouter)

app.get('/api/listings', (req, res) => {
  const city = req.query.city
  const rows = readListings()
  res.json(city ? rows.filter((r) => r.city === city) : rows)
})

app.get('/api/listings/:id', (req, res) => {
  const row = readListings().find((r) => String(r.id) === req.params.id)
  if (!row) return res.status(404).json({ error: 'not found' })
  res.json(row)
})

app.get('/api/stats', (req, res) => {
  res.json(computeStats(readListings()))
})

app.post('/api/ingest', ingestListings)

/** Replace the stored listings with a freshly scraped batch. */
function ingestListings(req, res) {
  const rows = Array.isArray(req.body) ? req.body : req.body.listings
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'expected an array of listings' })
  writeListings(rows.map((r, i) => ({ id: i + 1, ...r })))
  res.status(201).json({ stored: rows.length })
}

app.listen(PORT, () => console.log(`listings demo on http://localhost:${PORT}`))
