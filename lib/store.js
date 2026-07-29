// JSON-file persistence. Two files, deliberately:
//   watches.json — what to monitor (hand-editable, checked by a human)
//   data/history.json — append-only observations, one row per successful check
//
// Current state is derived from history rather than stored separately, so the
// two can never disagree.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const WATCHES_PATH = path.join(ROOT, 'watches.json')
const DATA_DIR = path.join(ROOT, 'data')
const HISTORY_PATH = path.join(DATA_DIR, 'history.json')

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  // Write to a temp file then rename, so an interrupted run can't truncate the
  // history file it has already spent hours accumulating.
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, filePath)
}

const getWatches = () => loadJson(WATCHES_PATH, { watches: [] }).watches || []

const saveWatches = (watches) => saveJson(WATCHES_PATH, { watches })

const getHistory = () => loadJson(HISTORY_PATH, { observations: [] }).observations || []

function addObservation(observation) {
  const observations = getHistory()
  observations.push(observation)
  saveJson(HISTORY_PATH, { observations })
  return observation
}

// Most recent observation per watch id.
function latestByWatch() {
  const latest = {}
  for (const obs of getHistory()) {
    const prev = latest[obs.watchId]
    if (!prev || obs.checkedAt > prev.checkedAt) latest[obs.watchId] = obs
  }
  return latest
}

// Full time series for one watch, oldest first.
const historyFor = (watchId) =>
  getHistory()
    .filter((o) => o.watchId === watchId)
    .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))

// Resolve a watch from an id, an exact label, or a partial label — so callers
// (and an LLM) can say "Northgate" instead of carrying ids around.
function findWatch(query, watches = getWatches()) {
  if (watches.length === 0) throw new Error('No watches configured yet.')

  const q = String(query).trim()
  const ql = q.toLowerCase()

  const byId = watches.find((w) => w.id === q)
  if (byId) return byId

  const exact = watches.find((w) => w.label.toLowerCase() === ql)
  if (exact) return exact

  const partial = watches.filter(
    (w) => w.label.toLowerCase().includes(ql) || w.url.toLowerCase().includes(ql)
  )
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) {
    throw new Error(
      `"${query}" matches ${partial.length} watches:\n` +
        partial.map((w) => `  ${w.id}  ${w.label}`).join('\n')
    )
  }

  throw new Error(
    `No watch matching "${query}". Available:\n` +
      watches.map((w) => `  ${w.id}  ${w.label}`).join('\n')
  )
}

module.exports = {
  getWatches,
  saveWatches,
  getHistory,
  addObservation,
  latestByWatch,
  historyFor,
  findWatch,
  loadJson,
  saveJson,
  WATCHES_PATH,
  HISTORY_PATH,
}
