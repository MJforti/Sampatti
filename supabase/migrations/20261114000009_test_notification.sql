-- Lets any signed-in user send themselves a test alert through the real pipeline
-- (in-app row + push delivery queued for the dispatcher). Max 5 per 10 minutes.
create or replace function public.send_test_notification() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n_id uuid;
  has_push boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if (select count(*) from public.notifications where user_id = auth.uid() and kind = 'test'
       and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Too many test alerts. Try again in a few minutes';
  end if;
  insert into public.notifications (user_id, kind, title, body, data)
  values (auth.uid(), 'test', 'Test alert',
          'Reminders are working on this account.' || E'\n' || 'Sent ' || to_char(now() at time zone
            (select timezone from public.admin_settings where id = 1), 'FMDD Mon YYYY, HH12:MI AM'),
          jsonb_build_object('url', '/reminders'))
  returning id into n_id;
  insert into public.notification_delivery_logs (notification_id, channel, status, sent_at) values (n_id, 'in_app', 'sent', now());
  has_push := exists (select 1 from public.push_subscriptions where user_id = auth.uid());
  if has_push then
    insert into public.notification_delivery_logs (notification_id, channel) values (n_id, 'push');
  end if;
  return jsonb_build_object('id', n_id, 'push_queued', has_push);
end $$;
revoke execute on function public.send_test_notification() from public, anon;
grant execute on function public.send_test_notification() to authenticated;

-- Deliver test pushes promptly: kick the dispatcher right away when one is queued.
create or replace function public.kick_dispatcher() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/dispatch-notifications',
      headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')),
      body := '{}'::jsonb);
  exception when others then null; -- pg_net/vault absent (local tests): cron will pick it up
  end;
  return null;
end $$;
revoke execute on function public.kick_dispatcher() from public, anon, authenticated;
create trigger notification_test_kick after insert on public.notification_delivery_logs
  for each row when (new.channel = 'push' and new.status = 'pending')
  execute function public.kick_dispatcher();

-- Web push keys live in Vault (created out of band: vapid_public / vapid_private / vapid_subject).
create or replace function public.get_push_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(name, decrypted_secret) from vault.decrypted_secrets
   where name in ('vapid_public','vapid_private','vapid_subject')
$$;
revoke execute on function public.get_push_config() from public, anon, authenticated;
grant execute on function public.get_push_config() to service_role;
