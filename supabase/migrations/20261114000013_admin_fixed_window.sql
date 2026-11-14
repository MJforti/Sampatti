-- Admin Mode is a fixed window from unlock (default 10 minutes); activity no longer extends it.
create or replace function public.admin_touch() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.admin_status();
end $$;
