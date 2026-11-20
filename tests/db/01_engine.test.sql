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

-- Delete a profile with records
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select verify_admin_pin('4826');
do $$ begin perform delete_entity((select id from family_entities where name = 'Neema Jain'), 'wrong'); raise exception 'should fail';
exception when others then if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - name confirmation required'; end $$;
select delete_entity((select id from family_entities where name = 'Neema Jain'), 'neema jain');
select pg_temp.ok((select count(*) = 0 from family_entities where name = 'Neema Jain') and (select count(*) = 0 from loans), 'profile and its records deleted');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
do $$ begin perform delete_entity((select id from family_entities limit 1), 'x'); raise exception 'should fail';
exception when others then if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - non-admin cannot delete profiles'; end $$;
select pg_temp.act_as(null);

-- Families & access codes
select pg_temp.act_as(null);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000c', 'cousin@example.com');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) = 0 from family_entities), 'new user sees no profiles');
select pg_temp.ok((select count(*) = 0 from family_codes()), 'non-admin cannot read family codes');
do $$ begin perform join_family('XXXX-XXXX'); raise exception 'should fail'; exception when others then
  if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - wrong code rejected'; end $$;
select pg_temp.act_as(null);
select set_config('t.code', (select access_code from families where name = 'Jain Family'), false);
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select join_family(lower(replace(current_setting('t.code'), '-', '')));
select pg_temp.ok((select count(*) = (select count(*) from family_entities) and count(*) > 0 from family_entities), 'joining with code grants all family members');
select pg_temp.act_as(null);
select pg_temp.ok((select role = 'family_member' from user_profiles where id = '00000000-0000-0000-0000-00000000000c'), 'joiner becomes family member');
insert into families (name) values ('Other Family');
update family_entities set family_id = (select id from families where name = 'Other Family') where name = 'Rajesh Bimal and Associates';
select pg_temp.ok(not exists (select 1 from entity_permissions ep join family_entities e on e.id = ep.entity_id
  where ep.user_id = '00000000-0000-0000-0000-00000000000c' and e.name = 'Rajesh Bimal and Associates'), 'moving a member out of the family withdraws access');

-- One family per user: joining another family moves them
select pg_temp.act_as(null);
select set_config('t.code2', (select access_code from families where name = 'Other Family'), false);
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select join_family(current_setting('t.code2'));
select pg_temp.act_as(null);
select pg_temp.ok((select count(*) = 1 from family_memberships where user_id = '00000000-0000-0000-0000-00000000000c'), 'user is in exactly one family');
select pg_temp.ok((select count(*) = 1 from entity_permissions where user_id = '00000000-0000-0000-0000-00000000000c'), 'access moved to the new family only');
do $$ begin insert into family_memberships (user_id, family_id) select '00000000-0000-0000-0000-00000000000c', id from families where name = 'Jain Family'; raise exception 'should fail';
exception when others then if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - database blocks a second family'; end $$;

-- Admin window is fixed: touching does not extend it
select pg_temp.act_as(null);
update user_sessions set admin_expires_at = now() + interval '1 minute' where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select admin_touch();
select pg_temp.act_as(null);
select pg_temp.ok((select admin_expires_at < now() + interval '2 minutes' from user_sessions where user_id = '00000000-0000-0000-0000-00000000000a'), 'activity does not extend Admin Mode');

-- Member emoji
select pg_temp.act_as(null);
update user_profiles set linked_entity_id = (select id from family_entities where name = 'Rajesh Bimal and Associates') where id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select set_member_emoji((select id from family_entities where name = 'Rajesh Bimal and Associates'), '🌸');
do $$ begin perform set_member_emoji((select id from family_entities where name = 'Rajesh Kumar Jain'), '🦁'); raise exception 'should fail';
exception when others then if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - cannot set someone else''s emoji'; end $$;
select pg_temp.act_as(null);
select pg_temp.ok((select emoji = '🌸' from family_entities where name = 'Rajesh Bimal and Associates'), 'member set own emoji');

