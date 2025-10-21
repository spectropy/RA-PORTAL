// schoolController.js
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
      .select('id,school_id, class, foundation, program, "group", section, num_students')
      .eq('school_id', school_id)
      .order('class', { ascending: true })
      .order('section', { ascending: true });
 
    if (classesError) {
      console.warn('Classes load error:', classesError);
    }
 
    const { data: rawTeachers, error: teachersError } = await supabase
      .from('teachers')
      .select('id, teacher_id, name, contact, email') // 👈 Removed alias to match frontend
      .eq('school_id', school_id);
 
    if (teachersError) {
      console.warn('Teachers load error:', teachersError);
    }
 
    let assignmentsMap = {};
    if (rawTeachers?.length) {
      const teacherRowIds = rawTeachers.map(t => t.id);
      const { data: assignments, error: assignmentsError } = await supabase
        .from('teacher_assignments')
        .select('id,teacher_id, class, section, subject')
        .in('teacher_id', teacherRowIds);
 
      if (!assignmentsError && assignments) {
        for (const a of assignments) {
          (assignmentsMap[a.teacher_id] ||= []).push({
            id: a.id, 
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
    const { error: teachersDeleteError } = await supabase
      .from('teachers')
      .delete()
      .eq('school_id', school_id);
 
    if (teachersDeleteError) {
      console.error('Failed to delete teachers:', teachersDeleteError);
      return res.status(500).json({ error: 'Failed to delete teachers' });
    }
 
    const { error: classesDeleteError } = await supabase
      .from('classes')
      .delete()
      .eq('school_id', school_id);
 
    if (classesDeleteError) {
      console.error('Failed to delete classes:', classesDeleteError);
      return res.status(500).json({ error: 'Failed to delete classes' });
    }
 
    const { error: schoolDeleteError } = await supabase
      .from('schools')
      .delete()
      .eq('school_id', school_id);
 
    if (schoolDeleteError) {
      console.error('Failed to delete school:', schoolDeleteError);
      return res.status(500).json({ error: 'Failed to delete school' });
    }
 
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
 
export const uploadStudents = async (req, res) => {
  console.log('🚀 [STUDENT UPLOAD] REQUEST RECEIVED');
  console.log('📁 File:', req.file ? { name: req.file.originalname, size: req.file.size } : 'MISSING');
  console.log('📦 Body:', req.body);
  console.log('🏫 School ID:', req.params.school_id);
 
  try {
    const { school_id } = req.params;
    const { class_section } = req.body;
 
    if (!school_id) {
      console.error('❌ Validation failed: school_id is required');
      return res.status(400).json({ error: 'school_id is required' });
    }
    if (!class_section) {
      console.error('❌ Validation failed: class_section is required');
      return res.status(400).json({ error: 'class_section is required' });
    }
    if (!req.file) {
      console.error('❌ Validation failed: No file uploaded');
      return res.status(400).json({ error: 'No file uploaded' });
    }
 
    console.log('🔍 Fetching school record...');
    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .select('school_id, academic_year')
      .eq('school_id', school_id)
      .single();
 
    if (schoolError || !school) {
      console.error('❌ School not found:', schoolError?.message || 'No record');
      return res.status(404).json({ error: 'School not found' });
    }
    console.log('✅ School record:', school);
 
    console.log('📊 Parsing file:', req.file.originalname);
    let records = [];
    const buffer = req.file.buffer;
    const filename = req.file.originalname.toLowerCase();
 
    try {
      if (filename.endsWith('.csv')) {
        console.log('📄 Parsing CSV...');
        const { parse } = await import('csv-parse/sync');
        records = parse(buffer.toString('utf-8'), {
          columns: true,
          skip_empty_lines: true,
          relax_column_count: true,
          bom: true
        });
      } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
        console.log('📄 Parsing Excel...');
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        records = XLSX.utils.sheet_to_json(worksheet, { defval: null });
      } else {
        console.error('❌ Unsupported file format');
        return res.status(400).json({ error: 'Unsupported file. Use CSV, XLSX, or XLS.' });
      }
    } catch (parseError) {
      console.error('💥 File parse error:', parseError.message);
      return res.status(400).json({ error: 'Invalid file format or corrupted file' });
    }
 
    console.log('📈 Records parsed:', records.length);
    if (!records.length) {
      console.error('❌ No data in file');
      return res.status(400).json({ error: 'No data found in file' });
    }
 
    let classValue = '';
    let sectionValue = '';
    if (class_section) {
  // Split by last occurrence of '-' to handle cases like "Grade - 6-A"
  const lastDashIndex = class_section.lastIndexOf('-');
  if (lastDashIndex > 0 && lastDashIndex < class_section.length - 1) {
    classValue = class_section.substring(0, lastDashIndex).trim();
    sectionValue = class_section.substring(lastDashIndex + 1).trim();
  }
}
    console.log('🏷️ Class/Section:', { classValue, sectionValue });
 
    const studentsData = records
  .map((record, index) => {
    console.log(`📄 Record ${index + 1}:`, record);

    // 🆕 Get NAME → store as `name`
    const studentName = (record['NAME'] || record['name'] || record['First Name'] || '').trim();
    
    // 🆕 Get ROLLNO → convert to INTEGER for `roll_no`
    const rollNoRaw = record['ROLLNO'] || record['Roll No'] || record['Student ID'] || record['student_id'];
    const rollNo = parseInt(rollNoRaw, 10);
    
    // ❗ If roll_no is not a valid number, skip this record
    if (isNaN(rollNo) || rollNo <= 0) {
      console.warn(`⚠️ Skipping record ${index + 1}: Invalid roll_no (${rollNoRaw})`);
      return null; // Will be filtered out
    }

    // 🆕 Get phone/email with fallbacks
    const parentPhone = record['PHONENO'] || record['Phone'] || record['Parent Phone'] || record['parent_phone'] || null;
    const parentEmail = record['EMAILID'] || record['Email'] || record['Parent Email'] || record['parent_email'] || null;

    return {
      school_id: school_id,
      student_id: String(rollNo), // 👈 Use roll_no as student_id if needed, or generate one
      roll_no: rollNo,            // 👈 INTEGER, required
      name: studentName,          // 👈 Single "name" field, required
      class: classValue,
      section: sectionValue,
      gender: record['Gender'] || record['gender'] || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  })
  .filter(Boolean) // Remove nulls from invalid roll_no
  .filter(student => {
    const valid = student.name && student.roll_no > 0;
    if (!valid) console.warn('⚠️ Skipping invalid student:', student);
    return valid;
  });
    console.log('✅ Valid students:', studentsData.length);
    if (studentsData.length === 0) {
      console.error('❌ No valid students after filtering');
      return res.status(400).json({ error: 'No valid student records found' });
    }
 
    console.log('💾 Attempting to insert', studentsData.length, 'students...');
    console.log('📋 First student:', studentsData[0]);
 
    const { data: inserted, error: dbError } = await supabase
      .from('students')
      .insert(studentsData)
      .select();
 
    if (dbError) {
      console.error('🔥 DATABASE INSERT ERROR:', dbError);
      console.error('📋 Sample payload that failed:', studentsData[0]);
      return res.status(500).json({
        error: 'Database insert failed: ' + (dbError.message || 'Unknown error'),
        details: dbError
      });
    }
 
    console.log('✅ SUCCESS: Inserted', inserted.length, 'students');
    return res.status(201).json({
      message: `${inserted.length} students uploaded successfully`,
      count: inserted.length,
      data: inserted
    });
 
  } catch (err) {
    console.error('💥 UNCAUGHT ERROR in uploadStudents:', err);
    console.error('💥 Stack trace:', err.stack);
    return res.status(500).json({
      error: 'Internal server error',
      details: err.message
    });
  }
};
// ✅ POST /api/exams - Create exam — NOW INCLUDES exam_date
export const createExam = async (req, res) => {
  try {
    const {
      school_id,
      program,
      exam_pattern,
      class: examClass,
      section: examSection,
      exam_date // 👈 ADD THIS — comes from frontend
    } = req.body;

    // Validate required fields
    if (!school_id) return res.status(400).json({ error: "Missing required field: school_id" });
    if (!program) return res.status(400).json({ error: "Missing required field: program" });
    if (!exam_pattern) return res.status(400).json({ error: "Missing required field: exam_pattern" });
    if (!examClass) return res.status(400).json({ error: "Missing required field: class" });
    if (!examSection) return res.status(400).json({ error: "Missing required field: section" });
    // 👇 Optional: Validate exam_date format (YYYY-MM-DD)
    if (exam_date && isNaN(Date.parse(exam_date))) {
      return res.status(400).json({ error: "Invalid exam_date format. Use YYYY-MM-DD." });
    }

    // Insert into DB — WITH exam_date
    const { data, error } = await supabase
      .from('exams')
      .insert([
        {
          school_id,
          program,
          exam_pattern,
          class: examClass,
          section: examSection,
          exam_date: exam_date || null // 👈 Store it — default to null if not provided
        }
      ])
      .select()
      .single();

    if (error) return res.status(500).json({ error: 'Database insert failed: ' + error.message });
    return res.status(201).json(data);
  } catch (error) {
    console.error('Error creating exam:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
// ✅ GET /api/exams - Get all exams — REQUIRED BY FRONTEND
export const getExams = async (req, res) => {
  try {
    console.log('🔍 getExams query params:', req.query); // 👈 ADD THIS

    let query = supabase.from('exams').select('*');
    
    if (req.query.school_id) {
      query = query.eq('school_id', req.query.school_id);
    }
    if (req.query.exam_pattern) {
      query = query.eq('exam_pattern', req.query.exam_pattern);
    }
    if (req.query.class) {
      query = query.eq('class', req.query.class);
    }
    if (req.query.section) {
      query = query.eq('section', req.query.section);
    }
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Database query failed: ' + error.message });

    console.log('✅ getExams found:', data.length, 'records'); // 👈 ADD THIS
    console.log('📋 First record:', data[0]); // 👈 ADD THIS

    return res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching exams:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ GET /api/foundations - MUST MATCH FRONTEND
export const getFoundations = (req, res) => {
  const FOUNDATIONS = [
    { id: 'IIT-MED', name: 'IIT-MED' },
    { id: 'IIT', name: 'IIT' },
    { id: 'MED', name: 'MED' },
    { id: 'FF', name: 'FF' }
  ];
  res.json(FOUNDATIONS);
};
 
// ✅ GET /api/programs - MUST MATCH FRONTEND
export const getPrograms = (req, res) => {
  const PROGRAMS = [
    { id: 'CAT', name: 'CAT' },
    { id: 'MAE', name: 'MAE' },
    { id: 'PIO', name: 'PIO' }
  ];
  res.json(PROGRAMS);
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
// ✅ POST /api/exams/:exam_id/results/upload - Upload and process exam results
export const uploadExamResults = async (req, res) => {
  const {
    school_id,
    program,
    exam_pattern,
    class: examClass,
    section: examSection,
    exam_date,
    max_marks_physics,
    max_marks_maths,
    max_marks_chemistry,
    max_marks_biology
  } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!school_id || !program || !exam_pattern || !examClass || !examSection) {
    return res.status(400).json({ 
      error: 'Missing exam context. Please fill all form fields.' 
    });
  }

  try {
    let records = [];
    const buffer = req.file.buffer;
    const filename = req.file.originalname.toLowerCase();

    if (filename.endsWith('.csv')) {
      const { parse } = await import('csv-parse/sync');
      records = parse(buffer.toString('utf-8'), {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        bom: true
      });
    } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      records = XLSX.utils.sheet_to_json(worksheet, { defval: null, raw: false });
    } else {
      return res.status(400).json({ error: 'Unsupported file format. Use CSV, XLSX, or XLS.' });
    }

    if (!records.length) {
      return res.status(400).json({ error: 'No data found in file' });
    }

    // Skip first row (column indices)
    if (records.length > 0) {
      console.log('Skipping first row (column indices):', records[0]);
      records = records.slice(1);
    }

    // Skip second row if it's a header
    if (records.length > 0) {
      const headerRow = records[0];
      if (
        (headerRow['2'] && typeof headerRow['2'] === 'string' && headerRow['2'].toLowerCase().includes('roll')) ||
        (headerRow['3'] && typeof headerRow['3'] === 'string' && headerRow['3'].toLowerCase().includes('name'))
      ) {
        console.log('Skipping header row:', headerRow);
        records = records.slice(1);
      }
    }

    // ✅ 🔒 CHECK FOR DUPLICATE EXAM BEFORE PROCESSING RECORDS
    const { data: existingExams, error: checkError } = await supabase
      .from('exams')
      .select('id')
      .eq('school_id', school_id)
      .eq('program', program)
      .eq('exam_pattern', exam_pattern)
      .eq('class', examClass)
      .eq('section', examSection)
      .eq('exam_date', exam_date || null)
      .limit(1);

    if (checkError) {
      console.error('Error checking for existing exam:', checkError);
      return res.status(500).json({ error: 'Failed to verify exam uniqueness' });
    }

    if (existingExams && existingExams.length > 0) {
      return res.status(409).json({
        error: 'This exam has already been registered and results uploaded. Duplicate uploads are not allowed.'
      });
    }

    const COLUMN_MAP = {
      2: 'student_id',
      3: 'student_name',
      7: 'correct',
      8: 'wrong',
      9: 'unattempted',
      10: 'physics',
      18: 'chemistry',
      26: 'maths',
      34: 'biology',
    };

    const getNumber = (row, ...keys) => {
      for (let key of keys) {
        if (key in row && row[key] != null && row[key] !== '') {
          const num = parseFloat(row[key]);
          if (!isNaN(num)) return num;
        }
      }
      return 0;
    };

    const getString = (row, ...keys) => {
      for (let key of keys) {
        if (key in row && row[key] != null) {
          return String(row[key]).trim();
        }
      }
      return '';
    };

    // ✅ Build raw upload rows (to go into `upload` table)
    const uploadRows = records.map((r, index) => {
      if (!r) return null;

      const mappedRow = {};
      for (const [colIndex, key] of Object.entries(COLUMN_MAP)) {
        mappedRow[key] = colIndex in r ? r[colIndex] : null;
      }

      const studentId = getString(mappedRow, 'student_id');
      if (!studentId || studentId.trim() === '') {
        console.warn(`Skipping invalid row ${index + 1}: student_id is empty`);
        return null;
      }
      const studentName = getString(mappedRow, 'student_name');
      const physics = getNumber(mappedRow, 'physics');
      const chemistry = getNumber(mappedRow, 'chemistry');
      const maths = getNumber(mappedRow, 'maths');
      const biology = getNumber(mappedRow, 'biology');
      const correct = getNumber(mappedRow, 'correct');
      const wrong = getNumber(mappedRow, 'wrong');
      const unattempted = getNumber(mappedRow, 'unattempted');

      const nameParts = studentName.split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      const totalMarks = physics + chemistry + maths + biology;
      const maxPhysics = parseInt(max_marks_physics);
      const maxChemistry = parseInt(max_marks_chemistry);
      const maxMaths = parseInt(max_marks_maths);
      const maxBiology = parseInt(max_marks_biology);
      const total_max_marks = maxPhysics + maxChemistry + maxMaths + maxBiology;
      const totalQuestions = 60;
      const percentage = total_max_marks > 0 ? parseFloat(((totalMarks / total_max_marks) * 100).toFixed(2)) : 0;

      // ⚠️ This object will be stored as JSONB in `upload.data`
      const rowData = {
        school_id,
        program,
        exam_pattern,
        class: examClass,
        section: examSection,
        exam_date: exam_date || null,
        max_marks_physics: parseInt(max_marks_physics) || 50,
        max_marks_maths: parseInt(max_marks_maths) || 50,
        max_marks_chemistry: parseInt(max_marks_chemistry) || 50,
        max_marks_biology: parseInt(max_marks_biology) || 0,

        // Student data from Excel
        student_id: studentId,
        first_name: firstName,
        last_name: lastName,
        total_questions: totalQuestions,
        correct_answers: correct,
        wrong_answers: wrong,
        unattempted: unattempted,
        physics_marks: physics,
        chemistry_marks: chemistry,
        maths_marks: maths,
        biology_marks: biology,
        total_marks: totalMarks,
        percentage: parseFloat(percentage),
        // Note: ranks will be filled later by trigger/function
        class_rank: '-',
        school_rank: '-',
        all_schools_rank: '-',
        created_at: new Date().toISOString()
      };

      return {
        file_name: req.file.originalname,
        row_index: index + 1, // 1-based index
        data: rowData // This will be inserted as JSONB
      };
    }).filter(Boolean);

    if (uploadRows.length === 0) {
      return res.status(400).json({ error: 'No valid records processed' });
    }

    // ✅ INSERT INTO `upload` TABLE
    const { error: insertError } = await supabase
      .from('upload')
      .insert(uploadRows);

    if (insertError) {
      console.error('Upload table insert error:', insertError);
      return res.status(500).json({
        error: 'Failed to save raw upload data',
        details: insertError.message
      });
    }

    // ✅ STEP 1: Recalculate ranks (safe: not in a trigger)
    const { error: rankError } = await supabase.rpc('calculate_ranks');
    if (rankError) {
      console.warn('⚠️ Rank recalculation failed:', rankError);
      // Don't fail the whole request — proceed with '-' ranks if needed
    }

    // ✅ STEP 2: Recalculate exam-level averages
    const { error: examAvgError } = await supabase.rpc('calculate_exam_averages');
    if (examAvgError) {
      console.warn('⚠️ Exam averages recalculation failed:', examAvgError);
    }

    // ✅ STEP 3: Recalculate grade-level averages
    const { error: gradeAvgError } = await supabase.rpc('calculate_grade_averages');
    if (gradeAvgError) {
      console.warn('⚠️ Grade averages recalculation failed:', gradeAvgError);
    }

    // ✅ STEP 4: Recalculate grade ranks
    const { error: gradeRankError } = await supabase.rpc('calculate_grade_ranks');
    if (gradeRankError) {
      console.warn('⚠️ Grade rank recalculation failed:', gradeRankError);
    }
    
    // ✅ STEP 5: Recalculate All India Rank
    const { error: allIndiaRankError } = await supabase.rpc('calculate_all_india_rank');
    if (allIndiaRankError) {
    console.warn('⚠️ All India rank recalculation failed:', allIndiaRankError);
    }

    // ✅ STEP 6: Fetch results (now with real ranks and averages if recalc succeeded)
    const { data: results, error: fetchError } = await supabase
      .from('exams')
      .select(`
        student_id,
        first_name,
        last_name,
        total_questions,
        correct_answers,
        wrong_answers,
        unattempted,
        physics_marks,
        chemistry_marks,
        maths_marks,
        biology_marks,
        total_marks,
        percentage,
        class_rank,
        school_rank,
        all_schools_rank
      `)
      .eq('school_id', school_id)
      .eq('program', program)
      .eq('exam_pattern', exam_pattern)
      .eq('class', examClass)
      .eq('section', examSection)
      .eq('exam_date', exam_date || null)
      .order('percentage', { ascending: false });

    if (fetchError) {
      console.warn('⚠️ Could not fetch results after upload:', fetchError);
    }

    // ✅ Return results to frontend
    return res.status(200).json({
      success: true,
      count: uploadRows.length,
      results: results || []
    });

  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({
      error: 'Failed to process file',
      details: err.message
    });
  }
};
 
// ✅ GET /api/schools/:school_id/students?class=...&section=...
export const getStudentsByClassSection = async (req, res) => {
  const { school_id } = req.params;
  const { class: classValue, section: sectionValue } = req.query;

  if (!school_id || !classValue || !sectionValue) {
    return res.status(400).json({ error: 'Missing required parameters: school_id, class, section' });
  }

  try {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('school_id', school_id)
      .eq('class', classValue)
      .eq('section', sectionValue)
      .order('roll_no', { ascending: true });

    if (error) {
      console.error('Supabase query error:', error);
      return res.status(500).json({ error: 'Database query failed' });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('Error in getStudentsByClassSection:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
// ✅ POST /api/teachers/login - Direct teacher login by teacher_id
export const loginTeacherByTeacherId = async (req, res) => {
  const { teacher_id, password } = req.body;

  if (!teacher_id || !password) {
    return res.status(400).json({ error: "Teacher ID and password are required" });
  }

  // 🔐 For security: Password must match teacher_id (same logic as frontend)
  if (teacher_id !== password) {
    return res.status(401).json({ error: "Teacher ID and password must be identical" });
  }

  try {
    // Fetch teacher record
    const { data: teacher, error: teacherError } = await supabase
      .from('teachers')
      .select(`
        id,
        teacher_id,
        name,
        contact,
        email,
        school_id
      `)
      .eq('teacher_id', teacher_id.trim().toUpperCase())
      .single();

    if (teacherError || !teacher) {
      return res.status(404).json({ error: "Invalid Teacher ID or password" });
    }

    // ✅ Also fetch assignments for this teacher
    const { data: assignments, error: assignError } = await supabase
      .from('teacher_assignments')
      .select('class, section, subject')
      .eq('teacher_id', teacher.id);

    if (assignError) {
      console.warn('Failed to load assignments:', assignError);
    }

    const teacherAssignments = Array.isArray(assignments) ? assignments : [];

    // ✅ Also fetch school name for display
    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .select('school_name')
      .eq('school_id', teacher.school_id)
      .single();

    if (schoolError) {
      console.warn('Failed to load school name:', schoolError);
    }

    // 🚀 SUCCESS: Return full teacher + school data
    return res.json({
      success: true,
      teacher: {
        ...teacher,
        teacher_assignments: teacherAssignments,
        school_name: school?.school_name || "Unknown School"
      }
    });

  } catch (err) {
    console.error('Teacher login error:', err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
// ✅ POST /api/students/login - Direct student login by student_id
export const loginStudentByStudentId = async (req, res) => {
  const { student_id, password } = req.body;

  if (!student_id || !password) {
    return res.status(400).json({ error: "Student ID and password are required" });
  }

  // 🔐 For security: Password must match student_id (same logic as frontend)
  if (student_id !== password) {
    return res.status(401).json({ error: "Student ID and password must be identical" });
  }

  try {
    // Fetch student record
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select(`
        id,
        student_id,
        roll_no,
        name,
        class,
        section,
        gender,
        parent_phone,
        parent_email,
        school_id
      `)
      .eq('student_id', student_id.trim())
      .single();

    if (studentError || !student) {
      return res.status(404).json({ error: "Invalid Student ID or password" });
    }

    // ✅ Also fetch school name for display
    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .select('school_name')
      .eq('school_id', student.school_id)
      .single();

    if (schoolError) {
      console.warn('Failed to load school name:', schoolError);
    }

    // 🚀 SUCCESS: Return full student + school data
    return res.json({
      success: true,
      student: {
        ...student,
        school_name: school?.school_name || "Unknown School"
      }
    });

  } catch (err) {
    console.error('Student login error:', err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
// ✅ GET /api/exams/results?student_id=... — Get all exam results for a student
export const getStudentExamResults = async (req, res) => {
  const { student_id } = req.query;
  if (!student_id) {
    return res.status(400).json({ error: 'student_id is required' });
  }
  try {
    // ✅ Query the `exams` table (which now stores student-level results)
    const { data: results, error } = await supabase
      .from('exams')
      .select(`
        id,
        student_id,
        physics_marks,
        chemistry_marks,
        maths_marks,
        biology_marks,
        total_marks,
        percentage,
        class_rank,
        school_rank,
        all_schools_rank,
        created_at,
        school_id,
        program,
        exam_pattern,
        class,
        section,
        exam_date,
        max_marks_physics,
        max_marks_chemistry,
        max_marks_maths,
        max_marks_biology,
        school_id,
        first_name,
        last_name,
        class,
        section,
        correct_answers,
        wrong_answers,
        unattempted
      `)
      .eq('student_id', student_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching exam results from exams table:', error);
      return res.status(500).json({ error: 'Failed to fetch exam results' });
    }

    // Format for frontend (same as before)
   const formatted = results.map(r => ({
  id: r.id,
  exam_id: r.id,
  date: r.exam_date || '—',
  exam: r.exam_pattern || 'N/A',
  exam_pattern: r.exam_pattern || 'N/A',  // 👈 FOR GROUPING LOGIC (critical!)
  program: r.program || 'N/A',
  physics_marks: parseFloat(r.physics_marks) || 0,
  chemistry_marks: parseFloat(r.chemistry_marks) || 0,
  maths_marks: parseFloat(r.maths_marks) || 0,
  biology_marks: parseFloat(r.biology_marks) || 0,
  max_marks_physics: parseInt(r.max_marks_physics) || 50,
  max_marks_chemistry: parseInt(r.max_marks_chemistry) || 50,
  max_marks_maths: parseInt(r.max_marks_maths) || 50,
  max_marks_biology: parseInt(r.max_marks_biology) || 0,
  total: parseFloat(r.total_marks) || 0,
  percentage: parseFloat(r.percentage) || 0,
  class_rank: r.class_rank || '-',
  school_rank: r.school_rank || '-',
  all_schools_rank: r.all_schools_rank || '-',
  school_id: r.school_id || '-',
  first_name: r.first_name || '-',
  last_name: r.last_name || '-',
  class: r.class || '-',
  section: r.section || '-',
  correct_answers: r.correct_answers,
  wrong_answers: r.wrong_answers,
  unattempted: r.unattempted
}));

    return res.json(formatted);
  } catch (err) {
    console.error('Unexpected error in getStudentExamResults:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ PUT /api/classes/:id - Update existing class
export const updateClass = async (req, res) => {
  const { id } = req.params;
  const {
    class: className,
    section,
    foundation,
    program,
    group,
    num_students
  } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Class ID is required' });
  }

  try {
    const { data, error } = await supabase
      .from('classes')
      .update({
        class: className,
        section,
        foundation,
        program,
        group,
        num_students: num_students || 0
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message || 'Failed to update class' });
    }

    if (!data) {
      return res.status(404).json({ error: 'Class not found' });
    }

    return res.json({
      success: true,
      message: 'Class updated successfully',
      data
    });
  } catch (err) {
    console.error('Update class error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ DELETE /api/classes/:id - Delete class
export const deleteClass = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Class ID is required' });
  }

  try {
    // Optional: Delete associated teacher assignments first
    const { error: assignmentDeleteError } = await supabase
      .from('teacher_assignments')
      .delete()
      .match({ class: id }); // ❗ If your assignment links by class ID

    // First get the class
    const { data: cls, error: classFetchError } = await supabase
      .from('classes')
      .select('class, section, school_id')
      .eq('id', id)
      .single();

    if (classFetchError || !cls) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Delete assignments linked to this class-section
    const { error: assignmentDeleteError2 } = await supabase
      .from('teacher_assignments')
      .delete()
      .match({ class: cls.class, section: cls.section, school_id: cls.school_id });

    if (assignmentDeleteError2) {
      console.warn('Failed to delete teacher assignments:', assignmentDeleteError2.message);
      // Don't block class deletion
    }

    // Now delete the class
    const { error: classDeleteError } = await supabase
      .from('classes')
      .delete()
      .eq('id', id);

    if (classDeleteError) {
      return res.status(400).json({ error: classDeleteError.message || 'Failed to delete class' });
    }

    return res.json({
      success: true,
      message: 'Class and associated assignments deleted successfully'
    });
  } catch (err) {
    console.error('Delete class error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ PUT /api/teacher-assignments/:id - Update teacher assignment
export const updateTeacherAssignment = async (req, res) => {
  const { id } = req.params;
  const {
    class: className,
    section,
    subject
  } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Assignment ID is required' });
  }

  try {
    const { data, error } = await supabase
      .from('teacher_assignments')
      .update({
        class: className,
        section,
        subject
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message || 'Failed to update assignment' });
    }

    if (!data) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    return res.json({
      success: true,
      message: 'Teacher assignment updated successfully',
      data
    });
  } catch (err) {
    console.error('Update assignment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ DELETE /api/teacher-assignments/:id - Delete teacher assignment
export const deleteTeacherAssignment = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Assignment ID is required' });
  }

  try {
    const { error } = await supabase
      .from('teacher_assignments')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(400).json({ error: error.message || 'Failed to delete assignment' });
    }

    return res.json({
      success: true,
      message: 'Teacher assignment deleted successfully'
    });
  } catch (err) {
    console.error('Delete assignment error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ PUT /api/schools/:school_id/logo - Update school logo
export const updateSchoolLogo = async (req, res) => {
  const { school_id } = req.params;
  const { logo_url } = req.body;

  if (!school_id || !logo_url) {
    return res.status(400).json({ error: 'school_id and logo_url are required' });
  }

  try {
    const { data, error } = await supabase
      .from('schools')
      .update({ logo_url })
      .eq('school_id', school_id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'School not found' });

    return res.json({ success: true, data });
  } catch (err) {
    console.error('Update school logo error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ✅ GET /api/queries/dashboard?program=...&exam_pattern=...&school=...
export const getDashboardData = async (req, res) => {
  const { program, exam_pattern, school } = req.query;

  if (!program) {
    return res.status(400).json({ error: 'program is required' });
  }

  // Normalize exam_pattern (trim to handle whitespace inconsistencies)
  const exam_pattern_trimmed = exam_pattern ? exam_pattern.trim() : null;
  const ROW_LIMIT = 10000;

  try {
    const queries = [];

    // Fetch exam patterns
    queries.push(
      supabase
        .from('exams')
        .select('exam_pattern')
        .eq('program', program)
        .limit(ROW_LIMIT)
    );

    // Fetch schools
    let schoolQuery = supabase
      .from('exams')
      .select('school_id')
      .eq('program', program)
      .limit(ROW_LIMIT);
    if (exam_pattern_trimmed) {
      schoolQuery = schoolQuery.eq('exam_pattern', exam_pattern_trimmed);
    }
    queries.push(schoolQuery);

    // 🔁 Fetch stats WITH student_id
    let statsQuery = supabase
      .from('exams')
      .select('school_id, class, section, exam_pattern, student_id') // ← include student_id
      .eq('program', program)
      .limit(ROW_LIMIT);
    if (exam_pattern_trimmed) {
      statsQuery = statsQuery.eq('exam_pattern', exam_pattern_trimmed);
    }
    if (school) {
      statsQuery = statsQuery.eq('school_id', school);
    }
    queries.push(statsQuery);

    const [examPatternRes, schoolRes, statsRes] = await Promise.all(queries);

    console.log("🔍 Raw statsRes.data (first 3 rows):", statsRes.data.slice(0, 3));
    console.log("🔍 Does data have student_id?", statsRes.data.some(row => row.student_id !== undefined));

    if (examPatternRes.error || schoolRes.error || statsRes.error) {
      console.error('Dashboard query error:', { examPatternRes, schoolRes, statsRes });
      return res.status(500).json({ error: 'Database query failed' });
    }

    // Process exam patterns
    const examPatterns = [
      ...new Set(
        examPatternRes.data
          .map(r => r.exam_pattern)
          .filter(p => p && p.trim() !== '')
          .map(p => p.trim())
      )
    ].sort();

    // Process schools
    const schools = [
      ...new Set(
        schoolRes.data
          .map(r => r.school_id)
          .filter(id => id && id.trim() !== '')
      )
    ].sort();

    // Process stats
    let stats;
    const data = statsRes.data;

    if (exam_pattern_trimmed) {
      // 🔹 SINGLE PATTERN: count distinct students
      const schoolIds = new Set();
      const classKeys = new Set();
      const studentIds = new Set(); // ← track students

      for (const row of data) {
        if (row.school_id) schoolIds.add(row.school_id);
        if (row.class && row.section) classKeys.add(`${row.class}-${row.section}`);
        if (row.student_id) studentIds.add(row.student_id); // ← add
      }

      stats = {
        examPattern: exam_pattern_trimmed,
        schoolCount: schoolIds.size,
        classCount: classKeys.size,
        studentCount: studentIds.size, // ✅ consistent logic
      };
      console.log("📊 Single pattern stats:", stats); // 🔴 LOG HERE
    } else {
      // 🔹 ALL PATTERNS: group by pattern, count distinct students per pattern
      const patternMap = {};

      for (const row of data) {
        const pattern = (row.exam_pattern || '— Uncategorized —').trim();
        if (!patternMap[pattern]) {
          patternMap[pattern] = {
            schoolIds: new Set(),
            classKeys: new Set(),
            studentIds: new Set(), // ← same structure
          };
        }
        if (row.school_id) patternMap[pattern].schoolIds.add(row.school_id);
        if (row.class && row.section) patternMap[pattern].classKeys.add(`${row.class}-${row.section}`);
        if (row.student_id) patternMap[pattern].studentIds.add(row.student_id); // ← same logic
      }

      stats = Object.entries(patternMap).map(([pattern, sets]) => ({
        examPattern: pattern,
        schoolCount: sets.schoolIds.size,
        classCount: sets.classKeys.size,
        studentCount: sets.studentIds.size, // ✅ same logic as single pattern
      })).sort((a, b) => a.examPattern.localeCompare(b.examPattern));
      console.log("📊 All patterns stats:", stats); // 🔴 LOG HERE
      console.log("Total rows in 'All Patterns' query:", statsRes.data.length);
    }

    return res.json({
      examPatterns,
      schools,
      stats,
    });
  } catch (err) {
    console.error('getDashboardData error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};