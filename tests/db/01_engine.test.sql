-- Behavioural tests for permissions, Admin Mode and the reminder engine.
\set QUIET on
create or replace function pg_temp.act_as(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false);
  if u is null then execute 'reset role'; else execute 'set role authenticated'; end if;
end $$;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'member@example.com');
update admin_settings set bootstrap_admin_email = 'admin@example.com';

select pg_temp.ok((select count(*) = 6 from family_entities), 'six initial profiles seeded');
select pg_temp.ok((select count(*) = 2 from user_profiles), 'profiles auto-created for auth users');
select pg_temp.ok(add_period('2026-01-31', 'monthly', 31) = '2026-02-28', 'month-end clamps');
select pg_temp.ok(add_period('2026-02-28', 'monthly', 31) = '2026-03-31', 'anchor day restored');
select pg_temp.ok(add_period('2026-03-15', 'quarterly') = '2026-06-15', 'quarterly');
select pg_temp.ok(format_inr(4500000) = '₹45,000' and format_inr(123456789) = '₹12,34,567.89', 'INR formatting');

-- ---- Bootstrap ----------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin perform bootstrap_admin('4826'); raise exception 'should fail'; exception when others then
  if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - non-designated user cannot bootstrap'; end $$;
select pg_temp.ok((select count(*) from family_entities) = 0, 'member without permission sees no entities');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((admin_status()->>'can_bootstrap')::boolean, 'designated admin can bootstrap');
select bootstrap_admin('4826');
select pg_temp.ok((admin_status()->>'is_admin')::boolean and not (admin_status()->>'unlocked')::boolean, 'admin created, still locked');

-- ---- Locked admin cannot write ---------------------------------------------
do $$ begin
  insert into family_entities (name) values ('Should Fail');
  raise exception 'should fail';
exception when others then
  if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - locked admin cannot write (%)', sqlerrm;
end $$;

-- ---- PIN verification & lockout -------------------------------------------
select pg_temp.ok(not (verify_admin_pin('1111')->>'ok')::boolean, 'wrong PIN rejected');
select pg_temp.ok((verify_admin_pin('4826')->>'ok')::boolean, 'correct PIN unlocks');
select pg_temp.ok(admin_unlocked(), 'admin_unlocked() true');
select admin_lock();
select pg_temp.ok(not admin_unlocked(), 'lock works');
select verify_admin_pin('0001'), verify_admin_pin('0002'), verify_admin_pin('0003'), verify_admin_pin('0004'), verify_admin_pin('0005');
do $$ begin perform verify_admin_pin('4826'); raise exception 'should fail'; exception when others then
  if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - lockout after repeated failures (%)', sqlerrm; end $$;
select pg_temp.act_as(null);
delete from admin_pin_attempts;
select pg_temp.ok((select pin_hash like '$2%' from admin_settings), 'PIN stored as bcrypt hash');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((verify_admin_pin('4826')->>'ok')::boolean, 'unlock after lockout cleared');

-- ---- Records create obligations -------------------------------------------
insert into bank_accounts (id, entity_id, bank_name, account_last4)
select '10000000-0000-0000-0000-000000000001', id, 'HDFC Bank', '1234' from family_entities where name = 'Rajesh Kumar Jain';
insert into insurance_policies (id, entity_id, category, insurer, policy_name, premium_paise, premium_frequency,
  next_premium_date, bank_account_id, auto_debit, sum_assured_paise)
select '20000000-0000-0000-0000-000000000001', id, 'life', 'LIC', 'Jeevan Anand', 4500000, 'yearly',
  app_today() + 7, '10000000-0000-0000-0000-000000000001', false, 500000000
from family_entities where name = 'Rajesh Kumar Jain';
insert into loans (id, entity_id, loan_type, lender, principal_paise, outstanding_paise, interest_rate, emi_paise, next_emi_date)
select '30000000-0000-0000-0000-000000000001', id, 'car', 'ICICI', 80000000, 50000000, 9.5, 2500000, app_today() - 2
from family_entities where name = 'Neema Jain';

select pg_temp.ok((select count(*) = 1 from scheduled_transactions st join recurring_obligations ro on ro.id = st.obligation_id
   where ro.source_id = '20000000-0000-0000-0000-000000000001' and st.status = 'upcoming' and st.amount_paise = 4500000),
   'insurance premium instance created');
select pg_temp.ok((select st.status = 'awaiting_confirmation' from scheduled_transactions st join recurring_obligations ro on ro.id = st.obligation_id
   where ro.source_id = '30000000-0000-0000-0000-000000000001'), 'past auto-debit EMI is awaiting confirmation, not paid');

