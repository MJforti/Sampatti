-- Unsaved form progress, synced across a person's devices. Private to each person.
create table if not exists public.form_drafts (
  user_id uuid not null references public.user_profiles(id) on delete cascade default auth.uid(),
  form_key text not null check (length(form_key) between 1 and 200),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, form_key)
);
alter table public.form_drafts enable row level security;
drop policy if exists form_drafts_own on public.form_drafts;
create policy form_drafts_own on public.form_drafts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.form_drafts to authenticated;
revoke all on public.form_drafts from anon;
