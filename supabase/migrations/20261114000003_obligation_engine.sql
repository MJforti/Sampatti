-- Obligation engine: source-record sync, status refresh, mark-paid, recurrence,
-- reminder generation and notification fan-out. All server-side.

create or replace function public.app_today() returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone (select timezone from public.admin_settings where id = 1))::date
$$;

-- Advance a date by one period, keeping the anchor day (31st -> 30th/28th, then back to 31st).
create or replace function public.add_period(d date, f public.frequency, anchor int default null) returns date
language plpgsql immutable as $$
declare
  months int;
  base date;
  last_day int;
  a int := coalesce(anchor, extract(day from d)::int);
begin
  if f = 'once' then return null; end if;
  if f = 'weekly' then return d + 7; end if;
  months := case f when 'monthly' then 1 when 'quarterly' then 3 when 'half_yearly' then 6 when 'yearly' then 12 end;
  base := (date_trunc('month', d) + make_interval(months => months))::date;
  last_day := extract(day from (base + interval '1 month' - interval '1 day'))::int;
  return base + (least(a, last_day) - 1);
end $$;

-- Initial status for an open instance as of today.
create or replace function public.open_status(p_due date, p_auto boolean) returns public.txn_status
language sql stable as $$
  select case
    when p_due < public.app_today() then (case when p_auto then 'awaiting_confirmation' else 'overdue' end)::public.txn_status
    when p_due = public.app_today() then (case when p_auto then 'auto_debit_scheduled' else 'due_today' end)::public.txn_status
    when p_auto then 'auto_debit_scheduled'::public.txn_status
    else 'upcoming'::public.txn_status end
$$;

