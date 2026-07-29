// robots.txt fetching and rule matching.
//
// This monitor only reads pages the site's own robots.txt permits. Rules are
// cached per-origin for the life of the process so we fetch each robots.txt once.

const USER_AGENT = 'price-monitor'

const cache = new Map()

// Parse robots.txt into groups of { agents, rules, crawlDelay }.
// Rules keep their order-independent longest-match semantics from the spec.
function parse(text) {
  const groups = []
  let current = null
  let lastLineWasAgent = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue

    const idx = line.indexOf(':')
    if (idx === -1) continue

    const field = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()

    if (field === 'user-agent') {
      // Consecutive user-agent lines share one group of rules
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastLineWasAgent = true
      continue
    }

    if (!current) continue
    lastLineWasAgent = false

    if (field === 'disallow' || field === 'allow') {
      // An empty Disallow means "allow everything" — no rule to record
      if (field === 'disallow' && value === '') continue
      current.rules.push({ allow: field === 'allow', path: value })
    } else if (field === 'crawl-delay') {
      const n = parseFloat(value)
      if (!Number.isNaN(n)) current.crawlDelay = n
    }
  }

  return groups
}

// Pick the group matching our agent, falling back to the wildcard group.
function selectGroup(groups, agent) {
  const ua = agent.toLowerCase()
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && ua.includes(a)))
  if (specific) return specific
  return groups.find((g) => g.agents.includes('*')) || null
}

// Convert a robots path pattern (supports * and $) into a regex.
function patternToRegex(pattern) {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*') re += '.*'
    else if (ch === '$' && i === pattern.length - 1) re += '$'
    else re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + re)
}

// Longest matching rule wins; Allow beats Disallow at equal length.
function isAllowed(group, pathname) {
  if (!group) return true

  let best = null
  for (const rule of group.rules) {
    if (!patternToRegex(rule.path).test(pathname)) continue
    if (
      !best ||
      rule.path.length > best.path.length ||
      (rule.path.length === best.path.length && rule.allow)
    ) {
      best = rule
    }
  }

  return best ? best.allow : true
}

// Fetch and cache robots.txt for a URL's origin.
// A missing or unreachable robots.txt is treated as "allow all", per convention.
async function getRules(url) {
  const { origin } = new URL(url)
  if (cache.has(origin)) return cache.get(origin)

  let group = null
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      group = selectGroup(parse(await res.text()), USER_AGENT)
    } else if (res.status >= 500) {
      // Server error means we can't know the rules — refuse rather than assume
      group = { agents: ['*'], rules: [{ allow: false, path: '/' }], crawlDelay: null }
    }
  } catch {
    // Network failure — treat as allow-all, same as a 404
  }

  cache.set(origin, group)
  return group
}

// Returns { allowed, crawlDelay } for a specific URL.
async function check(url) {
  const group = await getRules(url)
  const { pathname, search } = new URL(url)
  return {
    allowed: isAllowed(group, pathname + search),
    crawlDelay: group?.crawlDelay ?? null,
  }
}

module.exports = { check, parse, selectGroup, isAllowed, USER_AGENT }
