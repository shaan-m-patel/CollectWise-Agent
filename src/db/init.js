const Database = require('better-sqlite3')
const dotenv = require('dotenv')

dotenv.config()

let dbInstance = null

function getDb() {
  if (dbInstance) {
    return dbInstance
  }

  const dbPath = process.env.DB_PATH || './data/accounts.db'
  dbInstance = new Database(dbPath)

  dbInstance.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  account_number TEXT PRIMARY KEY,
  debtor_name    TEXT NOT NULL,
  phone_number   TEXT,
  balance        REAL,
  status         TEXT,
  client_name    TEXT,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
)
`)

  return dbInstance
}

module.exports = { getDb }
