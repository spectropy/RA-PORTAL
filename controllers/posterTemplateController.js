import { createClient } from '@supabase/supabase-js';
import { imageSize } from 'image-size';
import sharp from 'sharp';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TEMPLATE_CATEGORY = 'top_students';
const TEMPLATE_STATUSES = new Set(['draft', 'active', 'archived']);
const IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/svg+xml', 'svg']
]);
const POSTER_TEMPLATE_BUCKET = 'poster-templates';
const THUMBNAIL_WIDTH = 360;
const THUMBNAIL_HEIGHT = 480;

const parseLayoutJson = value => {
  if (value == null || value === '') return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }
  return null;
};

const positiveInteger = value => Number.isInteger(Number(value)) && Number(value) > 0;

const validateTemplatePayload = (payload, { partial = false } = {}) => {
  const errors = [];

  if (!partial || payload.name !== undefined) {
    if (!String(payload.name || '').trim()) errors.push('name is required');
  }

  if (!partial || payload.category !== undefined) {
    if ((payload.category || TEMPLATE_CATEGORY) !== TEMPLATE_CATEGORY) {
      errors.push(`category must be ${TEMPLATE_CATEGORY}`);
    }
  }

  if (!partial || payload.status !== undefined) {
    if (payload.status && !TEMPLATE_STATUSES.has(payload.status)) {
      errors.push('status must be draft, active, or archived');
    }
  }

  if (!partial || payload.canvas_width !== undefined) {
    if (!positiveInteger(payload.canvas_width)) errors.push('canvas_width must be a positive integer');
  }

  if (!partial || payload.canvas_height !== undefined) {
    if (!positiveInteger(payload.canvas_height)) errors.push('canvas_height must be a positive integer');
  }

  if (!partial || payload.layout_json !== undefined) {
    if (parseLayoutJson(payload.layout_json) === null) errors.push('layout_json must be a JSON object');
  }

  return errors;
};

const normalizeTemplatePayload = payload => {
  const normalized = {};
  if (payload.name !== undefined) normalized.name = String(payload.name).trim();
  if (payload.category !== undefined) normalized.category = payload.category;
  if (payload.description !== undefined) normalized.description = payload.description || null;
  if (payload.background_url !== undefined) normalized.background_url = payload.background_url || '';
  if (payload.background_storage_path !== undefined) normalized.background_storage_path = payload.background_storage_path || null;
  if (payload.thumbnail_url !== undefined) normalized.thumbnail_url = payload.thumbnail_url || null;
  if (payload.thumbnail_storage_path !== undefined) normalized.thumbnail_storage_path = payload.thumbnail_storage_path || null;
  if (payload.canvas_width !== undefined) normalized.canvas_width = Number(payload.canvas_width);
  if (payload.canvas_height !== undefined) normalized.canvas_height = Number(payload.canvas_height);
  if (payload.layout_json !== undefined) normalized.layout_json = parseLayoutJson(payload.layout_json);
  if (payload.status !== undefined) normalized.status = payload.status;
  if (payload.created_by !== undefined) normalized.created_by = payload.created_by || null;
  return normalized;
};

const validateActivation = layoutJson => {
  if (!layoutJson || layoutJson.version === undefined || layoutJson.version === null) {
    return 'layout_json.version is required before activating a template';
  }
  return null;
};

const publicUrlFor = storagePath => {
  if (!storagePath) return null;
  const { data } = supabase.storage.from(POSTER_TEMPLATE_BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl || null;
};

const ensurePosterTemplateBucket = async () => {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;

  if (buckets?.some(bucket => bucket.name === POSTER_TEMPLATE_BUCKET)) {
    const { error: updateError } = await supabase.storage.updateBucket(POSTER_TEMPLATE_BUCKET, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: [...IMAGE_TYPES.keys()]
    });
    if (updateError) throw updateError;
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(POSTER_TEMPLATE_BUCKET, {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: [...IMAGE_TYPES.keys()]
  });

  if (createError) throw createError;
};

const uploadBufferToStorage = async ({ buffer, mimetype, templateId, kind, extension }) => {
  const storagePath = `top_students/${templateId}/${kind}.${extension}`;
  await ensurePosterTemplateBucket();

  const { error: uploadError } = await supabase.storage
    .from(POSTER_TEMPLATE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimetype,
      upsert: true
    });

  if (uploadError) throw uploadError;

  return {
    storagePath,
    url: publicUrlFor(storagePath)
  };
};

