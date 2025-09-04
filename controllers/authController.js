// server/controllers/authController.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Mock credentials (DEV ONLY)
const OWNER_USERNAME = process.env.OWNER_USERNAME || 'owner';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'owner@123';

export const login = async (req, res) => {
  const { username, password, role } = req.body;

  if (role !== 'SCHOOL_OWNER') {
    return res.status(400).json({ error: 'Only SCHOOL_OWNER login supported' });
  }

  if (username !== OWNER_USERNAME || password !== OWNER_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  try {
    const mockSchoolId = 'TS2501';

    const { data: school, error: schoolError } = await supabase
      .from('school_list')
      .select('*')
      .eq('school_id', mockSchoolId)
      .single();

    if (schoolError && schoolError.code !== 'PGRST116') {
      return res.status(404).json({ error: 'School not found' });
    }

    const { data: students, error: studentsError } = await supabase
      .from('students')
      .select('*')
      .eq('school_id', mockSchoolId)
      .order('class')
      .order('section')
      .order('roll_no');

    if (studentsError && studentsError.code !== 'PGRST116') {
      console.warn('Failed to load students:', studentsError);
    }

    return res.json({
      success: true,
      role: 'SCHOOL_OWNER',
      school_id: mockSchoolId,
      school: school || null,
      students: students || [],
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error during login' });
  }
};