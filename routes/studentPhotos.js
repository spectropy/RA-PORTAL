import { Router } from 'express';
import multer from 'multer';
import { listStudentPhotos, uploadStudentPhoto } from '../controllers/studentPhotoController.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

router.get('/', listStudentPhotos);
router.post('/', upload.single('file'), uploadStudentPhoto);

export default router;
