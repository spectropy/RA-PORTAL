// server/routes/schools.js
import { Router } from 'express';
import { getSchools, createSchool, getSchoolById } from '../controllers/schoolController.js';

const router = Router();

router.get('/', getSchools);
router.post('/', createSchool);
router.get('/:school_id', getSchoolById); // ← New route

export default router;