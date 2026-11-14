-- Authorization helpers, Admin Mode (PIN) RPCs, RLS policies, audit logging.

-- ---------------------------------------------------------------------------
-- New auth user -> user_profiles row (default role read_only, no entity access)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'full_name', null))
  on conflict (id) do nothing;
  insert into public.notification_preferences (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Role helpers (security definer, stable; used by RLS)
-- ---------------------------------------------------------------------------
create or replace function public.current_role_name() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.user_profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.user_profiles where id = auth.uid() and is_active), false)
$$;

-- Admin Mode is unlocked only while a server-side session window is open.
create or replace function public.admin_unlocked() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() and exists (
    select 1 from public.user_sessions s
    where s.user_id = auth.uid()
      and s.admin_expires_at > now()
      and (s.revoked_at is null or s.revoked_at < s.admin_unlocked_at)
  )
$$;

-- Can the current user view records of an entity in a module?
create or replace function public.can_view(p_entity uuid, p_module text default null) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.entity_permissions ep
    join public.user_profiles up on up.id = ep.user_id and up.is_active
    where ep.user_id = auth.uid() and ep.entity_id = p_entity
      and (ep.categories is null or p_module is null or p_module = any (ep.categories))
  )
$$;

create or replace function public.can_view_any(p_entities uuid[], p_module text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from unnest(p_entities) e where public.can_view(e, p_module))
$$;

-- ---------------------------------------------------------------------------
-- Admin PIN
-- ---------------------------------------------------------------------------
create or replace function public.admin_status() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s public.admin_settings;
  sess public.user_sessions;
  fails int;
  locked_until timestamptz;
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
    'can_bootstrap', s.pin_hash is null
        and not exists (select 1 from public.user_profiles where role = 'admin')
        and s.bootstrap_admin_email is not null
        and lower(s.bootstrap_admin_email) = lower((select email from public.user_profiles where id = auth.uid())),
    'unlocked', public.admin_unlocked(),
    'expires_at', case when public.admin_unlocked() then sess.admin_expires_at end,
    'session_minutes', s.admin_session_minutes,
    'locked_until', case when fails >= s.max_pin_attempts then locked_until end,
    'attempts_left', greatest(s.max_pin_attempts - fails, 0)
  );
end $$;

create or replace function public._valid_pin(p text) returns boolean
language sql immutable as $$ select p ~ '^[0-9]{4}$' $$;

