// Run one check across every watch: fetch, extract, diff against the last
// observation, record, alert.

const path = require('path')
const fs = require('fs')

const { fetchPage, BlockedByRobotsError } = require('./lib/fetch')
const { extract } = require('./lib/extract')
const store = require('./lib/store')
const { diff, sendWebhook, fmt } = require('./lib/alert')

const ENV_PATH = path.join(__dirname, '.env')
if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH)

const verbose = process.argv.includes('--verbose')

async function checkWatch(watch, previous) {
  const html = await fetchPage(watch.url)
  const result = extract(html, { priceRegex: watch.priceRegex })

  if (!result) {
    throw new Error(
      'no price found — site publishes no structured data; add a "priceRegex" to this watch'
    )
  }

  const observation = {
    watchId: watch.id,
    checkedAt: new Date().toISOString(),
    price: result.price,
    // No silent default: an unknown currency stays null and renders as a bare
    // number, rather than mislabeling a £ price as $. Set "currency" on the
    // watch when the page doesn't declare one (the regex path never does).
    currency: result.currency || watch.currency || null,
    availability: result.availability,
    name: result.name,
    source: result.source,
  }

  const changes = diff(previous, observation)
  return { observation, changes }
}

async function run() {
  const watches = store.getWatches()

  if (watches.length === 0) {
    console.log('No watches configured. Add one:\n  npm run add -- <url> "Label"')
    return
  }

  const latest = store.latestByWatch()
  const changed = []
  let failed = 0

  console.log(`Checking ${watches.length} watch${watches.length === 1 ? '' : 'es'}...\n`)

  for (const watch of watches) {
    const previous = latest[watch.id] || null

    try {
      const { observation, changes } = await checkWatch(watch, previous)
      store.addObservation(observation)

      if (changes) {
        const list = Array.isArray(changes) ? changes : [changes]
        console.log(`  ${watch.label}`)
        for (const c of list) console.log(`    ${c.message}`)
        if (list.some((c) => c.type !== 'first_seen')) {
          changed.push({ watch, changes: list })
          await sendWebhook(watch, list)
        }
      } else if (verbose) {
        console.log(`  ${watch.label} — unchanged at ${fmt(observation.price, observation.currency)}`)
      }
    } catch (err) {
      failed++
      if (err instanceof BlockedByRobotsError) {
        console.error(`  ${watch.label} — SKIPPED: robots.txt disallows this URL`)
      } else {
        console.error(`  ${watch.label} — FAILED: ${err.message}`)
      }
    }
  }

  console.log(
    `\nDone. ${changed.length} change${changed.length === 1 ? '' : 's'}` +
      (failed ? `, ${failed} failed` : '')
  )
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = { run, checkWatch }
