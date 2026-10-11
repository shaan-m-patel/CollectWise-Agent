# CollectWise Agent — AI Coding Reference

> **For GitHub Copilot / AI coding tools:** This file is the single source of truth for this project.
> Read it fully before generating any code. All architectural decisions are already made — follow them, don't reinvent them.

---

## What We're Building

Atlas Recovery uses CollectWise's AI agent (built on Retell AI) to handle debt collection calls. Currently the agent can only look up debtor accounts **by phone number**. We are adding the ability to look up accounts **by account number**, sourced from a CSV file Atlas uploads periodically.

**This is a prototype / take-home project. Do not over-engineer.**

---

## Deliverables Checklist

- [ ] `src/db/init.js` — SQLite schema creation script
- [ ] `src/ingest.js` — CSV ingestion script with validation + upsert
- [ ] `src/server.js` — Express API server with account lookup endpoint
- [ ] `data/atlas_inventory.csv` — Sample CSV with realistic test data (8–10 rows)
- [ ] `agent/retell_agent.json` — Exported Retell AI conversation flow agent
- [ ] `docs/coo_email.md` — Non-technical email to Atlas Recovery COO
- [ ] `README.md` — Setup, run instructions, public URL, design decisions
- [ ] `.env.example` — Environment variable template

---

## Tech Stack (Final — Do Not Change)

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js | Required by spec |
| Framework | Express | Lightweight, no setup friction |
| Database | SQLite via `better-sqlite3` | Zero-config, file-based, perfect for prototype |
| CSV Parsing | `csv-parse` | Stream-based, handles large files |
| Config | `dotenv` | Standard `.env` pattern |
| Deployment | Railway.app | Free tier, GitHub deploy in 2 min |

**Install command:**
```bash
npm install express better-sqlite3 csv-parse dotenv
```

**No TypeScript. No ORM. No test framework. No extra abstraction layers.**

---

## Repo Structure

```
CollectWise-Agent/
├── src/
│   ├── db/
│   │   └── init.js          # Creates the accounts table if not exists
│   ├── ingest.js            # CSV → SQLite ingestion script
│   └── server.js            # Express API server
├── data/
│   └── atlas_inventory.csv  # Sample CSV for testing
├── agent/
│   └── retell_agent.json    # Exported Retell AI agent config
├── docs/
│   └── coo_email.md         # Email to Atlas Recovery COO
├── package.json
├── .env
├── .env.example
└── README.md
```

---

## Database Schema

**One table only: `accounts`**

```sql
CREATE TABLE IF NOT EXISTS accounts (
  account_number TEXT PRIMARY KEY,
  debtor_name    TEXT NOT NULL,
  phone_number   TEXT,
  balance        REAL,
  status         TEXT,
  client_name    TEXT,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Key decisions:**
- `account_number` is the PRIMARY KEY — enforces uniqueness at the DB level
- `balance` is `REAL` not `TEXT` — allows numeric comparisons if needed later
- `updated_at` is auto-set on insert; update it manually on upsert for auditability

---

## CSV Format

**Expected filename:** `atlas_inventory.csv`
**Required columns** (must be present, header names exact):

| Column | Type | Required | Notes |
|---|---|---|---|
| `account_number` | string | **YES** | Must be unique. Row is skipped if missing. |
| `debtor_name` | string | YES | Skip row if blank |
| `phone_number` | string | no | Can be null/empty |
| `balance` | numeric | YES | Skip row if non-numeric or negative |
| `status` | string | no | e.g. "Active", "Closed", "Pending" |
| `client_name` | string | no | e.g. "Atlas Recovery" |

**Sample `data/atlas_inventory.csv`** should include:
- 5+ normal rows with valid data
- 1 row with a duplicate `account_number` (to test upsert)
- 1 row with missing `account_number` (to test skip logic)
- 1 row with non-numeric `balance` such as `"N/A"` (to test validation)
- 1 row with `status: Closed`

---

## Ingestion Logic (`src/ingest.js`)

**Strategy: UPSERT (INSERT OR REPLACE)**
- Duplicate `account_number` rows **overwrite** the existing record
- This allows Atlas to safely re-upload a corrected CSV without manual deduplication
- This decision must be documented in the README

**Validation rules (per row):**
```
IF account_number is missing or empty  → SKIP row, log warning with line number
IF account_number is not ^[A-Za-z0-9_-]{1,50}$ → SKIP row, log warning with line number
IF balance is present but not numeric  → SKIP row, log warning with line number
IF debtor_name is missing or empty     → SKIP row, log warning with line number
ALL other missing fields               → allow NULL, do not skip
```

**SQL to use:**
```sql
INSERT OR REPLACE INTO accounts
  (account_number, debtor_name, phone_number, balance, status, client_name, updated_at)
VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
```

**Run command (add to package.json scripts):**
```json
"ingest": "node src/ingest.js --file data/atlas_inventory.csv"
```

**Script must:**
1. Accept `--file <path>` CLI argument via `process.argv`
2. Print a summary at the end: `Ingestion complete: X inserted/updated, Y skipped`
3. Exit with code `0` on success, `1` on fatal error (e.g. file not found)

---

## API Spec (`src/server.js`)

### `GET /accounts/:accountNumber`

**Auth and verification (required):**
- `Authorization: Bearer <API_BEARER_TOKEN>` must be valid before any query. Missing or invalid credentials return 401 with the same JSON body as an unknown account.
- `X-Caller-Number` is the inbound caller ID supplied by the voice platform (`{{user_number}}`), not a model argument.
- Return name, balance, and status only when that caller ID matches the stored phone. Do not return `phone_number`.
- Unknown accounts and caller-ID mismatches both return 404 `{ "error": "Account not found" }`.
- Account numbers must match `^[A-Za-z0-9_-]{1,50}$` exactly. Do not strip characters and query a different value. Mismatches return 400 and do not query.
- Rate-limit lookup requests.

**Happy path response (200), only after bearer auth and caller-ID match:**
```json
{
  "account_number": "ACC001",
  "debtor_name": "John Smith",
  "balance": 1300.00,
  "status": "Active",
  "client_name": "Atlas Recovery"
}
```

**Not found or caller mismatch (404), and the same body for missing credentials (401):**
```json
{
  "error": "Account not found"
}
```

**Bad input response (400):**
```json
{
  "error": "Invalid account number format"
}
```

### `GET /health`
```json
{ "status": "ok", "timestamp": "2026-03-30T12:00:00.000Z" }
```

**Server rules:**
- Listen on `process.env.PORT || 3000`
- Call `initDb()` from `src/db/init.js` on startup before listening
- Use `express.json()` middleware
- Log every request: method, path, status code, duration ms
- Never return a stack trace in production responses

---

## Environment Variables

**`.env.example`:**
```
PORT=3000
DB_PATH=./data/accounts.db
API_BEARER_TOKEN=
```

Always read `DB_PATH` from `process.env.DB_PATH` — never hardcode the DB file path.

---

## Production Startup Script

Railway resets the filesystem on every redeploy. The production start command must:
1. Run DB init to recreate the schema
2. Run CSV ingestion from the bundled `data/atlas_inventory.csv`
3. Start the server

**Add to `package.json` scripts:**
```json
"scripts": {
  "start": "node src/server.js",
  "ingest": "node src/ingest.js --file data/atlas_inventory.csv",
  "start:prod": "node src/db/init.js && node src/ingest.js --file data/atlas_inventory.csv && node src/server.js",
  "dev": "node --watch src/server.js"
}
```

Set Railway's start command to `npm run start:prod`.

---

## Retell AI Agent (`agent/retell_agent.json`)

**Agent name:** Atlas Recovery Agent
**Type:** Conversation Flow Agent
**Platform:** https://www.retellai.com

### Conversation Flow Nodes

```
[Start]
  └─► Greeting
        "Hello, this is the Atlas Recovery automated account line.
         To look up your account, I'll need your account number.
         Please say or enter your account number now."

  └─► Collect Account Number
        Capture user input → store as variable: {{account_number}}
        If unclear/too short → re-prompt once:
        "I didn't catch that. Could you repeat your account number?"

  └─► API Lookup (Custom Tool)
        Method: GET
        URL: https://YOUR-PUBLIC-URL/accounts/{{account_number}}
        Header Authorization: Bearer <API_BEARER_TOKEN>
        Header X-Caller-Number: {{user_number}}
        The model sends account_number only. Caller ID is not a tool argument.
        On success (200) → branch: Account Found
        On 401 or 404    → branch: Account Not Found (same caller-facing words)
        On error         → branch: System Error

  └─► Account Found
        Speak name, balance, and status only from the tool response.
        "I found your account. Your current balance is ${{balance}}
         and your account status is {{status}}.
         Is there anything else I can help you with?"

  └─► Account Not Found
        Do not say whether the account exists or whether the caller ID matched.
        "I wasn't able to locate that account number.
         Please double-check the number and call back from the phone number on the account."

  └─► System Error
        "I'm sorry, I'm having trouble accessing account information right now.
         Please try again in a moment or press 0 to speak with an agent."

  └─► Goodbye
        "Thank you for calling Atlas Recovery. Have a good day."