-- moving the date updates the open instance instead of duplicating
update insurance_policies set next_premium_date = app_today() + 8 where id = '20000000-0000-0000-0000-000000000001';
update insurance_policies set next_premium_date = app_today() + 7 where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.ok((select count(*) = 1 from scheduled_transactions st join recurring_obligations ro on ro.id = st.obligation_id
   where ro.source_id = '20000000-0000-0000-0000-000000000001'), 'date edits do not duplicate instances');

-- ---- Permissions -----------------------------------------------------------
insert into entity_permissions (user_id, entity_id, categories)
select '00000000-0000-0000-0000-00000000000b', id, '{insurance}' from family_entities where name = 'Rajesh Kumar Jain';
update user_profiles set role = 'family_member' where id = '00000000-0000-0000-0000-00000000000b';

select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) = 1 from family_entities), 'member sees only permitted entity');
select pg_temp.ok((select count(*) = 1 from insurance_policies), 'member sees permitted insurance');
select pg_temp.ok((select count(*) = 0 from loans), 'member cannot see loans of other entities');
select pg_temp.ok((select count(*) = 0 from bank_accounts), 'member cannot see module not granted (banks)');
update insurance_policies set premium_paise = 1 where id = '20000000-0000-0000-0000-000000000001';
do $$ begin update user_profiles set role = 'admin' where id = auth.uid(); raise exception 'should fail';
exception when others then if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - member cannot self-promote'; end $$;
do $$ begin perform verify_admin_pin('4826'); raise exception 'should fail';
exception when others then if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - non-admin cannot enter Admin Mode'; end $$;
do $$ begin perform resolve_transaction((select id from scheduled_transactions limit 1), 'paid', current_date, 1); raise exception 'should fail';
exception when others then if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - member cannot mark paid'; end $$;
do $$ begin perform generate_reminders(); raise exception 'should fail';
exception when others then if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - clients cannot invoke the engine directly'; end $$;
select pg_temp.act_as(null);
select pg_temp.ok((select premium_paise = 4500000 from insurance_policies), 'member update silently blocked by RLS');

-- ---- Reminder engine -------------------------------------------------------
select pg_temp.ok((select bool_and(not email) from notification_preferences), 'email notifications off by default');
update notification_preferences set email = true; -- exercise the delivery pipeline
select pg_temp.ok(generate_reminders(app_today()) = 2, 'first run fires reminders for premium (7d) and overdue EMI');
select pg_temp.ok(generate_reminders(app_today()) = 0, 'second run same day is idempotent');
select pg_temp.ok((select count(*) = 3 from notifications), 'admin gets 2, member gets only permitted insurance reminder');
select pg_temp.ok((select count(*) = 1 from notifications where user_id = '00000000-0000-0000-0000-00000000000b'
  and body like '%Amount: ₹45,000%' and body like '%Bank: HDFC Bank ••1234%' and body like '%Remaining: 7 days%'), 'notification content complete');
select pg_temp.ok((select count(*) from notifications where title like 'Confirm auto-debit:%') = 1, 'overdue auto-debit asks for confirmation');
select pg_temp.ok((select count(*) = 3 from notification_delivery_logs where channel = 'email' and status = 'pending'), 'email deliveries queued');
select pg_temp.ok((select count(*) = 3 from notification_delivery_logs where channel = 'push' and status = 'skipped'), 'push skipped without subscription (email fallback)');

select pg_temp.ok(generate_reminders(app_today() + 1) = 1, 'overdue repeats next day; premium (6d) waits for 3d window');
select pg_temp.ok(generate_reminders(app_today() + 4) >= 1, '3-day window reached');
select pg_temp.ok(generate_reminders(app_today() + 4) = 0, 'no duplicate within window');

set role service_role;
select pg_temp.ok((select count(*) from claim_deliveries(100)) > 0, 'dispatcher claims pending deliveries');
reset role;
select pg_temp.ok((select count(*) = 0 from notification_delivery_logs where channel='email' and status = 'pending'), 'claimed rows marked sending');

-- ---- Resolve: paid -> next cycle -------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select resolve_transaction((select st.id from scheduled_transactions st join recurring_obligations ro on ro.id = st.obligation_id
  where ro.source_id = '20000000-0000-0000-0000-000000000001' and st.status = 'upcoming'), 'paid', app_today(), 4500000, 'Paid via netbanking');
select pg_temp.act_as(null);
select pg_temp.ok((select next_premium_date = add_period(app_today() + 7, 'yearly') from insurance_policies), 'source date advanced one year');
select pg_temp.ok((select count(*) = 1 from scheduled_transactions st join recurring_obligations ro on ro.id = st.obligation_id
   where ro.source_id = '20000000-0000-0000-0000-000000000001' and st.status = 'upcoming' and st.due_date = add_period(app_today() + 7, 'yearly')), 'next instance generated');
select pg_temp.ok((select count(*) = 1 from payments where amount_paise = 4500000), 'payment recorded');
select pg_temp.ok(generate_reminders(app_today() + 6) = 1, 'paid premium gets no more reminders (only EMI overdue fires)');

