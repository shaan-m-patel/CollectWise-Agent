const express = require('express')
const dotenv = require('dotenv')
const { getDb } = require('./db/init')

dotenv.config()

function createApp() {
	const app = express()
	const db = getDb()
	const selectAccountByNumberStatement = db.prepare('SELECT * FROM accounts WHERE account_number = ?')

	app.use(express.json())

	app.get('/health', function healthHandler(req, res) {
		return res.json({
			status: 'ok',
			timestamp: new Date().toISOString()
		})
	})

	app.get('/accounts/:accountNumber', function getAccountByNumberHandler(req, res) {
		try {
			const trimmedAccountNumber = String(req.params.accountNumber || '').trim()

			if (!trimmedAccountNumber) {
				return res.status(400).json({ error: 'Account number is required' })
			}

			if (trimmedAccountNumber.length > 50) {
				return res.status(400).json({ error: 'Invalid account number format' })
			}

			const sanitizedAccountNumber = trimmedAccountNumber.replace(/[^A-Za-z0-9_-]/g, '')

			if (sanitizedAccountNumber !== trimmedAccountNumber) {
				console.warn(`[API] accountNumber sanitized from "${trimmedAccountNumber}" to "${sanitizedAccountNumber}"`)
			}

			if (!sanitizedAccountNumber) {
				return res.status(400).json({ error: 'Invalid account number format' })
			}

			const account = selectAccountByNumberStatement.get(sanitizedAccountNumber)

			if (!account) {
				return res.status(404).json({ error: 'Account not found' })
			}

			return res.status(200).json({
				account_number: account.account_number,
				debtor_name: account.debtor_name,
				phone_number: account.phone_number,
				balance: account.balance,
				status: account.status,
				client_name: account.client_name
			})
		} catch (error) {
			return res.status(500).json({ error: 'Internal server error' })
		}
	})

	return app
}

function startServer() {
	const app = createApp()
	const port = Number.parseInt(process.env.PORT || '3000', 10)
	const server = app.listen(port, function onListen() {
		console.log(`CollectWise API listening on port ${port}`)
	})

	return { app, server, port }
}

if (require.main === module) {
	startServer()
}

module.exports = { createApp, startServer }
