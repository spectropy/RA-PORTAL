// server/index.js
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as XLSX from 'xlsx';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const PORT = process.env.PORT || 4000;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase env vars. Check .env');
  process.exit(1);
}
try {
  new URL(SUPABASE_URL);
} catch (e) {
  console.error(`❌ Invalid SUPABASE_URL: "${process.env.SUPABASE_URL}"`);
  process.exit(1);
}

// Supabase client with service role key (full access)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const app = express();

// Enable CORS for frontend (adjust origin in production)
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);

app.use(express.json({ limit: '5mb' }));

// Multer for file upload
const upload = multer({ storage: multer.memoryStorage() });

// ====== Constants & Helpers ======
const STATES = {
  "Andhra Pradesh": "AP", "Arunachal Pradesh": "AR", "Assam": "AS", "Bihar": "BR",
  "Chhattisgarh": "CG", "Goa": "GA", "Gujarat": "GJ", "Haryana": "HR", "Himachal Pradesh": "HP",
  "Jharkhand": "JH", "Karnataka": "KA", "Kerala": "KL", "Madhya Pradesh": "MP", "Maharashtra": "MH",
  "Manipur": "MN", "Meghalaya": "ML", "Mizoram": "MZ", "Nagaland": "NL", "Odisha": "OD",
  "Punjab": "PB", "Rajasthan": "RJ", "Sikkim": "SK", "Tamil Nadu": "TN", "Telangana": "TS",
  "Tripura": "TR", "Uttar Pradesh": "UP", "Uttarakhand": "UK", "West Bengal": "WB",
  "Andaman & Nicobar Islands": "AN", "Chandigarh": "CH", "Dadra & Nagar Haveli and Daman & Diu": "DN",
  "Delhi": "DL", "Jammu & Kashmir": "JK", "Ladakh": "LA", "Lakshadweep": "LD", "Puducherry": "PY"
};

function yearYY(ay) {
  if (!ay) return '';
  const start = String(ay).split('-')[0] || '';
  return start.slice(-2);
}

function deriveSchoolId({ state, academic_year, school_number_2d }) {
  const abbr = STATES[state] || '';
  const yy = yearYY(academic_year);
  const nnRaw = String(school_number_2d || '').replace(/\D/g, '').slice(0, 2);
  const n = parseInt(nnRaw, 10);
  if (!abbr || !yy || !Number.isFinite(n) || n < 1 || n > 99) return null;
  const nn = String(n).padStart(2, '0');
  return `${abbr}${yy}${nn}`;
}

// ====== Routes ======

app.get('/', (req, res) => {
  res.json({ ok: true, name: 'SPECTROPY School Portal Backend' });
});

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

// GET /api/schools - List all schools from the view
app.get('/api/schools', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('school_list')
      .select('*')
      .order('school_name', { ascending: true });

    if (error) {
      console.error('Supabase select error:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/schools - Create full school with classes & teachers
app.post('/api/schools', async (req, res) => {
  const {
    school_name, state, academic_year, area, district,
    school_number_2d, classes = [], teachers = []
  } = req.body || {};

  // Validate required fields
  if (!school_name || !state || !academic_year || !school_number_2d) {
    return res.status(400).json({
      error: 'Missing required fields: school_name, state, academic_year, school_number_2d'
    });
  }

  // Validate state
  if (!STATES[state]) {
    return res.status(400).json({ error: `Invalid state: ${state}` });
  }

  // Derive SCHOOL_ID
  const school_id = deriveSchoolId({ state, academic_year, school_number_2d });
  if (!school_id) {
    return res.status(400).json({ error: 'Invalid school_id derivation (check state/year/number)' });
  }

  const payload = {
    school_id,
    school_name,
    state,
    academic_year,
    area: area || null,
    district: district || null,
    school_number_2d: parseInt(school_number_2d, 10),
    classes,
    teachers
  };

  try {
    const { data: newId, error: rpcError } = await supabase.rpc('create_school_full', { school: payload });

    if (rpcError) {
      if (rpcError.code === '23505') {
        return res.status(409).json({ error: `SCHOOL_ID ${school_id} already exists` });
      }
      console.error('RPC Error:', rpcError);
      return res.status(500).json({ error: rpcError.message });
    }

    // Fetch the created school from the view
    const { data, error } = await supabase
      .from('school_list')
      .select('*')
      .eq('id', newId)
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json({ data });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/upload-schools - Bulk upload from Excel
app.post('/api/upload-schools', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (json.length === 0) {
      return res.json({ inserted: 0, skipped: 0, message: 'No data in file' });
    }

    function pick(row, wanted) {
      const found = Object.keys(row).find(k => k.trim().toLowerCase() === wanted.toLowerCase());
      return found ? row[found] : '';
    }

    const batch = [];
    const errors = [];

    for (let i = 0; i < json.length; i++) {
      const r = json[i];
      const school_name = pick(r, 'School Name') || pick(r, 'SCHOOL_NAME');
      const state = pick(r, 'State') || pick(r, 'STATE');
      const academic_year = pick(r, 'Academic Year') || pick(r, 'ACADEMIC_YEAR');
      const school_number_2d =
        pick(r, 'School Number') ||
        pick(r, 'SCHOOL_NUMBER') ||
        pick(r, 'SCHOOL_NO') ||
        pick(r, 'SCHOOL_NUMBER_2D');

      if (!school_name || !state || !academic_year || !school_number_2d) {
        errors.push(`Row ${i + 1}: Missing required fields`);
        continue;
      }

      const school_id = deriveSchoolId({ state, academic_year, school_number_2d });
      if (!school_id) {
        errors.push(`Row ${i + 1}: Invalid SCHOOL_ID derivation`);
        continue;
      }

      batch.push({
        school_id,
        school_name,
        state,
        academic_year,
        area: pick(r, 'Area') || null,
        district: pick(r, 'District') || null,
      });
    }

    let inserted = 0, skipped = 0;
    if (batch.length > 0) {
      const { data, error } = await supabase
        .from('schools')
        .upsert(batch, { onConflict: 'school_id', ignoreDuplicates: false }); // update on conflict

      if (error) throw error;
      inserted = batch.length;
      skipped = errors.length;
    }

    res.json({ inserted, skipped, errors });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
  console.log(`📌 Connects to Supabase: ${SUPABASE_URL}`);
});