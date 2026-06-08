// Diagnostic: read the SignWell template back so we know its signer role + field api_ids.
// Run from repo root:  node --env-file=.env scripts/signwell-check.mjs
const KEY = process.env.SIGNWELL_API_KEY
const TID = process.env.SIGNWELL_TEMPLATE_ID
if (!KEY || !TID) {
  console.error('Missing SIGNWELL_API_KEY or SIGNWELL_TEMPLATE_ID in env')
  process.exit(1)
}
const headers = { 'X-Api-Key': KEY, 'Content-Type': 'application/json' }

const endpoints = [
  `https://www.signwell.com/api/v1/document_templates/${TID}`,
  `https://www.signwell.com/api/v1/document_templates/${TID}/`,
]

let data = null
for (const url of endpoints) {
  const res = await fetch(url, { headers })
  const text = await res.text()
  console.log(`\nGET ${url} → ${res.status}`)
  if (res.ok) {
    try { data = JSON.parse(text) } catch { console.log(text.slice(0, 400)) }
    break
  } else {
    console.log(text.slice(0, 300))
  }
}

if (!data) { console.error('\nCould not fetch template. Check the API key / template id.'); process.exit(1) }

console.log('\n=== TEMPLATE ===')
console.log('name:', data.name)
console.log('id  :', data.id)

// Recipients / signer placeholders (we need the placeholder name to match in code)
const recips = data.recipients || data.placeholders || data.template_recipients || []
console.log('\n=== SIGNER ROLES / PLACEHOLDERS ===')
if (!recips.length) console.log('(none found — inspect raw below)')
for (const r of recips) {
  console.log(`- id=${r.id ?? '?'}  placeholder_name=${JSON.stringify(r.placeholder_name ?? r.name ?? r.role ?? '?')}`)
}

// Fields with api_ids (the prefill targets)
const fields = data.fields || data.template_fields || []
console.log('\n=== FIELDS (api_id → type) ===')
if (!fields.length) console.log('(none found — inspect raw below)')
for (const f of fields) {
  console.log(`- api_id=${JSON.stringify(f.api_id ?? '(none)')}  type=${f.type ?? f.field_type ?? '?'}  recipient=${f.recipient_id ?? f.recipient ?? '?'}`)
}

console.log('\n=== RAW (top-level keys) ===')
console.log(Object.keys(data))
