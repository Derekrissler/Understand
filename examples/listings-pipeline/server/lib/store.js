const fs = require('fs')
const path = require('path')

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'listings.json')

/** Load every stored listing from disk. */
function readListings() {
  if (!fs.existsSync(DATA_FILE)) return []
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
}

/** Overwrite the stored listings. */
function writeListings(rows) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2))
}

module.exports = { readListings, writeListings }
