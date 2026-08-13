# SPECTROPY School Portal Backend

This project is the server-side API for the SPECTROPY School Portal. It receives requests from the frontend, validates the input, reads or writes data in Supabase, and sends JSON responses back to the frontend.

This guide is written for a developer who is new to the project.

## 1. Technology used

- **Node.js** - runs the JavaScript server.
- **Express** - creates the HTTP API and routes.
- **Supabase** - provides the PostgreSQL database and RPC functions.
- **Multer** - reads uploaded files from `multipart/form-data` requests.
- **XLSX** - reads Excel files in memory.
- **csv-parse** - available for CSV processing.
- **CORS** - allows the frontend to call this API from another origin.
- **dotenv** - loads values from `.env` into `process.env`.
- **Nodemon** - restarts the server automatically during development.

The project uses ES modules, so imports use `import` and files use the `.js` extension.

## 2. Folder structure

```text
school_portal_backend/
|-- index.js                 # Creates Express app, registers routes, starts server
|-- package.json              # Scripts and dependencies
|-- .env                      # Local configuration; do not commit secrets
|-- routes/                   # URL-to-controller mapping
|   |-- auth.js
|   |-- schools.js
|   `-- upload.js
|-- controllers/              # Business logic and Supabase queries
|   |-- authController.js
|   |-- schoolController.js
|   `-- uploadController.js
`-- middleware/
    `-- errorHandler.js       # Common error response handler
```

### How a request moves through the backend

```text
Frontend request
      |
      v
Express middleware (JSON, form data, CORS, file upload)
      |
      v
Route or endpoint in index.js/routes/
      |
      v
Controller function
      |
      v
Supabase table or database RPC function
      |
      v
JSON response to the frontend
```

## 3. Local setup

### Requirements

- Node.js and npm
- Access to the project's Supabase instance
- The Supabase URL and service-role key

### Install and run

```bash
npm install
npm run dev
```

For a normal start without automatic restart:

```bash
npm start
```

The server uses port `4000` by default. Set `PORT` in `.env` to use another port.

Before starting, create or update `.env` with the required values:

```env
PORT=4000
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
FRONTEND_URL=http://localhost:5173
OWNER_USERNAME=owner
OWNER_PASSWORD=change-this-for-local-development
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required. The server stops immediately if either is missing. Never expose the service-role key in frontend code or commit it to Git.

## 4. Important files

### `index.js`

This is the application entry point. It:

1. Loads environment variables.
2. Creates the Express application.
3. Enables JSON and URL-encoded request parsing.
4. Enables CORS.
5. Mounts the route modules.
6. Registers several direct endpoints for classes, teachers, students, exams, and reference data.
7. Returns a 404 response for unknown routes.
8. Registers the common error handler.
9. Starts listening on the configured port.

### `routes/`

Route files keep related URLs together. For example, `routes/schools.js` maps `GET /api/schools` to `getSchools`. The actual database work belongs in a controller, not in the route file.

### `controllers/`

Controllers contain validation, business rules, Supabase queries, and response formatting. `schoolController.js` currently contains most of the portal functionality, including schools, classes, teachers, students, exams, rankings, logos, and dashboard data.

### `middleware/errorHandler.js`

This is the final error handler. Unexpected errors are logged on the server and returned as an HTTP 500 JSON response. The original error message is included only when `NODE_ENV=development`.

## 5. API endpoints

All endpoints return JSON unless they are accepting a file upload.

### Health

| Method | URL | Purpose |
|---|---|---|
| GET | `/` | Returns a basic API status response. |
| GET | `/health` | Returns `ok` when the server is running. |

### Authentication

| Method | URL | Purpose |
|---|---|---|
| POST | `/api/login/login` | School-owner login. The request body contains `username`, `password`, and `role`. |
| POST | `/api/students/login` | Student login using a student ID. |
| POST | `/api/teachers/login` | Teacher login using a teacher ID. |

The school-owner login currently uses credentials from environment variables and loads the fixed development school ID `TS2501`. Treat this as development behavior, not as a complete production authentication system.

### Schools

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/schools` | Lists school overview rows. |
| POST | `/api/schools` | Creates a school, including optional classes and teachers. |
| GET | `/api/schools/:school_id` | Gets one school with its classes, teachers, and teacher assignments. |
| DELETE | `/api/schools/:school_id` | Deletes a school and related school data. |
| PUT | `/api/schools/:school_id/logo` | Updates a school's `logo_url`. |
| POST | `/api/upload-schools` | Uploads an Excel file in the form field `file` and upserts school overview rows. |

School IDs are derived from state, academic year, and a two-digit school number. For example, a Telangana school in academic year `2025-26` with number `01` becomes `TS2501`.

### Classes, teachers, and assignments

