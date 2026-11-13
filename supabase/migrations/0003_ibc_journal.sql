-- Applied 13 Nov 2026. Journal article types and teaching notes for Indian Business Chronicles (IBC),
-- plus the standing IBC call with three tracks: RES (research), TC (teaching cases), GC (graphic cases).
alter type public.article_type add value if not exists 'research_note';
alter type public.article_type add value if not exists 'perspective';
alter type public.article_type add value if not exists 'graphic_case';
alter type public.file_kind add value if not exists 'teaching_note';

-- submit_submission() now also requires a teaching note for journal cases
-- (case_study, short_case, graphic_case in any venue that is not a conference).
-- See the Supabase migration "ibc_call_and_teaching_note_rule" for the full function text.

-- The IBC venue (type journal_issue, status open, no closing date) and its tracks were inserted as data:
--   RES Research articles · TC Teaching cases · GC Graphic teaching cases
-- Paper IDs follow the usual pattern: IBC-RES-001, IBC-TC-001, IBC-GC-001.
