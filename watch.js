// Long-running scheduler. Runs a check immediately, then every
// CHECK_INTERVAL_MINUTES (default 360 — four times a day is plenty for pricing
// and keeps request volume negligible).

const path = require('path')
const fs = require('fs')
const { run } = require('./check')

const ENV_PATH = path.join(__dirname, '.env')
if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH)

const intervalMinutes = parseInt(process.env.CHECK_INTERVAL_MINUTES || '360', 10)

async function tick() {
  console.log(`\n=== ${new Date().toLocaleString()} ===`)
  try {
    await run()
  } catch (err) {
    console.error(`Check cycle failed: ${err.message}`)
  }
}

console.log(`Watching every ${intervalMinutes} minutes. Ctrl-C to stop.`)
tick()
setInterval(tick, intervalMinutes * 60 * 1000)
