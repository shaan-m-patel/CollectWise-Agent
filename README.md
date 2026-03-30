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
- Request: path param `accountNumber`
- Response 200:
	```json
	{
		"account_number": "ACC001",
		"debtor_name": "Jane Smith",
		"phone_number": "404-555-0101",
		"balance": 1250.00,
		"status": "Active",
		"client_name": "Atlas Recovery"
	}
	```
- Response 400:
	```json
	{ "error": "Account number is required" }
	```
	or
	```json
	{ "error": "Invalid account number format" }
	```
- Response 404:
	```json
	{ "error": "Account not found" }
	```
- Response 500:
	```json
	{ "error": "Internal server error" }
	```
- Curl (200):
	```bash
	curl http://localhost:3000/accounts/ACC001
	```
- Curl (400 empty):
	```bash
	curl "http://localhost:3000/accounts/%20"
	```
- Curl (400 invalid format):
	```bash
	curl http://localhost:3000/accounts/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
	```
- Curl (404):
	```bash
	curl http://localhost:3000/accounts/DOESNOTEXIST
	```
- Curl (500 example, stop DB/service dependency then call endpoint):
	```bash
	curl http://localhost:3000/accounts/ACC001
	```

## Live API
Public URL: [REPLACE WITH RAILWAY URL]

Example:
```bash
curl https://YOUR-APP.up.railway.app/accounts/ACC001
```

## CSV Format
| Column | Type | Required | Notes |
|---|---|---|---|
| account_number | string | YES | Unique account identifier used for lookup |
| debtor_name | string | YES | Caller-facing name |
| phone_number | string | no | Optional contact number |
| balance | numeric | YES | Must be numeric and non-negative |
| status | string | no | Example: Active, Closed, Pending |
| client_name | string | no | Example: Atlas Recovery |

## Data Ingestion
- Run: `npm run ingest --file path/to/file.csv`
- Duplicate `account_number` rows overwrite prior records (UPSERT behavior)
- Invalid rows are skipped with console warnings (for example missing `account_number`, non-numeric `balance`)

## Design Decisions
- SQLite over Postgres: lightweight file-based DB is sufficient for prototype scope and quick setup
- UPSERT strategy: latest row wins for duplicate `account_number` to support correction re-uploads
- Auto-seed on deploy: startup command recreates schema and re-ingests bundled CSV on Railway
- Synchronous `better-sqlite3`: simple, predictable query flow for low-throughput prototype use
- No auth: intentionally omitted for this take-home scope

## Deployment
Deploy on Railway using Nixpacks with start command `npm run start:prod`. On each redeploy, the service initializes the SQLite schema and re-seeds data from `data/atlas_inventory.csv` automatically, so no manual migration or seed step is required.