| Method | URL | Purpose |
|---|---|---|
| POST | `/api/classes` | Creates a class. |
| PUT | `/api/classes/:id` | Updates a class. |
| DELETE | `/api/classes/:id` | Deletes a class. |
| POST | `/api/teachers` | Creates a teacher. |
| DELETE | `/api/teachers/:id` | Deletes a teacher. |
| POST | `/api/teacher-assignments` | Assigns a teacher to a class, section, and subject. |
| PUT | `/api/teacher-assignments/:id` | Updates an assignment. |
| DELETE | `/api/teacher-assignments/:id` | Deletes an assignment. |
| POST/GET | `/api/teachers/:teacher_id/ranks` | Gets teacher subject averages and ranks. |

### Students

| Method | URL | Purpose |
|---|---|---|
| POST | `/api/schools/:school_id/students/upload` | Uploads student data from a file. Use form field `file`. |
| GET | `/api/schools/:school_id/students` | Lists students, optionally filtered by class and section. |
| DELETE | `/api/schools/:school_id/students` | Deletes students for a selected class and section. |
| DELETE | `/api/schools/:school_id/students/:id` | Deletes one student registration. |

### Exams and dashboard

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/exams` | Lists exams. |
| POST | `/api/exams` | Creates an exam. |
| POST | `/api/exams/:exam_id/results/upload` | Uploads results for an exam. Use form field `file`. |
| GET | `/api/exams/results` | Gets student exam results. |
| GET | `/api/schools/:school_id/exam-datasets` | Lists datasets for a school. |
| GET | `/api/schools/:school_id/exam-datasets/results` | Gets results for a school's datasets. |
| DELETE | `/api/schools/:school_id/exam-datasets` | Deletes exam datasets for a school. |
| GET | `/api/queries/dashboard` | Gets dashboard statistics. `program` is required; `exam_pattern` and `school` are optional query parameters. |

### Reference data

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/foundations` | Lists foundation values. |
| GET | `/api/programs` | Lists program values. |
| GET | `/api/academic-years` | Lists academic years. |

## 6. Working with Supabase

Each controller creates a Supabase client using the server environment variables. Controllers use two patterns:

- `.from('table')` for normal reads, inserts, updates, and deletes.
- `.rpc('function_name', parameters)` for database functions such as school, class, and teacher creation.

When adding a new feature:

1. Confirm the table columns or RPC function parameters in Supabase.
2. Add or update a controller function.
3. Add the endpoint in `index.js` or the relevant route file.
4. Validate required body, path, and query values before querying Supabase.
5. Return a suitable HTTP status (`400` for invalid input, `404` for missing data, `409` for duplicates, `500` for unexpected failures).
6. Test the endpoint with the frontend, Postman, or another API client.

The service-role client bypasses Supabase Row Level Security. This makes the backend trusted and powerful, so every endpoint must validate IDs, input, and ownership relationships carefully.

### 6.1 What Supabase is in this project

Supabase is the hosted database platform used by this application. The database itself is PostgreSQL. Supabase gives the project:

- PostgreSQL tables for schools, classes, teachers, students, and exam data.
- SQL functions, called RPC functions, for operations that involve multiple tables or calculations.
- Storage for school logo images.
- Row Level Security (RLS), which is enabled on the application tables.

The backend connects with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is server-only and bypasses RLS. The frontend uses the public URL and anon key only for the logo storage flow. Never put the service-role key in the frontend or commit it to Git.

The complete database setup and migration script is [`supabase_rebuild.sql`](../supabase_rebuild.sql). Read that file when you need the exact column types, constraints, indexes, triggers, or function definitions. It should be run in the Supabase Dashboard SQL Editor only after confirming the target project; it can change database structure and is not a replacement for a backup.

### 6.2 Database relationship map

The main relationship is organized around `school_id`:

```text
school_list                  schools
    |                          |
    | overview/counts          | school details
    |                          |
    +--------------------------+------------------+
                               |
                +--------------+--------------+
                |                             |
             classes                       teachers
                |                             |
                |                             +------------------+
                |                                                |
                +---- teacher_assignments <-----------------------+
                               |
                           students

exams  <---- raw rows are first saved in upload
```

Important: most tables use a text `school_id` such as `TS2501` to identify a school. Each row also has a UUID `id`, which is the database row identifier. Do not confuse the UUID `id` with the business-facing `school_id`, `student_id`, or `teacher_id`.

### 6.3 Tables and what they store

| Table | Purpose | Important columns and rules |
|---|---|---|
| `schools` | Full record for a school. | `school_id` is unique; contains name, state, academic year, district, area, school number, and logo URL. |
| `school_list` | Lightweight school overview used by the school list screen and school-owner login. | Mirrors the main school details and stores `classes_count` and `teachers_count`. Counts are maintained by database triggers. |
| `classes` | Classes/sections belonging to a school. | References `schools.school_id`; `(school_id, class, section)` must be unique. The column named `group` is quoted in SQL because `group` is a SQL keyword. |
| `teachers` | Teachers belonging to a school. | `teacher_id` is the human-readable unique ID; `id` is the UUID referenced by assignments. |
| `teacher_assignments` | Links a teacher to a class, section, and subject. | References the teacher UUID through `teacher_id`; assignments are deleted when the teacher is deleted. |
| `students` | Student registration and contact data. | `student_id` is unique; rows belong to a school and may include class and section. |
| `exams` | Exam registrations and one row of marks/results per student. | Uses `school_id`, `program`, `exam_pattern`, `class`, `section`, and `exam_date` to identify a dataset. Stores marks, percentages, averages, and ranks. |
| `upload` | Raw JSON rows from uploaded exam result files. | `data` is `jsonb`. Inserting into this table fires a trigger that creates the corresponding row in `exams`. |

