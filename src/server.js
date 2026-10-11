const crypto = require('crypto')
const express = require('express')
const dotenv = require('dotenv')
const { getDb } = require('./db/init')
const { isValidAccountNumber } = require('./accountNumber')

dotenv.config()

const MIN_TOKEN_LENGTH = 32
const DEFAULT_RATE_LIMIT_MAX = 30
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60000
const MAX_RATE_LIMIT_KEYS = 5000

let warnedAboutMissingToken = false

function notFoundBody() {
	return { error: 'Account not found' }
}

function readPositiveInt(name, fallback) {
	const parsed = Number.parseInt(process.env[name] || '', 10)
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return fallback
	}
	return parsed
}

function configuredToken() {
	const raw = process.env.API_BEARER_TOKEN
	if (!raw) {
		return ''
	}

	const token = String(raw).trim()
	if (token.length < MIN_TOKEN_LENGTH) {
		return ''
	}

	if (token.toLowerCase().startsWith('replace-with-')) {
		return ''
	}

	if (/\s/.test(token)) {
		return ''
	}

	return token
}

function warnIfTokenMissing() {
	if (configuredToken() || warnedAboutMissingToken) {
		return
	}

	warnedAboutMissingToken = true
	console.error('[API] API_BEARER_TOKEN is missing or unusable; account lookups are rejected')
}

function secretsMatch(provided, expected) {
	const providedDigest = crypto.createHash('sha256').update(provided, 'utf8').digest()
	const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest()
	return crypto.timingSafeEqual(providedDigest, expectedDigest)
}

function readBearerToken(req) {
	const header = req.get('authorization')
	if (!header) {
		return ''
	}

	const match = /^Bearer ([^\s]+)$/i.exec(header)
	if (!match) {
		return ''
	}

	return match[1]
}

function isAuthorized(req) {
	const expected = configuredToken()
	if (!expected) {
		warnIfTokenMissing()
		return false
	}

	const provided = readBearerToken(req)
	if (!provided) {
		return false
	}

	return secretsMatch(provided, expected)
}

function normalizePhone(value) {
	const digits = String(value || '').replace(/\D/g, '')
	if (digits.length === 11 && digits.startsWith('1')) {
		return digits.slice(1)
	}
	return digits
}

function phonesMatch(stored, provided) {
	const storedDigits = normalizePhone(stored)
	const providedDigits = normalizePhone(provided)
	const storedComparable = storedDigits.length === 10 ? storedDigits : '0000000000'
	const providedComparable = providedDigits.length === 10 ? providedDigits : '0000000000'
	const equal = crypto.timingSafeEqual(Buffer.from(storedComparable), Buffer.from(providedComparable))

	if (storedDigits.length !== 10 || providedDigits.length !== 10) {
		return false
	}

	return equal
}

// Caller ID is taken only from the platform header. It is not a tool argument.
function readCallerNumber(req) {
	const header = req.get('x-caller-number')
	if (!header) {
		return ''
	}

	const value = String(header).trim()
	if (!value || value.length > 32 || value.includes('{{')) {
		return ''
	}

	return value
}

function createRateLimiter() {
	const windowMs = readPositiveInt('RATE_LIMIT_WINDOW_MS', DEFAULT_RATE_LIMIT_WINDOW_MS)
	const max = readPositiveInt('RATE_LIMIT_MAX', DEFAULT_RATE_LIMIT_MAX)
	const hits = new Map()

	return function rateLimitLookups(req, res, next) {
		const now = Date.now()
		const key = req.ip || 'unknown'
		let timestamps = hits.get(key)

		if (!timestamps) {
			if (hits.size >= MAX_RATE_LIMIT_KEYS) {
				const oldestKey = hits.keys().next().value
				hits.delete(oldestKey)
			}
			timestamps = []
			hits.set(key, timestamps)
		}

		const cutoff = now - windowMs
		while (timestamps.length > 0 && timestamps[0] <= cutoff) {
			timestamps.shift()
		}

		if (timestamps.length >= max) {
			res.set('Retry-After', String(Math.ceil(windowMs / 1000)))
			return res.status(429).json({ error: 'Too many requests' })
		}

		timestamps.push(now)
		return next()
	}
}

function createApp() {
	const app = express()
	const db = getDb()
	const selectAccountByNumberStatement = db.prepare('SELECT * FROM accounts WHERE account_number = ?')
	const rateLimitLookups = createRateLimiter()

	app.set('trust proxy', 1)
	app.use(express.json())

	app.get('/health', function healthHandler(req, res) {
		return res.json({
			status: 'ok',
			timestamp: new Date().toISOString()
		})
	})

	app.get('/accounts/:accountNumber', rateLimitLookups, function getAccountByNumberHandler(req, res) {
		try {
			if (!isAuthorized(req)) {
				console.warn('[API] lookup rejected reason=unauthenticated')
				return res.status(401).json(notFoundBody())
			}

			const accountNumber = req.params.accountNumber

			if (!isValidAccountNumber(accountNumber)) {
				console.warn('[API] lookup rejected reason=invalid_account_number')
				return res.status(400).json({ error: 'Invalid account number format' })
			}

			const account = selectAccountByNumberStatement.get(accountNumber)
			const storedPhone = account ? account.phone_number : '0000000000'
			const callerMatches = phonesMatch(storedPhone, readCallerNumber(req))

			if (!account || !callerMatches) {
				console.warn('[API] lookup rejected reason=not_verified')
				return res.status(404).json(notFoundBody())
			}

			return res.status(200).json({
				account_number: account.account_number,
				debtor_name: account.debtor_name,
				balance: account.balance,
				status: account.status,
				client_name: account.client_name
			})
		} catch (error) {
			console.error('[API] lookup failed')
			return res.status(500).json({ error: 'Internal server error' })
		}
	})

	return app
}

function startServer() {
	warnIfTokenMissing()
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
