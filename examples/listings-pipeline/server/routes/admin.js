const express = require('express')
const { writeListings, readListings } = require('../lib/store')

const router = express.Router()

router.get('/health', (req, res) => {
  res.json({ ok: true, listings: readListings().length })
})

router.post('/reset', (req, res) => {
  writeListings([])
  res.json({ ok: true })
})

module.exports = router
