-- WiseWizard portal, stage 1: accounts, venues, tracks, submissions, files.
-- Rule of thumb: tables are locked down by default; every permission below is deliberate.

create schema if not exists private;
grant usage on schema private to anon, authenticated;

create type public.app_role as enum ('author', 'reviewer', 'editor', 'admin');
create type public.venue_type as enum ('journal_issue', 'special_call', 'conference');
create type public.venue_status as enum ('draft', 'open', 'closed', 'archived');
create type public.article_type as enum ('research_article', 'case_study', 'short_case', 'conference_paper');
create type public.submission_status as enum (
  'draft', 'submitted', 'under_review', 'revision_requested',
  'revision_submitted', 'accepted', 'rejected', 'withdrawn');
create type public.file_kind as enum ('blinded_manuscript', 'title_page', 'supplementary', 'similarity_report');

-- ---------- Tables ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  designation text,
  institution text,
  country text,
  phone text,
  orcid text,
  roles public.app_role[] not null default '{author}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{2,10}$'),
  name text not null,
  type public.venue_type not null,
  partner_name text,
  description text,
  opens_on date,
  closes_on date,
  status public.venue_status not null default 'draft',
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  code text not null check (code ~ '^[A-Z]{2,5}$'),
  name text not null,
  next_seq integer not null default 1,
  unique (venue_id, code)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id),
  track_id uuid not null references public.tracks (id),
  owner_id uuid not null default auth.uid() references public.profiles (id),
  paper_id text unique,
  title text not null default '',
  abstract text not null default '',
  keywords text[] not null default '{}',
  article_type public.article_type not null default 'research_article',
  status public.submission_status not null default 'draft',
  version integer not null default 1,
  declared_original boolean not null default false,
  declared_ai_use boolean not null default false,
  declared_consent boolean not null default false,
  ai_use_statement text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index submissions_owner_idx on public.submissions (owner_id);
create index submissions_venue_idx on public.submissions (venue_id);
create index submissions_track_idx on public.submissions (track_id);

create table public.submission_authors (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  position integer not null default 1,
  full_name text not null,
  email text not null,
  affiliation text,
  country text,
  is_corresponding boolean not null default false
);
create index submission_authors_submission_idx on public.submission_authors (submission_id);

create table public.submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  kind public.file_kind not null,
  version integer not null default 1,
  storage_path text not null unique,
  file_name text not null,
  size_bytes bigint,
  uploaded_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index submission_files_submission_idx on public.submission_files (submission_id);
create index submission_files_uploader_idx on public.submission_files (uploaded_by);
create index venues_created_by_idx on public.venues (created_by);

-- ---------- Helper functions (private schema: not callable from the web API) ----------

create function private.has_role(r public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and r = any (p.roles)
  );
$$;

create function private.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and (p.roles && array['editor', 'admin']::public.app_role[])
  );
$$;

create function private.owns_editable_submission(s uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.submissions x
    where x.id = s and x.owner_id = (select auth.uid())
      and x.status in ('draft', 'revision_requested')
  );
$$;

create function private.owns_submission(s uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.submissions x
    where x.id = s and x.owner_id = (select auth.uid())
  );
$$;

create function private.try_uuid(t text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

create function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end $$;

revoke all on all functions in schema private from public;
grant execute on function private.has_role(public.app_role) to anon, authenticated;
grant execute on function private.is_staff() to anon, authenticated;
grant execute on function private.owns_editable_submission(uuid) to authenticated;
grant execute on function private.owns_submission(uuid) to authenticated;
grant execute on function private.try_uuid(text) to authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger venues_touch before update on public.venues
  for each row execute function private.touch_updated_at();
create trigger submissions_touch before update on public.submissions
  for each row execute function private.touch_updated_at();

-- ---------- Table permissions (column-level, so users cannot change roles, status or paper IDs) ----------

revoke all on public.profiles, public.venues, public.tracks, public.submissions,
  public.submission_authors, public.submission_files from anon, authenticated;

grant select on public.venues to anon, authenticated;
grant select (id, venue_id, code, name) on public.tracks to anon, authenticated;
grant insert, update, delete on public.venues to authenticated;
grant insert (venue_id, code, name), update (code, name), delete on public.tracks to authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, designation, institution, country, phone, orcid) on public.profiles to authenticated;

grant select, delete on public.submissions to authenticated;
grant insert (venue_id, track_id, title, abstract, keywords, article_type,
              declared_original, declared_ai_use, declared_consent, ai_use_statement)
  on public.submissions to authenticated;
grant update (track_id, title, abstract, keywords, article_type,
              declared_original, declared_ai_use, declared_consent, ai_use_statement)
  on public.submissions to authenticated;

grant select, insert, update, delete on public.submission_authors to authenticated;
grant select, delete on public.submission_files to authenticated;
grant insert (submission_id, kind, version, storage_path, file_name, size_bytes)
  on public.submission_files to authenticated;

-- ---------- Row-level security ----------

alter table public.profiles enable row level security;
alter table public.venues enable row level security;
alter table public.tracks enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_authors enable row level security;
alter table public.submission_files enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy venues_read on public.venues for select to anon, authenticated
  using (status in ('open', 'closed') or (select private.is_staff()));
