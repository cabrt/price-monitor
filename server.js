// Dashboard server. Serves the static page plus a small read-only JSON API.

const express = require('express')
const path = require('path')
const store = require('./lib/store')

const app = express()
const PORT = process.env.PORT || 3457

app.use(express.static(path.join(__dirname, 'public')))

// One row per watch: current reading, previous reading, and full series.
app.get('/api/watches', (req, res) => {
  const latest = store.latestByWatch()

  const rows = store.getWatches().map((watch) => {
    const series = store.historyFor(watch.id)
    const current = latest[watch.id] || null
    const previous = series.length > 1 ? series[series.length - 2] : null

    return {
      ...watch,
      current,
      previous,
      history: series.map((o) => ({
        checkedAt: o.checkedAt,
        price: o.price,
        availability: o.availability,
      })),
    }
  })

  res.json({ watches: rows, generatedAt: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`Price Monitor dashboard: http://localhost:${PORT}`)
})
