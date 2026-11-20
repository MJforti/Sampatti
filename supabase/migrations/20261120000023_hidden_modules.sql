-- Loans and insurance are hidden by default; each person can turn them on in Settings.
alter table public.user_profiles
  add column if not exists hidden_modules text[] not null default '{loans,insurance}'
  check (hidden_modules <@ array['loans','insurance']::text[]);

-- No reminders for modules a person has hidden.
create or replace function public.trg_skip_hidden_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.data ? 'category' and exists (
       select 1 from public.user_profiles up
        where up.id = new.user_id and public.category_module(new.data->>'category') = any (up.hidden_modules)) then
    return null;
  end if;
  return new;
end $$;
revoke execute on function public.trg_skip_hidden_notifications() from public, anon, authenticated;

drop trigger if exists notifications_skip_hidden on public.notifications;
create trigger notifications_skip_hidden before insert on public.notifications
  for each row execute function public.trg_skip_hidden_notifications();
