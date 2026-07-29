import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import { z } from 'zod'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// stdout carries the MCP protocol — anything logged there corrupts the stream
const origLog = console.log
console.log = (...args) => process.stderr.write(args.join(' ') + '\n')

const ENV_PATH = path.join(__dirname, '.env')
if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH)

const store = require('./lib/store')
const { diff, fmt } = require('./lib/alert')
const { checkWatch } = require('./check')
const { BlockedByRobotsError } = require('./lib/fetch')

const text = (s) => ({ content: [{ type: 'text', text: s }] })

// ---------- shaping helpers ----------

function pctChange(from, to) {
  if (!from || from === 0 || to === null || to === undefined) return null
  return ((to - from) / from) * 100
}

// Reading closest to `days` ago, for change-over-window comparisons.
function readingBefore(series, days) {
  const cutoff = Date.now() - days * 86400 * 1000
  const older = series.filter((o) => new Date(o.checkedAt).getTime() <= cutoff)
  return older.length ? older[older.length - 1] : series[0] || null
}

function watchRow(watch, days = null) {
  const series = store.historyFor(watch.id)
  const current = series[series.length - 1] || null
  const baseline = days ? readingBefore(series, days) : series[series.length - 2] || null

  return {
    id: watch.id,
    label: watch.label,
    url: watch.url,
    price: current?.price ?? null,
    currency: current?.currency ?? null,
    availability: current?.availability ?? null,
    checkedAt: current?.checkedAt ?? null,
    readings: series.length,
    source: current?.source ?? null,
    baselinePrice: baseline?.price ?? null,
    changePct: current && baseline ? pctChange(baseline.price, current.price) : null,
    changeAbs: current && baseline ? current.price - baseline.price : null,
  }
}