There are no `foundations`, `programs`, or `academic_years` tables in the current schema. Their API values are defined in backend code (`schoolController.js`).

### 6.4 How common database operations work

Creating a school uses the `create_school_full` RPC function. It inserts the school, creates its `school_list` overview, and can also insert classes, teachers, and teacher assignments in one operation.

Creating a class, creating a teacher, and assigning a teacher use these RPC functions:

| RPC function | What it does |
|---|---|
| `create_school_full` | Creates a school and its initial related data. |
| `create_class` | Inserts one class and returns a JSON success result. |
| `create_teacher` | Inserts one teacher and returns a JSON success result. |
| `assign_teacher_to_class` | Finds a teacher by school and `teacher_id`, then creates an assignment. |

Normal reads, updates, and deletes use the Supabase query style:

```js
const { data, error } = await supabase
  .from('students')
  .select('*')
  .eq('school_id', schoolId);

if (error) throw error;
```

Always check `error`. A successful request with no matching rows usually returns an empty array, while a failed database request returns an error object.

### 6.5 Exam result upload flow

Exam uploads have two database records involved:

1. The backend reads the Excel/CSV file and stores each raw row in `upload.data` as JSON.
2. The `upload_row_to_exam` trigger runs automatically after each insert.
3. The trigger converts the JSON values into typed columns in `exams`.
4. The backend calls calculation functions to update ranks, exam averages, grade averages, cumulative percentages, and all-school ranks.

The main calculation functions are `calculate_exam_ranks`, `calculate_exam_averages_for`, `calculate_grade_averages_for`, `calculate_cumulative_percentages_for`, `calculate_grade_ranks_for`, and `calculate_all_india_rank_for`.

When deleting an exam dataset, delete matching rows from both `exams` and `upload`, then recalculate the affected analytics. The existing delete endpoint follows this process.

### 6.6 Data safety and database rules for new developers

- Use the backend API for normal application changes. Do not edit production rows directly in the Supabase table editor unless the change is approved.
- Preserve foreign-key relationships. For example, a class must use an existing `schools.school_id`.
- School deletion can remove related data because several foreign keys use `on delete cascade`. Treat delete operations as irreversible unless a backup exists.
- Do not change a column name or type without checking its controller, frontend, SQL function, and upload-file usage.
- Exam grouping depends on the exact values of `school_id`, `program`, `exam_pattern`, `class`, `section`, and `exam_date`. Extra spaces, different capitalization, or a different date format can create a separate dataset.
- Use parameterized Supabase filters and validate IDs and request values before querying.
- Student contact details and exam results are private data. Do not log full rows, passwords, or uploaded files.

### 6.7 Useful SQL for a new developer

Run read-only checks in Supabase SQL Editor while learning:

```sql
-- See the tables used by the portal
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

-- Check a school's related records
select * from public.schools where school_id = 'TS2501';
select * from public.classes where school_id = 'TS2501';
select * from public.teachers where school_id = 'TS2501';
select * from public.students where school_id = 'TS2501';

-- Check the number of exam result rows for a school
select count(*)
from public.exams
where school_id = 'TS2501'
  and student_id is not null;
```

For a new local or test Supabase project, run [`supabase_rebuild.sql`](../supabase_rebuild.sql), configure the backend `.env`, and verify `/health` before testing uploads. Do not run the rebuild script against a shared production database without reviewing it and taking a backup.

## 7. Useful request examples

Create a school:

```http
POST http://localhost:4000/api/schools
Content-Type: application/json

{
  "school_name": "Example School",
  "state": "Telangana",
  "academic_year": "2025-26",
  "school_number_2d": "01",
  "district": "Hyderabad",
  "area": "Central"
}
```

Upload an Excel file using curl:

```bash
curl -X POST http://localhost:4000/api/upload-schools -F "file=@schools.xlsx"
```

## 8. Common issues

- **Server exits with missing Supabase variables:** check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
- **Frontend cannot call the API:** check that the backend is running and that the frontend uses the correct port. CORS is currently configured to allow requests broadly.
- **404 response:** check the HTTP method and exact URL. For example, school-owner login is `/api/login/login`, not `/api/login`.
- **Supabase errors:** verify table names, column names, RPC function names, and the service-role key.
- **Upload errors:** confirm the request uses `multipart/form-data` and the field name is exactly `file`.

## 9. Development notes

- Keep secrets in `.env`; do not commit them.
- Add new business logic to controllers so `index.js` remains easy to navigate.
- Keep response shapes consistent with existing frontend expectations.
- Log useful server-side details, but do not log passwords, service-role keys, or private student data.
- Run `npm run dev` while developing and `npm start` when testing a normal production-style start.
