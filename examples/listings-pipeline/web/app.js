// Frontend: loads listings and stats from the API and renders them.
async function loadListings() {
  const res = await fetch('/api/listings')
  const rows = await res.json()
  const list = document.querySelector('#listings')
  list.innerHTML = rows.map((r) => `<li data-id="${r.id}">${r.title} · ${r.city} · $${r.price}</li>`).join('')
  list.addEventListener('click', (e) => showDetail(e.target.dataset.id))
}

async function loadStats() {
  const res = await fetch('/api/stats')
  const stats = await res.json()
  document.getElementById('stats').textContent = stats.map((s) => `${s.city}: avg $${s.avgPrice}`).join(' | ')
}

// BUG (on purpose): the API route is /api/listings/:id, not /api/listing/:id
async function showDetail(id) {
  const res = await fetch(`/api/listing/${id}`)
  const row = await res.json()
  document.getElementById('detail').textContent = JSON.stringify(row)
  localStorage.setItem('lastViewed', id)
}

document.addEventListener('DOMContentLoaded', () => {
  loadListings()
  loadStats()
})