const uploadImage = async (file, templateId, kind) => {
  if (!file) return { error: `${kind} file is required` };

  const extension = IMAGE_TYPES.get(file.mimetype);
  if (!extension) return { error: 'Only PNG, JPEG, and SVG images are supported' };

  let dimensions;
  try {
    dimensions = imageSize(file.buffer);
  } catch {
    return { error: 'Could not read image dimensions' };
  }

  if (!dimensions?.width || !dimensions?.height) {
    return { error: 'Uploaded image has invalid dimensions' };
  }

  const uploaded = await uploadBufferToStorage({
    buffer: file.buffer,
    mimetype: file.mimetype,
    templateId,
    kind,
    extension
  });

  return {
    storagePath: uploaded.storagePath,
    url: uploaded.url,
    width: dimensions.width,
    height: dimensions.height
  };
};

const createThumbnail = async (file, templateId) => {
  const buffer = await sharp(file.buffer)
    .resize({
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      fit: 'cover',
      position: 'center'
    })
    .jpeg({ quality: 78 })
    .toBuffer();

  return uploadBufferToStorage({
    buffer,
    mimetype: 'image/jpeg',
    templateId,
    kind: 'thumbnail',
    extension: 'jpg'
  });
};

export const listPosterTemplates = async (req, res) => {
  try {
    let query = supabase
      .from('poster_templates')
      .select('*')
      .order('created_at', { ascending: false });

    if (req.query.category) query = query.eq('category', req.query.category);
    if (req.query.status) query = query.eq('status', req.query.status);

    const { data, error } = await query;
    if (error) throw error;
    return res.json({ data: data || [] });
  } catch (error) {
    console.error('List poster templates error:', error);
    return res.status(500).json({ error: 'Failed to fetch poster templates' });
  }
};

export const getPosterTemplate = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('poster_templates')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Poster template not found' });
    return res.json({ data });
  } catch (error) {
    console.error('Get poster template error:', error);
    return res.status(500).json({ error: 'Failed to fetch poster template' });
  }
};

export const createPosterTemplate = async (req, res) => {
  const payload = normalizeTemplatePayload(req.body || {});
  const errors = validateTemplatePayload(payload);
  const backgroundFile = req.file;

  if (payload.status === 'active') {
    const activationError = validateActivation(payload.layout_json);
    if (activationError) errors.push(activationError);
  }
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });

  try {
    const { data, error } = await supabase
      .from('poster_templates')
      .insert({
        ...payload,
        category: TEMPLATE_CATEGORY,
        background_url: payload.background_url || '',
        layout_json: payload.layout_json || {}
      })
      .select('*')
      .single();

    if (error) throw error;

    if (!backgroundFile) return res.status(201).json({ data });

    const background = await uploadImage(backgroundFile, data.id, 'background');
    if (background.error) return res.status(400).json({ error: background.error });

    const thumbnail = await createThumbnail(backgroundFile, data.id);
    const layoutJson = {
      ...(payload.layout_json || {}),
      canvas: {
        ...(payload.layout_json?.canvas || {}),
        width: background.width,
        height: background.height,
        backgroundUrl: background.url
      }
    };

    const { data: finalData, error: updateError } = await supabase
      .from('poster_templates')
      .update({
        background_url: background.url,
        background_storage_path: background.storagePath,
        thumbnail_url: thumbnail.url,
        thumbnail_storage_path: thumbnail.storagePath,
        canvas_width: background.width,
        canvas_height: background.height,
        layout_json: layoutJson
      })
      .eq('id', data.id)
      .select('*')
      .single();

    if (updateError) throw updateError;
    return res.status(201).json({ data: finalData });
  } catch (error) {
    console.error('Create poster template error:', error);
    return res.status(500).json({
      error: 'Failed to create poster template',
      details: error.message || String(error)
    });
  }
};

export const updatePosterTemplate = async (req, res) => {
  const payload = normalizeTemplatePayload(req.body || {});
  const errors = validateTemplatePayload(payload, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });

  try {
    const { data: existing, error: existingError } = await supabase
      .from('poster_templates')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (existingError || !existing) return res.status(404).json({ error: 'Poster template not found' });

    const nextLayout = payload.layout_json ?? existing.layout_json;
    const nextStatus = payload.status ?? existing.status;
    if (nextStatus === 'active') {
      const activationError = validateActivation(nextLayout);
      if (activationError) return res.status(400).json({ error: activationError });
    }

    const { data, error } = await supabase
      .from('poster_templates')
      .update(payload)
      .eq('id', req.params.id)
      .select('*')
      .single();

    if (error) throw error;
    return res.json({ data });
  } catch (error) {
    console.error('Update poster template error:', error);
    return res.status(500).json({ error: 'Failed to update poster template' });
  }
};

