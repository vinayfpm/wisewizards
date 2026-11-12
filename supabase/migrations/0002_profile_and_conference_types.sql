-- Applied 13 Nov 2026. Adds conference submission types, a fuller profile, and attendance mode.
-- The updated submit_submission() function (abstracts and posters need no file) lives in the database;
-- see the Supabase migration history for its full text.
alter type public.article_type add value if not exists 'abstract';
alter type public.article_type add value if not exists 'extended_abstract';
alter type public.article_type add value if not exists 'full_paper';
alter type public.article_type add value if not exists 'review_paper';
alter type public.article_type add value if not exists 'poster';

alter table public.profiles
  add column salutation text, add column department text, add column city text,
  add column highest_qualification text,
  add column experience_years integer check (experience_years between 0 and 70),
  add column bio text,
  add column research_areas text[] not null default '{}',
  add column methods text[] not null default '{}',
  add column willing_to_review boolean not null default false,
  add column review_interests text[] not null default '{}',
  add column reviews_per_year integer check (reviews_per_year between 0 and 50),
  add column review_experience text, add column scholar_url text;

grant update (salutation, department, city, highest_qualification, experience_years, bio,
              research_areas, methods, willing_to_review, review_interests, reviews_per_year,
              review_experience, scholar_url) on public.profiles to authenticated;

alter table public.submissions
  add column attendance_mode text check (attendance_mode in ('on_site', 'online'));
grant insert (attendance_mode), update (attendance_mode) on public.submissions to authenticated;
