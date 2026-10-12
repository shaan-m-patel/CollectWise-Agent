# CollectWise Agent

## Overview
CollectWise Agent is a prototype service for Atlas Recovery that enables an AI debt collection caller to look up debtor accounts by account number during live calls. It ingests account inventory from CSV into SQLite and exposes a small REST API so the voice agent can retrieve balance and status information in real time.

## Tech Stack
- Node.js
- Express
- better-sqlite3
- csv-parse
- Railway

## Setup
1. Clone the repo:
	 ```bash
	 git clone <repo-url>
	 cd CollectWise-Agent
	 ```
2. Install dependencies:
	 ```bash
	 npm install
	 ```
3. Create environment file:
	 ```bash
	 cp .env.example .env
	 ```
4. Ingest sample data (pre-bundled in `data/atlas_inventory.csv`):
	 ```bash
	 npm run ingest
	 ```
5. Start the API:
	 ```bash
	 npm start
	 ```

## API Reference

### GET /health
- Request: none
- Response 200:
	```json
	{ "status": "ok", "timestamp": "2026-03-30T12:00:00.000Z" }
	```
- Curl:
	```bash
	curl http://localhost:3000/health
	```

### GET /accounts/:accountNumber
- Request: path param `accountNumber` (must match `^[A-Za-z0-9_-]{1,50}$` exactly; the API does not rewrite it)
- Headers:
	- `Authorization: Bearer <API_BEARER_TOKEN>` (required). The token is the voice platform's shared secret. Account numbers are not credentials.
	- `X-Caller-Number`: inbound caller ID, set by Retell to `{{user_number}}`. This is not a model argument.
- Response 200 (only after the bearer token is valid and `X-Caller-Number` matches the phone stored on that account):
	```json
	{
		"account_number": "ACC001",
		"debtor_name": "John Smith",
		"balance": 1300,
		"status": "Active",
		"client_name": "Atlas Recovery"
	}
	```
	The stored phone number is never returned.
- Response 400 (authenticated, but the account number does not match the pattern; the database is not queried):
	```json
	{ "error": "Invalid account number format" }
	```
- Response 401 (missing or invalid bearer token; the database is not queried) and response 404 (unknown account, or caller ID did not match) use the same body:
	```json
	{ "error": "Account not found" }
	```
- Response 429:
	```json
	{ "error": "Too many requests" }
	```
- Response 500:
	```json
	{ "error": "Internal server error" }
	```
- Curl (200):
	```bash
	curl -H "Authorization: Bearer $API_BEARER_TOKEN" \
		-H "X-Caller-Number: +14045550101" \
		http://localhost:3000/accounts/ACC001
	```
- Curl (401, no credentials):
	```bash
	curl http://localhost:3000/accounts/ACC001
	```
- Curl (400 invalid format; a dotted number is not rewritten into another account):
	```bash
	curl -H "Authorization: Bearer $API_BEARER_TOKEN" \
		http://localhost:3000/accounts/ACC.001
	```
- Curl (404 unknown account or caller ID mismatch):
	```bash
	curl -H "Authorization: Bearer $API_BEARER_TOKEN" \
		-H "X-Caller-Number: +14045550101" \
		http://localhost:3000/accounts/DOESNOTEXIST
	```

## Live API
Public URL: [REPLACE WITH RAILWAY URL]

Example:
```bash
curl -H "Authorization: Bearer $API_BEARER_TOKEN" \
	-H "X-Caller-Number: +14045550101" \
	https://YOUR-APP.up.railway.app/accounts/ACC001
```

## CSV Format
| Column | Type | Required | Notes |
|---|---|---|---|
| account_number | string | YES | Unique account identifier. Must match `^[A-Za-z0-9_-]{1,50}$`. Other characters are skipped, not stored under a rewritten key |
| debtor_name | string | YES | Caller-facing name |
| phone_number | string | no | Used only to verify inbound caller ID. If it is missing, account details are not returned. It is never sent to the voice agent |
| balance | numeric | YES | Must be numeric and non-negative |
| status | string | no | Example: Active, Closed, Pending |
| client_name | string | no | Example: Atlas Recovery |

## Data Ingestion
- Run: `npm run ingest --file path/to/file.csv`
- Duplicate `account_number` rows overwrite prior records (UPSERT behavior)
- Invalid rows are skipped with console warnings (for example missing `account_number`, account numbers outside `^[A-Za-z0-9_-]{1,50}$`, non-numeric `balance`)

## Design Decisions
- SQLite over Postgres: lightweight file-based DB is sufficient for prototype scope and quick setup
- UPSERT strategy: latest row wins for duplicate `account_number` to support correction re-uploads
- Auto-seed on deploy: startup command recreates schema and re-ingests bundled CSV on Railway
- Synchronous `better-sqlite3`: simple, predictable query flow for low-throughput prototype use
- Shared secret: `GET /accounts/:accountNumber` requires `Authorization: Bearer <API_BEARER_TOKEN>`. Missing or invalid credentials are rejected before any database lookup, and the JSON body matches the unknown-account response so an account number is not an oracle.
- Caller verification: Retell sets `X-Caller-Number` to `{{user_number}}`. Name, balance, and status are returned only when that number matches the phone on the account. The stored phone is checked on the server and is not included in the tool payload.
- Account numbers: lookup and ingest accept only `^[A-Za-z0-9_-]{1,50}$`. A value that does not match is rejected and is not rewritten into a different account number.
- Rate limit: lookup requests are limited per client IP (default 30 per minute) to slow inventory enumeration.

## Deployment
Deploy on Railway using Nixpacks with start command `npm run start:prod`. On each redeploy, the service initializes the SQLite schema and re-seeds data from `data/atlas_inventory.csv` automatically, so no manual migration or seed step is required.

Set `API_BEARER_TOKEN` in the Railway service variables to a unique value from `openssl rand -hex 32`. In the Retell `lookup_account` tool, set the `Authorization` header to `Bearer <that same value>` and set `X-Caller-Number` to `{{user_number}}`. The placeholder `Bearer <API_BEARER_TOKEN>` in `agent/retell_tool.json` must be replaced in the Retell dashboard. Do not commit the live token. Until the variable is set, account lookups fail closed and `GET /health` still responds.