-- Create/update the obligation that mirrors a date field on a source record,
-- and keep exactly one open instance in sync with it.
create or replace function public.sync_source_obligation(
  p_source_type text, p_source_id uuid, p_field text, p_entity uuid, p_title text, p_category text,
  p_amount bigint, p_due date, p_freq public.frequency, p_bank uuid, p_auto boolean, p_active boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  ob_id uuid;
  open_id uuid;
begin
  if p_due is null or not p_active then
    update public.recurring_obligations set is_active = false
     where source_type = p_source_type and source_id = p_source_id and source_field = p_field
     returning id into ob_id;
    if ob_id is not null then
      update public.scheduled_transactions set status = 'cancelled', resolved_at = now(),
             notes = coalesce(notes || E'\n', '') || 'Cancelled: source date cleared or record archived'
       where obligation_id = ob_id and status not in ('paid','cancelled','renewed');
    end if;
    return;
  end if;

  insert into public.recurring_obligations as ro
    (entity_id, title, category, amount_paise, frequency, anchor_day, next_due_date, bank_account_id,
     auto_debit, source_type, source_id, source_field, is_active)
  values (p_entity, p_title, p_category, p_amount, p_freq, extract(day from p_due)::int, p_due, p_bank,
          coalesce(p_auto, false), p_source_type, p_source_id, p_field, true)
  on conflict (source_type, source_id, source_field) where source_type is not null do update set
    entity_id = excluded.entity_id, title = excluded.title, category = excluded.category,
    amount_paise = excluded.amount_paise, frequency = excluded.frequency,
    anchor_day = case when ro.next_due_date is distinct from excluded.next_due_date
                      then excluded.anchor_day else ro.anchor_day end,
    next_due_date = excluded.next_due_date, bank_account_id = excluded.bank_account_id,
    auto_debit = excluded.auto_debit, is_active = true
  returning id into ob_id;

  select id into open_id from public.scheduled_transactions
   where obligation_id = ob_id and status not in ('paid','cancelled','renewed');

  if open_id is null then
    insert into public.scheduled_transactions (obligation_id, entity_id, due_date, amount_paise, status)
    values (ob_id, p_entity, p_due, p_amount, public.open_status(p_due, coalesce(p_auto,false)))
    on conflict (obligation_id, due_date) do nothing;
  else
    update public.scheduled_transactions set due_date = p_due, amount_paise = p_amount, entity_id = p_entity,
           status = case when status in ('upcoming','due_today','overdue','auto_debit_scheduled','awaiting_confirmation')
                         then public.open_status(p_due, coalesce(p_auto,false)) else status end
     where id = open_id and (due_date <> p_due or amount_paise is distinct from p_amount or entity_id <> p_entity);
  end if;
end $$;

-- Custom obligations (no source): keep their open instance in sync too.
create or replace function public.trg_custom_obligation() returns trigger
language plpgsql security definer set search_path = public as $$
declare open_id uuid;
begin
  if new.source_type is not null then return new; end if;
  if not new.is_active or new.next_due_date is null then
    update public.scheduled_transactions set status = 'cancelled', resolved_at = now()
     where obligation_id = new.id and status not in ('paid','cancelled','renewed');
    return new;
  end if;
  select id into open_id from public.scheduled_transactions
   where obligation_id = new.id and status not in ('paid','cancelled','renewed');
  if open_id is null then
    insert into public.scheduled_transactions (obligation_id, entity_id, due_date, amount_paise, status)
    values (new.id, new.entity_id, new.next_due_date, new.amount_paise, public.open_status(new.next_due_date, new.auto_debit))
    on conflict (obligation_id, due_date) do nothing;
  else
    update public.scheduled_transactions set due_date = new.next_due_date, amount_paise = new.amount_paise,
           entity_id = new.entity_id, status = public.open_status(new.next_due_date, new.auto_debit)
     where id = open_id;
  end if;
  return new;
end $$;
create trigger recurring_obligations_custom_sync after insert or update on public.recurring_obligations
  for each row execute function public.trg_custom_obligation();

-- ---- Source triggers ------------------------------------------------------
create or replace function public.trg_insurance_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  active boolean := new.archived_at is null and new.status = 'active';
  label text := coalesce(nullif(new.policy_name,''), new.insurer) || coalesce(' · ' || new.policy_number, '');
begin
  perform public.sync_source_obligation('insurance_policies', new.id, 'next_premium_date', new.entity_id,
    'Insurance premium — ' || label, 'insurance_premium', new.premium_paise, new.next_premium_date,
    coalesce(new.premium_frequency, 'yearly'), new.bank_account_id, new.auto_debit, active);
  perform public.sync_source_obligation('insurance_policies', new.id, 'expiry_date', new.entity_id,
    'Policy renewal — ' || label,
    case when new.category in ('health','vehicle','property','business','personal_accident') then 'insurance_renewal' else 'insurance_renewal' end,
    case when new.next_premium_date is null then new.premium_paise end, new.expiry_date, 'once', new.bank_account_id, false, active);
  perform public.sync_source_obligation('insurance_policies', new.id, 'maturity_date', new.entity_id,
    'Policy maturity — ' || label, 'investment_maturity', null, new.maturity_date, 'once', new.bank_account_id, false, active);
  return new;
end $$;
create trigger insurance_sync after insert or update on public.insurance_policies
  for each row execute function public.trg_insurance_sync();

create or replace function public.trg_loan_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_source_obligation('loans', new.id, 'next_emi_date', new.entity_id,
    'EMI — ' || new.lender || ' ' || initcap(new.loan_type) || ' loan', 'loan_emi', new.emi_paise,
    new.next_emi_date, 'monthly', new.bank_account_id, true,
    new.archived_at is null and new.outstanding_paise > 0);
  return new;
end $$;
create trigger loan_sync after insert or update on public.loans
  for each row execute function public.trg_loan_sync();

create or replace function public.trg_investment_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare active boolean := new.archived_at is null;
begin
  perform public.sync_source_obligation('investments', new.id, 'next_sip_date', new.entity_id,
    case when new.category = 'recurring_deposit' then 'RD instalment — ' else 'SIP — ' end || new.name,
    case when new.category = 'recurring_deposit' then 'recurring_deposit' else 'sip' end,
    new.sip_amount_paise, new.next_sip_date, coalesce(new.sip_frequency, 'monthly'), new.bank_account_id, true, active);
  perform public.sync_source_obligation('investments', new.id, 'maturity_date', new.entity_id,
    'Maturity — ' || new.name || coalesce(' (' || new.institution || ')', ''),
    case when new.category = 'fixed_deposit' then 'fd_maturity' else 'investment_maturity' end,
    new.maturity_amount_paise, new.maturity_date, 'once', new.bank_account_id, false, active);
  return new;
end $$;
create trigger investment_sync after insert or update on public.investments
  for each row execute function public.trg_investment_sync();

create or replace function public.trg_vehicle_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  active boolean := new.archived_at is null;
  r text := new.registration_number;
begin
  perform public.sync_source_obligation('vehicles', new.id, 'puc_expiry', new.entity_id, 'PUC expiry — ' || r, 'vehicle_puc', null, new.puc_expiry, 'once', null, false, active);
  perform public.sync_source_obligation('vehicles', new.id, 'insurance_expiry', new.entity_id, 'Vehicle insurance expiry — ' || r, 'vehicle_insurance', null, new.insurance_expiry, 'once', null, false, active);
  perform public.sync_source_obligation('vehicles', new.id, 'road_tax_expiry', new.entity_id, 'Road tax due — ' || r, 'vehicle_road_tax', null, new.road_tax_expiry, 'once', null, false, active);
  perform public.sync_source_obligation('vehicles', new.id, 'fitness_expiry', new.entity_id, 'Fitness certificate expiry — ' || r, 'vehicle_fitness', null, new.fitness_expiry, 'once', null, false, active);
  perform public.sync_source_obligation('vehicles', new.id, 'registration_expiry', new.entity_id, 'Registration renewal — ' || r, 'vehicle_registration', null, new.registration_expiry, 'once', null, false, active);
  perform public.sync_source_obligation('vehicles', new.id, 'permit_expiry', new.entity_id, 'Permit renewal — ' || r, 'vehicle_permit', null, new.permit_expiry, 'once', null, false, active);
  perform public.sync_source_obligation('vehicles', new.id, 'next_service_date', new.entity_id, 'Scheduled service — ' || r, 'vehicle_service', null, new.next_service_date, 'once', null, false, active);
  return new;
end $$;
create trigger vehicle_sync after insert or update on public.vehicles
  for each row execute function public.trg_vehicle_sync();

create or replace function public.trg_tax_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_source_obligation('tax_compliance', new.id, 'due_date', new.entity_id,
    new.title || coalesce(' — ' || new.period_label, ''), new.compliance_type, new.amount_paise,
    new.due_date, new.frequency, null, false, new.archived_at is null);
  return new;
end $$;
create trigger tax_sync after insert or update on public.tax_compliance
  for each row execute function public.trg_tax_sync();

create or replace function public.trg_document_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_source_obligation('documents', new.id, 'expiry_date', new.entity_id,
    'Document expiry — ' || new.title, 'document_expiry', null, new.expiry_date, 'once', null, false,
    new.archived_at is null);
  return new;
end $$;
create trigger document_sync after insert or update on public.documents
  for each row execute function public.trg_document_sync();

-- Archiving/deleting a source record removes its obligations.
create or replace function public.trg_source_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.recurring_obligations where source_type = tg_table_name and source_id = old.id;
  return old;
end $$;
do $$
declare t text;
begin
  foreach t in array array['insurance_policies','loans','investments','vehicles','tax_compliance','documents'] loop
    execute format('create trigger %1$s_obl_delete before delete on public.%1$I for each row execute function public.trg_source_delete()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Status maintenance (cron). Never marks anything paid.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_transaction_statuses() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.scheduled_transactions st set status = public.open_status(st.due_date, ro.auto_debit)
    from public.recurring_obligations ro
   where ro.id = st.obligation_id
     and st.status in ('upcoming','due_today','overdue','auto_debit_scheduled')
     and st.status <> public.open_status(st.due_date, ro.auto_debit);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Resolve an instance: paid / renewed / cancelled / awaiting confirmation.
-- Generates the next recurring instance and advances the source record.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_transaction(
  p_id uuid, p_status public.txn_status, p_paid_on date default null, p_amount bigint default null,
  p_notes text default null, p_receipt uuid default null, p_reference text default null,
  p_next_due date default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st public.scheduled_transactions;
  ob public.recurring_obligations;
  nxt date;
  pay_id uuid;
  new_id uuid;
begin
  if not public.admin_unlocked() then raise exception 'Unlock Admin Mode first'; end if;
  select * into st from public.scheduled_transactions where id = p_id for update;
  if st.id is null then raise exception 'Not found'; end if;
  select * into ob from public.recurring_obligations where id = st.obligation_id for update;

  if p_status = 'awaiting_confirmation' or p_status = 'auto_debit_scheduled' then
    update public.scheduled_transactions set status = p_status, notes = coalesce(p_notes, notes) where id = p_id;
    return jsonb_build_object('id', p_id, 'status', p_status);
  end if;
  if p_status not in ('paid','renewed','cancelled') then
    raise exception 'Unsupported status %', p_status;
  end if;
  if st.status in ('paid','renewed','cancelled') then raise exception 'Already resolved'; end if;

  if p_status = 'paid' then
    if p_paid_on is null or p_amount is null then raise exception 'Payment date and amount are required'; end if;
    if p_paid_on > public.app_today() then raise exception 'Payment date cannot be in the future'; end if;
    insert into public.payments (scheduled_transaction_id, entity_id, paid_on, amount_paise, bank_account_id,
                                 reference, notes, receipt_document_id, recorded_by)
    values (st.id, st.entity_id, p_paid_on, p_amount, ob.bank_account_id, p_reference, p_notes, p_receipt, auth.uid())
    returning id into pay_id;
    if ob.source_type = 'loans' then
      insert into public.loan_payments (loan_id, paid_on, amount_paise, notes)
      values (ob.source_id, p_paid_on, p_amount, 'Recorded via EMI ' || st.due_date);
    end if;
  end if;

  update public.scheduled_transactions set status = p_status, resolved_at = now(),
         notes = coalesce(p_notes, notes) where id = p_id;

  -- Next cycle
  nxt := coalesce(p_next_due, public.add_period(st.due_date, ob.frequency, ob.anchor_day));
  if p_status = 'cancelled' and p_next_due is null then nxt := case when ob.frequency = 'once' then null else nxt end; end if;
  if nxt is not null and (ob.end_date is null or nxt <= ob.end_date) and ob.is_active then
    if ob.source_type is null then
      update public.recurring_obligations set next_due_date = nxt where id = ob.id;  -- trigger creates instance
    else
      update public.recurring_obligations set next_due_date = nxt where id = ob.id;
      -- advance the source record's date; its trigger is idempotent with the instance below
      execute format('update public.%I set %I = $1 where id = $2', ob.source_type, ob.source_field)
        using nxt, ob.source_id;
      insert into public.scheduled_transactions (obligation_id, entity_id, due_date, amount_paise, status)
      values (ob.id, st.entity_id, nxt, ob.amount_paise, public.open_status(nxt, ob.auto_debit))
      on conflict do nothing;
    end if;
    select id into new_id from public.scheduled_transactions
     where obligation_id = ob.id and status not in ('paid','cancelled','renewed');
  elsif ob.frequency = 'once' and ob.source_type is null then
    update public.recurring_obligations set next_due_date = null where id = ob.id;
  end if;

  return jsonb_build_object('id', p_id, 'status', p_status, 'payment_id', pay_id,
                            'next_transaction_id', new_id, 'next_due_date', nxt);
end $$;
grant execute on function public.resolve_transaction(uuid, public.txn_status, date, bigint, text, uuid, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Reminder engine
-- ---------------------------------------------------------------------------
create or replace function public.format_inr(p bigint) returns text
language plpgsql immutable as $$
declare
  rupees bigint := abs(p) / 100;
  paise int := (abs(p) % 100)::int;
  s text := rupees::text;
  head text; tail text; out text;
begin
  if p is null then return null; end if;
  if length(s) > 3 then
    tail := right(s, 3); head := left(s, length(s) - 3);
    head := regexp_replace(head, '(\d)(?=(\d\d)+$)', '\1,', 'g');
    s := head || ',' || tail;
  end if;
  out := '₹' || s || case when paise > 0 then '.' || lpad(paise::text, 2, '0') else '' end;
  return case when p < 0 then '-' || out else out end;
end $$;

create or replace function public.category_label(c text) returns text
language sql immutable as $$
  select case c
    when 'insurance_premium' then 'Insurance premium' when 'insurance_renewal' then 'Insurance renewal'
    when 'sip' then 'SIP' when 'loan_emi' then 'Loan EMI' when 'recurring_deposit' then 'Recurring deposit'
    when 'fd_maturity' then 'FD maturity' when 'investment_maturity' then 'Investment maturity'
    when 'interest_receipt' then 'Interest / dividend'
    when 'vehicle_puc' then 'Vehicle PUC' when 'vehicle_insurance' then 'Vehicle insurance'
    when 'vehicle_road_tax' then 'Road tax' when 'vehicle_fitness' then 'Fitness certificate'
    when 'vehicle_registration' then 'Registration' when 'vehicle_permit' then 'Permit'
    when 'vehicle_service' then 'Vehicle service'
    when 'tax_gst' then 'GST return' when 'tax_tds_return' then 'TDS return' when 'tax_tds_payment' then 'TDS payment'
    when 'tax_itr' then 'Income tax return' when 'tax_advance' then 'Advance tax' when 'tax_audit' then 'Tax audit'
    when 'compliance_other' then 'Compliance' when 'document_expiry' then 'Document expiry'
    when 'recurring_payment' then 'Recurring payment' else 'Custom' end
$$;

-- Module name used by entity_permissions for a category.
create or replace function public.category_module(c text) returns text
language sql immutable as $$
  select case
    when c like 'insurance_%' then 'insurance'
    when c in ('sip','recurring_deposit','fd_maturity','investment_maturity','interest_receipt') then 'investments'
    when c = 'loan_emi' then 'loans'
    when c like 'vehicle_%' then 'vehicles'
    when c like 'tax_%' or c = 'compliance_other' then 'tax'
    when c = 'document_expiry' then 'documents'
    else 'obligations' end
$$;

-- Runs from cron (hourly is fine; idempotent). Returns number of reminders fired.
create or replace function public.generate_reminders(p_today date default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  s public.admin_settings;
  today date;
  r record;
  offs int[];
  chosen int;
  rem_id uuid;
  n_id uuid;
  fired int := 0;
  days int;
  title text;
  body text;
  u record;
  ent_name text;
  bank text;
begin
  select * into s from public.admin_settings where id = 1;
  today := coalesce(p_today, public.app_today());
  perform public.refresh_transaction_statuses();

  for r in
    select st.*, ro.title as ob_title, ro.category, ro.auto_debit, ro.reminder_offsets, ro.instructions,
           ro.bank_account_id, ro.source_type, ro.source_id
      from public.scheduled_transactions st
      join public.recurring_obligations ro on ro.id = st.obligation_id and ro.is_active
      join public.family_entities fe on fe.id = st.entity_id and fe.is_active
     where st.status not in ('paid','cancelled','renewed')
  loop
    days := r.due_date - today;
    offs := coalesce(r.reminder_offsets, s.reminder_offsets);
    if r.auto_debit then
      offs := offs || greatest(ceil(s.auto_debit_reminder_hours / 24.0)::int, 1);
    end if;
    chosen := null;

    if days >= 0 then
      -- the tightest offset already reached (catch-up safe; one reminder per window)
      select min(o) into chosen from unnest(offs) o where o >= days;
      if chosen is null then continue; end if;
      if exists (select 1 from public.reminders x where x.scheduled_transaction_id = r.id
                  and x.due_date = r.due_date and x.offset_days <= chosen and x.offset_days >= 0) then
        continue;
      end if;
    else
      -- overdue: repeat every N days until resolved
      if ((-days) % s.overdue_repeat_days) <> 0 and exists (
         select 1 from public.reminders x where x.scheduled_transaction_id = r.id and x.due_date = r.due_date and x.offset_days < 0) then
        continue;
      end if;
      chosen := days;
    end if;

    insert into public.reminders (scheduled_transaction_id, due_date, offset_days, fired_on)
    values (r.id, r.due_date, chosen, today)
    on conflict do nothing
    returning id into rem_id;
    if rem_id is null then continue; end if;
    fired := fired + 1;

    select name into ent_name from public.family_entities where id = r.entity_id;
    select b.bank_name || coalesce(' ••' || b.account_last4, '') into bank
      from public.bank_accounts b where b.id = r.bank_account_id;

    title := case
      when days < 0 then (case when r.auto_debit then 'Confirm auto-debit: ' else 'Overdue: ' end) || r.ob_title
      when days = 0 then 'Due today: ' || r.ob_title
      when days = 1 then 'Due tomorrow: ' || r.ob_title
      else public.category_label(r.category) || ' due in ' || days || ' days' end;
    body := ent_name
      || coalesce(E'\nAmount: ' || public.format_inr(r.amount_paise), '')
      || E'\nDue: ' || to_char(r.due_date, 'FMDD Mon YYYY')
      || E'\n' || case when days < 0 then 'Overdue by ' || (-days) || ' day' || case when days = -1 then '' else 's' end
                       when days = 0 then 'Due today' else 'Remaining: ' || days || ' day' || case when days = 1 then '' else 's' end end
      || coalesce(E'\nBank: ' || bank, '')
      || E'\nStatus: ' || initcap(replace(r.status::text, '_', ' '))
      || coalesce(E'\n' || r.instructions, '');

    for u in
      select up.id, coalesce(np.in_app, true) in_app, coalesce(np.email, true) email, coalesce(np.push, true) push
        from public.user_profiles up
        left join public.notification_preferences np on np.user_id = up.id
       where up.is_active
         and not (public.category_module(r.category) = any (coalesce(np.muted_categories, '{}')))
         and (up.role = 'admin' or exists (
               select 1 from public.entity_permissions ep
                where ep.user_id = up.id and ep.entity_id = r.entity_id and ep.receive_notifications
                  and (ep.categories is null or public.category_module(r.category) = any (ep.categories))))
    loop
      insert into public.notifications (user_id, reminder_id, scheduled_transaction_id, title, body, data)
      values (u.id, rem_id, r.id, title, body, jsonb_build_object(
        'url', '/tx/' || r.id, 'due_date', r.due_date, 'days', days, 'amount_paise', r.amount_paise,
        'entity', ent_name, 'category', r.category, 'bank', bank, 'status', r.status))
      on conflict do nothing
      returning id into n_id;
      if n_id is null then continue; end if;
      insert into public.notification_delivery_logs (notification_id, channel, status, sent_at)
        values (n_id, 'in_app', 'sent', now());
      if u.email then
        insert into public.notification_delivery_logs (notification_id, channel) values (n_id, 'email');
      end if;
      if u.push then
        insert into public.notification_delivery_logs (notification_id, channel, status)
        values (n_id, 'push', case when exists (select 1 from public.push_subscriptions ps where ps.user_id = u.id)
                                   then 'pending' else 'skipped' end);
      end if;
    end loop;
  end loop;
  return fired;
end $$;
revoke execute on function public.generate_reminders(date) from public, anon, authenticated;
revoke execute on function public.refresh_transaction_statuses() from public, anon, authenticated;
revoke execute on function public.sync_source_obligation(text, uuid, text, uuid, text, text, bigint, date, public.frequency, uuid, boolean, boolean) from public, anon, authenticated;

-- Admin can trigger a run manually (e.g. after bulk data entry).
create or replace function public.run_reminders_now() returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_unlocked() then raise exception 'Unlock Admin Mode first'; end if;
  return public.generate_reminders();
end $$;
grant execute on function public.run_reminders_now() to authenticated;

-- Atomically claim pending deliveries for the dispatcher (service role only).
create or replace function public.claim_deliveries(p_limit int default 100) returns table (
  log_id uuid, channel text, notification_id uuid, user_id uuid, email text, title text, body text, data jsonb, attempts int)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with c as (
    select l.id from public.notification_delivery_logs l
     where l.channel in ('email','push','whatsapp')
       and (l.status = 'pending'
            or (l.status = 'failed' and l.attempts < 5
                and l.updated_at < now() - make_interval(mins => 5 * l.attempts))
            or (l.status = 'sending' and l.updated_at < now() - interval '15 minutes'))
     order by l.created_at limit p_limit
     for update skip locked)
  update public.notification_delivery_logs l set status = 'sending', attempts = l.attempts + 1
    from c, public.notifications n, public.user_profiles up
   where l.id = c.id and n.id = l.notification_id and up.id = n.user_id
  returning l.id, l.channel, n.id, n.user_id, up.email, n.title, n.body, n.data, l.attempts;
end $$;
revoke execute on function public.claim_deliveries(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Calendar view (RLS applies through security_invoker)
-- ---------------------------------------------------------------------------
create view public.financial_calendar_events with (security_invoker = true) as
  select st.id, st.due_date as event_date, st.status, st.amount_paise, st.entity_id, fe.name as entity_name,
         ro.id as obligation_id, ro.title, ro.category, ro.auto_debit, ro.bank_account_id,
         b.bank_name, b.account_last4, ro.source_type, ro.source_id, ro.instructions,
         (select p.paid_on from public.payments p where p.scheduled_transaction_id = st.id order by p.created_at desc limit 1) as paid_on,
         (select p.amount_paise from public.payments p where p.scheduled_transaction_id = st.id order by p.created_at desc limit 1) as paid_amount_paise
    from public.scheduled_transactions st
    join public.recurring_obligations ro on ro.id = st.obligation_id
    join public.family_entities fe on fe.id = st.entity_id
    left join public.bank_accounts b on b.id = ro.bank_account_id;
grant select on public.financial_calendar_events, public.vehicle_documents, public.users to authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard summary (respects RLS since security invoker)
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_summary(p_entity uuid default null) returns jsonb
language sql stable security invoker set search_path = public as $$
  with inv as (
    select coalesce(sum(invested_paise),0) invested,
           coalesce(sum(coalesce(current_value_paise, invested_paise)),0) current_value,
           bool_and(value_is_verified) all_verified,
           coalesce(sum(case when next_sip_date is not null and coalesce(sip_frequency,'monthly') = 'monthly' then sip_amount_paise end),0) monthly_sip
      from investments where archived_at is null and (p_entity is null or entity_id = p_entity)),
  ln as (
    select coalesce(sum(outstanding_paise),0) outstanding, coalesce(sum(emi_paise) filter (where outstanding_paise > 0),0) monthly_emi
      from loans where archived_at is null and (p_entity is null or entity_id = p_entity)),
  ins as (
    select coalesce(sum(sum_assured_paise),0) cover,
           coalesce(sum(case premium_frequency when 'monthly' then premium_paise*12 when 'quarterly' then premium_paise*4
              when 'half_yearly' then premium_paise*2 when 'weekly' then premium_paise*52 else premium_paise end),0) annual_premium
      from insurance_policies where archived_at is null and status = 'active' and (p_entity is null or entity_id = p_entity)),
  up as (
    select coalesce(sum(amount_paise) filter (where due_date <= app_today() + 30),0) due30,
           count(*) filter (where status in ('overdue','awaiting_confirmation')) overdue_count,
           coalesce(sum(amount_paise) filter (where status = 'overdue'),0) overdue_amount
      from scheduled_transactions
     where status not in ('paid','cancelled','renewed') and (p_entity is null or entity_id = p_entity)),
  paid as (
    select coalesce(sum(p.amount_paise),0) paid_month, count(*) paid_count from payments p
     where p.paid_on >= date_trunc('month', app_today())::date and (p_entity is null or p.entity_id = p_entity))
  select jsonb_build_object(
    'invested', inv.invested, 'current_value', inv.current_value, 'values_verified', coalesce(inv.all_verified, true),
    'monthly_sip', inv.monthly_sip, 'loans_outstanding', ln.outstanding, 'monthly_emi', ln.monthly_emi,
    'insurance_cover', ins.cover, 'annual_premium', ins.annual_premium,
    'upcoming_30', up.due30, 'overdue_count', up.overdue_count, 'overdue_amount', up.overdue_amount,
    'paid_this_month', paid.paid_month, 'paid_count_this_month', paid.paid_count,
    'net_worth_estimate', inv.current_value - ln.outstanding,
    'today', app_today())
  from inv, ln, ins, up, paid
$$;
grant execute on function public.dashboard_summary(uuid) to authenticated;
grant execute on function public.app_today() to authenticated;
