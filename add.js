// Add a watch:  npm run add -- <url> "Label" [--regex '<pattern>']

const crypto = require('crypto')
const store = require('./lib/store')

const args = process.argv.slice(2)
const url = args.find((a) => a.startsWith('http'))
const regexFlag = args.indexOf('--regex')
const label = args.find((a) => !a.startsWith('http') && !a.startsWith('--') && a !== args[regexFlag + 1])

if (!url) {
  console.error('Usage: npm run add -- <url> "Label" [--regex \'<pattern>\']')
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
  ...(regexFlag !== -1 ? { priceRegex: args[regexFlag + 1] } : {}),
}

watches.push(watch)
store.saveWatches(watches)

console.log(`Added "${watch.label}" (${watch.id})`)
console.log('Run `npm run check` to take a first reading.')
