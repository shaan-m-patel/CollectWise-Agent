const ACCOUNT_NUMBER_PATTERN = /^[A-Za-z0-9_-]{1,50}$/

function isValidAccountNumber(value) {
  return typeof value === 'string' && ACCOUNT_NUMBER_PATTERN.test(value)
}

module.exports = {
  ACCOUNT_NUMBER_PATTERN,
  isValidAccountNumber
}
