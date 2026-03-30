const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')
const { getDb } = require('./db/init')
const { runIngest } = require('./ingest')
const { startServer } = require('./server')

dotenv.config()

function main() {
  getDb()
  console.log('DB initialized')

  const csvFilePath = 'data/atlas_inventory.csv'
  const resolvedCsvFilePath = path.resolve(process.cwd(), csvFilePath)

  if (fs.existsSync(resolvedCsvFilePath)) {
    runIngest(csvFilePath)
    console.log('CSV ingested')
  } else {
    console.warn(`[START] CSV not found at ${csvFilePath}; skipping ingest`)
  }

  const { port } = startServer()
  console.log(`Server started on port ${port}`)
}

main()
