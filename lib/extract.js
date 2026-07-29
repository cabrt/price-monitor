// Price and availability extraction.
//
// Strategy, in order of reliability:
//   1. schema.org Product JSON-LD  — structured, standardised, what search
//      engines read. Most commerce platforms (Shopify, WooCommerce, BigCommerce,
//      Magento) emit it by default.
//   2. OpenGraph / microdata meta tags — well-defined, widely present.
//   3. A user-supplied regex in the watch config — last resort for sites that
//      publish neither.
//
// Scraping rendered DOM with brittle CSS selectors is deliberately not the
// primary path: selectors break on every redesign, structured data rarely does.

const IN_STOCK = /InStock|InStoreOnly|OnlineOnly|LimitedAvailability|PreOrder|BackOrder/i
const OUT_OF_STOCK = /OutOfStock|SoldOut|Discontinued/i

// Pull every JSON-LD block out of the document.
function parseJsonLdBlocks(html) {
  const blocks = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

  let match
  while ((match = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(match[1].trim()))
    } catch {
      // Malformed JSON-LD is common in the wild — skip it rather than fail
    }
  }

  return blocks
}

// JSON-LD can nest via arrays or @graph; walk it all into a flat list.
function flattenNodes(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) flattenNodes(item, out)
  } else if (value && typeof value === 'object') {
    out.push(value)
    if (value['@graph']) flattenNodes(value['@graph'], out)
  }
  return out
}

const hasType = (node, type) => {
  const t = node['@type']
  if (!t) return false
  return Array.isArray(t) ? t.includes(type) : t === type
}

// Offers may be a single object, an array, or an AggregateOffer.
function pickOffer(offers) {
  const candidates = flattenNodes(offers)
  if (candidates.length === 0) return null

  const aggregate = candidates.find((o) => hasType(o, 'AggregateOffer'))
  if (aggregate) {
    return {
      price: aggregate.lowPrice ?? aggregate.price,
      currency: aggregate.priceCurrency,
      availability: aggregate.availability,
    }
  }

  // Prefer an in-stock offer when a product lists several
  const offer =
    candidates.find((o) => o.availability && IN_STOCK.test(String(o.availability))) ||
    candidates[0]

  return {
    price: offer.price ?? offer.lowPrice,
    currency: offer.priceCurrency,
    availability: offer.availability,
  }
}

// Normalise "$1,299.00" / "1.299,00" / 1299 into a number.
function parsePrice(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null

  let s = String(raw).trim().replace(/[^\d.,-]/g, '')
  if (!s) return null

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')

  if (lastComma > lastDot) {
    // European format: 1.299,00 -> comma is the decimal separator
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    // Anglo format: 1,299.00 -> comma is a thousands separator
    s = s.replace(/,/g, '')
  }

  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function parseAvailability(raw) {
  if (!raw) return null
  const s = String(raw)
  if (OUT_OF_STOCK.test(s)) return 'out_of_stock'
  if (IN_STOCK.test(s)) return 'in_stock'
  return null
}

function fromJsonLd(html) {
  const nodes = flattenNodes(parseJsonLdBlocks(html))
  const product = nodes.find((n) => hasType(n, 'Product') && n.offers)
  if (!product) return null

  const offer = pickOffer(product.offers)
  if (!offer) return null

  const price = parsePrice(offer.price)
  if (price === null) return null

  return {
    name: typeof product.name === 'string' ? product.name.trim() : null,
    price,
    currency: offer.currency || null,
    availability: parseAvailability(offer.availability),
    source: 'json-ld',
  }
}

// Read <meta property="..." content="..."> in either attribute order.
function metaContent(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*content=["']([^"']+)["']`,
        'i'
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${escaped}["']`,
        'i'
      ),
    ]
    for (const re of patterns) {
      const m = html.match(re)
      if (m) return m[1]
    }
  }
  return null
}

function fromMetaTags(html) {
  const price = parsePrice(
    metaContent(html, ['product:price:amount', 'og:price:amount', 'price', 'product:price'])
  )
  if (price === null) return null

  return {
    name: metaContent(html, ['og:title', 'twitter:title']),
    price,
    currency: metaContent(html, ['product:price:currency', 'og:price:currency', 'priceCurrency']),
    availability: parseAvailability(
      metaContent(html, ['product:availability', 'og:availability', 'availability'])
    ),
    source: 'meta-tags',
  }
}

// Escape hatch for sites with no structured data. Configured per-watch as
// { "priceRegex": "..." } with the price in the first capture group.
function fromRegex(html, priceRegex) {
  if (!priceRegex) return null

  const m = html.match(new RegExp(priceRegex))
  if (!m) return null

  const price = parsePrice(m[1] ?? m[0])
  if (price === null) return null

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return {
    name: titleMatch ? titleMatch[1].trim() : null,
    price,
    currency: null,
    availability: null,
    source: 'regex',
  }
}

// Try each strategy in order; return the first that yields a price.
function extract(html, { priceRegex } = {}) {
  return fromJsonLd(html) || fromMetaTags(html) || fromRegex(html, priceRegex) || null
}

module.exports = { extract, fromJsonLd, fromMetaTags, fromRegex, parsePrice, parseAvailability }
