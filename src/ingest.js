const fs = require('fs')
const path = require('path')
const { parse } = require('csv-parse/sync')
const { getDb } = require('./db/init')

function getFilePathFromArgs(args) {
  const fileFlagIndex = args.indexOf('--file')
  if (fileFlagIndex === -1 || !args[fileFlagIndex + 1]) {
    return null
  }
  return args[fileFlagIndex + 1]
}

function normalizeText(value) {
  if (value === undefined || value === null) {
    return null
  }

  const trimmedValue = String(value).trim()
  return trimmedValue === '' ? null : trimmedValue
}

function main() {
  const csvFilePathArg = getFilePathFromArgs(process.argv.slice(2))

  if (!csvFilePathArg) {
    console.error('[INGEST] Missing required --file flag')
    process.exit(1)
  }

  const csvFilePath = path.resolve(process.cwd(), csvFilePathArg)

  if (!fs.existsSync(csvFilePath)) {
    console.error(`[INGEST] File not found: ${csvFilePathArg}`)
    process.exit(1)
  }

  let csvContent
  try {
    csvContent = fs.readFileSync(csvFilePath, 'utf8')
  } catch (error) {
    console.error(`[INGEST] Failed to read file: ${error.message}`)
    process.exit(1)
  }

  let rows
  try {
    rows = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    })
  } catch (error) {
    console.error(`[INGEST] Failed to parse CSV: ${error.message}`)
    process.exit(1)
  }

  const db = getDb()
  const upsertStatement = db.prepare(`
INSERT OR REPLACE INTO accounts
  (account_number, debtor_name, phone_number, balance, status, client_name, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
`)

  let ingestedRows = 0
  let skippedRows = 0


  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const rowNumber = index + 2

    const accountNumber = normalizeText(row.account_number)
    if (!accountNumber) {
      skippedRows += 1
      console.warn(`[INGEST] Skipping row ${rowNumber}: missing account_number`)
      continue
    }

    const debtorName = normalizeText(row.debtor_name)
    if (!debtorName) {
      skippedRows += 1
      console.warn(`[INGEST] Skipping row ${rowNumber}: missing debtor_name`)
      continue
    }

    const phoneNumber = normalizeText(row.phone_number)
    const status = normalizeText(row.status)
    const clientName = normalizeText(row.client_name)

    const rawBalance = normalizeText(row.balance)
    let balance = null
    if (rawBalance !== null) {
      balance = Number.parseFloat(rawBalance)
      if (Number.isNaN(balance)) {
        skippedRows += 1
        console.warn(`[INGEST] Skipping account ${accountNumber}: invalid balance`)
        continue
      }
    }

    upsertStatement.run(
      accountNumber,
      debtorName,
      phoneNumber,
      balance,
      status,
      clientName,
      new Date().toISOString()
    )

    ingestedRows += 1
  }

  console.log(`Ingested ${ingestedRows} rows, skipped ${skippedRows} rows`)
}

main()
