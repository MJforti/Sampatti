-- Plain punctuation in generated payment names: "Insurance premium: Jeevan Anand" instead of an em dash.
do $$
declare f text; src text;
begin
  foreach f in array array['public.trg_insurance_sync()','public.trg_loan_sync()','public.trg_investment_sync()',
                           'public.trg_vehicle_sync()','public.trg_tax_sync()','public.trg_document_sync()'] loop
    src := pg_get_functiondef(f::regprocedure);
    src := replace(src, ' — ', ': ');
    execute src;
  end loop;
end $$;
update public.recurring_obligations set title = replace(title, ' — ', ': ') where title like '% — %';
