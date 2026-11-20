-- Remember each user's appearance choice on their account (light / dark / system).
alter table public.user_profiles add column theme text not null default 'system' check (theme in ('system','light','dark'));