create policy venues_admin_insert on public.venues for insert to authenticated
  with check ((select private.has_role('admin')));
create policy venues_admin_update on public.venues for update to authenticated
  using ((select private.has_role('admin'))) with check ((select private.has_role('admin')));
create policy venues_admin_delete on public.venues for delete to authenticated
  using ((select private.has_role('admin')));

create policy tracks_read on public.tracks for select to anon, authenticated
  using (exists (select 1 from public.venues v where v.id = venue_id));
create policy tracks_admin_insert on public.tracks for insert to authenticated
  with check ((select private.has_role('admin')));
create policy tracks_admin_update on public.tracks for update to authenticated
  using ((select private.has_role('admin'))) with check ((select private.has_role('admin')));
create policy tracks_admin_delete on public.tracks for delete to authenticated
  using ((select private.has_role('admin')));

create policy submissions_read on public.submissions for select to authenticated
  using (owner_id = (select auth.uid()) or (select private.is_staff()));
create policy submissions_insert_own on public.submissions for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy submissions_update_own on public.submissions for update to authenticated
  using (owner_id = (select auth.uid()) and status in ('draft', 'revision_requested'))
  with check (owner_id = (select auth.uid()));
create policy submissions_delete_draft on public.submissions for delete to authenticated
  using (owner_id = (select auth.uid()) and status = 'draft');

create policy authors_read on public.submission_authors for select to authenticated
  using ((select private.owns_submission(submission_id)) or (select private.is_staff()));
create policy authors_insert on public.submission_authors for insert to authenticated
  with check ((select private.owns_editable_submission(submission_id)));
create policy authors_update on public.submission_authors for update to authenticated
  using ((select private.owns_editable_submission(submission_id)))
  with check ((select private.owns_editable_submission(submission_id)));
create policy authors_delete on public.submission_authors for delete to authenticated
  using ((select private.owns_editable_submission(submission_id)));

create policy files_read on public.submission_files for select to authenticated
  using ((select private.owns_submission(submission_id)) or (select private.is_staff()));
create policy files_insert on public.submission_files for insert to authenticated
  with check ((select private.owns_editable_submission(submission_id)));
create policy files_delete on public.submission_files for delete to authenticated
  using ((select private.owns_editable_submission(submission_id)));

-- ---------- Actions that need checks the browser cannot be trusted to make ----------

create function public.submit_submission(p_submission uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.submissions;
  v public.venues;
  t_code text;
  n integer;
  pid text;
begin
  select * into s from public.submissions where id = p_submission for update;
  if not found or s.owner_id is distinct from (select auth.uid()) then
    raise exception 'Submission not found';
  end if;
  if s.status <> 'draft' then
    raise exception 'This submission has already been submitted';
  end if;
  if length(trim(s.title)) = 0 or length(trim(s.abstract)) = 0 then
    raise exception 'Title and abstract are required';
  end if;
  if not (s.declared_original and s.declared_ai_use and s.declared_consent) then
    raise exception 'Please accept all three declarations';
  end if;
  select * into v from public.venues where id = s.venue_id;
  if v.status <> 'open' or (v.closes_on is not null and v.closes_on < current_date) then
    raise exception 'This call is not open for submissions';
  end if;
  if not exists (select 1 from public.submission_files f
                 where f.submission_id = s.id and f.kind = 'blinded_manuscript') then
    raise exception 'Please upload the blinded manuscript';
  end if;
  if not exists (select 1 from public.submission_authors a
                 where a.submission_id = s.id and a.is_corresponding) then
    raise exception 'Please name a corresponding author';
  end if;
  update public.tracks set next_seq = next_seq + 1
    where id = s.track_id and venue_id = s.venue_id
    returning code, next_seq - 1 into t_code, n;
  if t_code is null then
    raise exception 'The chosen track does not belong to this call';
  end if;
  pid := v.code || '-' || t_code || '-' || lpad(n::text, 3, '0');
  update public.submissions
    set paper_id = pid, status = 'submitted', submitted_at = now()
    where id = s.id;
  return pid;
end $$;

create function public.set_user_roles(p_user uuid, p_roles public.app_role[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role('admin') then
    raise exception 'Only an admin can change roles';
  end if;
  if not ('author' = any (p_roles)) then
    p_roles := array_prepend('author'::public.app_role, p_roles);
  end if;
  update public.profiles set roles = p_roles where id = p_user;
end $$;

revoke all on function public.submit_submission(uuid) from public, anon;
revoke all on function public.set_user_roles(uuid, public.app_role[]) from public, anon;
grant execute on function public.submit_submission(uuid) to authenticated;
grant execute on function public.set_user_roles(uuid, public.app_role[]) to authenticated;

-- ---------- Private file store for manuscripts: path is <submission id>/<file name> ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manuscripts', 'manuscripts', false, 20971520, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy manuscripts_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'manuscripts'
    and (select private.owns_editable_submission(private.try_uuid((storage.foldername(name))[1]))));
create policy manuscripts_read on storage.objects for select to authenticated
  using (bucket_id = 'manuscripts'
    and ((select private.owns_submission(private.try_uuid((storage.foldername(name))[1])))
         or (select private.is_staff())));
create policy manuscripts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'manuscripts'
    and (select private.owns_editable_submission(private.try_uuid((storage.foldername(name))[1]))));
