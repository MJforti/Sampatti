-- Allow the designated administrator to be granted the admin role up front
-- (automated setup) and still choose the PIN on first sign-in.
create or replace function public.admin_status() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s public.admin_settings;
  sess public.user_sessions;
  fails int;
  locked_until timestamptz;
  me text := (select lower(email) from public.user_profiles where id = auth.uid());
begin
  select * into s from public.admin_settings where id = 1;
  select * into sess from public.user_sessions where user_id = auth.uid();
  select count(*), max(attempted_at) + make_interval(mins => s.lockout_minutes)
    into fails, locked_until
    from public.admin_pin_attempts
   where user_id = auth.uid() and not success
     and attempted_at > now() - make_interval(mins => s.lockout_minutes)
     and attempted_at > coalesce((select max(attempted_at) from public.admin_pin_attempts
                                   where user_id = auth.uid() and success), '-infinity');
  return jsonb_build_object(
    'is_admin', public.is_admin(),
    'pin_configured', s.pin_hash is not null,
    'can_bootstrap', s.pin_hash is null and s.bootstrap_admin_email is not null and lower(s.bootstrap_admin_email) = me,
    'unlocked', public.admin_unlocked(),
    'expires_at', case when public.admin_unlocked() then sess.admin_expires_at end,
    'session_minutes', s.admin_session_minutes,
    'locked_until', case when fails >= s.max_pin_attempts then locked_until end,
    'attempts_left', greatest(s.max_pin_attempts - fails, 0));
end $$;

create or replace function public.bootstrap_admin(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.admin_settings;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public._valid_pin(p_pin) then raise exception 'PIN must be exactly 4 digits'; end if;
  if p_pin in ('0000','1111','1234','4321','2222','9999') then raise exception 'Choose a less predictable PIN'; end if;
  select * into s from public.admin_settings where id = 1 for update;
  if s.pin_hash is not null then raise exception 'Administrator already configured'; end if;
  if s.bootstrap_admin_email is null
     or lower(s.bootstrap_admin_email) <> lower((select email from public.user_profiles where id = auth.uid())) then
    raise exception 'This account is not the designated bootstrap administrator';
  end if;
  update public.user_profiles set role = 'admin' where id = auth.uid();
  update public.admin_settings set pin_hash = crypt(p_pin, gen_salt('bf', 10)), pin_set_at = now(),
         bootstrap_admin_email = null where id = 1;
  insert into public.administrator_audit_logs (actor_id, action) values (auth.uid(), 'admin.bootstrap');
  return public.admin_status();
end $$;
revoke execute on function public.admin_status(), public.bootstrap_admin(text) from anon, public;
grant execute on function public.admin_status(), public.bootstrap_admin(text) to authenticated;
