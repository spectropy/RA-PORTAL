import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PAGE_SIZE = 1000;

const fetchAll = async (table, columns, applyFilters = query => query) => {
  const rows = [];
  let from = 0;

  while (true) {
    let query = supabase.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
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

  const { data: schoolList, error: schoolListError } = await supabase
    .from('school_list')
    .select('school_id, school_name, logo_url')
    .eq('school_id', schoolId)
    .maybeSingle();

  if (schoolListError) throw schoolListError;
  return schoolList
    ? { school_id: schoolList.school_id, name: schoolList.school_name, logo: schoolList.logo_url }
    : null;
};

const buildGroups = (examRows, studentRows) => {
  const names = new Map((studentRows || []).map(student => [String(student.student_id), student.name]));
  const groups = new Map();

  for (const exam of examRows) {
    if (!exam.class || !exam.section || !exam.student_id) continue;

    // Keep parity with TopStudentsSchool.jsx: percentage first, then totalgrade_per_avg.
    const score = numberOrNull(exam.percentage ?? exam.totalgrade_per_avg);
    if (score === null) continue;

    const className = String(exam.class);
    const sectionName = String(exam.section);
    const groupKey = `${className}|${sectionName}`;
    const studentKey = String(exam.student_id);
    const group = groups.get(groupKey) || new Map();
    const current = group.get(studentKey) || {
      student_id: exam.student_id,
      name: names.get(studentKey) || [exam.first_name, exam.last_name].filter(Boolean).join(' ') || 'Anonymous',
      class: className,
      section: sectionName,
      scores: []
    };

    current.scores.push(score);
    group.set(studentKey, current);
    groups.set(groupKey, group);
  }

  return [...groups.entries()].map(([key, students]) => {
    const [className, sectionName] = key.split('|');
    const ranked = [...students.values()]
      .map(student => ({
        student_id: student.student_id,
        name: student.name,
        class: student.class,
        section: student.section,
        cumulative_percentage: Number((student.scores.reduce((sum, score) => sum + score, 0) / student.scores.length).toFixed(2))
      }))
      .sort((a, b) => b.cumulative_percentage - a.cumulative_percentage || String(a.name).localeCompare(String(b.name)))
      .slice(0, 5)
      .map((student, index) => ({ ...student, rank: index + 1 }));

    return { key, className, sectionName, students: ranked };
  });
};

export const getTopStudents = async (req, res) => {
  const schoolId = String(req.query.school_id || '').trim();
  const className = String(req.query.class || '').trim();
  const sectionName = String(req.query.section || '').trim();
  const requestedLimit = Number(req.query.limit || 5);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 5;

  if (!schoolId) return res.status(400).json({ error: 'school_id is required' });
  if ((className && !sectionName) || (!className && sectionName)) {
    return res.status(400).json({ error: 'class and section must be provided together' });
  }

  try {
    const school = await loadSchool(schoolId);
    if (!school) return res.status(404).json({ error: 'School not found' });

    const examRows = await fetchAll(
      'exams',
      'school_id, class, section, student_id, first_name, last_name, percentage, totalgrade_per_avg',
      query => {
        let filtered = query.eq('school_id', schoolId).not('student_id', 'is', null);
        if (className) filtered = filtered.eq('class', className).eq('section', sectionName);
        return filtered.order('created_at', { ascending: false });
      }
    );

    const studentIds = [...new Set(examRows.map(row => row.student_id).filter(Boolean).map(String))];
    let studentRows = [];
    if (studentIds.length) {
      const { data, error } = await supabase
        .from('students')
        .select('student_id, name')
        .eq('school_id', schoolId)
        .in('student_id', studentIds);
      if (error) throw error;
      studentRows = data || [];
    }

    const groups = buildGroups(examRows, studentRows).map(group => ({
      ...group,
      students: group.students.slice(0, limit)
    }));

    if (!className) return res.json({ school, groups });

    const group = groups.find(item => item.className === className && item.sectionName === sectionName);
    return res.json({
      school,
      className,
      sectionName,
      students: group?.students || []
    });
  } catch (error) {
    console.error('Get top students error:', error);
    return res.status(500).json({ error: 'Failed to calculate top students' });
  }
};
