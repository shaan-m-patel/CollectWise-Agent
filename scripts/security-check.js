const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectwise-'))
process.env.DB_PATH = path.join(tempDir, 'accounts.db')
process.env.API_BEARER_TOKEN = 'test-bearer-token-0123456789abcdef'
process.env.RATE_LIMIT_MAX = '100'
process.env.RATE_LIMIT_WINDOW_MS = '60000'

const { createApp } = require('../src/server')
const { getDb } = require('../src/db/init')
const { runIngest } = require('../src/ingest')
const { isValidAccountNumber } = require('../src/accountNumber')

const TOKEN = process.env.API_BEARER_TOKEN
const NOT_FOUND_RAW = '{"error":"Account not found"}'
const ALLOWED_FIELDS = ['account_number', 'balance', 'client_name', 'debtor_name', 'status']

function listen(app) {
  return new Promise(function onListen(resolve) {
    const server = app.listen(0, '127.0.0.1', function onReady() {
      resolve(server)
    })
  })
}

function request(server, options) {
  const address = server.address()
  const headers = options.headers || {}
  const reqPath = options.path

  return new Promise(function onRequest(resolve, reject) {
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      method: 'GET',
      path: reqPath,
      headers
    }, function onResponse(res) {
      const chunks = []
      res.on('data', function onData(chunk) {
        chunks.push(chunk)
      })
      res.on('end', function onEnd() {
        const raw = Buffer.concat(chunks).toString('utf8')
        let body = raw
        try {
          body = JSON.parse(raw)
        } catch (error) {
          body = raw
        }
        resolve({ status: res.statusCode, body, raw })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function authHeaders(extra) {
  return Object.assign({
    Authorization: `Bearer ${TOKEN}`
  }, extra || {})
}

function assertNoDebtFields(body) {
  const serialized = JSON.stringify(body)
  assert.strictEqual(Object.hasOwn(body, 'debtor_name'), false)
  assert.strictEqual(Object.hasOwn(body, 'phone_number'), false)
  assert.strictEqual(Object.hasOwn(body, 'balance'), false)
  assert.strictEqual(Object.hasOwn(body, 'status'), false)
  assert.strictEqual(serialized.includes('John Smith'), false)
  assert.strictEqual(serialized.includes('Jane Doe'), false)
  assert.strictEqual(serialized.includes('404555'), false)
}

async function main() {
  assert.strictEqual(isValidAccountNumber('ACC001'), true)
  assert.strictEqual(isValidAccountNumber('ACC-001'), true)
  assert.strictEqual(isValidAccountNumber('ACC_001'), true)
  assert.strictEqual(isValidAccountNumber('A'.repeat(50)), true)
  assert.strictEqual(isValidAccountNumber('ACC.001'), false)
  assert.strictEqual(isValidAccountNumber('ACC 001'), false)
  assert.strictEqual(isValidAccountNumber('ACC/003'), false)
  assert.strictEqual(isValidAccountNumber(''), false)
  assert.strictEqual(isValidAccountNumber('A'.repeat(51)), false)

  const sampleResult = runIngest('data/atlas_inventory.csv')
  assert.strictEqual(sampleResult.ingestedRows, 6)
  assert.strictEqual(sampleResult.skippedRows, 2)

  const badCsvPath = path.join(tempDir, 'bad-accounts.csv')
  fs.writeFileSync(badCsvPath, [
    'account_number,debtor_name,phone_number,balance,status,client_name',
    'ACC.001,Mallory Jones,4045550199,1.00,Active,Atlas Recovery',
    'ACC 002,Space Case,4045550188,2.00,Active,Atlas Recovery',
    'ACC/003,Slash Case,4045550177,3.00,Active,Atlas Recovery'
  ].join('\n'))

  const badResult = runIngest(badCsvPath)
  assert.strictEqual(badResult.ingestedRows, 0)
  assert.strictEqual(badResult.skippedRows, 3)

  const db = getDb()
  const stored = db.prepare('SELECT account_number, phone_number, balance FROM accounts WHERE account_number = ?').get('ACC001')
  assert.ok(stored)
  assert.strictEqual(stored.phone_number, '4045550101')
  assert.strictEqual(stored.balance, 1300)
  assert.strictEqual(db.prepare('SELECT account_number FROM accounts WHERE account_number = ?').get('ACC.001'), undefined)

  const app = createApp()
  const server = await listen(app)

  const health = await request(server, { path: '/health' })
  assert.strictEqual(health.status, 200)
  assert.strictEqual(health.body.status, 'ok')

  const noAuthKnown = await request(server, { path: '/accounts/ACC001' })
  const noAuthUnknown = await request(server, { path: '/accounts/DOESNOTEXIST' })
  const noAuthDotted = await request(server, { path: '/accounts/ACC.001' })
  const wrongAuth = await request(server, {
    path: '/accounts/ACC001',
    headers: { Authorization: 'Bearer not-the-real-token-0123456789abcd' }
  })
  const queryToken = await request(server, {
    path: `/accounts/ACC001?access_token=${TOKEN}`,
    headers: { 'X-Caller-Number': '+14045550101' }
  })

  for (const response of [noAuthKnown, noAuthUnknown, noAuthDotted, wrongAuth, queryToken]) {
    assert.strictEqual(response.status, 401)
    assert.strictEqual(response.raw, NOT_FOUND_RAW)
    assertNoDebtFields(response.body)
  }

  process.env.API_BEARER_TOKEN = 'replace-with-a-random-secret-at-least-32-chars'
  const placeholder = await request(server, {
    path: '/accounts/ACC001',
    headers: {
      Authorization: 'Bearer replace-with-a-random-secret-at-least-32-chars',
      'X-Caller-Number': '+14045550101'
    }
  })
  assert.strictEqual(placeholder.status, 401)
  assert.strictEqual(placeholder.raw, NOT_FOUND_RAW)

  process.env.API_BEARER_TOKEN = 'short-token'
  const shortToken = await request(server, {
    path: '/accounts/ACC001',
    headers: {
      Authorization: 'Bearer short-token',
      'X-Caller-Number': '+14045550101'
    }
  })
  assert.strictEqual(shortToken.status, 401)
  assert.strictEqual(shortToken.raw, NOT_FOUND_RAW)

  process.env.API_BEARER_TOKEN = ''
  const unset = await request(server, {
    path: '/accounts/ACC001',
    headers: authHeaders({ 'X-Caller-Number': '+14045550101' })
  })
  assert.strictEqual(unset.status, 401)
  assert.strictEqual(unset.raw, NOT_FOUND_RAW)

  process.env.API_BEARER_TOKEN = TOKEN

  const dotted = await request(server, {
    path: '/accounts/ACC.001',
    headers: authHeaders({ 'X-Caller-Number': '4045550199' })
  })
  assert.strictEqual(dotted.status, 400)
  assert.deepStrictEqual(dotted.body, { error: 'Invalid account number format' })
  assertNoDebtFields(dotted.body)

  const spaced = await request(server, {
    path: '/accounts/ACC%20002',
    headers: authHeaders({ 'X-Caller-Number': '4045550102' })
  })
  assert.strictEqual(spaced.status, 400)
  assertNoDebtFields(spaced.body)

  const missingCaller = await request(server, {
    path: '/accounts/ACC001',
    headers: authHeaders()
  })
  const wrongCaller = await request(server, {
    path: '/accounts/ACC001',
    headers: authHeaders({ 'X-Caller-Number': '+14045550199' })
  })
  const unknownAccount = await request(server, {
    path: '/accounts/ACC999',
    headers: authHeaders({ 'X-Caller-Number': '+14045550101' })
  })
  const queryCallerOnly = await request(server, {
    path: '/accounts/ACC001?caller_number=%2B14045550101',
    headers: authHeaders()
  })
  const headerLosesToQuery = await request(server, {
    path: '/accounts/ACC002?caller_number=%2B14045550102',
    headers: authHeaders({ 'X-Caller-Number': '+14045550101' })
  })

  for (const response of [missingCaller, wrongCaller, unknownAccount, queryCallerOnly, headerLosesToQuery]) {
    assert.strictEqual(response.status, 404)
    assert.strictEqual(response.raw, NOT_FOUND_RAW)
    assertNoDebtFields(response.body)
  }

  const verified = await request(server, {
    path: '/accounts/ACC001',
    headers: authHeaders({ 'X-Caller-Number': '+1 (404) 555-0101' })
  })
  assert.strictEqual(verified.status, 200)
  assert.deepStrictEqual(Object.keys(verified.body).sort(), ALLOWED_FIELDS)
  assert.strictEqual(verified.body.account_number, 'ACC001')
  assert.strictEqual(verified.body.debtor_name, 'John Smith')
  assert.strictEqual(verified.body.balance, 1300)
  assert.strictEqual(verified.body.status, 'Active')
  assert.strictEqual(verified.body.client_name, 'Atlas Recovery')
  assert.strictEqual(Object.hasOwn(verified.body, 'phone_number'), false)
  assert.strictEqual(verified.raw.includes('4045550101'), false)

  const verifiedDigits = await request(server, {
    path: '/accounts/ACC002',
    headers: authHeaders({ 'X-Caller-Number': '4045550102' })
  })
  assert.strictEqual(verifiedDigits.status, 200)
  assert.strictEqual(verifiedDigits.body.debtor_name, 'Jane Doe')
  assert.strictEqual(Object.hasOwn(verifiedDigits.body, 'phone_number'), false)

  const templateCaller = await request(server, {
    path: '/accounts/ACC001',
    headers: authHeaders({ 'X-Caller-Number': '{{user_number}}' })
  })
  assert.strictEqual(templateCaller.status, 404)
  assert.strictEqual(templateCaller.raw, NOT_FOUND_RAW)

  server.close()

  process.env.RATE_LIMIT_MAX = '2'
  const limitedApp = createApp()
  const limitedServer = await listen(limitedApp)
  const first = await request(limitedServer, { path: '/accounts/ACC001' })
  const second = await request(limitedServer, { path: '/accounts/ACC002' })
  const third = await request(limitedServer, {
    path: '/accounts/ACC001',
    headers: authHeaders({ 'X-Caller-Number': '+14045550101' })
  })
  assert.strictEqual(first.status, 401)
  assert.strictEqual(second.status, 401)
  assert.strictEqual(third.status, 429)
  assert.deepStrictEqual(third.body, { error: 'Too many requests' })
  assertNoDebtFields(third.body)
  limitedServer.close()

  const prompt = fs.readFileSync('agent/agent_prompt.txt', 'utf8').replace(/\n$/, '')
  const retellAgent = JSON.parse(fs.readFileSync('agent/retell_agent.json', 'utf8'))
  const retellTool = JSON.parse(fs.readFileSync('agent/retell_tool.json', 'utf8'))
  const lookupTool = retellAgent.retellLlmData.general_tools.find(function findLookup(tool) {
    return tool.name === 'lookup_account'
  })

  assert.strictEqual(retellAgent.retellLlmData.general_prompt, prompt)
  assert.strictEqual(prompt.includes('inbound caller ID'), true)
  assert.strictEqual(prompt.includes('Do not speak a name, balance, status, or phone number.'), true)
  assert.strictEqual(prompt.includes('immediately call the lookup_account tool'), false)

  assert.strictEqual(lookupTool.headers['X-Caller-Number'], '{{user_number}}')
  assert.strictEqual(lookupTool.headers.Authorization, 'Bearer <API_BEARER_TOKEN>')
  assert.strictEqual(Object.hasOwn(lookupTool.parameters.properties, 'phone_number'), false)
  assert.strictEqual(Object.hasOwn(lookupTool.response_variables, 'phone_number'), false)

  assert.strictEqual(retellTool.headers['X-Caller-Number'], '{{user_number}}')
  assert.strictEqual(retellTool.headers.Authorization, 'Bearer <API_BEARER_TOKEN>')
  assert.strictEqual(Object.hasOwn(retellTool.parameters.properties, 'phone_number'), false)
  assert.strictEqual(Object.hasOwn(retellTool.response_mapping, 'phone_number'), false)

  console.log('security checks passed')
}

main().catch(function onFailure(error) {
  console.error(error)
  process.exit(1)
})
