-- CareerPrep placement portal (IBS Jaipur), Supabase project "CareerPrep" (ref cundtmcpfxrafihmypzo, Mumbai).
-- Students (@ibsindia.org only) apply to job openings with a resume and a per-job form.
-- Placement managers post companies and jobs; after the closing date they export everything
-- (Excel, resumes, job PDF) and then clear the applications and files from the server.

create extension if not exists pgcrypto;
create schema if not exists private;

create type public.app_role as enum ('student', 'manager', 'admin');
create type public.app_status as enum ('submitted', 'shortlisted', 'selected', 'not_selected', 'withdrawn');

-- ---------- people ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  roll_no text,
  programme text,
  batch text,
  specialisation text,
  phone text,
  role public.app_role not null default 'student',
  created_at timestamptz not null default now()
);

-- Staff (managers, admins) join by invitation, with any email address.
create table public.staff_invites (
  email text primary key check (email = lower(email)),
  role public.app_role not null check (role <> 'student'),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function private.role_of(uid uuid) returns public.app_role
language sql stable security definer set search_path = '' as
$$ select role from public.profiles where id = uid $$;

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select role in ('manager', 'admin') from public.profiles where id = (select auth.uid())), false) $$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select role = 'admin' from public.profiles where id = (select auth.uid())), false) $$;

-- Only institute addresses, or invited staff, may create an account.
create or replace function private.check_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if lower(coalesce(new.email, '')) like '%@ibsindia.org'
     or exists (select 1 from public.staff_invites i where i.email = lower(new.email)) then
    return new;
  end if;
  raise exception 'Please sign up with your @ibsindia.org email address.';
end $$;

create trigger careerprep_check_signup before insert on auth.users
  for each row execute function private.check_signup();

create or replace function private.on_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'full_name', ''),
          coalesce((select i.role from public.staff_invites i where i.email = lower(new.email)), 'student'));
  return new;
end $$;

create trigger careerprep_on_new_user after insert on auth.users
  for each row execute function private.on_new_user();

-- An invitation for someone who already has an account takes effect at once.
create or replace function private.apply_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set role = new.role where email = new.email;
  return new;
end $$;

create trigger apply_invite after insert or update on public.staff_invites
  for each row execute function private.apply_invite();

-- ---------- jobs ----------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  company_about text,
  company_website text,
  title text not null,
  job_type text not null default 'Full-time',
  location text,
  ctc text,
  description text,
  eligibility text,
  process text,
  other_info text,
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null,
  published boolean not null default false,
  form jsonb not null default '[]'::jsonb,
  jd_file_path text,
  jd_file_name text,
  exported_at timestamptz,
  archived_at timestamptz,
  archive_summary jsonb,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at > opens_at)
);

create or replace function private.job_open(j uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs
                 where id = j and published and archived_at is null and now() >= opens_at and now() < closes_at)
$$;

create or replace function private.job_visible(j uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs where id = j and published and archived_at is null)
$$;

-- ---------- applications ----------
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  student_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  resume_path text,
  resume_name text,
  resume_size integer,
  status public.app_status not null default 'submitted',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, student_id)
);
create index on public.applications (job_id);

-- Students may edit their answers and resume while the job is open; only staff change the status.
create or replace function private.guard_application() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_staff() then
    if new.status is distinct from old.status or new.job_id <> old.job_id or new.student_id <> old.student_id then
      raise exception 'Only the placement team can change this.';
    end if;
    if not private.job_open(new.job_id) then
      raise exception 'Applications for this job are closed.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_application before update on public.applications
  for each row execute function private.guard_application();

create or replace function private.touch() returns trigger language plpgsql set search_path = '' as
$$ begin new.updated_at := now(); return new; end $$;
create trigger touch_jobs before update on public.jobs for each row execute function private.touch();

-- ---------- row-level security ----------
alter table public.profiles enable row level security;
alter table public.staff_invites enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;

create policy "read own profile or staff" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_staff());
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated, anon;
grant update (full_name, roll_no, programme, batch, specialisation, phone) on public.profiles to authenticated;

create policy "admins manage invites" on public.staff_invites for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy "students see published jobs, staff see all" on public.jobs for select to authenticated
  using (private.is_staff() or (published and archived_at is null));
