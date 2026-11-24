-- CareerPrep placement portal (IBS Jaipur), Supabase project "CareerPrep" (ref cundtmcpfxrafihmypzo, Mumbai).
-- Rebuilt 24 Nov 2026 (version 2): roles PCO, Deputy PCO, Placement Manager, Mentor; selection rounds per job.
--
-- Roles (highest first): manager and maintenance (the owner), pco, deputy_pco, placement_manager, mentor, student.
-- Students sign up with @ibsindia.org or @iujaipur.edu.in. Everyone else joins by invitation:
--   manager invites any role; pco invites deputy_pco, placement_manager, mentor; deputy_pco invites placement_manager, mentor.
-- A job belongs to one placement manager (its owner). Round results are changed by the owner or a head
-- (deputy_pco, pco, manager). Mentors see the applications of the students assigned to them by a head.

-- ---------- start clean (version 1 had no data) ----------
drop trigger if exists careerprep_check_signup on auth.users;
drop trigger if exists careerprep_on_new_user on auth.users;
drop policy if exists "students upload own resume while open" on storage.objects;
drop policy if exists "students replace own resume while open" on storage.objects;
drop policy if exists "read own resume, staff all" on storage.objects;
drop policy if exists "remove own resume while open, staff any" on storage.objects;
drop policy if exists "staff manage job files" on storage.objects;
drop policy if exists "students read files of visible jobs" on storage.objects;
drop table if exists public.applications, public.jobs, public.mentor_assignments, public.staff_invites, public.profiles cascade;
drop function if exists public.mark_exported(uuid), public.clear_job(uuid), public.remove_staff(text), public.update_round(uuid[], text, text);
drop schema if exists private cascade;
drop type if exists public.app_role, public.app_status, public.app_result;

create extension if not exists pgcrypto;
create schema private;
grant usage on schema private to authenticated;

create type public.app_role as enum ('student', 'mentor', 'placement_manager', 'deputy_pco', 'pco', 'maintenance', 'manager', 'inactive');
create type public.app_result as enum ('in_process', 'selected', 'not_cleared');

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
  department text,
  role public.app_role not null default 'student',
  created_at timestamptz not null default now()
);

create table public.staff_invites (
  email text primary key check (email = lower(email)),
  role public.app_role not null check (role not in ('student', 'inactive')),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.mentor_assignments (
  student_id uuid primary key references public.profiles (id) on delete cascade,
  mentor_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now()
);
create index on public.mentor_assignments (mentor_id);

create or replace function private.role_of(uid uuid) returns public.app_role
language sql stable security definer set search_path = '' as $$ select role from public.profiles where id = uid $$;

create or replace function private.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$ select role from public.profiles where id = (select auth.uid()) $$;

-- Can see every job and application.
create or replace function private.is_placement() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce(private.my_role() in ('placement_manager', 'deputy_pco', 'pco', 'maintenance', 'manager'), false) $$;

-- Heads: may act on any job and assign mentors.
create or replace function private.is_head() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce(private.my_role() in ('deputy_pco', 'pco', 'manager'), false) $$;

create or replace function private.can_grant(r public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.my_role()
    when 'manager' then r not in ('student', 'inactive')
    when 'pco' then r in ('deputy_pco', 'placement_manager', 'mentor')
    when 'deputy_pco' then r in ('placement_manager', 'mentor')
    else false end
$$;

create or replace function private.is_my_mentee(s uuid) returns boolean
language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.mentor_assignments where student_id = s and mentor_id = (select auth.uid())) $$;

-- Sign-up: institute addresses, or anyone invited to the team.
create or replace function private.check_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if lower(coalesce(new.email, '')) like '%@ibsindia.org'
     or lower(coalesce(new.email, '')) like '%@iujaipur.edu.in'
     or exists (select 1 from public.staff_invites i where i.email = lower(new.email)) then
    return new;
  end if;
  raise exception 'Please sign up with your @ibsindia.org or @iujaipur.edu.in email address.';
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
  rounds jsonb not null default '[]'::jsonb,   -- [{ "id": "r1", "name": "Aptitude test", "note": "..." }]
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null,
  published boolean not null default false,
  form jsonb not null default '[]'::jsonb,
  jd_file_path text,
  jd_file_name text,
  owner_id uuid default auth.uid() references public.profiles (id) on delete set null,
  exported_at timestamptz,
  archived_at timestamptz,
  archive_summary jsonb,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at > opens_at)
);

create or replace function private.can_manage_job(j uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_head()
      or (private.my_role() = 'placement_manager'
          and exists (select 1 from public.jobs where id = j and owner_id = (select auth.uid())))
$$;

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
  stage integer not null default 0,          -- index of the round the student is in (0 = first round)
  result public.app_result not null default 'in_process',
  history jsonb not null default '[]'::jsonb,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, student_id)
);
create index on public.applications (job_id);
create index on public.applications (student_id);