export const uploadPosterTemplateBackground = async (req, res) => {
  try {
    const result = await uploadImage(req.file, req.params.id, 'background');
    if (result.error) return res.status(400).json({ error: result.error });

    const { data, error } = await supabase
      .from('poster_templates')
      .update({
        background_url: result.url,
        background_storage_path: result.storagePath,
        canvas_width: result.width,
        canvas_height: result.height
      })
      .eq('id', req.params.id)
      .select('id, background_url, background_storage_path, canvas_width, canvas_height')
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Poster template not found' });
    return res.json(data);
  } catch (error) {
    console.error('Upload poster background error:', error);
    return res.status(500).json({
      error: 'Failed to upload poster background',
      details: error.message || String(error)
    });
  }
};

export const uploadPosterTemplateThumbnail = async (req, res) => {
  try {
    const result = await uploadImage(req.file, req.params.id, 'thumbnail');
    if (result.error) return res.status(400).json({ error: result.error });

    const { data, error } = await supabase
      .from('poster_templates')
      .update({
        thumbnail_url: result.url,
        thumbnail_storage_path: result.storagePath
      })
      .eq('id', req.params.id)
      .select('id, thumbnail_url, thumbnail_storage_path')
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Poster template not found' });
    return res.json(data);
  } catch (error) {
    console.error('Upload poster thumbnail error:', error);
    return res.status(500).json({
      error: 'Failed to upload poster thumbnail',
      details: error.message || String(error)
    });
  }
};

export const duplicatePosterTemplate = async (req, res) => {
  try {
    const { data: source, error: sourceError } = await supabase
      .from('poster_templates')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (sourceError || !source) return res.status(404).json({ error: 'Poster template not found' });

    const { data: duplicate, error: duplicateError } = await supabase
      .from('poster_templates')
      .insert({
        name: `${source.name} - Copy`,
        category: source.category,
        description: source.description,
        background_url: source.background_url,
        background_storage_path: source.background_storage_path,
        thumbnail_url: source.thumbnail_url,
        thumbnail_storage_path: source.thumbnail_storage_path,
        canvas_width: source.canvas_width,
        canvas_height: source.canvas_height,
        layout_json: source.layout_json || {},
        status: 'draft',
        created_by: req.body?.created_by || source.created_by
      })
      .select('*')
      .single();

    if (duplicateError) throw duplicateError;
    return res.status(201).json({ data: duplicate });
  } catch (error) {
    console.error('Duplicate poster template error:', error);
    return res.status(500).json({ error: 'Failed to duplicate poster template' });
  }
};

export const deletePosterTemplate = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('poster_templates')
      .update({ status: 'archived' })
      .eq('id', req.params.id)
      .select('*')
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Poster template not found' });
    return res.json({ data, message: 'Poster template archived successfully' });
  } catch (error) {
    console.error('Archive poster template error:', error);
    return res.status(500).json({ error: 'Failed to archive poster template' });
  }
};

export const permanentlyDeletePosterTemplate = async (req, res) => {
  try {
    const { data: existing, error: existingError } = await supabase
      .from('poster_templates')
      .select('id, background_storage_path, thumbnail_storage_path')
      .eq('id', req.params.id)
      .single();

    if (existingError || !existing) return res.status(404).json({ error: 'Poster template not found' });

    const storagePaths = [
      existing.background_storage_path,
      existing.thumbnail_storage_path
    ].filter(Boolean);

    if (storagePaths.length) {
      const { error: storageError } = await supabase.storage
        .from(POSTER_TEMPLATE_BUCKET)
        .remove(storagePaths);
      if (storageError) throw storageError;
    }

    const { error: deleteError } = await supabase
      .from('poster_templates')
      .delete()
      .eq('id', req.params.id);

    if (deleteError) throw deleteError;
    return res.json({ success: true, message: 'Poster template permanently deleted' });
  } catch (error) {
    console.error('Permanent poster template delete error:', error);
    return res.status(500).json({
      error: 'Failed to permanently delete poster template',
      details: error.message || String(error)
    });
  }
};
