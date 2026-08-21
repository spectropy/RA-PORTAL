import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const PAGE_SIZE = 1000;

const fetchAll = async (applyFilters) => {
  const rows = [];
  let from = 0;

  while (true) {
    let query = supabase.from('exams').select('*').range(from, from + PAGE_SIZE - 1);
    query = applyFilters(query);
    const { data, error } = await query;
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
};

const numberOrNull = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const loadSchool = async schoolId => {
  const { data: school, error } = await supabase
    .from('schools')
    .select('school_id, school_name, logo_url')
    .eq('school_id', schoolId)
    .maybeSingle();
  if (error) throw error;
  if (school) return { school_id: school.school_id, name: school.school_name, logo: school.logo_url };

  const { data: fallback, error: fallbackError } = await supabase
    .from('school_list')
    .select('school_id, school_name, logo_url')
    .eq('school_id', schoolId)
    .maybeSingle();
  if (fallbackError) throw fallbackError;
  return fallback
    ? { school_id: fallback.school_id, name: fallback.school_name, logo: fallback.logo_url }
    : null;
};

export const getExamWiseTopStudents = async (req, res) => {
  const schoolId = String(req.query.school_id || '').trim();
  const className = String(req.query.class || '').trim();
  const sectionName = String(req.query.section || '').trim();
  const examPattern = String(req.query.exam_pattern || '').trim();
  const examDate = String(req.query.exam_date || '').trim();
  const requestedLimit = Number(req.query.limit || 5);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 100)
    : 5;

  if (!schoolId || !className || !sectionName || !examPattern) {
    return res.status(400).json({
      error: 'school_id, class, section, and exam_pattern are required',
    });
  }

  try {
    const school = await loadSchool(schoolId);
    if (!school) return res.status(404).json({ error: 'School not found' });

    const rows = await fetchAll(query => {
      let filtered = query
        .eq('school_id', schoolId)
        .eq('class', className)
        .eq('section', sectionName)
        .eq('exam_pattern', examPattern)
        .not('student_id', 'is', null);
      if (examDate) filtered = filtered.eq('exam_date', examDate);
      return filtered.order('created_at', { ascending: false });
    });

    const students = new Map();
    for (const row of rows) {
      const percentage = numberOrNull(row.percentage ?? row.totalgrade_per_avg);
      if (!row.student_id || percentage === null) continue;
      const key = String(row.student_id);
      if (!students.has(key)) {
        students.set(key, {
          student_id: row.student_id,
          name: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Anonymous',
          percentage,
          total_marks: numberOrNull(row.total_marks) || 0,
        });
      }
    }

    const ranked = [...students.values()]
      .sort((a, b) => b.percentage - a.percentage || b.total_marks - a.total_marks || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((student, index) => ({
        rank: index + 1,
        student_id: student.student_id,
        name: student.name,
        percentage: Number(student.percentage.toFixed(2)),
      }));

    return res.json({
      school,
      className,
      sectionName,
      exam: {
        name: examDate ? `${examPattern} - ${examDate}` : examPattern,
        pattern: examPattern,
        date: examDate || null,
      },
      students: ranked,
    });
  } catch (error) {
    console.error('Get exam-wise top students error:', error);
    return res.status(500).json({ error: 'Failed to calculate exam-wise top students' });
  }
};
