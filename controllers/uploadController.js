// server/controllers/uploadController.js
import * as XLSX from 'xlsx';

import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

import { deriveSchoolId } from './schoolController.js';

export const uploadSchools = async (req, res) => {
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

    if (batch.length > 0) {
      const { data, error } = await supabase
        .from('school_list')
        .upsert(batch, { onConflict: 'school_id', ignoreDuplicates: false });

      if (error) throw error;
    }

    return res.json({ inserted: batch.length, skipped: errors.length, errors });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
};