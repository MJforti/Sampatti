-- Hardening from Supabase security advisor.
-- 1) Nothing is callable without signing in.
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke execute on functions from anon, public;

-- 2) Trigger / internal helpers are not RPC endpoints for signed-in users either.
revoke execute on function public.audit_row(), public.handle_new_user(), public.trg_custom_obligation(),
  public.trg_document_sync(), public.trg_insurance_sync(), public.trg_investment_sync(), public.trg_loan_sync(),
  public.trg_source_delete(), public.trg_tax_sync(), public.trg_vehicle_sync(), public.guard_profile_update(),
  public.touch_updated_at() from authenticated;

-- 3) Pin search_path on remaining functions.
alter function public.touch_updated_at() set search_path = public;
alter function public.valid_category(text) set search_path = public;
alter function public._valid_pin(text) set search_path = public;
alter function public.guard_profile_update() set search_path = public;
alter function public.add_period(date, public.frequency, int) set search_path = public;
alter function public.open_status(date, boolean) set search_path = public;
alter function public.format_inr(bigint) set search_path = public;
alter function public.category_label(text) set search_path = public;
alter function public.category_module(text) set search_path = public;

-- 4) Replace the security-definer settings view with a function (safe columns only).
drop view if exists public.app_settings;
create or replace function public.get_app_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'timezone', timezone, 'reminder_offsets', reminder_offsets, 'auto_debit_reminder_hours', auto_debit_reminder_hours,
    'overdue_repeat_days', overdue_repeat_days, 'admin_session_minutes', admin_session_minutes,
    'max_pin_attempts', max_pin_attempts, 'lockout_minutes', lockout_minutes, 'app_url', app_url, 'pin_set_at', pin_set_at)
  end from public.admin_settings where id = 1
$$;
revoke execute on function public.get_app_settings() from anon, public;
grant execute on function public.get_app_settings() to authenticated;

-- 5) pg_net out of public is managed by Supabase; leave as installed.
