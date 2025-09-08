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
// ✅ GET /api/schools/:school_id - full details
export const getSchoolById = async (req, res) => {
  const { school_id } = req.params;

  try {
    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .select('*')
      .eq('school_id', school_id)
      .single();

    if (schoolError || !school) {
      return res.status(404).json({ error: 'School not found' });
    }

    const { data: classes, error: classesError } = await supabase
      .from('classes')
      .select('class, foundation, program, "group", section, num_students')
      .eq('school_id', school_id)
      .order('class', { ascending: true })
      .order('section', { ascending: true });

    if (classesError) {
      console.warn('Classes load error:', classesError);
    }

    const { data: rawTeachers, error: teachersError } = await supabase
      .from('teachers')
      .select('id, teacherId:teacher_id, name, contact, email') 
      .eq('school_id', school_id);

    if (teachersError) {
      console.warn('Teachers load error:', teachersError);
    }

    let assignmentsMap = {};
    if (rawTeachers?.length) {
      const teacherRowIds = rawTeachers.map(t => t.id); // UUIDs
      const { data: assignments, error: assignmentsError } = await supabase
        .from('teacher_assignments')
        .select('teacher_id, class, section, subject')
        .in('teacher_id', teacherRowIds);

      if (!assignmentsError && assignments) {
        for (const a of assignments) {
          (assignmentsMap[a.teacher_id] ||= []).push({
            class: a.class,
            section: a.section,
            subject: a.subject
          });
        }
      } else if (assignmentsError) {
        console.warn('Assignments load error:', assignmentsError);
      }
    }

    const teachers = (rawTeachers || []).map(t => ({
      ...t,
      teacher_assignments: assignmentsMap[t.id] || []
    }));

    return res.json({
      school,
      classes: classes || [],
      teachers
    });
  } catch (err) {
    console.error('Get school by ID error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};


// ✅ DELETE /api/schools/:school_id - Delete school and all associated classes & teachers
export const deleteSchool = async (req, res) => {
  const { school_id } = req.params;

  if (!school_id) {
    return res.status(400).json({ error: 'school_id is required' });
  }

  try {
    // 1. Delete all teachers for this school
    const { error: teachersDeleteError } = await supabase
      .from('teachers')
      .delete()
      .eq('school_id', school_id);

    if (teachersDeleteError) {
      console.error('Failed to delete teachers:', teachersDeleteError);
      return res.status(500).json({ error: 'Failed to delete teachers' });
    }

    // 2. Delete all classes for this school
    const { error: classesDeleteError } = await supabase
      .from('classes')
      .delete()
      .eq('school_id', school_id);

    if (classesDeleteError) {
      console.error('Failed to delete classes:', classesDeleteError);
      return res.status(500).json({ error: 'Failed to delete classes' });
    }

    // 3. Delete the school
    const { error: schoolDeleteError } = await supabase
      .from('schools')
      .delete()
      .eq('school_id', school_id);

    if (schoolDeleteError) {
      console.error('Failed to delete school:', schoolDeleteError);
      return res.status(500).json({ error: 'Failed to delete school' });
    }

    // ✅ Success
    return res.status(200).json({
      message: `School ${school_id} and all associated data deleted successfully.`,
      school_id
    });

  } catch (err) {
    console.error('Delete school error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};