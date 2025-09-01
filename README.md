# SPECTROPY — School Portal Backend

## Quick start
1) `cp .env.example .env` and fill `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Settings → API).
2) `npm install`
3) `npm run dev` (starts on :4000)

## Endpoints
- `GET /` -> health
- `GET /api/schools` -> list rows
- `POST /api/schools` (JSON) -> add one row
- `POST /api/upload-schools` (multipart/form-data, field `file`) -> parse Excel and insert

This server uses the **service role key** so it bypasses RLS. Keep it on server only.
