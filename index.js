import express from 'express'
import cors from 'cors'
import multer from 'multer'
import * as XLSX from 'xlsx'
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const PORT = process.env.PORT || 4000
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '')
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase env vars. Check .env')
  process.exit(1)
}
try { new URL(SUPABASE_URL) } catch {
  console.error(`❌ Invalid SUPABASE_URL. Got "${process.env.SUPABASE_URL}"`)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})

const app = express()
app.use(cors())
app.use(express.json())

const upload = multer({ storage: multer.memoryStorage() })

const STATES = {
  "Andhra Pradesh": "AP", "Arunachal Pradesh": "AR", "Assam": "AS", "Bihar": "BR",
  "Chhattisgarh": "CG", "Goa": "GA", "Gujarat": "GJ", "Haryana": "HR", "Himachal Pradesh": "HP",
  "Jharkhand": "JH", "Karnataka": "KA", "Kerala": "KL", "Madhya Pradesh": "MP", "Maharashtra": "MH",
  "Manipur": "MN", "Meghalaya": "ML", "Mizoram": "MZ", "Nagaland": "NL", "Odisha": "OD",
  "Punjab": "PB", "Rajasthan": "RJ", "Sikkim": "SK", "Tamil Nadu": "TN", "Telangana": "TS",
  "Tripura": "TR", "Uttar Pradesh": "UP", "Uttarakhand": "UK", "West Bengal": "WB",
  "Andaman & Nicobar Islands": "AN", "Chandigarh": "CH", "Dadra & Nagar Haveli and Daman & Diu": "DN",
  "Delhi": "DL", "Jammu & Kashmir": "JK", "Ladakh": "LA", "Lakshadweep": "LD", "Puducherry": "PY"
}

function yearYY(ay) {
  if (!ay) return ''
  const start = String(ay).split('-')[0] || ''
  return start.slice(-2)
}

/** Build SCHOOL_ID = STATE_ABBR + YY + NN (01–99). Returns null if invalid inputs. */
function deriveSchoolId({ state, academic_year, school_number_2d }) {
  const abbr = STATES[state] || ''
  const yy = yearYY(academic_year)
  const nnRaw = String(school_number_2d || '').replace(/\D/g, '').slice(0, 2)
  const n = parseInt(nnRaw || '0', 10)
  if (!abbr || !yy || !Number.isFinite(n) || n < 1 || n > 99) return null
  const nn = String(n).padStart(2, '0')
  return `${abbr}${yy}${nn}`
}

app.get('/', (req, res) => res.json({ ok: true, name: 'SPECTROPY School Portal Backend' }))

/** List schools (now includes classes & teachers JSON) */
app.get('/api/schools', async (req, res) => {
  const { data, error } = await supabase
    .from('schools')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ data })
})

/** Create one school (manual form) */
app.post('/api/schools', async (req, res) => {
  const {
    school_name, state, academic_year, area, district,
    school_number_2d, classes, teachers
  } = req.body || {}

  if (!school_name || !state || !academic_year) {
    return res.status(400).send('Missing required fields (school_name, state, academic_year)')
  }

  const school_id = deriveSchoolId({ state, academic_year, school_number_2d })
  if (!school_id) return res.status(400).send('Invalid state/academic_year/School Number (need 01–99)')

  const row = {
    school_id,
    school_name,
    state,
    academic_year,
    area: area || null,
    district: district || null,
    // keep excel/pdf placeholders
    excel_r: null,
    pdf_r: null,
    // NEW: json columns
    classes: Array.isArray(classes) ? classes : [],
    teachers: Array.isArray(teachers) ? teachers : []
  }

  const { data, error } = await supabase.from('schools').insert(row).select().single()
  if (error) {
    if (error.code === '23505') return res.status(409).send('SCHOOL_ID already exists')
    return res.status(500).send(error.message)
  }
  res.json({ data })
})

/** Bulk upload from Excel (expects "School Number" 01–99) */
app.post('/api/upload-schools', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded')
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const json = XLSX.utils.sheet_to_json(ws, { defval: '' })

    function pick(row, wanted) {
      const keys = Object.keys(row)
      const found = keys.find(k => k.trim().toLowerCase() === wanted.toLowerCase())
      return found ? row[found] : ''
    }

    const batch = []
    for (const r of json) {
      const school_name = pick(r, 'School Name') || pick(r, 'SCHOOL_NAME')
      const state = pick(r, 'State') || pick(r, 'STATE')
      const academic_year = pick(r, 'Academic Year') || pick(r, 'ACADEMIC_YEAR')
      const area = pick(r, 'Area') || pick(r, 'AREA')
      const district = pick(r, 'District') || pick(r, 'DIST')

      // NEW: read School Number (various header spellings)
      const school_number_2d =
        pick(r, 'School Number') ||
        pick(r, 'SCHOOL_NUMBER') ||
        pick(r, 'SCHOOL_NUMBER_2D') ||
        pick(r, 'School No') ||
        pick(r, 'SCHOOL_NO')

      if (!school_name || !state || !academic_year || !school_number_2d) continue

      const school_id = deriveSchoolId({ state, academic_year, school_number_2d })
      if (!school_id) continue

      batch.push({
        school_id,
        school_name,
        state,
        academic_year,
        area: area || null,
        district: district || null,
        excel_r: null,
        pdf_r: null,
        classes: [],  // Excel import doesn’t handle classes/teachers; left empty
        teachers: []
      })
    }

    let inserted = 0, skipped = 0
    if (batch.length) {
      const { data, error } = await supabase
        .from('schools')
        .upsert(batch, { onConflict: 'school_id', ignoreDuplicates: true })
        .select()
      if (error) throw error
      inserted = data?.length || 0
      skipped = batch.length - inserted
    }

    res.json({ inserted, skipped })
  } catch (e) {
    console.error(e)
    res.status(500).send(e.message)
  }
})

app.listen(PORT, () => console.log(`✅ Backend listening on http://localhost:${PORT}`))
