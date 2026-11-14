-- Permanently remove a profile and everything that belongs to it (Admin Mode only).
create or replace function public.delete_entity(p_entity uuid, p_confirm_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.family_entities;
  banks uuid[]; vehs uuid[]; docs uuid[];
begin
  if not public.admin_unlocked() then raise exception 'Unlock Admin Mode first'; end if;
  select * into e from public.family_entities where id = p_entity;
  if e.id is null then raise exception 'Profile not found'; end if;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(e.name)) then raise exception 'Type the profile name exactly to confirm'; end if;

  select coalesce(array_agg(id), '{}') into banks from public.bank_accounts where entity_id = p_entity;
  select coalesce(array_agg(id), '{}') into vehs from public.vehicles where entity_id = p_entity;
  select coalesce(array_agg(id), '{}') into docs from public.documents where entity_id = p_entity;

  -- detach references from other profiles' records
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

  -- delete owned records
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
revoke execute on function public.delete_entity(uuid, text) from public, anon;
grant execute on function public.delete_entity(uuid, text) to authenticated;
