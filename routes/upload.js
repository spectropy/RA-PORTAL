// server/routes/upload.js
import { Router } from 'express';
import multer from 'multer';
import { uploadSchools } from '../controllers/uploadController.js';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.post('/', upload.single('file'), uploadSchools);

export default router;