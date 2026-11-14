-- Two admin tiers:
--   Ultra admin  = user_profiles.role 'admin' (global, uses admin_settings PIN)
--   Family admin = family_memberships.is_admin for their one family (own PIN in admin_pins)
-- Admin Mode (user_sessions window) applies to both; every write is scoped by can_admin_entity().

alter table public.family_memberships add column is_admin boolean not null default false;

create table public.admin_pins (
  user_id uuid primary key references public.user_profiles (id) on delete cascade,
  pin_hash text not null,
  set_at timestamptz not null default now()
);
alter table public.admin_pins enable row level security;
revoke all on public.admin_pins from anon, authenticated;

create or replace function public.is_ultra() returns boolean
language sql stable security definer set search_path = public as $$ select public.is_admin() $$;

create or replace function public.my_admin_family() returns uuid
language sql stable security definer set search_path = public as $$
  select m.family_id from public.family_memberships m
    join public.user_profiles up on up.id = m.user_id and up.is_active
   where m.user_id = auth.uid() and m.is_admin limit 1
$$;

create or replace function public.can_use_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ultra() or public.my_admin_family() is not null
$$;

create or replace function public.admin_unlocked() returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_use_admin() and exists (
    select 1 from public.user_sessions s
    where s.user_id = auth.uid() and s.admin_expires_at > now()
      and (s.revoked_at is null or s.revoked_at < s.admin_unlocked_at))
$$;

create or replace function public.ultra_unlocked() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ultra() and public.admin_unlocked()
$$;

