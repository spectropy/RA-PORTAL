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
 
// ✅ POST /api/exams - Create exam — MATCHES FRONTEND
export const createExam = async (req, res) => {
  try {
    const {
      school_id,
      program,
      exam_template,
      exam_pattern,
      class: examClass,
      section: examSection,
      // ❌ REMOVED: exam_name — frontend doesn't send it
      // ❌ REMOVED: created_at — let DB handle it
    } = req.body;
 
    if (!school_id) return res.status(400).json({ error: "Missing required field: school_id" });
    if (!program) return res.status(400).json({ error: "Missing required field: program" });
    if (!exam_template) return res.status(400).json({ error: "Missing required field: exam_template" });
    if (!exam_pattern) return res.status(400).json({ error: "Missing required field: exam_pattern" });
    if (!examClass) return res.status(400).json({ error: "Missing required field: class" });
    if (!examSection) return res.status(400).json({ error: "Missing required field: section" });

    const { data, error } = await supabase
      .from('exams')
      .insert([
        {
          school_id,
          program,
          exam_template,
          exam_pattern,
          class: examClass,
          section: examSection, 
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
      records = XLSX.utils.sheet_to_json(worksheet, { defval: null, raw: false });
    } else {
      return res.status(400).json({ error: 'Unsupported file format. Use CSV, XLSX, or XLS.' });
    }

    if (!records.length) {
      return res.status(400).json({ error: 'No data found in file' });
    }

    // Skip first row if it looks like a header
    if (
      records.length > 0 &&
      (
        (records[0]['2'] && String(records[0]['2']).toLowerCase().includes('roll')) ||
        (records[0]['3'] && String(records[0]['3']).toLowerCase().includes('name')) ||
        (records[0]['10'] === '0' && records[0]['11'] === '0' && records[0]['12'] === '0')
      )
    ) {
      console.log('🗑️ Skipping header row:', records[0]);
      records = records.slice(1);
    }

    // 🔍 DEBUG: Log first 3 rows
    console.log('📄 First 3 rows from Excel:', records.slice(0, 3));
    console.log('Exam ID:', exam_id);

    // Fetch exam details
    const { data: exam, error: examError } = await supabase
      .from('exams')
      .select('school_id, class, program, exam_template, exam_pattern')
      .eq('id', exam_id)
      .single();

    if (examError || !exam) {
      return res.status(404).json({ error: 'Exam not found' });
    }

    // 🧮 Helper to safely extract number
    const getNumber = (row, ...keys) => {
      for (let key of keys) {
        if (key in row && row[key] != null && row[key] !== '') {
          const num = parseFloat(row[key]);
          if (!isNaN(num)) return num;
        }
      }
      return 0;
    };

    // 🧍 Helper to get string
    const getString = (row, ...keys) => {
      for (let key of keys) {
        if (key in row && row[key] != null) {
          return String(row[key]).trim();
        }
      }
      return '';
    };

    // ✅ STORE FULL ROWS IN UPLOAD TABLE FIRST
    const uploadData = records.map((r, idx) => ({
      exam_id: parseInt(exam_id),
      file_name: req.file.originalname,
      row_index: idx + 1, // 1-based index
      data: r // Entire row as object → stored as JSONB
    }));

    const { error: uploadError } = await supabase
      .from('upload')
      .insert(uploadData);

    if (uploadError) {
      console.error('❌ Error inserting into upload table:', uploadError);
      return res.status(500).json({
        error: 'Failed to store raw upload data',
        details: uploadError.message
      });
    }

    console.log(`✅ Stored ${uploadData.length} raw rows in 'upload' table`);

    // ✅ NOW PROCESS FOR exam_results (unchanged logic)
    const COLUMN_MAP = {
      2: 'student_id',       // C → Roll No
      3: 'student_name',     // D → Name
      7: 'correct',          // H → Correct
      8: 'wrong',            // I → Wrong
      9: 'unattempted',      // J → Unattempted
      10: 'physics',         // K → Physics
      18: 'chemistry',       // S → Chemistry
      26: 'maths',           // AA → Maths
      34: 'biology',         // AI → Biology
    };

    const results = records.map((r, idx) => {
      if (!r) return null;

      const mappedRow = {};
      for (const [index, key] of Object.entries(COLUMN_MAP)) {
        if (index in r) {
          mappedRow[key] = r[index];
        } else {
          console.warn(`⚠️ Column index ${index} not found in row ${idx + 1} for key "${key}"`);
          mappedRow[key] = null;
        }
      }

      const studentId = getString(mappedRow, 'student_id');
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
      const totalQuestions = 60;
      const percentage = totalQuestions > 0 ? ((correct / totalQuestions) * 100).toFixed(2) : 0;

      return {
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
        percentage: percentage,
        class_rank: '-',
        school_rank: '-',
        all_schools_rank: '-'
      };
    }).filter(Boolean);

    if (results.length === 0) {
      return res.status(400).json({ error: 'No valid records processed' });
    }

    // ✅ STORE IN DATABASE
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
      correct_answers: r.correct_answers,
      wrong_answers: r.wrong_answers,
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
      return res.status(500).json({
        error: 'Database insert failed',
        details: insertError.message
      });
    }

   // ✅ CALCULATE RANKS
const { error: rankError } = await supabase.rpc('calculate_exam_ranks', {
  p_exam_id: parseInt(exam_id)
});

if (rankError) {
  console.error('❌ Error calculating ranks:', rankError);
}

// ✅ 🆕 GENERATE ANALYTICS
const { error: analyticsError } = await supabase.rpc('generate_exam_analytics', {
  p_exam_id: parseInt(exam_id)
});

if (analyticsError) {
  console.error('❌ Error generating analytics:', analyticsError);
}
    

    // ✅ FETCH FINAL RESULTS WITH RANKS
    const { data: finalResults, error: fetchError } = await supabase
      .from('exam_results')
      .select('*')
      .eq('exam_id', exam_id);

    // ✅ SUCCESS RESPONSE
    return res.status(200).json({
      success: true,
      exam: {
        id: exam_id,
        school_id: exam.school_id,
        class: exam.class,
        program: exam.program,
        exam_template: exam.exam_template,
        exam_pattern: exam.exam_pattern
      },
      results: finalResults || results,
      count: (finalResults || results).length,
      raw_uploads_stored: uploadData.length // 👈 Added for feedback
    });

  } catch (err) {
    console.error('💥 Error processing exam results:', err);
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
    const { data: results, error } = await supabase
      .from('exam_results')
      .select(`
        id,
        exam_id,
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
        exams (
          exam_pattern,
          exam_template,
          program,
          class,
          section
        )
      `)
      .eq('student_id', student_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching exam results:', error);
      return res.status(500).json({ error: 'Failed to fetch exam results' });
    }

    // Format for frontend
    const formatted = results.map(r => ({
      id: r.id,
      exam_id: r.exam_id,
      date: new Date(r.created_at).toLocaleDateString('en-GB'),
      exam: r.exams?.exam_pattern || r.exams?.exam_template || 'N/A',
      program: r.exams?.program || 'N/A',
      physics: parseFloat(r.physics_marks) || 0,
      chemistry: parseFloat(r.chemistry_marks) || 0,
      maths: parseFloat(r.maths_marks) || 0,
      biology: parseFloat(r.biology_marks) || 0,
      total: parseFloat(r.total_marks) || 0,
      percentage: parseFloat(r.percentage) || 0,
      class_rank: r.class_rank || '-',
      school_rank: r.school_rank || '-',
      all_schools_rank: r.all_schools_rank || '-'
    }));

    return res.json(formatted);
  } catch (err) {
    console.error('Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
// In your routes file (e.g., analyticsRoutes.js or schoolController.js)
export const getClassAverages = async (req, res) => {
  const { school_id } = req.query;

  if (!school_id) {
    return res.status(400).json({ error: 'school_id is required' });
  }

  try {
    const { data, error } = await supabase
      .from('classes_average')
      .select('*')
      .eq('school_id', school_id)
      .order('exam_pattern', { ascending: true })
      .order('class', { ascending: true });

    if (error) throw error;

    return res.json(data);
  } catch (err) {
    console.error('Error fetching class averages:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSubjectSummaries = async (req, res) => {
  const { school_id } = req.query;

  if (!school_id) {
    return res.status(400).json({ error: 'school_id is required' });
  }

  try {
    const { data, error } = await supabase
      .from('subject_summary')
      .select('*')
      .eq('school_id', school_id)
      .order('exam_pattern', { ascending: true })
      .order('class', { ascending: true })
      .order('subject', { ascending: true });

    if (error) throw error;

    return res.json(data);
  } catch (err) {
    console.error('Error fetching subject summaries:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};