const FORMULA_INJECTION_PREFIXES_RE = /^[=+\-@|\t\r]+/
const HTML_TAG_RE = /<[^>]*>/g
const MAX_FIELD_LENGTH = 500
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_ROWS = 5000

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls']

// Some environments emit no MIME for CSV – we rely on extension as the
// primary check, so an empty MIME is acceptable.
const DISALLOWED_MIME_PREFIXES = ['application/x-msdownload', 'text/html', 'application/javascript']

export function sanitizeString(value: unknown): string {
  if (value === null || value === undefined) return ''
  const stripped = String(value)
    .replace(HTML_TAG_RE, '')  // remove any embedded HTML/script tags
    .trim()
    .slice(0, MAX_FIELD_LENGTH)
  // Neutralise CSV/spreadsheet formula injection
  return stripped.replace(FORMULA_INJECTION_PREFIXES_RE, '')
}

export interface FileValidationError {
  type: 'size' | 'type' | 'rows'
  message: string
}

export function validateFile(file: File, rowCount?: number): FileValidationError | null {
  const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase()

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      type: 'type',
      message: `File type ".${file.name.split('.').pop()}" is not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}.`,
    }
  }

  // Block clearly dangerous MIME types (non-empty and explicitly disallowed)
  if (file.type && DISALLOWED_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix))) {
    return { type: 'type', message: 'File content type is not recognised as a spreadsheet.' }
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      type: 'size',
      message: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — maximum allowed is 5 MB.`,
    }
  }

  if (rowCount !== undefined && rowCount > MAX_ROWS) {
    return {
      type: 'rows',
      message: `File contains ${rowCount.toLocaleString()} rows — maximum allowed is ${MAX_ROWS.toLocaleString()}.`,
    }
  }

  return null
}

// mappings: { csvHeader -> targetField }
// targetField is one of: 'amount' | 'currency' | 'merchant_name' | 'user_identifier' | 'credit_limit'
// credit_limit is optional — rows without it are still valid
export type TargetField = 'amount' | 'currency' | 'merchant_name' | 'user_identifier' | 'credit_limit'

export interface RowValidationResult {
  valid: boolean
  errors: string[]
  sanitized: Record<TargetField, string>
}

export function sanitizeRow(
  rawRow: Record<string, unknown>,
  mappings: Record<string, TargetField>,
): RowValidationResult {
  const errors: string[] = []

  const getValue = (target: TargetField): string => {
    const sourceKey = Object.keys(mappings).find((k) => mappings[k] === target)
    if (!sourceKey) return ''
    return sanitizeString(rawRow[sourceKey])
  }

  const amount = getValue('amount')
  const currency = getValue('currency')
  const merchant_name = getValue('merchant_name')
  const user_identifier = getValue('user_identifier')
  const credit_limit = getValue('credit_limit') // optional — empty string if not mapped

  const amountNum = parseFloat(amount)
  if (!amount || isNaN(amountNum) || amountNum <= 0) {
    errors.push('amount must be a positive number')
  }
  if (!currency || currency.length < 2 || currency.length > 5) {
    errors.push('currency must be 2–5 characters (e.g. CZK, USD)')
  }
  if (!merchant_name) {
    errors.push('merchant_name is required')
  }
  if (!user_identifier) {
    errors.push('user identifier (email or username) is required')
  }
  // credit_limit is optional — only validate if provided
  if (credit_limit && (isNaN(parseFloat(credit_limit)) || parseFloat(credit_limit) <= 0)) {
    errors.push('credit_limit must be a positive number if provided')
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: { amount, currency, merchant_name, user_identifier, credit_limit },
  }
}
