const { test } = require('node:test')
const assert = require('node:assert')

const { parse, selectGroup, isAllowed } = require('../lib/robots')

const groupFor = (text, agent = 'price-monitor') => selectGroup(parse(text), agent)

test('wildcard disallow blocks matching paths', () => {
  const g = groupFor(`
User-agent: *
Disallow: /admin
`)
  assert.equal(isAllowed(g, '/admin/settings'), false)
  assert.equal(isAllowed(g, '/products/widget'), true)
})

test('empty Disallow means allow everything', () => {
  const g = groupFor(`
User-agent: *
Disallow:
`)
  assert.equal(isAllowed(g, '/anything'), true)
})

test('longest matching rule wins over a broader one', () => {
  const g = groupFor(`
User-agent: *
Disallow: /
Allow: /products
`)
  assert.equal(isAllowed(g, '/products/widget'), true)
  assert.equal(isAllowed(g, '/checkout'), false)
})

test('Allow beats Disallow at equal specificity', () => {
  const g = groupFor(`
User-agent: *
Disallow: /shop
Allow: /shop
`)
  assert.equal(isAllowed(g, '/shop/item'), true)
})

test('wildcards and end-anchors in patterns', () => {
  const g = groupFor(`
User-agent: *
Disallow: /*.pdf$
Disallow: /private/*/secret
`)
  assert.equal(isAllowed(g, '/files/report.pdf'), false)
  assert.equal(isAllowed(g, '/files/report.pdf?v=2'), true)
  assert.equal(isAllowed(g, '/private/a/secret'), false)
})

test('an agent-specific group overrides the wildcard group', () => {
  const text = `
User-agent: *
Disallow: /

User-agent: price-monitor
Disallow: /admin
`
  const g = groupFor(text)
  assert.equal(isAllowed(g, '/products'), true)
  assert.equal(isAllowed(g, '/admin'), false)
})

test('consecutive user-agent lines share one rule group', () => {
  const groups = parse(`
User-agent: googlebot
User-agent: price-monitor
Disallow: /nope
`)
  assert.equal(groups.length, 1)
  assert.equal(isAllowed(selectGroup(groups, 'price-monitor'), '/nope'), false)
})

test('comments and blank lines are ignored', () => {
  const g = groupFor(`
# a comment
User-agent: *   # trailing comment

Disallow: /admin
`)
  assert.equal(isAllowed(g, '/admin'), false)
  assert.equal(isAllowed(g, '/ok'), true)
})

test('crawl-delay is captured', () => {
  const g = groupFor(`
User-agent: *
Crawl-delay: 10
Disallow: /x
`)
  assert.equal(g.crawlDelay, 10)
})

test('no robots rules at all means allow', () => {
  assert.equal(isAllowed(null, '/anything'), true)
})
