-- Self sign-up with email + password, no confirmation email.
-- New accounts are read_only with zero entity access until an admin grants it (RLS).
create table if not exists public.signup_attempts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);
alter table public.signup_attempts enable row level security;
revoke all on public.signup_attempts from anon, authenticated;

create or replace function public.sign_up(p_email text, p_password text, p_full_name text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  uid uuid := gen_random_uuid();
  e text := lower(trim(p_email));
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  if length(coalesce(p_full_name, '')) > 120 then raise exception 'Name is too long'; end if;
  if (select count(*) from public.signup_attempts where created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many sign-ups right now. Try again later';
  end if;
  insert into public.signup_attempts default values;
  if exists (select 1 from auth.users where lower(email) = e) then
    raise exception 'An account with this email already exists. Sign in instead';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', e,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', nullif(trim(p_full_name), '')),
    now(), now(), '', '', '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, 'email',
    jsonb_build_object('sub', uid::text, 'email', e, 'email_verified', true), now(), now());
  -- No notification emails by default (email delivery is not set up)
  update public.notification_preferences set email = false where user_id = uid;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.sign_up(text, text, text) from public;
grant execute on function public.sign_up(text, text, text) to anon, authenticated;

-- Admin sets a user's password (replaces email-based reset).
create or replace function public.admin_set_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.admin_unlocked() then raise exception 'Unlock Admin Mode first'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user;
  insert into public.administrator_audit_logs (actor_id, action, record_id) values (auth.uid(), 'user.password_reset', p_user::text);
end $$;
revoke execute on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.admin_set_password(uuid, text) to authenticated;

-- Email delivery is off: stop queuing email for everyone and default new users to off.
alter table public.notification_preferences alter column email set default false;
update public.notification_preferences set email = false;
