// server/routes/schoolRoutes.js
import express from 'express';
import * as schoolController from '../controllers/schoolController.js';

const router = express.Router();

router.get('/', schoolController.getSchools);
router.post('/', schoolController.createSchool);
router.get('/:school_id', schoolController.getSchoolById);
router.delete('/:school_id', schoolController.deleteSchool); // 👈 ADD THIS LINE

export default router;