-- Initial secure setup: only the email the deployer configured in SQL, only
-- when no admin and no PIN exist yet.
create or replace function public.bootstrap_admin(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.admin_settings;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public._valid_pin(p_pin) then raise exception 'PIN must be exactly 4 digits'; end if;
  if p_pin in ('0000','1111','1234','4321','2222','9999') then raise exception 'Choose a less predictable PIN'; end if;
  select * into s from public.admin_settings where id = 1 for update;
  if s.pin_hash is not null or exists (select 1 from public.user_profiles where role = 'admin') then
    raise exception 'Administrator already configured';
  end if;
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

create or replace function public.verify_admin_pin(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s public.admin_settings;
  st jsonb;
  ok boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then
    insert into public.administrator_audit_logs (actor_id, action) values (auth.uid(), 'admin.pin_denied_not_admin');
    raise exception 'Administrator access is not enabled for this account';
  end if;
  select * into s from public.admin_settings where id = 1;
  if s.pin_hash is null then raise exception 'Administrator PIN has not been configured'; end if;
  st := public.admin_status();
  if st->>'locked_until' is not null then
    raise exception 'Too many incorrect attempts. Try again after %', st->>'locked_until';
  end if;
  ok := public._valid_pin(p_pin) and crypt(p_pin, s.pin_hash) = s.pin_hash;
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

-- Slide the inactivity window forward (only while still unlocked).
create or replace function public.admin_touch() returns jsonb
language plpgsql security definer set search_path = public as $$
declare mins int;
begin
  if not public.admin_unlocked() then return public.admin_status(); end if;
  select admin_session_minutes into mins from public.admin_settings where id = 1;
  update public.user_sessions set last_activity_at = now(),
         admin_expires_at = now() + make_interval(mins => mins)
   where user_id = auth.uid();
  return public.admin_status();
end $$;

create or replace function public.admin_lock() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update public.user_sessions set admin_expires_at = now() where user_id = auth.uid();
  insert into public.administrator_audit_logs (actor_id, action) values (auth.uid(), 'admin.locked');
  return public.admin_status();
end $$;

create or replace function public.change_admin_pin(p_current text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s public.admin_settings;
begin
  if not public.admin_unlocked() then raise exception 'Unlock Admin Mode first'; end if;
  if not public._valid_pin(p_new) then raise exception 'PIN must be exactly 4 digits'; end if;
  if p_new in ('0000','1111','1234','4321','2222','9999') then raise exception 'Choose a less predictable PIN'; end if;
  select * into s from public.admin_settings where id = 1 for update;
  if crypt(p_current, s.pin_hash) <> s.pin_hash then
    insert into public.admin_pin_attempts (user_id, success) values (auth.uid(), false);
    raise exception 'Current PIN is incorrect';
  end if;
  update public.admin_settings set pin_hash = crypt(p_new, gen_salt('bf', 10)), pin_set_at = now() where id = 1;
  insert into public.administrator_audit_logs (actor_id, action) values (auth.uid(), 'admin.pin_changed');
  return jsonb_build_object('ok', true);
end $$;

-- Revoke every admin-mode window (e.g. lost phone).
create or replace function public.revoke_admin_sessions(p_user uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_unlocked() then raise exception 'Unlock Admin Mode first'; end if;
  update public.user_sessions set admin_expires_at = now(), revoked_at = now()
   where p_user is null or user_id = p_user;
  insert into public.administrator_audit_logs (actor_id, action, record_id)
  values (auth.uid(), 'admin.sessions_revoked', p_user::text);
end $$;

-- ---------------------------------------------------------------------------
-- Settings: clients can read safe columns only; writes via RPC.
-- ---------------------------------------------------------------------------
create or replace view public.app_settings with (security_invoker = false) as
  select timezone, reminder_offsets, auto_debit_reminder_hours, overdue_repeat_days,
         admin_session_minutes, max_pin_attempts, lockout_minutes, app_url, pin_set_at
  from public.admin_settings where id = 1 and auth.uid() is not null;

create or replace function public.update_app_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare offs int[];
begin
  if not public.admin_unlocked() then raise exception 'Unlock Admin Mode first'; end if;
  if p ? 'reminder_offsets' then
    select array_agg(distinct v::int order by v::int desc) into offs
      from jsonb_array_elements_text(p->'reminder_offsets') v;
    if offs is null or exists (select 1 from unnest(offs) o where o < 0 or o > 365) then
      raise exception 'Reminder offsets must be between 0 and 365 days';
    end if;
  end if;
  if p ? 'timezone' and not exists (select 1 from pg_timezone_names where name = p->>'timezone') then
    raise exception 'Unknown timezone %', p->>'timezone';
  end if;
  update public.admin_settings set
    timezone = coalesce(p->>'timezone', timezone),
    reminder_offsets = coalesce(offs, reminder_offsets),
    auto_debit_reminder_hours = coalesce((p->>'auto_debit_reminder_hours')::int, auto_debit_reminder_hours),
    overdue_repeat_days = coalesce((p->>'overdue_repeat_days')::int, overdue_repeat_days),
    admin_session_minutes = coalesce((p->>'admin_session_minutes')::int, admin_session_minutes),
    max_pin_attempts = coalesce((p->>'max_pin_attempts')::int, max_pin_attempts),
    lockout_minutes = coalesce((p->>'lockout_minutes')::int, lockout_minutes),
    app_url = coalesce(p->>'app_url', app_url)
  where id = 1;
  insert into public.administrator_audit_logs (actor_id, action, new_data) values (auth.uid(), 'settings.updated', p);
end $$;

-- ---------------------------------------------------------------------------
-- Audit trigger for every data table
-- ---------------------------------------------------------------------------
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.administrator_audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), lower(tg_op), tg_table_name,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id', ''),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.family_entities enable row level security;
alter table public.user_profiles enable row level security;
alter table public.entity_permissions enable row level security;
alter table public.admin_settings enable row level security;
alter table public.user_sessions enable row level security;
alter table public.admin_pin_attempts enable row level security;
alter table public.administrator_audit_logs enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_delivery_logs enable row level security;
alter table public.reminders enable row level security;

-- admin_settings, user_sessions, admin_pin_attempts: no client policies => no direct access.
revoke all on public.admin_settings from anon, authenticated;
revoke all on public.admin_pin_attempts from anon, authenticated;
revoke all on public.user_sessions from anon, authenticated;
grant select on public.app_settings to authenticated;

create policy entities_select on public.family_entities for select to authenticated
  using (public.can_view(id));
create policy entities_write on public.family_entities for all to authenticated
  using (public.admin_unlocked()) with check (public.admin_unlocked());

create policy profiles_select on public.user_profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_admin_write on public.user_profiles for update to authenticated
  using (public.admin_unlocked()) with check (public.admin_unlocked());
-- users may edit their own display name only (role/is_active guarded by trigger)
create policy profiles_self_update on public.user_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.guard_profile_update() returns trigger
language plpgsql as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active
      or new.linked_entity_id is distinct from old.linked_entity_id or new.email is distinct from old.email)
     and not public.admin_unlocked() and current_user in ('authenticated','anon') then
    raise exception 'Only an administrator in Admin Mode can change roles or access';
  end if;
  if old.id = auth.uid() and old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from public.user_profiles where role = 'admin' and is_active) <= 1 then
    raise exception 'Cannot remove the last administrator';
  end if;
  return new;
end $$;
create trigger user_profiles_guard before update on public.user_profiles
  for each row execute function public.guard_profile_update();

create policy perms_select on public.entity_permissions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy perms_write on public.entity_permissions for all to authenticated
  using (public.admin_unlocked()) with check (public.admin_unlocked());

create policy audit_select on public.administrator_audit_logs for select to authenticated
  using (public.is_admin());

create policy prefs_own on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notif_select on public.notifications for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy notif_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Only read_at may change through the API
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy delivery_select on public.notification_delivery_logs for select to authenticated
  using (public.is_admin() or exists (select 1 from public.notifications n
         where n.id = notification_id and n.user_id = auth.uid()));
create policy reminders_select on public.reminders for select to authenticated
  using (public.is_admin());

-- Entity-scoped data tables: view by permission, write only in Admin Mode.
do $$
declare
  r record;
begin
  for r in select * from (values
      ('bank_accounts','banks', 'entity_id'),
      ('investments','investments', 'entity_id'),
      ('insurance_policies','insurance', 'entity_id'),
      ('loans','loans', 'entity_id'),
      ('vehicles','vehicles', 'entity_id'),
      ('tax_compliance','tax', 'entity_id'),
      ('recurring_obligations','obligations', 'entity_id'),
      ('scheduled_transactions','obligations', 'entity_id'),
      ('payments','obligations', 'entity_id'),
      ('documents','documents', 'entity_id')
    ) as t(tbl, module, col)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    if r.tbl in ('investments','loans') then
      execute format($p$create policy %1$s_select on public.%1$I for select to authenticated
        using (public.can_view(entity_id, %2$L) or public.can_view_any(joint_entity_ids, %2$L))$p$, r.tbl, r.module);
    elsif r.tbl = 'documents' then
      execute format($p$create policy %1$s_select on public.%1$I for select to authenticated
        using (public.is_admin() or exists (select 1 from public.entity_permissions ep
               where ep.user_id = auth.uid() and ep.entity_id = documents.entity_id and ep.can_view_documents))$p$, r.tbl);
    else
      execute format($p$create policy %1$s_select on public.%1$I for select to authenticated
        using (public.can_view(entity_id, %2$L))$p$, r.tbl, r.module);
    end if;
    execute format($p$create policy %1$s_write on public.%1$I for all to authenticated
      using (public.admin_unlocked()) with check (public.admin_unlocked())$p$, r.tbl);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I
      for each row execute function public.audit_row()', r.tbl);
  end loop;
end $$;

create trigger family_entities_audit after insert or update or delete on public.family_entities
  for each row execute function public.audit_row();
create trigger entity_permissions_audit after insert or update or delete on public.entity_permissions
  for each row execute function public.audit_row();
create trigger user_profiles_audit after update on public.user_profiles
  for each row execute function public.audit_row();

-- Child tables follow their parent's visibility.
alter table public.investment_transactions enable row level security;
create policy inv_tx_select on public.investment_transactions for select to authenticated
  using (exists (select 1 from public.investments i where i.id = investment_id));
create policy inv_tx_write on public.investment_transactions for all to authenticated
  using (public.admin_unlocked()) with check (public.admin_unlocked());

alter table public.loan_payments enable row level security;
create policy loan_pay_select on public.loan_payments for select to authenticated
  using (exists (select 1 from public.loans l where l.id = loan_id));
create policy loan_pay_write on public.loan_payments for all to authenticated
  using (public.admin_unlocked()) with check (public.admin_unlocked());

alter table public.document_versions enable row level security;
create policy docv_select on public.document_versions for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id));
create policy docv_write on public.document_versions for all to authenticated
  using (public.admin_unlocked()) with check (public.admin_unlocked());

grant execute on function public.admin_status(), public.verify_admin_pin(text), public.admin_touch(),
  public.admin_lock(), public.change_admin_pin(text, text), public.bootstrap_admin(text),
  public.update_app_settings(jsonb), public.revoke_admin_sessions(uuid) to authenticated;
revoke execute on function public.verify_admin_pin(text), public.bootstrap_admin(text) from anon;
