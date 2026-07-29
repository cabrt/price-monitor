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

module.exports = {
  getWatches,
  saveWatches,
  getHistory,
  addObservation,
  latestByWatch,
  historyFor,
  loadJson,
  saveJson,
  WATCHES_PATH,
  HISTORY_PATH,
}
