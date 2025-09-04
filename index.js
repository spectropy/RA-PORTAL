// server/index.js
import express from 'express';
import cors from 'cors';
import 'dotenv/config';

// Routes
import authRoutes from './routes/auth.js';
import schoolRoutes from './routes/schools.js';
import uploadRoutes from './routes/upload.js';

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

app.use('/api/login', authRoutes);
app.use('/api/schools', schoolRoutes);
app.use('/api/upload-schools', uploadRoutes);

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
});