create policy "staff add jobs" on public.jobs for insert to authenticated with check (private.is_staff());
create policy "staff edit jobs" on public.jobs for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy "staff delete jobs" on public.jobs for delete to authenticated using (private.is_staff());

create policy "own applications or staff" on public.applications for select to authenticated
  using (student_id = (select auth.uid()) or private.is_staff());
create policy "apply while open" on public.applications for insert to authenticated
  with check (student_id = (select auth.uid()) and private.job_open(job_id)
              and private.role_of((select auth.uid())) = 'student');
create policy "edit own while open, staff any" on public.applications for update to authenticated
  using (student_id = (select auth.uid()) or private.is_staff());
create policy "withdraw own while open" on public.applications for delete to authenticated
  using (student_id = (select auth.uid()) and private.job_open(job_id));
revoke update on public.applications from authenticated, anon;
grant update (answers, resume_path, resume_name, resume_size, status) on public.applications to authenticated;

-- ---------- export and clean-up ----------
create or replace function public.mark_exported(p_job uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare t timestamptz;
begin
  if not private.is_staff() then raise exception 'Only the placement team can export.'; end if;
  update public.jobs set exported_at = now() where id = p_job and closes_at <= now() returning exported_at into t;
  if t is null then raise exception 'Export is available once the closing date has passed.'; end if;
  return t;
end $$;

-- Removes every application for a closed, exported job and keeps a short record of the job.
create or replace function public.clear_job(p_job uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; s jsonb;
begin
  if not private.is_staff() then raise exception 'Only the placement team can clear data.'; end if;
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'Job not found.'; end if;
  if j.closes_at > now() then raise exception 'This job is still open.'; end if;
  if j.exported_at is null then raise exception 'Please download the archive before clearing.'; end if;
  s := jsonb_build_object('applications', (select count(*) from public.applications where job_id = p_job),
         'by_status', coalesce((select jsonb_object_agg(status, n) from (select status::text, count(*) n from public.applications where job_id = p_job group by status) y), '{}'::jsonb),
         'cleared_at', now());
  delete from public.applications where job_id = p_job;
  update public.jobs set archived_at = now(), archive_summary = s, jd_file_path = null, jd_file_name = null where id = p_job;
  return s;
end $$;

create or replace function public.remove_staff(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only an admin can do this.'; end if;
  if lower(p_email) = (select email from public.profiles where id = (select auth.uid())) then
    raise exception 'You cannot remove your own access.';
  end if;
  delete from public.staff_invites where email = lower(p_email);
  update public.profiles set role = 'student' where email = lower(p_email);
end $$;

revoke execute on function public.mark_exported(uuid), public.clear_job(uuid), public.remove_staff(text) from anon, public;
grant execute on function public.mark_exported(uuid), public.clear_job(uuid), public.remove_staff(text) to authenticated;
grant usage on schema private to authenticated;

-- ---------- file storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('resumes', 'resumes', false, 5242880, array['application/pdf']),
  ('jobfiles', 'jobfiles', false, 10485760, array['application/pdf', 'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- resumes/<job id>/<student id>/<file name>
create policy "students upload own resume while open" on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[2] = (select auth.uid())::text
              and private.job_open(((storage.foldername(name))[1])::uuid));
create policy "students replace own resume while open" on storage.objects for update to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[2] = (select auth.uid())::text
         and private.job_open(((storage.foldername(name))[1])::uuid));
create policy "read own resume, staff all" on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and ((storage.foldername(name))[2] = (select auth.uid())::text or private.is_staff()));
create policy "remove own resume while open, staff any" on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and (private.is_staff() or ((storage.foldername(name))[2] = (select auth.uid())::text
         and private.job_open(((storage.foldername(name))[1])::uuid))));

-- jobfiles/<job id>/<file name>
create policy "staff manage job files" on storage.objects for all to authenticated
  using (bucket_id = 'jobfiles' and private.is_staff()) with check (bucket_id = 'jobfiles' and private.is_staff());
create policy "students read files of visible jobs" on storage.objects for select to authenticated
  using (bucket_id = 'jobfiles' and private.job_visible(((storage.foldername(name))[1])::uuid));

-- ---------- first admins ----------
insert into public.staff_invites (email, role) values
  ('write2vinayk@gmail.com', 'admin'), ('vinayfpm@gmail.com', 'admin')
on conflict (email) do nothing;