function formatRow(r) {
  const parts = [`${r.label} [${r.id}]`]
  parts.push(`  price: ${r.price === null ? 'no reading yet' : fmt(r.price, r.currency)}`)

  if (r.changePct !== null && r.changeAbs !== 0) {
    const dir = r.changeAbs < 0 ? 'down' : 'up'
    parts.push(
      `  change: ${dir} ${fmt(Math.abs(r.changeAbs), r.currency)} (${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(1)}%) from ${fmt(r.baselinePrice, r.currency)}`
    )
  } else if (r.changePct !== null) {
    parts.push('  change: none')
  }

  if (r.availability) parts.push(`  stock: ${r.availability.replace(/_/g, ' ')}`)
  if (r.checkedAt) {
    const mins = Math.round((Date.now() - new Date(r.checkedAt)) / 60000)
    parts.push(`  last checked: ${mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`}`)
  }
  parts.push(`  ${r.url}`)
  return parts.join('\n')
}

// ---------- server ----------

const server = new McpServer({
  name: 'price-monitor',
  version: '1.0.0',
})

server.tool(
  'list_watches',
  'List every monitored product with its current price, latest change, and stock status.',
  {},
  async () => {
    const watches = store.getWatches()
    if (watches.length === 0) {
      return text('No watches configured. Use add_watch with a product URL to start monitoring one.')
    }

    const rows = watches.map((w) => watchRow(w))
    return text(
      `${rows.length} watch${rows.length === 1 ? '' : 'es'}:\n\n` +
        rows.map(formatRow).join('\n\n')
    )
  }
)

server.tool(
  'get_watch',
  'Full detail and recent price readings for one product. Accepts a watch id, exact label, or partial label.',
  {
    query: z.string().describe("Watch id, label, or part of a label (e.g. 'Northgate')"),
    limit: z.number().int().min(1).max(200).default(20).describe('How many recent readings to include'),
  },
  async ({ query, limit }) => {
    const watch = store.findWatch(query)
    const series = store.historyFor(watch.id)
    const row = watchRow(watch)

    const recent = series.slice(-limit).reverse()
    const lines = recent.map(
      (o) =>
        `  ${new Date(o.checkedAt).toISOString().replace('T', ' ').slice(0, 16)}  ` +
        `${fmt(o.price, o.currency).padStart(10)}  ${o.availability || 'unknown'}`
    )

    return text(
      formatRow(row) +
        `\n  extraction: ${row.source || 'n/a'}\n\n` +
        `Last ${recent.length} of ${series.length} readings (newest first):\n` +
        (lines.join('\n') || '  none yet')
    )
  }
)

server.tool(
  'price_history',
  'Price time series for one product over a window, with min, max, and net change. Use for trend questions.',
  {
    query: z.string().describe('Watch id, label, or part of a label'),
    days: z.number().int().min(1).max(365).default(14).describe('Window in days'),
  },
  async ({ query, days }) => {
    const watch = store.findWatch(query)
    const cutoff = Date.now() - days * 86400 * 1000
    const series = store
      .historyFor(watch.id)
      .filter((o) => new Date(o.checkedAt).getTime() >= cutoff)

    if (series.length === 0) {
      return text(`No readings for "${watch.label}" in the last ${days} days.`)
    }

    const prices = series.map((o) => o.price)
    const first = series[0]
    const last = series[series.length - 1]
    const net = pctChange(first.price, last.price)

    const outOfStockSpells = series.filter((o) => o.availability === 'out_of_stock').length

    return text(
      `${watch.label} — last ${days} days (${series.length} readings)\n` +
        `  now:    ${fmt(last.price, last.currency)}\n` +
        `  then:   ${fmt(first.price, first.currency)}\n` +
        `  net:    ${net === null ? 'n/a' : `${net >= 0 ? '+' : ''}${net.toFixed(1)}%`}\n` +
        `  low:    ${fmt(Math.min(...prices), last.currency)}\n` +
        `  high:   ${fmt(Math.max(...prices), last.currency)}\n` +
        `  out of stock in ${outOfStockSpells} of ${series.length} readings\n\n` +
        series
          .map(
            (o) =>
              `  ${new Date(o.checkedAt).toISOString().slice(0, 16).replace('T', ' ')}  ${fmt(o.price, o.currency).padStart(10)}`
          )
          .join('\n')
    )
  }
)

server.tool(
  'biggest_movers',
  'Products whose price moved most over a window, ranked by absolute percent change. Answers "who repriced?"',
  {
    days: z.number().int().min(1).max(365).default(7).describe('Window in days'),
    limit: z.number().int().min(1).max(50).default(10).describe('How many to return'),
    direction: z
      .enum(['any', 'down', 'up'])
      .default('any')
      .describe("'down' for competitors undercutting, 'up' for price rises"),
  },
  async ({ days, limit, direction }) => {
    const rows = store
      .getWatches()
      .map((w) => watchRow(w, days))
      .filter((r) => r.changePct !== null && r.changeAbs !== 0)
      .filter((r) =>
        direction === 'down' ? r.changeAbs < 0 : direction === 'up' ? r.changeAbs > 0 : true
      )
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, limit)

    if (rows.length === 0) {
      return text(`No ${direction === 'any' ? '' : direction + ' '}price moves in the last ${days} days.`)
    }

    return text(
      `Biggest movers over ${days} days (${direction}):\n\n` + rows.map(formatRow).join('\n\n')
    )
  }
)

server.tool(
  'summary',
  'Portfolio-level snapshot: how many products are tracked, how many moved, how many are out of stock.',
  { days: z.number().int().min(1).max(365).default(7).describe('Window in days') },
  async ({ days }) => {
    const rows = store.getWatches().map((w) => watchRow(w, days))
    const withData = rows.filter((r) => r.price !== null)
    const moved = withData.filter((r) => r.changeAbs !== null && r.changeAbs !== 0)
    const drops = moved.filter((r) => r.changeAbs < 0)
    const rises = moved.filter((r) => r.changeAbs > 0)
    const oos = withData.filter((r) => r.availability === 'out_of_stock')

    const deepest = drops.length
      ? drops.reduce((a, b) => (a.changePct < b.changePct ? a : b))
      : null

    return text(
      `Price monitor — last ${days} days\n` +
        `  tracked:      ${rows.length} (${withData.length} with readings)\n` +
        `  repriced:     ${moved.length}  (${drops.length} down, ${rises.length} up)\n` +
        `  out of stock: ${oos.length}${oos.length ? ` — ${oos.map((r) => r.label).join(', ')}` : ''}\n` +
        (deepest
          ? `  deepest cut:  ${deepest.label} ${deepest.changePct.toFixed(1)}% to ${fmt(deepest.price, deepest.currency)}\n`
          : '')
    )
  }
)

server.tool(
  'add_watch',
  'Start monitoring a product URL. Takes a first reading immediately so you know whether extraction works.',
  {
    url: z.string().url().describe('Public product page URL'),
    label: z.string().optional().describe('Display name; defaults to the hostname'),
    priceRegex: z
      .string()
      .optional()
      .describe('Only for sites with no structured data; price in capture group 1'),
    currency: z
      .string()
      .length(3)
      .optional()
      .describe('ISO code (GBP, EUR…) for pages that do not declare one; required with priceRegex'),
  },
  async ({ url, label, priceRegex, currency }) => {
    const watches = store.getWatches()
    if (watches.some((w) => w.url === url)) {
      return text(`Already watching ${url}`)
    }

    const watch = {
      id: crypto.randomUUID().slice(0, 8),
      label: label || new URL(url).hostname.replace(/^www\./, ''),
      url,
      ...(priceRegex ? { priceRegex } : {}),
      ...(currency ? { currency: currency.toUpperCase() } : {}),
    }

    // Take a reading before committing, so a URL we can't read never gets saved silently
    try {
      const { observation } = await checkWatch(watch, null)
      watches.push(watch)
      store.saveWatches(watches)
      store.addObservation(observation)

      return text(
        `Added "${watch.label}" [${watch.id}]\n` +
          `  first reading: ${fmt(observation.price, observation.currency)}` +
          `${observation.availability ? ` (${observation.availability.replace(/_/g, ' ')})` : ''}\n` +
          `  extraction: ${observation.source}`
      )
    } catch (err) {
      if (err instanceof BlockedByRobotsError) {
        return text(`Not added — robots.txt on that host disallows fetching ${url}`)
      }
      return text(
        `Not added — could not read a price: ${err.message}\n` +
          'If the site publishes no structured data, retry with a priceRegex.'
      )
    }
  }
)

server.tool(
  'remove_watch',
  'Stop monitoring a product. Its recorded history is kept.',
  { query: z.string().describe('Watch id, label, or part of a label') },
  async ({ query }) => {
    const watch = store.findWatch(query)
    store.saveWatches(store.getWatches().filter((w) => w.id !== watch.id))
    return text(`Removed "${watch.label}" [${watch.id}]. History retained.`)
  }
)

server.tool(
  'check_now',
  'Fetch fresh prices right now and report what changed. Omit query to check everything.',
  {
    query: z
      .string()
      .optional()
      .describe('Watch id or label to check; omit to check all watches'),
  },
  async ({ query }) => {
    const targets = query ? [store.findWatch(query)] : store.getWatches()
    if (targets.length === 0) return text('No watches configured.')

    const latest = store.latestByWatch()
    const lines = []
    let changes = 0

    for (const watch of targets) {
      const previous = latest[watch.id] || null
      try {
        const { observation, changes: ch } = await checkWatch(watch, previous)
        store.addObservation(observation)

        if (ch) {
          const list = Array.isArray(ch) ? ch : [ch]
          if (list.some((c) => c.type !== 'first_seen')) changes++
          lines.push(`${watch.label}: ${list.map((c) => c.message).join('; ')}`)
        } else {
          lines.push(`${watch.label}: unchanged at ${fmt(observation.price, observation.currency)}`)
        }
      } catch (err) {
        lines.push(
          err instanceof BlockedByRobotsError
            ? `${watch.label}: skipped — robots.txt disallows this URL`
            : `${watch.label}: failed — ${err.message}`
        )
      }
    }

    return text(
      `Checked ${targets.length} watch${targets.length === 1 ? '' : 'es'}, ${changes} changed:\n\n` +
        lines.map((l) => `  ${l}`).join('\n')
    )
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.log('price-monitor MCP server ready')
