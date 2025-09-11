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
      .select('school_id, class, foundation, program, "group", section, num_students')
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
          relax_column_count: true
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
      const parts = class_section.split('-');
      if (parts.length >= 2) {
        classValue = parts[0];
        sectionValue = parts[1];
      }
    }
    console.log('🏷️ Class/Section:', { classValue, sectionValue });
 
    const studentsData = records
      .map((record, index) => {
        console.log(`📄 Record ${index + 1}:`, record);
        return {
          school_id: school_id,
          student_id: record['Student ID'] || record['student_id'] || null,
          first_name: (record['First Name'] || record['first_name'] || '').trim(),
          last_name: (record['Last Name'] || record['last_name'] || '').trim(),
          date_of_birth: record['Date of Birth'] || record['date_of_birth'] || null,
          gender: record['Gender'] || record['gender'] || null,
          parent_name: record['Parent Name'] || record['parent_name'] || null,
          parent_phone: record['Parent Phone'] || record['parent_phone'] || null,
          parent_email: record['Parent Email'] || record['parent_email'] || null,
          class: classValue,
          section: sectionValue,
          academic_year: school.academic_year || null
        };
      })
      .filter(student => {
        const valid = student.first_name && student.last_name;
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
 
// ✅ POST /api/exams - Create exam — MATCHES FRONTEND
export const createExam = async (req, res) => {
  try {
    const {
      school_id,
      foundation,
      program,
      exam_template,
      exam_pattern,
      class: examClass,
      // ❌ REMOVED: exam_name — frontend doesn't send it
      // ❌ REMOVED: created_at — let DB handle it
    } = req.body;
 
    if (!school_id) return res.status(400).json({ error: "Missing required field: school_id" });
    if (!foundation) return res.status(400).json({ error: "Missing required field: foundation" });
    if (!program) return res.status(400).json({ error: "Missing required field: program" });
    if (!exam_template) return res.status(400).json({ error: "Missing required field: exam_template" });
    if (!exam_pattern) return res.status(400).json({ error: "Missing required field: exam_pattern" });
    if (!examClass) return res.status(400).json({ error: "Missing required field: class" });
 
    const { data, error } = await supabase
      .from('exams')
      .insert([
        {
          school_id,
          foundation,
          program,
          exam_template,
          exam_pattern,
          class: examClass,
          // ✅ created_at uses DEFAULT NOW() from table
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
    const { data, error } = await supabase
      .from('exams')
      .select('*')
      .order('created_at', { ascending: false });
 
    if (error) return res.status(500).json({ error: 'Database query failed: ' + error.message });
 
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
  const { exam_id } = req.params;
 
  if (!exam_id) {
    return res.status(400).json({ error: 'Exam ID is required' });
  }
 
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
 
  try {
    let records = [];
    const buffer = req.file.buffer;
    const filename = req.file.originalname.toLowerCase();
 
    // Parse file
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
      records = XLSX.utils.sheet_to_json(worksheet, { defval: null });
    } else {
      return res.status(400).json({ error: 'Unsupported file format. Use CSV, XLSX, or XLS.' });
    }
 
    if (!records.length) {
      return res.status(400).json({ error: 'No data found in file' });
    }
 
    // Skip first row if it looks like a header (e.g., contains "Roll No", "Name", or many "0"s)
    // Skip first row if it looks like a header (e.g., contains "Roll No", "Name", or many "0"s)
if (
  records.length > 0 &&
  (
    (records[0]['2'] && String(records[0]['2']).toLowerCase().includes('roll')) ||
    (records[0]['3'] && String(records[0]['3']).toLowerCase().includes('name')) ||
    (records[0]['10'] === '0' && records[0]['11'] === '0' && records[0]['12'] === '0') // e.g., marks are 0
  )
) {
  console.log('🗑️ Skipping header row:', records[0]);
  records = records.slice(1); // Remove first row
}
// 🔍 DEBUG: Log first 3 rows to verify column mapping
    console.log('📄 First 3 rows from Excel:', records.slice(0, 3));
 
    // Fetch exam details to validate and enrich data
    const { data: exam, error: examError } = await supabase
      .from('exams')
      .select('school_id, class, foundation, program, exam_template, exam_pattern')
      .eq('id', exam_id)
      .single();
 
    if (examError || !exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }
 
    // 🧮 Helper to safely extract number from any of given keys
    const getNumber = (row, ...keys) => {
      for (let key of keys) {
        if (key in row && row[key] != null && row[key] !== '') {
          const num = parseFloat(row[key]);
          if (!isNaN(num)) return num;
        }
      }
      return 0;
    };
 
    // 🧍 Helper to get string (trim, fallback to empty)
    const getString = (row, ...keys) => {
      for (let key of keys) {
        if (key in row && row[key] != null) {
          return String(row[key]).trim();
        }
      }
      return '';
    };
 
    // 💡 Determine total questions based on foundation/program (optional)
    // You mentioned: IIT-MED=60, IIT=45, etc. — adjust as needed
    const getDefaultTotalQuestions = () => {
      if (exam.foundation === 'IIT-MED') return 60;
      if (exam.foundation === 'IIT') return 45;
      if (exam.program === 'PIO' || exam.program === 'MAE') return 60; // Pioneer/Maestro
      return 60; // default fallback
    };
 
    // Process records
   const results = records.map(r => {
  // Map indexed columns to named fields
 
    // ✅ DEFINE COLUMN_MAP — Maps Excel column index to field name
    const COLUMN_MAP = {
      2: 'student_id',       // Roll No / Student ID
      3: 'student_name',     // Student Name
      7: 'total_questions',  // Total Q
      8: 'correct',          // Correct
      9: 'wrong',            // Wrong
      10: 'physics',         // Physics Marks
      11: 'chemistry',       // Chemistry Marks
      12: 'maths',           // Maths Marks
      13: 'biology',         // Biology Marks
    };
 
    const results = records.map(r => {
      // Map indexed columns to named fields
      const mappedRow = {};
      for (const [index, key] of Object.entries(COLUMN_MAP)) {
        mappedRow[key] = r[index];
      }
 
      // Now extract from mappedRow
      const studentId = getString(mappedRow, 'student_id');
      const studentName = getString(mappedRow, 'student_name');
      const physics = getNumber(mappedRow, 'physics');
      const chemistry = getNumber(mappedRow, 'chemistry');
      const maths = getNumber(mappedRow, 'maths');
      const biology = getNumber(mappedRow, 'biology');
      const totalQuestions = getNumber(mappedRow, 'total_questions');
      const correct = getNumber(mappedRow, 'correct');
      const wrong = getNumber(mappedRow, 'wrong');
      const unattempted = totalQuestions - correct - wrong; // Calculate if not provided
 
      // Split name if needed
      const nameParts = studentName.split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
 
      const totalMarks = physics + chemistry + maths + biology;
      const percentage = totalQuestions > 0 ? ((correct / totalQuestions) * 100).toFixed(2) : 0;
 
      return {
        student_id: studentId,
        first_name: firstName,
        last_name: lastName,
        total_questions: totalQuestions,
        correct: correct,
        wrong: wrong,
        unattempted: unattempted,
        physics_marks: physics,
        chemistry_marks: chemistry,
        maths_marks: maths,
        biology_marks: biology,
        total_marks: totalMarks,
        percentage: percentage,
        class_rank: '-',
        school_rank: '-',
        all_schools_rank: '-'
      };
    });
 
  const mappedRow = {};
  for (const [index, key] of Object.entries(COLUMN_MAP)) {
    mappedRow[key] = r[index];
  }
 
  // Now extract from mappedRow
  const studentId = getString(mappedRow, 'student_id');
  const studentName = getString(mappedRow, 'student_name');
  const physics = getNumber(mappedRow, 'physics');
  const chemistry = getNumber(mappedRow, 'chemistry');
  const maths = getNumber(mappedRow, 'maths');
  const biology = getNumber(mappedRow, 'biology');
  const totalQuestions = getNumber(mappedRow, 'total_questions');
  const correct = getNumber(mappedRow, 'correct');
  const wrong = getNumber(mappedRow, 'wrong');
  const unattempted = totalQuestions - correct - wrong; // Calculate if not provided
 
  // Split name if needed
  const nameParts = studentName.split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
 
  const totalMarks = physics + chemistry + maths + biology;
  const percentage = totalQuestions > 0 ? ((correct / totalQuestions) * 100).toFixed(2) : 0;
 
  return {
    student_id: studentId,
    first_name: firstName,
    last_name: lastName,
    total_questions: totalQuestions,
    correct: correct,
    wrong: wrong,
    unattempted: unattempted,
    physics_marks: physics,
    chemistry_marks: chemistry,
    maths_marks: maths,
    biology_marks: biology,
    total_marks: totalMarks,
    percentage: percentage,
    class_rank: '-',
    school_rank: '-',
    all_schools_rank: '-'
  };
});
 
    // ✅ STORE IN DATABASE (UNCOMMENTED)
    const examResultsData = results.map(r => ({
      exam_id: parseInt(exam_id),
      student_id: r.student_id,
      first_name: r.first_name,
      last_name: r.last_name,
      physics_marks: r.physics_marks,
      chemistry_marks: r.chemistry_marks,
      maths_marks: r.maths_marks,
      biology_marks: r.biology_marks,
      total_questions: r.total_questions,
      correct_answers: r.correct,
      wrong_answers: r.wrong,
      unattempted: r.unattempted,
      total_marks: r.total_marks,
      percentage: parseFloat(r.percentage),
      created_at: new Date().toISOString()
    }));
 
    const { error: insertError } = await supabase
  .from('exam_results')
  .insert(examResultsData);

if (insertError) {
  console.error('❌ Error inserting exam results:', insertError);
}

// ✅ CALCULATE & UPDATE RANKS AFTER INSERT
const { error: rankError } = await supabase.rpc('calculate_exam_ranks', {
  p_exam_id: parseInt(exam_id)
});

if (rankError) {
  console.error('❌ Error calculating ranks:', rankError);
}

// ✅ FETCH UPDATED RESULTS WITH RANKS (OPTIONAL — for immediate response)
const { data: finalResults, error: fetchError } = await supabase
  .from('exam_results')
  .select('*')
  .eq('exam_id', exam_id);

if (fetchError) {
  console.warn('⚠️ Could not fetch ranked results:', fetchError);
}
    // ✅ SUCCESS RESPONSE
    return res.status(200).json({
      success: true,
      exam: {
        id: exam_id,
        school_id: exam.school_id,
        class: exam.class,
        foundation: exam.foundation,
        program: exam.program,
        exam_template: exam.exam_template,
        exam_pattern: exam.exam_pattern
      },
     results: finalResults || results, // fallback if fetch fails
     count: (finalResults || results).length
    });
 
  } catch (err) {
    console.error('💥 Error processing exam results:', err);
    return res.status(500).json({
      error: 'Failed to process file',
      details: err.message
    });
  }
};
 