// server/controllers/schoolController.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

export function deriveSchoolId({ state, academic_year, school_number_2d }) {
  const abbr = STATES[state] || '';
  const yy = yearYY(academic_year);
  const nnRaw = String(school_number_2d || '').replace(/\D/g, '').slice(0, 2);
  const n = parseInt(nnRaw, 10);
  if (!abbr || !yy || !Number.isFinite(n) || n < 1 || n > 99) return null;
  const nn = String(n).padStart(2, '0');
  return `${abbr}${yy}${nn}`;
}

// ✅ GET /api/schools - List all schools (overview only)
export const getSchools = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('school_list')
      .select('*')
      .order('school_name', { ascending: true });

    if (error) throw error;

    return res.json({ data });
  } catch (err) {
    console.error('GET /api/schools error:', err);
    return res.status(500).json({ error: 'Failed to fetch schools' });
  }
};

// ✅ POST /api/schools - Create new school
export const createSchool = async (req, res) => {
  const {
    school_name, state, academic_year, area, district,
    school_number_2d, classes = [], teachers = []
  } = req.body || {};

  if (!school_name || !state || !academic_year || !school_number_2d) {
    return res.status(400).json({
      error: 'Missing required fields: school_name, state, academic_year, school_number_2d'
    });
  }

  if (!STATES[state]) {
    return res.status(400).json({ error: `Invalid state: ${state}` });
  }

  const school_id = deriveSchoolId({ state, academic_year, school_number_2d });
  if (!school_id) {
    return res.status(400).json({ error: 'Invalid school_id derivation' });
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
      return res.status(500).json({ error: rpcError.message });
    }

    // ✅ Query from `schools` table, not `school_list` view
    const { data, error } = await supabase
      .from('schools')
      .select('*')
      .eq('id', newId)
      .single();

    if (error) throw error;

    return res.status(201).json({ data });
  } catch (err) {
    console.error('Create school error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ GET /api/schools/:school_id - Get full school details with classes & teachers
export const getSchoolById = async (req, res) => {
  const { school_id } = req.params;

  try {
    // Get school base info
    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .select('*')
      .eq('school_id', school_id)
      .single();

    if (schoolError || !school) {
      return res.status(404).json({ error: 'School not found' });
    }

    // Get classes — ⚠️ Quote "group" (reserved SQL keyword)
    const { data: classes, error: classesError } = await supabase
      .from('classes')
      .select('class, foundation, program, "group", section, num_students')
      .eq('school_id', school_id)
      .order('class')
      .order('section');

    if (classesError && classesError.code !== 'PGRST116') {
      console.warn('Failed to load classes:', classesError);
    }

    // Get teachers with assignments
    const { data: teachers, error: teachersError } = await supabase
      .from('teachers')
      .select(`
        id,
        name,
        contact,
        email,
        teacher_assignments (
          class,
          section,
          subject
        )
      `)
      .eq('school_id', school_id);

    if (teachersError && teachersError.code !== 'PGRST116') {
      console.warn('Failed to load teachers:', teachersError);
    }

    // ✅ Return full school data
    return res.json({
      school,
      classes: classes || [],
      teachers: teachers || []
    });
  } catch (err) {
    console.error('Get school by ID error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};