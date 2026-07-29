// Add a watch:
//   npm run add -- <url> "Label" [--regex '<pattern>'] [--currency GBP]

const crypto = require('crypto')
const store = require('./lib/store')

const args = process.argv.slice(2)
const url = args.find((a) => a.startsWith('http'))

const flagValue = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}

const priceRegex = flagValue('--regex')
const currency = flagValue('--currency')
const flagValues = new Set([priceRegex, currency].filter(Boolean))
const label = args.find(
  (a) => !a.startsWith('http') && !a.startsWith('--') && !flagValues.has(a)
)

if (!url) {
  console.error(
    "Usage: npm run add -- <url> \"Label\" [--regex '<pattern>'] [--currency GBP]"
  )
  process.exit(1)
}

const watches = store.getWatches()

if (watches.some((w) => w.url === url)) {
  console.error('Already watching that URL.')
  process.exit(1)
}

const watch = {
  id: crypto.randomUUID().slice(0, 8),
  label: label || new URL(url).hostname.replace(/^www\./, ''),
  url,
  ...(priceRegex ? { priceRegex } : {}),
  ...(currency ? { currency: currency.toUpperCase() } : {}),
}

watches.push(watch)
store.saveWatches(watches)

console.log(`Added "${watch.label}" (${watch.id})`)
console.log('Run `npm run check` to take a first reading.')
