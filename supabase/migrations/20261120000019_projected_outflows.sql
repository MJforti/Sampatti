-- Projected cash outflow: every active recurring obligation rolled forward on its own
-- schedule for N months (SIPs, RD instalments, EMIs, premiums, tax, other payments).
-- Inflows (maturities, interest/dividend receipts) are excluded. Runs as the caller, so RLS applies.
create or replace function public.projected_outflows(p_months int default 12)
returns table (entity_id uuid, month date, category text, amount_paise bigint, items int)
language sql stable security invoker set search_path = public as $$
  with recursive bounds as (
    select date_trunc('month', app_today())::date as start_d,
           (date_trunc('month', app_today()) + make_interval(months => least(greatest(p_months, 1), 36)))::date as end_d
  ), base as (
    select ro.id, ro.entity_id, ro.category, ro.amount_paise, ro.frequency, ro.anchor_day, ro.end_date,
           coalesce((select min(st.due_date) from scheduled_transactions st
                      where st.obligation_id = ro.id and st.status not in ('paid','cancelled','renewed')),
                    ro.next_due_date) as d
      from recurring_obligations ro
      join family_entities fe on fe.id = ro.entity_id and fe.is_active
     where ro.is_active and coalesce(ro.amount_paise, 0) > 0
       and ro.category not in ('fd_maturity','investment_maturity','interest_receipt')
  ), s as (
    select b.*, 0 as n from base b where b.d is not null
    union all
    select s.id, s.entity_id, s.category, s.amount_paise, s.frequency, s.anchor_day, s.end_date,
           add_period(s.d, s.frequency, s.anchor_day), s.n + 1
      from s, bounds
     where s.frequency <> 'once' and s.n < 600 and add_period(s.d, s.frequency, s.anchor_day) < bounds.end_d
  )
  select s.entity_id, date_trunc('month', s.d)::date, s.category, sum(s.amount_paise)::bigint, count(*)::int
    from s, bounds
   where s.d >= bounds.start_d and s.d < bounds.end_d and (s.end_date is null or s.d <= s.end_date)
   group by 1, 2, 3
$$;
grant execute on function public.projected_outflows(int) to authenticated;
