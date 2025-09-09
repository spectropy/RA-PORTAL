import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import multer from 'multer';

// Routes
import authRoutes from './routes/auth.js';
import schoolRoutes from './routes/schools.js';
import uploadRoutes from './routes/upload.js';

// Controllers
import * as schoolController from './controllers/schoolController.js';

// Middleware
import { errorHandler } from './middleware/errorHandler.js';

// =========================
// 🔧 Configuration
// =========================

const PORT = process.env.PORT || 4000;

// Validate Supabase
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase env vars');
  process.exit(1);
}

// Configure multer for file uploads
const upload = multer({ 
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// =========================
// 🌐 Express App
// =========================

const app = express();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '5mb' }));

// =========================
// 🛠️ Routes
// =========================

app.get('/', (req, res) => {
  res.json({ ok: true, name: 'SPECTROPY School Portal Backend' });
});

app.get('/health', (req, res) => res.status(200).send('ok'));

// Authentication routes
app.use('/api/login', authRoutes);

// School routes
app.use('/api/schools', schoolRoutes);

// Upload routes
app.use('/api/upload-schools', uploadRoutes);

// =========================
// 🆕 New Routes for Class/Teacher, Student, and Exam Registration
// =========================

// Classes routes
app.post('/api/classes', schoolController.createClass);

// Teachers routes
app.post('/api/teachers', schoolController.createTeacher);

// Teacher assignments routes
app.post('/api/teacher-assignments', schoolController.assignTeacherToClass);

// Students upload route
app.post('/api/schools/:school_id/students/upload', 
  upload.single('file'), 
  schoolController.uploadStudents
);

// Exams routes
app.post('/api/exams', schoolController.createExam);

// Reference data routes
app.get('/api/foundations', schoolController.getFoundations);
app.get('/api/programs', schoolController.getPrograms);
app.get('/api/academic-years', schoolController.getAcademicYears);

// =========================
// 🚨 Error Handling
// =========================

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.use(errorHandler);

// =========================
// ▶️ Start Server
// =========================

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
  console.log(`📌 Connected to Supabase`);
  console.log(`🔐 School Owner login: ${process.env.OWNER_USERNAME || 'owner'} / ********`);
  
  // Log new routes
  console.log(`🆕 New API endpoints available:`);
  console.log(`   POST   /api/classes`);
  console.log(`   POST   /api/teachers`);
  console.log(`   POST   /api/teacher-assignments`);
  console.log(`   POST   /api/schools/:school_id/students/upload`);
  console.log(`   POST   /api/exams`);
  console.log(`   GET    /api/foundations`);
  console.log(`   GET    /api/programs`);
  console.log(`   GET    /api/academic-years`);
});