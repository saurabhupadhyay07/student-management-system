# CampusFlow — Student Management System

Node.js/Express API + Supabase Postgres storage with live dashboard updates.

## One-time setup

1. Create a Supabase project at [supabase.com](https://supabase.com), then open **SQL Editor** and run [`supabase/schema.sql`](./supabase/schema.sql).
2. In **Project Settings → API**, copy the project URL, `service_role` key, and `anon` key.
3. Create `.env` from `.env.example` and set all three values. The service key is server-only.
4. Run `npm install`, then `npm run dev`.
5. Open `http://localhost:3000` (not `index.html` directly), create an account, then confirm the email if your Supabase Auth settings require it.
6. In Supabase SQL Editor, promote the first account to an administrator:

   ```sql
   update public.profiles set role = 'admin' where id = '<your auth user UUID>';
   ```

All new accounts default to the `student` role. Administrators and teachers can create, edit, delete students and record attendance/assessments; students can only view their own linked records.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/students` | List students |
| POST | `/api/students` | Create a student |
| PATCH | `/api/students/:id` | Update a student |
| DELETE | `/api/students/:id` | Delete a student |

The server validates inputs, checks the authenticated user's role, and performs writes with the Supabase service key. The browser uses the anonymous key only for Supabase Auth and real-time read subscriptions. The schema includes `profiles`, `attendance_records`, `assessments`, and `audit_logs`.
