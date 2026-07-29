// Node's built-in test runner — no test dependency to install.
//   node --test

const { test } = require('node:test')
const assert = require('node:assert')

const { extract, parsePrice, fromJsonLd, fromMetaTags } = require('../lib/extract')

const page = (body) => `<!DOCTYPE html><html><head>${body}</head><body></body></html>`

const jsonLd = (obj) =>
  page(`<script type="application/ld+json">${JSON.stringify(obj)}</script>`)

test('parsePrice handles anglo, european, and symbol formats', () => {
  assert.equal(parsePrice('$1,299.00'), 1299)
  assert.equal(parsePrice('1.299,00'), 1299)
  assert.equal(parsePrice('49.99'), 49.99)
  assert.equal(parsePrice(29.5), 29.5)
  assert.equal(parsePrice('€ 1.234,56'), 1234.56)
  assert.equal(parsePrice(''), null)
  assert.equal(parsePrice(null), null)
})

test('extracts a plain Product with a single offer', () => {
  const html = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Widget Pro',
    offers: {
      '@type': 'Offer',
      price: '49.99',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
  })

  assert.deepEqual(extract(html), {
    name: 'Widget Pro',
    price: 49.99,
    currency: 'USD',
    availability: 'in_stock',
    source: 'json-ld',
  })
})

test('finds a Product nested inside @graph', () => {
  const html = jsonLd({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'Shop' },
      {
        '@type': 'Product',
        name: 'Nested Widget',
        offers: { '@type': 'Offer', price: 12.5, priceCurrency: 'GBP' },
      },
    ],
  })

  const result = fromJsonLd(html)
  assert.equal(result.name, 'Nested Widget')
  assert.equal(result.price, 12.5)
  assert.equal(result.currency, 'GBP')
})

test('AggregateOffer uses lowPrice', () => {
  const html = jsonLd({
    '@type': 'Product',
    name: 'Multi-variant',
    offers: {
      '@type': 'AggregateOffer',
      lowPrice: '19.99',
      highPrice: '39.99',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
  })

  assert.equal(fromJsonLd(html).price, 19.99)
})

test('prefers the in-stock offer when several are listed', () => {
  const html = jsonLd({
    '@type': 'Product',
    name: 'Variants',
    offers: [
      { '@type': 'Offer', price: '10.00', availability: 'https://schema.org/OutOfStock' },
      { '@type': 'Offer', price: '20.00', availability: 'https://schema.org/InStock' },
    ],
  })

  const result = fromJsonLd(html)
  assert.equal(result.price, 20)
  assert.equal(result.availability, 'in_stock')
})

test('detects out of stock', () => {
  const html = jsonLd({
    '@type': 'Product',
    name: 'Gone',
    offers: { '@type': 'Offer', price: '5.00', availability: 'https://schema.org/SoldOut' },
  })

  assert.equal(fromJsonLd(html).availability, 'out_of_stock')
})

test('malformed JSON-LD does not throw, falls through to meta tags', () => {
  const html = page(`
    <script type="application/ld+json">{ this is not json }</script>
    <meta property="product:price:amount" content="15.00">
    <meta property="product:price:currency" content="USD">
    <meta property="og:title" content="Fallback Widget">`)

  const result = extract(html)
  assert.equal(result.source, 'meta-tags')
  assert.equal(result.price, 15)
  assert.equal(result.name, 'Fallback Widget')
})

test('meta tags parse with attributes in either order', () => {
  const html = page(`<meta content="42.00" property="og:price:amount">`)
  assert.equal(fromMetaTags(html).price, 42)
})

test('regex fallback is used only when nothing structured exists', () => {
  const html = page(`<title>Regex Widget</title>`) +
    `<div class="price">$77.50</div>`

  assert.equal(extract(html), null)
  assert.equal(extract(html, { priceRegex: 'class="price">\\$([0-9.,]+)' }).price, 77.5)
})

test('returns null when no price is present anywhere', () => {
  assert.equal(extract(page('<title>Nothing here</title>')), null)
})