```

**After building and testing:** Export via Settings → Export JSON → save output to `agent/retell_agent.json` and commit.

---

## README Structure

The README must include these sections in order:

1. **Overview** — 2 sentences on what this does
2. **Prerequisites** — Node.js version, npm
3. **Setup** — `git clone`, `npm install`, `cp .env.example .env`
4. **Ingest a CSV** — `npm run ingest` with expected terminal output
5. **Start the server** — `npm start`, then sample `curl` command
6. **API Reference** — endpoint, params, example request + response
7. **Deployment** — Railway setup steps + public URL
8. **Design Decisions** — duplicate handling (UPSERT), validation rules, SQLite choice, Railway persistence workaround
9. **Assumptions** — CSV column names are exact match, `account_number` is always a string

---

## COO Email (`docs/coo_email.md`)

**Audience:** Non-technical executive. No jargon. Short paragraphs.

**Must cover:**
1. What changed — the AI agent can now find accounts by account number, not just phone number
2. How it works in plain English — CSV upload → secure database → AI agent looks it up in real time during calls
3. Required CSV columns and why `account_number` must always be present and unique
4. What happens to bad rows — skipped and logged, not imported, will not affect existing data
5. What happens with duplicate account numbers — the newer row wins, safe to re-upload corrected files
6. What Atlas needs to do — use exact column header names, contact us to re-upload when account data changes

**Tone:** Professional, warm, brief. Use short paragraphs not bullet-heavy lists.

---

## Coding Style Rules

> GitHub Copilot: follow these exactly when generating any code in this project.

- **CommonJS only** — `require()` / `module.exports`, no ESM `import`/`export`
- **No semicolons** — rely on ASI
- **2-space indentation**
- **Single quotes** for all strings
- **async/await** over raw `.then()` chains or callbacks
- **Named functions** over anonymous arrows for top-level route handlers
- **Descriptive variable names** — `accountNumber` not `acctNum`, `csvFilePath` not `f`
- **Structured log prefixes** — `[DB]`, `[INGEST]`, `[API]` — no bare `console.log('here')`
- **Human-readable error messages** — never leak stack traces or raw SQL errors to API responses

**Example style reference:**
```js
function lookupAccount(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Account not found' })
  }
  const accountNumber = req.params.accountNumber
  if (!isValidAccountNumber(accountNumber)) {
    return res.status(400).json({ error: 'Invalid account number format' })
  }
  const account = db.prepare('SELECT * FROM accounts WHERE account_number = ?').get(accountNumber)
  if (!account || !phonesMatch(account.phone_number, req.get('x-caller-number'))) {
    return res.status(404).json({ error: 'Account not found' })
  }
  return res.json({
    account_number: account.account_number,
    debtor_name: account.debtor_name,
    balance: account.balance,
    status: account.status,
    client_name: account.client_name
  })
}
```

---

## What NOT to Build

Do not add any of the following — they are explicitly out of scope:

- Pagination or filtering on the accounts endpoint
- A CSV upload HTTP endpoint (Atlas uploads files manually / via redeploy)
- Any frontend or admin UI
- TypeScript
- Docker or containerization

Account lookup must keep its bearer token, per-IP rate limit, exact account-number pattern, and caller-ID check. Do not remove those controls.

---

## Timebox Targets

| Task | Target Time |
|---|---|
| Repo scaffold + schema + DB init | 20 min |
| CSV ingestion script | 30 min |
| Express API server | 25 min |
| Local testing with curl | 15 min |
| Railway deployment + public URL | 30 min |
| Retell AI agent build + test | 90 min |
| README + COO email | 30 min |
| Buffer / debugging | 30 min |
| **Total** | **~5.5 hours** |

