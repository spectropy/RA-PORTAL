import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'student-photos';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);

export const listStudentPhotos = async (req, res) => {
  const schoolId = String(req.query.school_id || '').trim();
  const studentIds = String(req.query.student_ids || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  if (!schoolId || !studentIds.length) {
    return res.status(400).json({ error: 'school_id and student_ids are required' });
  }

  try {
    const { data, error } = await supabase
      .from('student_photos')
      .select('school_id, student_id, storage_path, content_type, file_size_bytes')
      .eq('school_id', schoolId)
      .in('student_id', studentIds);
    if (error) throw error;

    const photos = (data || []).map(row => ({
      ...row,
      photo_url: supabase.storage.from(BUCKET).getPublicUrl(row.storage_path).data.publicUrl
    }));
    return res.json({ data: photos });
  } catch (error) {
    console.error('List student photos error:', error);
    return res.status(500).json({ error: 'Failed to load student photos' });
  }
};

export const uploadStudentPhoto = async (req, res) => {
  const schoolId = String(req.body.school_id || '').trim();
  const studentId = String(req.body.student_id || '').trim();
  const file = req.file;

  if (!schoolId || !studentId || !file) {
    return res.status(400).json({ error: 'school_id, student_id, and image file are required' });
  }
  const extension = allowedTypes.get(file.mimetype);
  if (!extension) return res.status(400).json({ error: 'Only JPEG, PNG, and WebP images are supported' });

  let uploadedPath = '';
  try {
    const storagePath = `${schoolId}/${randomUUID()}.${extension}`;
    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (storageError) throw storageError;
    uploadedPath = storagePath;

    const { data: previous } = await supabase
      .from('student_photos')
      .select('storage_path')
      .eq('school_id', schoolId)
      .eq('student_id', studentId)
      .maybeSingle();

    const { data, error } = await supabase
      .from('student_photos')
      .upsert({
        school_id: schoolId,
        student_id: studentId,
        storage_path: storagePath,
        content_type: file.mimetype,
        file_size_bytes: file.size,
        uploaded_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'school_id,student_id' })
      .select('school_id, student_id, storage_path, content_type, file_size_bytes')
      .single();
    if (error) throw error;

    if (previous?.storage_path && previous.storage_path !== storagePath) {
      const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([previous.storage_path]);
      if (cleanupError) console.warn('Could not remove replaced student photo:', cleanupError.message);
    }

    return res.status(201).json({
      data: {
        ...data,
        photo_url: supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl
      }
    });
  } catch (error) {
    if (uploadedPath) {
      await supabase.storage.from(BUCKET).remove([uploadedPath]).catch(() => {});
    }
    console.error('Upload student photo error:', error);
    return res.status(500).json({ error: 'Failed to save student photo' });
  }
};
