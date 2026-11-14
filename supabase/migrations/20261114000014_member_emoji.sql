-- Each member profile can have a personal emoji used to mark their items across the app.
alter table public.family_entities add column emoji text check (emoji is null or (char_length(emoji) between 1 and 8 and emoji !~ '[A-Za-z0-9<>]'));

-- Admin (Admin Mode) can set any member's emoji; a user can set the emoji of the profile linked to their account.
create or replace function public.set_member_emoji(p_entity uuid, p_emoji text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.admin_unlocked() or exists (select 1 from public.user_profiles where id = auth.uid() and linked_entity_id = p_entity)) then
    raise exception 'You can only choose the emoji for your own profile';
  end if;
  update public.family_entities set emoji = nullif(trim(p_emoji), '') where id = p_entity;
end $$;
revoke execute on function public.set_member_emoji(uuid, text) from public, anon;
grant execute on function public.set_member_emoji(uuid, text) to authenticated;

-- Link a user account to the member profile that is "them" (admin only).
create or replace function public.link_user_profile(p_user uuid, p_entity uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_unlocked() then raise exception 'Unlock Admin Mode first'; end if;
  update public.user_profiles set linked_entity_id = p_entity where id = p_user;
end $$;
revoke execute on function public.link_user_profile(uuid, uuid) from public, anon;
grant execute on function public.link_user_profile(uuid, uuid) to authenticated;

-- Calendar rows carry the member's emoji
create or replace view public.financial_calendar_events with (security_invoker = true) as
  select st.id, st.due_date as event_date, st.status, st.amount_paise, st.entity_id, fe.name as entity_name,
         ro.id as obligation_id, ro.title, ro.category, ro.auto_debit, ro.bank_account_id,
         b.bank_name, b.account_last4, ro.source_type, ro.source_id, ro.instructions,
         (select p.paid_on from public.payments p where p.scheduled_transaction_id = st.id order by p.created_at desc limit 1) as paid_on,
         (select p.amount_paise from public.payments p where p.scheduled_transaction_id = st.id order by p.created_at desc limit 1) as paid_amount_paise,
         fe.emoji as entity_emoji
    from public.scheduled_transactions st
    join public.recurring_obligations ro on ro.id = st.obligation_id
    join public.family_entities fe on fe.id = st.entity_id
    left join public.bank_accounts b on b.id = ro.bank_account_id;
