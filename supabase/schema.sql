-- CampusFlow Supabase schema
create extension if not exists "pgcrypto";

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  student_id text not null unique,
  full_name text not null,
  email text not null unique,
  course text not null,
  attendance smallint not null default 90 check (attendance between 0 and 100),
  grade smallint not null default 80 check (grade between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at before update on public.students for each row execute function public.set_updated_at();
do $$ begin create type public.app_role as enum ('admin', 'teacher', 'student'); exception when duplicate_object then null; end $$;
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text not null default '', role public.app_role not null default 'student', student_id uuid unique references public.students(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.attendance_records (id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id) on delete cascade, attendance_date date not null, status text not null check (status in ('present','absent','late','excused')), notes text not null default '', recorded_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(student_id,attendance_date));
create table if not exists public.assessments (id uuid primary key default gen_random_uuid(), student_id uuid not null references public.students(id) on delete cascade, subject text not null, title text not null, score numeric(7,2) not null check (score >= 0), max_score numeric(7,2) not null check (max_score > 0 and score <= max_score), assessed_on date not null, created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now());
create table if not exists public.audit_logs (id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id) on delete set null, action text not null, entity text not null, entity_id uuid, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', '')); return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
create or replace function public.current_app_role() returns public.app_role language sql stable security definer set search_path = public as $$ select role from public.profiles where id = auth.uid() $$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$ select coalesce(public.current_app_role() in ('admin','teacher'), false) $$;
alter table public.students enable row level security;
alter table public.profiles enable row level security;
alter table public.attendance_records enable row level security;
alter table public.assessments enable row level security;
alter table public.audit_logs enable row level security;
create policy "Staff can read students" on public.students for select to authenticated using (public.is_staff() or id = (select student_id from public.profiles where id = auth.uid()));
create policy "Users can read own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff());
create policy "Staff can read attendance" on public.attendance_records for select to authenticated using (public.is_staff() or student_id = (select student_id from public.profiles where id = auth.uid()));
create policy "Staff can read assessments" on public.assessments for select to authenticated using (public.is_staff() or student_id = (select student_id from public.profiles where id = auth.uid()));
create policy "Admins can read audit logs" on public.audit_logs for select to authenticated using (public.current_app_role() = 'admin');
do $$ begin alter publication supabase_realtime add table public.students; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.attendance_records; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.assessments; exception when duplicate_object then null; end $$;
