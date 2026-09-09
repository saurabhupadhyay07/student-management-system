import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((name) => !process.env[name]);
const configured = missing.length === 0;
if (!configured) console.warn(`Supabase setup required: ${missing.join(', ')}.`);
const supabase = configured ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const app = express(), port = Number(process.env.PORT || 3000);
const staffRoles = new Set(['admin', 'teacher']);
const studentSchema = z.object({ studentId: z.string().trim().min(3).max(50), name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), course: z.string().trim().min(2).max(100), attendance: z.coerce.number().int().min(0).max(100), grade: z.coerce.number().int().min(0).max(100) });
const attendanceSchema = z.object({ studentId: z.string().uuid(), date: z.coerce.date().transform((value) => value.toISOString().slice(0, 10)), status: z.enum(['present', 'absent', 'late', 'excused']), notes: z.string().trim().max(300).optional().default('') });
const assessmentSchema = z.object({ studentId: z.string().uuid(), subject: z.string().trim().min(2).max(100), title: z.string().trim().min(2).max(160), score: z.coerce.number().min(0).max(100), maxScore: z.coerce.number().positive().max(1000), assessedOn: z.coerce.date().transform((value) => value.toISOString().slice(0, 10)) }).refine((item) => item.score <= item.maxScore, { message: 'Score cannot exceed maximum score.', path: ['score'] });

app.use(helmet({ contentSecurityPolicy: false })); app.use(express.json({ limit: '20kb' })); app.use(morgan('dev')); app.use(express.static('.', { dotfiles: 'deny', index: 'index.html' }));
const toRow = (s) => ({ student_id: s.studentId, full_name: s.name, email: s.email, course: s.course, attendance: s.attendance, grade: s.grade });
const toPartialRow = (s) => Object.fromEntries(Object.entries(toRow(s)).filter(([, value]) => value !== undefined));
const apiError = (res, error) => res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'A record with that unique value already exists.' : 'Database request failed.' });
async function audit(actorId, action, entity, entityId, details = {}) { await supabase.from('audit_logs').insert({ actor_id: actorId, action, entity, entity_id: entityId, details }); }
async function requireAuth(req, res, next) {
  if (!configured) return res.status(503).json({ error: 'Supabase is not configured yet. Add values to .env and restart the server.' });
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Please sign in first.' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Your session is invalid or expired.' });
  const { data: profile, error: profileError } = await supabase.from('profiles').select('id, full_name, role').eq('id', user.id).single();
  if (profileError || !profile) return res.status(403).json({ error: 'Your account profile has not been provisioned.' });
  req.user = { id: user.id, email: user.email, ...profile }; next();
}
const requireStaff = (req, res, next) => staffRoles.has(req.user.role) ? next() : res.status(403).json({ error: 'Only administrators and teachers can perform this action.' });

app.get('/api/config', (_req, res) => res.json({ configured, supabaseUrl: process.env.SUPABASE_URL || null, supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null, missing }));
app.get('/api/me', requireAuth, (req, res) => res.json(req.user));
app.get('/api/students', requireAuth, async (_req, res) => { const { data, error } = await supabase.from('students').select('*').order('created_at', { ascending: false }); if (error) return apiError(res, error); res.json(data); });
app.post('/api/students', requireAuth, requireStaff, async (req, res) => { const parsed = studentSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Please provide valid student details.' }); const { data, error } = await supabase.from('students').insert(toRow(parsed.data)).select().single(); if (error) return apiError(res, error); await audit(req.user.id, 'create', 'student', data.id, { studentId: data.student_id }); res.status(201).json(data); });
app.patch('/api/students/:id', requireAuth, requireStaff, async (req, res) => { if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid student ID.' }); const parsed = studentSchema.partial().safeParse(req.body); if (!parsed.success || Object.keys(parsed.data).length === 0) return res.status(400).json({ error: 'Provide at least one valid field to update.' }); const { data, error } = await supabase.from('students').update(toPartialRow(parsed.data)).eq('id', req.params.id).select().maybeSingle(); if (error) return apiError(res, error); if (!data) return res.status(404).json({ error: 'Student not found.' }); await audit(req.user.id, 'update', 'student', data.id, Object.keys(parsed.data)); res.json(data); });
app.delete('/api/students/:id', requireAuth, requireStaff, async (req, res) => { if (!z.string().uuid().safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid student ID.' }); const { data, error } = await supabase.from('students').delete().eq('id', req.params.id).select('id').maybeSingle(); if (error) return apiError(res, error); if (!data) return res.status(404).json({ error: 'Student not found.' }); await audit(req.user.id, 'delete', 'student', data.id); res.status(204).end(); });
app.get('/api/attendance', requireAuth, async (req, res) => { const date = z.string().date().safeParse(req.query.date || new Date().toISOString().slice(0, 10)); if (!date.success) return res.status(400).json({ error: 'Use a valid date.' }); const { data, error } = await supabase.from('attendance_records').select('*, students(full_name, student_id)').eq('attendance_date', date.data).order('created_at'); if (error) return apiError(res, error); res.json(data); });
app.post('/api/attendance', requireAuth, requireStaff, async (req, res) => { const parsed = attendanceSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Please provide a valid attendance record.' }); const { data, error } = await supabase.from('attendance_records').upsert({ student_id: parsed.data.studentId, attendance_date: parsed.data.date, status: parsed.data.status, notes: parsed.data.notes, recorded_by: req.user.id }, { onConflict: 'student_id,attendance_date' }).select().single(); if (error) return apiError(res, error); await audit(req.user.id, 'upsert', 'attendance', data.id, { status: data.status }); res.json(data); });
app.get('/api/assessments', requireAuth, async (req, res) => { const { data, error } = await supabase.from('assessments').select('*, students(full_name, student_id)').order('assessed_on', { ascending: false }).limit(100); if (error) return apiError(res, error); res.json(data); });
app.post('/api/assessments', requireAuth, requireStaff, async (req, res) => { const parsed = assessmentSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'Please provide a valid assessment.' }); const { data, error } = await supabase.from('assessments').insert({ student_id: parsed.data.studentId, subject: parsed.data.subject, title: parsed.data.title, score: parsed.data.score, max_score: parsed.data.maxScore, assessed_on: parsed.data.assessedOn, created_by: req.user.id }).select().single(); if (error) return apiError(res, error); await audit(req.user.id, 'create', 'assessment', data.id, { subject: data.subject, title: data.title }); res.status(201).json(data); });
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.listen(port, () => console.log(`CampusFlow is running at http://localhost:${port}${configured ? '' : ' (Supabase setup required)'}`));