-- EMI confirmation -> next month, loan payment logged
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select resolve_transaction((select st.id from scheduled_transactions st join recurring_obligations ro on ro.id = st.obligation_id
  where ro.source_id = '30000000-0000-0000-0000-000000000001' and st.status = 'awaiting_confirmation'), 'paid', app_today(), 2500000);
select pg_temp.ok((select next_emi_date = add_period(app_today() - 2, 'monthly') from loans), 'EMI advanced a month');
select pg_temp.ok((select count(*) = 1 from loan_payments), 'loan payment logged');

-- Vehicle renewals with new expiry
insert into vehicles (id, entity_id, registration_number, puc_expiry)
select '40000000-0000-0000-0000-000000000001', id, 'MH12AB1234', app_today() + 2 from family_entities where name = 'Vishesh Jain';
select resolve_transaction((select st.id from scheduled_transactions st join recurring_obligations ro on ro.id = st.obligation_id
  where ro.source_id = '40000000-0000-0000-0000-000000000001' and st.status = 'upcoming'), 'renewed', null, null, null, null, null, app_today() + 182);
select pg_temp.ok((select puc_expiry = app_today() + 182 from vehicles), 'PUC renewal sets new expiry');

-- Custom monthly obligation
insert into recurring_obligations (entity_id, title, category, amount_paise, frequency, next_due_date, auto_debit)
select id, 'Office rent', 'recurring_payment', 5000000, 'monthly', app_today() + 3, false from family_entities where name = 'Rajesh Bimal and Associates';
select pg_temp.ok((select count(*) = 1 from scheduled_transactions st join recurring_obligations ro on ro.id = st.obligation_id where ro.title = 'Office rent'), 'custom obligation instance');
select resolve_transaction((select st.id from scheduled_transactions st join recurring_obligations ro on ro.id = st.obligation_id where ro.title = 'Office rent'), 'paid', app_today(), 5000000);
select pg_temp.ok((select count(*) = 2 from scheduled_transactions st join recurring_obligations ro on ro.id = st.obligation_id where ro.title = 'Office rent'), 'custom obligation recurs');

-- Archive cancels open reminders
update vehicles set archived_at = now();
select pg_temp.ok((select count(*) = 0 from scheduled_transactions st join recurring_obligations ro on ro.id = st.obligation_id
  where ro.source_type = 'vehicles' and st.status not in ('paid','cancelled','renewed')), 'archiving cancels open instances');

select pg_temp.ok((dashboard_summary()->>'monthly_emi')::bigint = 2500000, 'dashboard EMI total');
select pg_temp.ok((select count(*) > 0 from financial_calendar_events), 'calendar view populated');
select pg_temp.ok((select count(*) > 5 from administrator_audit_logs), 'audit log captured');
select pg_temp.act_as(null);

-- Pre-assigned admin (automated setup) can still choose the PIN once
select pg_temp.act_as(null);
update admin_settings set pin_hash = null, bootstrap_admin_email = 'member@example.com';
update user_profiles set role = 'admin' where email = 'member@example.com';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((admin_status()->>'can_bootstrap')::boolean, 'pre-assigned admin can set PIN');
select bootstrap_admin('5937');
select pg_temp.ok((verify_admin_pin('5937')->>'ok')::boolean, 'pre-assigned admin unlocks with new PIN');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
do $$ begin perform bootstrap_admin('6048'); raise exception 'should fail'; exception when others then
  if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - PIN cannot be re-bootstrapped'; end $$;
select pg_temp.act_as(null);

-- Self sign-up (no email)
set role anon;
select sign_up('New.Person@Example.com', 'longenough1', 'New Person');
reset role;
select pg_temp.ok((select role = 'read_only' and not exists (select 1 from entity_permissions ep where ep.user_id = up.id)
  from user_profiles up where email = 'new.person@example.com'), 'sign-up creates a no-access read-only account');
select pg_temp.ok((select encrypted_password = extensions.crypt('longenough1', encrypted_password) from auth.users where email = 'new.person@example.com'), 'password stored hashed');
set role anon;
do $$ begin perform sign_up('new.person@example.com', 'longenough1'); raise exception 'should fail'; exception when others then
  if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - duplicate email rejected'; end $$;
do $$ begin perform sign_up('x@example.com', 'short'); raise exception 'should fail'; exception when others then
  if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - short password rejected'; end $$;
reset role;

-- Test notification
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select send_test_notification();
select pg_temp.ok((select count(*) = 1 from notifications where kind = 'test' and user_id = auth.uid()), 'test notification lands in own inbox');
select send_test_notification(), send_test_notification(), send_test_notification(), send_test_notification();
do $$ begin perform send_test_notification(); raise exception 'should fail'; exception when others then
  if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - test alerts rate-limited'; end $$;
select pg_temp.act_as(null);
