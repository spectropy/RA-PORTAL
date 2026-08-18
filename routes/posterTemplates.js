import express from 'express';
import multer from 'multer';
import * as posterTemplateController from '../controllers/posterTemplateController.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.get('/', posterTemplateController.listPosterTemplates);
router.get('/:id', posterTemplateController.getPosterTemplate);
router.post('/', upload.single('file'), posterTemplateController.createPosterTemplate);
router.put('/:id', posterTemplateController.updatePosterTemplate);
router.post('/:id/background', upload.single('file'), posterTemplateController.uploadPosterTemplateBackground);
router.post('/:id/thumbnail', upload.single('file'), posterTemplateController.uploadPosterTemplateThumbnail);
router.post('/:id/duplicate', posterTemplateController.duplicatePosterTemplate);
router.delete('/:id/permanent', posterTemplateController.permanentlyDeletePosterTemplate);
router.delete('/:id', posterTemplateController.deletePosterTemplate);

export default router;