-- Students edit answers and resume only while the job is open and no round result has been recorded.
create or replace function private.guard_application() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('careerprep.round_update', true) = 'on' then
    return new;
  end if;
  if new.stage <> old.stage or new.result <> old.result or new.history <> old.history
     or new.job_id <> old.job_id or new.student_id <> old.student_id then
    raise exception 'Only the placement team can change round results.';
  end if;
  if jsonb_array_length(old.history) > 0 then
    raise exception 'Your application is being evaluated and can no longer be changed.';
  end if;
  if not private.job_open(new.job_id) then
    raise exception 'Applications for this job are closed.';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_application before update on public.applications
  for each row execute function private.guard_application();

create or replace function private.touch() returns trigger language plpgsql set search_path = '' as
$$ begin new.updated_at := now(); return new; end $$;
create trigger touch_jobs before update on public.jobs for each row execute function private.touch();

-- Round results: 'clear' moves to the next round (or selects after the last), 'not_clear' stops,
-- 'select' gives the offer directly, 'reopen' undoes a final result, 'back' returns one round.
create or replace function public.update_round(p_apps uuid[], p_action text, p_note text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare a public.applications; j public.jobs; n int; done int := 0; who text; rname text; act text := lower(p_action);
begin
  if act not in ('clear', 'not_clear', 'select', 'reopen', 'back') then raise exception 'Unknown action.'; end if;
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = (select auth.uid());
  perform set_config('careerprep.round_update', 'on', true);
  for a in select * from public.applications where id = any (p_apps) for update loop
    select * into j from public.jobs where id = a.job_id;
    if not private.can_manage_job(j.id) then raise exception 'Only the job''s placement manager or a head can update rounds.'; end if;
    if j.archived_at is not null then raise exception 'This job has been cleared.'; end if;
    n := jsonb_array_length(j.rounds);
    rname := coalesce(j.rounds -> least(a.stage, greatest(n - 1, 0)) ->> 'name', 'Application');
    if act = 'clear' and a.result = 'in_process' then
      if a.stage + 1 >= n then a.result := 'selected'; a.stage := n; else a.stage := a.stage + 1; end if;
    elsif act = 'not_clear' and a.result = 'in_process' then
      a.result := 'not_cleared';
    elsif act = 'select' and a.result <> 'selected' then
      a.result := 'selected'; a.stage := n;
    elsif act = 'reopen' and a.result <> 'in_process' then
      a.result := 'in_process'; if a.stage >= n then a.stage := greatest(n - 1, 0); end if;
    elsif act = 'back' and a.result = 'in_process' and a.stage > 0 then
      a.stage := a.stage - 1;
    else
      continue;
    end if;
    update public.applications
       set stage = a.stage, result = a.result, updated_at = now(),
           history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', who, 'action', act, 'round', rname, 'note', p_note))
     where id = a.id;
    done := done + 1;
  end loop;
  perform set_config('careerprep.round_update', 'off', true);
  return done;
end $$;

-- ---------- row-level security ----------
alter table public.profiles enable row level security;
alter table public.staff_invites enable row level security;
alter table public.mentor_assignments enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;

create policy "who can see a profile" on public.profiles for select to authenticated using (
  id = (select auth.uid()) or private.is_placement() or private.is_my_mentee(id)
  or exists (select 1 from public.mentor_assignments m where m.student_id = (select auth.uid()) and m.mentor_id = profiles.id));
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated, anon;
grant update (full_name, roll_no, programme, batch, specialisation, phone, department) on public.profiles to authenticated;

create policy "team can see the team" on public.staff_invites for select to authenticated using (private.is_placement());
create policy "invite within your seniority" on public.staff_invites for insert to authenticated with check (private.can_grant(role));
create policy "change invites within your seniority" on public.staff_invites for update to authenticated
  using (private.can_grant(role)) with check (private.can_grant(role));

create policy "see mentor links" on public.mentor_assignments for select to authenticated using (
  private.is_placement() or mentor_id = (select auth.uid()) or student_id = (select auth.uid()));
create policy "heads assign mentors" on public.mentor_assignments for insert to authenticated with check (
  private.is_head() and private.role_of(student_id) = 'student' and private.role_of(mentor_id) = 'mentor');
create policy "heads reassign mentors" on public.mentor_assignments for update to authenticated using (private.is_head())
  with check (private.is_head() and private.role_of(student_id) = 'student' and private.role_of(mentor_id) = 'mentor');
create policy "heads remove mentor links" on public.mentor_assignments for delete to authenticated using (private.is_head());

create policy "see jobs" on public.jobs for select to authenticated
  using (private.is_placement() or (published and archived_at is null));
create policy "placement team posts jobs" on public.jobs for insert to authenticated with check (
  private.my_role() in ('placement_manager', 'deputy_pco', 'pco', 'manager')
  and (owner_id = (select auth.uid()) or private.is_head()));
create policy "owner or head edits a job" on public.jobs for update to authenticated
  using (private.can_manage_job(id)) with check (private.is_head() or owner_id = (select auth.uid()));
create policy "owner or head deletes a job" on public.jobs for delete to authenticated using (private.can_manage_job(id));

create policy "see applications" on public.applications for select to authenticated
  using (student_id = (select auth.uid()) or private.is_placement() or private.is_my_mentee(student_id));
create policy "students apply while open" on public.applications for insert to authenticated
  with check (student_id = (select auth.uid()) and private.job_open(job_id) and private.my_role() = 'student');
create policy "students edit own" on public.applications for update to authenticated using (student_id = (select auth.uid()));
create policy "students withdraw while open" on public.applications for delete to authenticated
  using (student_id = (select auth.uid()) and private.job_open(job_id) and jsonb_array_length(history) = 0);
revoke update on public.applications from authenticated, anon;
grant update (answers, resume_path, resume_name, resume_size) on public.applications to authenticated;

-- ---------- export, clean-up, team ----------
create or replace function public.mark_exported(p_job uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare t timestamptz;
begin
  if not private.can_manage_job(p_job) then raise exception 'Only the job''s placement manager or a head can export.'; end if;
  update public.jobs set exported_at = now() where id = p_job and closes_at <= now() returning exported_at into t;
  if t is null then raise exception 'Export is available once the closing date has passed.'; end if;
  return t;
end $$;

create or replace function public.clear_job(p_job uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.jobs; s jsonb;
begin
  if not private.can_manage_job(p_job) then raise exception 'Only the job''s placement manager or a head can clear data.'; end if;
  select * into j from public.jobs where id = p_job for update;
  if j.closes_at > now() then raise exception 'This job is still open.'; end if;
  if j.exported_at is null then raise exception 'Please download the archive before clearing.'; end if;
  s := jsonb_build_object(
    'applications', (select count(*) from public.applications where job_id = p_job),
    'by_result', coalesce((select jsonb_object_agg(result, n) from (select result::text, count(*) n from public.applications where job_id = p_job group by result) y), '{}'::jsonb),
    'rounds', j.rounds, 'cleared_at', now());
  delete from public.applications where job_id = p_job;
  update public.jobs set archived_at = now(), archive_summary = s, jd_file_path = null, jd_file_name = null where id = p_job;
  return s;
end $$;

create or replace function public.remove_staff(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.app_role; e text := lower(p_email);
begin
  select role into r from public.staff_invites where email = e;
  if r is null then raise exception 'Not on the team.'; end if;
  if not private.can_grant(r) then raise exception 'You cannot remove someone at that level.'; end if;
  if e = (select email from public.profiles where id = (select auth.uid())) then raise exception 'You cannot remove your own access.'; end if;
  delete from public.staff_invites where email = e;
  delete from public.mentor_assignments where mentor_id in (select id from public.profiles where email = e);
  update public.profiles set role = 'inactive' where email = e;
end $$;

revoke execute on function public.mark_exported(uuid), public.clear_job(uuid), public.remove_staff(text), public.update_round(uuid[], text, text) from anon, public;
grant execute on function public.mark_exported(uuid), public.clear_job(uuid), public.remove_staff(text), public.update_round(uuid[], text, text) to authenticated;

-- ---------- file storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('resumes', 'resumes', false, 5242880, array['application/pdf']),
  ('jobfiles', 'jobfiles', false, 10485760, array['application/pdf', 'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- resumes/<job id>/<student id>/resume.pdf
create policy "students upload own resume while open" on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[2] = (select auth.uid())::text
              and private.job_open(((storage.foldername(name))[1])::uuid));
create policy "students replace own resume while open" on storage.objects for update to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[2] = (select auth.uid())::text
         and private.job_open(((storage.foldername(name))[1])::uuid));
create policy "read own resume, mentees, placement team" on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and ((storage.foldername(name))[2] = (select auth.uid())::text or private.is_placement()
         or private.is_my_mentee(((storage.foldername(name))[2])::uuid)));
create policy "remove own resume while open, job managers any" on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and (private.can_manage_job(((storage.foldername(name))[1])::uuid)
         or ((storage.foldername(name))[2] = (select auth.uid())::text and private.job_open(((storage.foldername(name))[1])::uuid))));

-- jobfiles/<job id>/<file name>
create policy "job managers add job files" on storage.objects for insert to authenticated
  with check (bucket_id = 'jobfiles' and private.can_manage_job(((storage.foldername(name))[1])::uuid));
create policy "job managers change job files" on storage.objects for update to authenticated
  using (bucket_id = 'jobfiles' and private.can_manage_job(((storage.foldername(name))[1])::uuid));
create policy "job managers remove job files" on storage.objects for delete to authenticated
  using (bucket_id = 'jobfiles' and private.can_manage_job(((storage.foldername(name))[1])::uuid));
create policy "read job files" on storage.objects for select to authenticated
  using (bucket_id = 'jobfiles' and (private.is_placement() or private.job_visible(((storage.foldername(name))[1])::uuid)));

-- ---------- the owner ----------
insert into public.staff_invites (email, role) values
  ('write2vinayk@gmail.com', 'manager'), ('vinayfpm@gmail.com', 'maintenance')
on conflict (email) do update set role = excluded.role;
