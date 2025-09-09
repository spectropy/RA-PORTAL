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
      .select('school_id, class, foundation, program, "group", section, num_students') // ✅ FIXED
      .eq('school_id', school_id)
      .order('class', { ascending: true })
      .order('section', { ascending: true });

    if (classesError) {
      console.warn('Classes load error:', classesError);
    }
    console.log('📚 CLASSES RETURNED:', classes); // 👈 DEBUG

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

// ✅ POST /api/classes - Create a new class
export const createClass = async (req, res) => {
  const {
    school_id,
    class: className,
    foundation,
    program,
    group,
    section,
    num_students,
    academic_year
  } = req.body;

  if (!school_id || !className || !section) {
    return res.status(400).json({
      error: 'Missing required fields: school_id, class, section'
    });
  }

  try {
    // Call the create_class function
    const { data, error } = await supabase.rpc('create_class', {
      p_school_id: school_id,
      p_class: className,
      p_foundation: foundation,
      p_program: program,
      p_group: group,
      p_section: section,
      p_num_students: num_students,
      p_academic_year: academic_year
    });

    if (error) {
      return res.status(400).json({ error: error.message || 'Failed to create class' });
    }

    if (!data.success) {
      return res.status(400).json({ error: data.error || 'Failed to create class' });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error('Create class error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ POST /api/teachers - Create a new teacher
export const createTeacher = async (req, res) => {
  const {
    school_id,
    teacher_id,
    name,
    contact,
    email
  } = req.body;

  if (!school_id || !teacher_id || !name) {
    return res.status(400).json({
      error: 'Missing required fields: school_id, teacher_id, name'
    });
  }

  try {
    // Call the create_teacher function
    const { data, error } = await supabase.rpc('create_teacher', {
      p_school_id: school_id,
      p_teacher_id: teacher_id,
      p_name: name,
      p_contact: contact,
      p_email: email
    });

    if (error) {
      return res.status(400).json({ error: error.message || 'Failed to create teacher' });
    }

    if (!data.success) {
      return res.status(400).json({ error: data.error || 'Failed to create teacher' });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error('Create teacher error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ POST /api/teacher-assignments - Assign teacher to class
export const assignTeacherToClass = async (req, res) => {
  const {
    school_id,
    teacher_id,
    class: className,
    section,
    subject
  } = req.body;

  if (!school_id || !teacher_id || !className || !section || !subject) {
    return res.status(400).json({
      error: 'Missing required fields: school_id, teacher_id, class, section, subject'
    });
  }

  try {
    // Call the assign_teacher_to_class function
    const { data, error } = await supabase.rpc('assign_teacher_to_class', {
      p_school_id: school_id,
      p_teacher_id: teacher_id,
      p_class: className,
      p_section: section,
      p_subject: subject
    });

    if (error) {
      return res.status(400).json({ error: error.message || 'Failed to assign teacher' });
    }

    if (!data.success) {
      return res.status(400).json({ error: data.error || 'Failed to assign teacher' });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error('Assign teacher to class error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ POST /api/schools/:school_id/students/upload - Upload students
export const uploadStudents = async (req, res) => {
  const { school_id } = req.params;
  const { class_section } = req.body;

  if (!school_id) {
    return res.status(400).json({ error: 'school_id is required' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // Verify school exists
    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .select('school_id')
      .eq('school_id', school_id)
      .single();

    if (schoolError || !school) {
      return res.status(404).json({ error: 'School not found' });
    }

    // Parse the file based on extension
    let records = [];
    const fileBuffer = req.file.buffer;
    const filename = req.file.originalname.toLowerCase();

    if (filename.endsWith('.csv')) {
      // For CSV files
      const { parse } = await import('csv-parse/sync');
      records = parse(fileBuffer.toString('utf-8'), {
        columns: true,
        skip_empty_lines: true
      });
    } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      // For Excel files
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(fileBuffer);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      records = XLSX.utils.sheet_to_json(worksheet);
    } else {
      return res.status(400).json({ error: 'Unsupported file format. Please upload CSV or Excel file.' });
    }

    if (!records || records.length === 0) {
      return res.status(400).json({ error: 'No data found in file' });
    }

    // Extract class and section from class_section (format: "Class-Section")
    let classValue = '';
    let sectionValue = '';
    
    if (class_section) {
      const parts = class_section.split('-');
      if (parts.length >= 2) {
        classValue = parts[0];
        sectionValue = parts[1];
      }
    }

    // Get academic year from school
    const { data: schoolData, error: schoolDataError } = await supabase
      .from('schools')
      .select('academic_year')
      .eq('school_id', school_id)
      .single();

    if (schoolDataError) {
      console.warn('Could not get academic year:', schoolDataError);
    }

    const academicYear = schoolData?.academic_year || null;

    // Prepare students data for insertion
    const studentsData = records.map(record => ({
      school_id,
      student_id: record['Student ID'] || record['student_id'] || null,
      first_name: record['First Name'] || record['first_name'] || '',
      last_name: record['Last Name'] || record['last_name'] || '',
      date_of_birth: record['Date of Birth'] || record['date_of_birth'] || null,
      gender: record['Gender'] || record['gender'] || null,
      parent_name: record['Parent Name'] || record['parent_name'] || null,
      parent_phone: record['Parent Phone'] || record['parent_phone'] || null,
      parent_email: record['Parent Email'] || record['parent_email'] || null,
      class: classValue,
      section: sectionValue,
      academic_year: academicYear
    })).filter(student => student.first_name && student.last_name);

    if (studentsData.length === 0) {
      return res.status(400).json({ error: 'No valid student records found in file' });
    }

    // Insert students
    const { data, error } = await supabase
      .from('students')
      .insert(studentsData)
      .select();

    if (error) {
      throw error;
    }

    return res.status(201).json({
      message: `${studentsData.length} students uploaded successfully`,
      count: studentsData.length,
      data
    });
  } catch (err) {
    console.error('Upload students error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ POST /api/exams - Create exam
export const createExam = async (req, res) => {
  const {
    school_id,
    foundation,
    program,
    exam_name,
    exam_template,
    exam_pattern,
    class: className
  } = req.body;

  if (!school_id || !foundation || !program || !exam_name || !exam_template || !className) {
    return res.status(400).json({
      error: 'Missing required fields: school_id, foundation, program, exam_name, exam_template, class'
    });
  }

  try {
    // Call the create_exam function
    const { data, error } = await supabase.rpc('create_exam', {
      p_school_id: school_id,
      p_foundation: foundation,
      p_program: program,
      p_exam_name: exam_name,
      p_exam_template: exam_template,
      p_exam_pattern: exam_pattern,
      p_class: className
    });

    if (error) {
      return res.status(400).json({ error: error.message || 'Failed to create exam' });
    }

    if (!data.success) {
      return res.status(400).json({ error: data.error || 'Failed to create exam' });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error('Create exam error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ GET /api/foundations - Get foundations
export const getFoundations = async (req, res) => {
  try {
    const foundations = [
      { id: 'cbse', name: 'CBSE' },
      { id: 'icse', name: 'ICSE' },
      { id: 'state-board', name: 'State Board' },
      { id: 'ib', name: 'International Baccalaureate' }
    ];
    
    return res.json(foundations);
  } catch (err) {
    console.error('Get foundations error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ GET /api/programs - Get programs
export const getPrograms = async (req, res) => {
  try {
    const programs = [
      { id: 'regular', name: 'Regular Program' },
      { id: 'advanced', name: 'Advanced Program' },
      { id: 'foundation', name: 'Foundation Program' },
      { id: 'olympiad', name: 'Olympiad Program' }
    ];
    
    return res.json(programs);
  } catch (err) {
    console.error('Get programs error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ GET /api/academic-years - Get academic years
export const getAcademicYears = async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    const academicYears = [];
    
    for (let i = -1; i < 4; i++) {
      const startYear = currentYear + i;
      const endYear = startYear + 1;
      academicYears.push({
        id: `${startYear}-${endYear}`,
        name: `${startYear}-${endYear}`
      });
    }
    
    return res.json(academicYears);
  } catch (err) {
    console.error('Get academic years error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};