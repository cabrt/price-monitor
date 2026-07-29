// Change alerting. Console output always; webhook when ALERT_WEBHOOK is set.
//
// The webhook payload is a generic JSON body that Slack, Discord and Zapier all
// accept, so there's no per-service integration to maintain.

const fmt = (n, currency) =>
  n === null || n === undefined
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: currency ? 'currency' : 'decimal',
        currency: currency || undefined,
        minimumFractionDigits: 2,
      }).format(n)

// Describe what changed between two observations, or null if nothing did.
function diff(previous, current) {
  if (!previous) {
    return { type: 'first_seen', message: `now tracking at ${fmt(current.price, current.currency)}` }
  }

  const changes = []

  if (previous.price !== current.price) {
    const delta = current.price - previous.price
    const pct = previous.price ? (delta / previous.price) * 100 : 0
    changes.push({
      type: delta < 0 ? 'price_drop' : 'price_rise',
      from: previous.price,
      to: current.price,
      delta,
      pct,
      message: `${delta < 0 ? 'dropped' : 'rose'} ${fmt(Math.abs(delta), current.currency)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%) — ${fmt(previous.price, current.currency)} → ${fmt(current.price, current.currency)}`,
    })
  }

  if (previous.availability !== current.availability && current.availability) {
    changes.push({
      type: current.availability === 'out_of_stock' ? 'went_out_of_stock' : 'back_in_stock',
      from: previous.availability,
      to: current.availability,
      message:
        current.availability === 'out_of_stock' ? 'went out of stock' : 'came back in stock',
    })
  }

  return changes.length > 0 ? changes : null
}

async function sendWebhook(watch, changes) {
  const url = process.env.ALERT_WEBHOOK
  if (!url) return

  const list = Array.isArray(changes) ? changes : [changes]
  const text = `*${watch.label}* ${list.map((c) => c.message).join('; ')}\n${watch.url}`

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, watch, changes: list }),
      signal: AbortSignal.timeout(10000),
    })
  } catch (err) {
    console.error(`  ! webhook failed: ${err.message}`)
  }
}

module.exports = { diff, sendWebhook, fmt }