create or replace function public.can_admin_entity(p_entity uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.admin_unlocked() and (public.is_ultra() or exists (
    select 1 from public.family_entities e where e.id = p_entity and e.family_id = public.my_admin_family()))
$$;

-- ---- Admin status / PINs --------------------------------------------------
create or replace function public.admin_status() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s public.admin_settings;
  sess public.user_sessions;
  fails int;
  locked_until timestamptz;
  me text := (select lower(email) from public.user_profiles where id = auth.uid());
  ultra boolean := public.is_ultra();
  fam uuid := public.my_admin_family();
  pin_ok boolean;
begin
  select * into s from public.admin_settings where id = 1;
  select * into sess from public.user_sessions where user_id = auth.uid();
  select count(*), max(attempted_at) + make_interval(mins => s.lockout_minutes) into fails, locked_until
    from public.admin_pin_attempts
   where user_id = auth.uid() and not success
     and attempted_at > now() - make_interval(mins => s.lockout_minutes)
     and attempted_at > coalesce((select max(attempted_at) from public.admin_pin_attempts where user_id = auth.uid() and success), '-infinity');
  pin_ok := case when ultra then s.pin_hash is not null
                 when fam is not null then exists (select 1 from public.admin_pins where user_id = auth.uid())
                 else false end;
  return jsonb_build_object(
    'is_admin', ultra or fam is not null,
    'is_ultra', ultra,
    'family_id', case when ultra then null else fam end,
    'family_name', (select name from public.families where id = fam),
    'pin_configured', pin_ok,
    'can_bootstrap', (s.pin_hash is null and s.bootstrap_admin_email is not null and lower(s.bootstrap_admin_email) = me)
                     or (not ultra and fam is not null and not pin_ok),
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
  -- Family admin choosing their own PIN for the first time
  if not public.is_ultra() and public.my_admin_family() is not null then
    if exists (select 1 from public.admin_pins where user_id = auth.uid()) then raise exception 'Your admin PIN is already set'; end if;
    insert into public.admin_pins (user_id, pin_hash) values (auth.uid(), crypt(p_pin, gen_salt('bf', 10)));
    insert into public.administrator_audit_logs (actor_id, action) values (auth.uid(), 'admin.family_pin_set');
    return public.admin_status();
  end if;
  select * into s from public.admin_settings where id = 1 for update;
  if s.pin_hash is not null then raise exception 'Administrator already configured'; end if;
  if s.bootstrap_admin_email is null
     or lower(s.bootstrap_admin_email) <> lower((select email from public.user_profiles where id = auth.uid())) then
    raise exception 'This account is not the designated bootstrap administrator';
  end if;
  update public.user_profiles set role = 'admin' where id = auth.uid();
  update public.admin_settings set pin_hash = crypt(p_pin, gen_salt('bf', 10)), pin_set_at = now(), bootstrap_admin_email = null where id = 1;
  insert into public.administrator_audit_logs (actor_id, action) values (auth.uid(), 'admin.bootstrap');
  return public.admin_status();
end $$;

create or replace function public._my_pin_hash() returns text
language sql stable security definer set search_path = public as $$
  select case when public.is_ultra() then (select pin_hash from public.admin_settings where id = 1)
              else (select pin_hash from public.admin_pins where user_id = auth.uid()) end
$$;
revoke execute on function public._my_pin_hash() from public, anon, authenticated;

create or replace function public.verify_admin_pin(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s public.admin_settings;
  h text;
  st jsonb;
  ok boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.can_use_admin() then
    insert into public.administrator_audit_logs (actor_id, action) values (auth.uid(), 'admin.pin_denied_not_admin');
    raise exception 'Administrator access is not enabled for this account';
  end if;
  select * into s from public.admin_settings where id = 1;
  h := public._my_pin_hash();
  if h is null then raise exception 'Administrator PIN has not been set up yet'; end if;
  st := public.admin_status();
  if st->>'locked_until' is not null then raise exception 'Too many incorrect attempts. Try again after %', st->>'locked_until'; end if;
  ok := public._valid_pin(p_pin) and crypt(p_pin, h) = h;
  insert into public.admin_pin_attempts (user_id, success) values (auth.uid(), ok);
  if not ok then
    insert into public.administrator_audit_logs (actor_id, action) values (auth.uid(), 'admin.pin_failed');
    return public.admin_status() || jsonb_build_object('ok', false);
  end if;
  insert into public.user_sessions (user_id, admin_unlocked_at, admin_expires_at, last_activity_at)
  values (auth.uid(), now(), now() + make_interval(mins => s.admin_session_minutes), now())
  on conflict (user_id) do update set admin_unlocked_at = excluded.admin_unlocked_at,
    admin_expires_at = excluded.admin_expires_at, last_activity_at = excluded.last_activity_at;
  insert into public.administrator_audit_logs (actor_id, action) values (auth.uid(), 'admin.unlocked');
  return public.admin_status() || jsonb_build_object('ok', true);
end $$;

create or replace function public.change_admin_pin(p_current text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare h text := public._my_pin_hash();
begin
  if not public.admin_unlocked() then raise exception 'Unlock Admin Mode first'; end if;
  if not public._valid_pin(p_new) then raise exception 'PIN must be exactly 4 digits'; end if;
  if p_new in ('0000','1111','1234','4321','2222','9999') then raise exception 'Choose a less predictable PIN'; end if;
  if h is null or crypt(p_current, h) <> h then
    insert into public.admin_pin_attempts (user_id, success) values (auth.uid(), false);
    raise exception 'Current PIN is incorrect';
  end if;
  if public.is_ultra() then
    update public.admin_settings set pin_hash = crypt(p_new, gen_salt('bf', 10)), pin_set_at = now() where id = 1;
  else
    update public.admin_pins set pin_hash = crypt(p_new, gen_salt('bf', 10)), set_at = now() where user_id = auth.uid();
  end if;
  insert into public.administrator_audit_logs (actor_id, action) values (auth.uid(), 'admin.pin_changed');
  return jsonb_build_object('ok', true);
end $$;

-- ---- Ultra-only actions ----------------------------------------------------
create or replace function public.revoke_admin_sessions(p_user uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ultra_unlocked() then raise exception 'Only the ultra admin can do this'; end if;
  update public.user_sessions set admin_expires_at = now(), revoked_at = now() where p_user is null or user_id = p_user;
  insert into public.administrator_audit_logs (actor_id, action, record_id) values (auth.uid(), 'admin.sessions_revoked', p_user::text);
end $$;

create or replace function public.run_reminders_now() returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.ultra_unlocked() then raise exception 'Only the ultra admin can do this'; end if;
  return public.generate_reminders();
end $$;

create or replace function public.update_app_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare offs int[];
begin
  if not public.ultra_unlocked() then raise exception 'Only the ultra admin can change app settings'; end if;
  if p ? 'reminder_offsets' then
    select array_agg(distinct v::int order by v::int desc) into offs from jsonb_array_elements_text(p->'reminder_offsets') v;
    if offs is null or exists (select 1 from unnest(offs) o where o < 0 or o > 365) then raise exception 'Reminder offsets must be between 0 and 365 days'; end if;
  end if;
  if p ? 'timezone' and not exists (select 1 from pg_timezone_names where name = p->>'timezone') then raise exception 'Unknown timezone %', p->>'timezone'; end if;
  update public.admin_settings set
    timezone = coalesce(p->>'timezone', timezone), reminder_offsets = coalesce(offs, reminder_offsets),
    auto_debit_reminder_hours = coalesce((p->>'auto_debit_reminder_hours')::int, auto_debit_reminder_hours),
    overdue_repeat_days = coalesce((p->>'overdue_repeat_days')::int, overdue_repeat_days),
    admin_session_minutes = coalesce((p->>'admin_session_minutes')::int, admin_session_minutes),
    max_pin_attempts = coalesce((p->>'max_pin_attempts')::int, max_pin_attempts),
    lockout_minutes = coalesce((p->>'lockout_minutes')::int, lockout_minutes),
    app_url = coalesce(p->>'app_url', app_url)
  where id = 1;
  insert into public.administrator_audit_logs (actor_id, action, new_data) values (auth.uid(), 'settings.updated', p);
end $$;

create or replace function public.link_user_profile(p_user uuid, p_entity uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ultra_unlocked() then raise exception 'Only the ultra admin can do this'; end if;
  update public.user_profiles set linked_entity_id = p_entity where id = p_user;
end $$;

create or replace function public.admin_set_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.ultra_unlocked() then raise exception 'Only the ultra admin can reset passwords'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user;
  insert into public.administrator_audit_logs (actor_id, action, record_id) values (auth.uid(), 'user.password_reset', p_user::text);
end $$;

-- Make someone the admin of a family (moves them into it), or remove their admin rights
create or replace function public.set_family_admin(p_user uuid, p_family uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ultra_unlocked() then raise exception 'Only the ultra admin can choose family admins'; end if;
  if p_admin then
    delete from public.family_memberships where user_id = p_user and family_id <> p_family;
    insert into public.family_memberships (user_id, family_id, is_admin) values (p_user, p_family, true)
      on conflict (user_id, family_id) do update set is_admin = true;
    update public.user_profiles set role = 'family_member' where id = p_user and role = 'read_only';
  else
    update public.family_memberships set is_admin = false where user_id = p_user and family_id = p_family;
    update public.user_sessions set admin_expires_at = now() where user_id = p_user;
  end if;
  insert into public.administrator_audit_logs (actor_id, action, table_name, record_id, new_data)
  values (auth.uid(), case when p_admin then 'family.admin_added' else 'family.admin_removed' end, 'families', p_family::text,
          jsonb_build_object('user', (select coalesce(full_name, email) from public.user_profiles where id = p_user),
                             'name', (select name from public.families where id = p_family)));
end $$;
revoke execute on function public.set_family_admin(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_family_admin(uuid, uuid, boolean) to authenticated;

-- ---- Scoped record actions ---------------------------------------------------
create or replace function public.delete_entity(p_entity uuid, p_confirm_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.family_entities; banks uuid[]; vehs uuid[]; docs uuid[];
begin
  if not public.can_admin_entity(p_entity) then raise exception 'You can only remove profiles in your own family'; end if;
  select * into e from public.family_entities where id = p_entity;
  if e.id is null then raise exception 'Profile not found'; end if;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(e.name)) then raise exception 'Type the profile name exactly to confirm'; end if;
  select coalesce(array_agg(id), '{}') into banks from public.bank_accounts where entity_id = p_entity;
  select coalesce(array_agg(id), '{}') into vehs from public.vehicles where entity_id = p_entity;
  select coalesce(array_agg(id), '{}') into docs from public.documents where entity_id = p_entity;
  update public.payments set receipt_document_id = null where receipt_document_id = any (docs);
  update public.payments set bank_account_id = null where bank_account_id = any (banks);
  update public.investments set bank_account_id = null where bank_account_id = any (banks);
  update public.insurance_policies set bank_account_id = null where bank_account_id = any (banks);
  update public.loans set bank_account_id = null where bank_account_id = any (banks);
  update public.recurring_obligations set bank_account_id = null where bank_account_id = any (banks);
  update public.insurance_policies set vehicle_id = null where vehicle_id = any (vehs);
  update public.loans set vehicle_id = null where vehicle_id = any (vehs);
  update public.investments set joint_entity_ids = array_remove(joint_entity_ids, p_entity) where p_entity = any (joint_entity_ids);
  update public.loans set joint_entity_ids = array_remove(joint_entity_ids, p_entity) where p_entity = any (joint_entity_ids);
  delete from public.payments where entity_id = p_entity;
  delete from public.scheduled_transactions where entity_id = p_entity;
  delete from public.documents where entity_id = p_entity;
  delete from public.tax_compliance where entity_id = p_entity;
  delete from public.insurance_policies where entity_id = p_entity;
  delete from public.loans where entity_id = p_entity;
  delete from public.investments where entity_id = p_entity;
  delete from public.vehicles where entity_id = p_entity;
  delete from public.recurring_obligations where entity_id = p_entity;
  delete from public.bank_accounts where entity_id = p_entity;
  delete from public.family_entities where id = p_entity;
  insert into public.administrator_audit_logs (actor_id, action, table_name, record_id, old_data)
  values (auth.uid(), 'entity.deleted', 'family_entities', p_entity::text, to_jsonb(e));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.set_member_emoji(p_entity uuid, p_emoji text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.can_admin_entity(p_entity) or exists (select 1 from public.user_profiles where id = auth.uid() and linked_entity_id = p_entity)) then
    raise exception 'You can only choose the emoji for your own profile';
  end if;
  update public.family_entities set emoji = nullif(trim(p_emoji), '') where id = p_entity;
end $$;

create or replace function public.regenerate_family_code(p_family uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not (public.ultra_unlocked() or (public.admin_unlocked() and public.my_admin_family() = p_family)) then
    raise exception 'You can only change your own family’s code';
  end if;
  update public.families set access_code = public.new_family_code() where id = p_family returning access_code into c;
  return c;
end $$;

create or replace function public.family_codes() returns table (id uuid, access_code text)
language sql stable security definer set search_path = public as $$
  select id, access_code from public.families where public.is_ultra() or id = public.my_admin_family()
$$;

-- resolve_transaction: scope check (rest unchanged)
do $$
declare src text;
begin
  select pg_get_functiondef('public.resolve_transaction(uuid, public.txn_status, date, bigint, text, uuid, text, date)'::regprocedure) into src;
  src := replace(src, 'if not public.admin_unlocked() then raise exception ''Unlock Admin Mode first''; end if;
  select * into st from public.scheduled_transactions where id = p_id for update;
  if st.id is null then raise exception ''Not found''; end if;',
  'select * into st from public.scheduled_transactions where id = p_id for update;
  if st.id is null then raise exception ''Not found''; end if;
  if not public.can_admin_entity(st.entity_id) then raise exception ''Unlock Admin Mode first''; end if;');
  if position('can_admin_entity' in src) = 0 then raise exception 'resolve_transaction patch failed'; end if;
  execute src;
end $$;

create or replace function public.guard_profile_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active
      or new.linked_entity_id is distinct from old.linked_entity_id or new.email is distinct from old.email)
     and not public.ultra_unlocked() and current_user in ('authenticated','anon') then
    raise exception 'Only the ultra admin can change roles or access';
  end if;
  if old.id = auth.uid() and old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from public.user_profiles where role = 'admin' and is_active) <= 1 then
    raise exception 'Cannot remove the last ultra admin';
  end if;
  return new;
end $$;

-- ---- RLS write policies ------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['bank_accounts','investments','insurance_policies','loans','vehicles','tax_compliance',
                           'recurring_obligations','scheduled_transactions','payments','documents'] loop
    execute format('drop policy if exists %1$s_write on public.%1$I', t);
    execute format('create policy %1$s_write on public.%1$I for all to authenticated
      using (public.can_admin_entity(entity_id)) with check (public.can_admin_entity(entity_id))', t);
  end loop;
end $$;

drop policy if exists entities_write on public.family_entities;
create policy entities_insert on public.family_entities for insert to authenticated
  with check (public.ultra_unlocked() or (public.admin_unlocked() and family_id = public.my_admin_family()));
create policy entities_update on public.family_entities for update to authenticated
  using (public.can_admin_entity(id))
  with check (public.ultra_unlocked() or (public.admin_unlocked() and family_id = public.my_admin_family()));
create policy entities_delete on public.family_entities for delete to authenticated using (public.can_admin_entity(id));

drop policy if exists inv_tx_write on public.investment_transactions;
create policy inv_tx_write on public.investment_transactions for all to authenticated
  using (exists (select 1 from public.investments i where i.id = investment_id and public.can_admin_entity(i.entity_id)))
  with check (exists (select 1 from public.investments i where i.id = investment_id and public.can_admin_entity(i.entity_id)));
drop policy if exists loan_pay_write on public.loan_payments;
create policy loan_pay_write on public.loan_payments for all to authenticated
  using (exists (select 1 from public.loans l where l.id = loan_id and public.can_admin_entity(l.entity_id)))
  with check (exists (select 1 from public.loans l where l.id = loan_id and public.can_admin_entity(l.entity_id)));
drop policy if exists docv_write on public.document_versions;
create policy docv_write on public.document_versions for all to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and public.can_admin_entity(d.entity_id)))
  with check (exists (select 1 from public.documents d where d.id = document_id and public.can_admin_entity(d.entity_id)));

drop policy if exists perms_write on public.entity_permissions;
create policy perms_write on public.entity_permissions for all to authenticated
  using (public.ultra_unlocked()) with check (public.ultra_unlocked());
drop policy if exists profiles_admin_write on public.user_profiles;
create policy profiles_admin_write on public.user_profiles for update to authenticated
  using (public.ultra_unlocked()) with check (public.ultra_unlocked());

drop policy if exists families_write on public.families;
create policy families_ultra on public.families for all to authenticated
  using (public.ultra_unlocked()) with check (public.ultra_unlocked());
create policy families_own_update on public.families for update to authenticated
  using (public.admin_unlocked() and id = public.my_admin_family())
  with check (public.admin_unlocked() and id = public.my_admin_family());

drop policy if exists memberships_write on public.family_memberships;
create policy memberships_ultra on public.family_memberships for all to authenticated
  using (public.ultra_unlocked()) with check (public.ultra_unlocked());
create policy memberships_leave on public.family_memberships for delete to authenticated
  using (user_id = auth.uid() or (public.admin_unlocked() and family_id = public.my_admin_family() and not is_admin));
-- family admins can see who is in their family
drop policy if exists memberships_select on public.family_memberships;
create policy memberships_select on public.family_memberships for select to authenticated
  using (user_id = auth.uid() or public.is_ultra() or family_id = public.my_admin_family());

grant execute on function public.is_ultra(), public.my_admin_family(), public.can_use_admin(), public.ultra_unlocked(),
  public.can_admin_entity(uuid) to authenticated;