-- Family admins vs ultra admin
select pg_temp.act_as(null);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'famadmin@example.com');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select verify_admin_pin('4826');
select set_family_admin('00000000-0000-0000-0000-00000000000d', (select id from families where name = 'Jain Family'), true);
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select pg_temp.ok((admin_status()->>'can_bootstrap')::boolean and not (admin_status()->>'is_ultra')::boolean, 'family admin is asked to set own PIN');
select bootstrap_admin('7351');
select pg_temp.ok((verify_admin_pin('7351')->>'ok')::boolean, 'family admin unlocks with own PIN');
select pg_temp.ok(not exists (select 1 from family_entities where name = 'Rajesh Bimal and Associates'), 'family admin cannot see other family');
insert into bank_accounts (entity_id, bank_name) select id, 'SBI' from family_entities where name = 'Vishesh Jain';
select pg_temp.ok((select count(*) = 1 from bank_accounts where bank_name = 'SBI'), 'family admin edits own family');
select pg_temp.act_as(null);
select set_config('t.other', (select id::text from family_entities where name = 'Rajesh Bimal and Associates'), false);
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
do $$ begin insert into bank_accounts (entity_id, bank_name) values (current_setting('t.other')::uuid, 'Axis'); raise exception 'should fail';
exception when others then if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - family admin cannot write to another family'; end $$;
do $$ begin perform update_app_settings('{"overdue_repeat_days": 2}'); raise exception 'should fail';
exception when others then if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - family admin cannot change app settings'; end $$;
do $$ begin insert into family_entities (name, family_id) values ('Sneaky', current_setting('t.other')::uuid); raise exception 'should fail';
exception when others then if sqlerrm = 'should fail' then raise; end if; raise notice 'ok - family admin cannot add members to other families'; end $$;
insert into family_entities (name, family_id) values ('New Baby Jain', public.my_admin_family());
select pg_temp.ok(exists (select 1 from family_entities where name = 'New Baby Jain'), 'family admin adds member to own family');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) >= 2 from families), 'ultra admin sees every family');
insert into bank_accounts (entity_id, bank_name) values (current_setting('t.other')::uuid, 'Axis');
select pg_temp.ok(true, 'ultra admin writes anywhere');
select pg_temp.act_as(null);

-- Ultra admin creates a family through the app's own role (not as postgres)
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select verify_admin_pin('4826');
insert into families (name) values ('Gangwal Family');
select pg_temp.act_as(null);
select pg_temp.ok((select access_code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$' from families where name = 'Gangwal Family'), 'ultra admin can create a family with a code');

-- Projected outflows
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select verify_admin_pin('4826');
insert into investments (entity_id, category, name, invested_paise, mode, sip_amount_paise, sip_frequency, next_sip_date)
select id, 'mutual_fund', 'Test Flexi Cap', 0, 'sip', 500000, 'monthly', date_trunc('month', app_today())::date + 14 from family_entities where name = 'Vishesh Jain';
select pg_temp.ok((select sum(amount_paise) = 6000000 and count(*) = 12 from projected_outflows(12) where category = 'sip'),
  'monthly ₹5,000 SIP projects to ₹60,000 over 12 months');
select pg_temp.ok(not exists (select 1 from projected_outflows(12) where category in ('fd_maturity','investment_maturity')), 'maturities are not counted as outflow');
select pg_temp.act_as(null);

-- PMS and AIF investment types
insert into investments (entity_id, category, name, invested_paise) select id, 'pms', 'Test PMS', 5000000000 from family_entities limit 1;
insert into investments (entity_id, category, name, invested_paise, maturity_date) select id, 'aif', 'Test AIF Cat II', 2500000000, current_date + 1500 from family_entities limit 1;
select pg_temp.ok((select count(*) = 2 from investments where category in ('pms','aif')), 'PMS and AIF investments can be saved');

-- AIF capital call appears in projected outflow
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select verify_admin_pin('4826');
insert into investments (entity_id, category, name, invested_paise, details)
select id, 'aif', 'Call Test AIF', 0, jsonb_build_object('aif_commitment_paise', 1000000000, 'aif_drawn_paise', 0,
  'aif_next_call_date', (date_trunc('month', app_today())::date + 40)::text, 'aif_next_call_paise', 250000000)
from family_entities where name = 'Vishesh Jain';
select pg_temp.ok((select sum(amount_paise) = 250000000 from projected_outflows(12) where category = 'aif_call'), 'next AIF capital call is projected');
select pg_temp.act_as(null);

-- Theme preference: a user can save their own appearance
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
update user_profiles set theme = 'dark' where id = auth.uid();
select pg_temp.act_as(null);
select pg_temp.ok((select theme = 'dark' from user_profiles where id = '00000000-0000-0000-0000-00000000000b'), 'user saves own theme');
