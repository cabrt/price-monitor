// Polite HTTP fetching: identifies itself honestly, obeys robots.txt,
// spaces requests per-origin, and backs off on 429/5xx.

const robots = require('./robots')

const DEFAULT_DELAY_MS = 2000
const MAX_RETRIES = 3
const TIMEOUT_MS = 20000

// Descriptive UA with a contact URL — site owners can identify and block us.
const USER_AGENT =
  'price-monitor/1.0 (+https://github.com/cabrt/price-monitor) Node/' +
  process.versions.node

const lastRequestAt = new Map()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Wait out the per-origin delay so we never burst a single host.
async function throttle(origin, delayMs) {
  const last = lastRequestAt.get(origin) || 0
  const wait = last + delayMs - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequestAt.set(origin, Date.now())
}

class BlockedByRobotsError extends Error {
  constructor(url) {
    super(`robots.txt disallows fetching ${url}`)
    this.name = 'BlockedByRobotsError'
    this.url = url
  }
}

// Fetch a page as HTML text. Throws BlockedByRobotsError if disallowed.
async function fetchPage(url, { minDelayMs = DEFAULT_DELAY_MS } = {}) {
  const { origin } = new URL(url)

  const { allowed, crawlDelay } = await robots.check(url)
  if (!allowed) throw new BlockedByRobotsError(url)

  // Honor the site's Crawl-delay when it asks for more than our default
  const delayMs = Math.max(minDelayMs, (crawlDelay ?? 0) * 1000)

  let lastError = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await throttle(origin, delayMs)

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (res.status === 429 || res.status >= 500) {
        // Prefer the server's own Retry-After when it gives one
        const retryAfter = parseFloat(res.headers.get('Retry-After'))
        const backoff = Number.isNaN(retryAfter)
          ? delayMs * 2 ** (attempt + 1)
          : retryAfter * 1000
        lastError = new Error(`HTTP ${res.status} from ${url}`)
        if (attempt < MAX_RETRIES - 1) {
          await sleep(backoff)
          continue
        }
        throw lastError
      }

      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)

      return await res.text()
    } catch (err) {
      lastError = err
      if (err.name === 'BlockedByRobotsError') throw err
      if (attempt < MAX_RETRIES - 1) {
        await sleep(delayMs * 2 ** (attempt + 1))
        continue
      }
    }
  }

  throw lastError || new Error(`Failed to fetch ${url}`)
}

module.exports = { fetchPage, BlockedByRobotsError, USER_AGENT }
