-- Add PMS (Portfolio Management Services) and AIF (Alternative Investment Fund) investment types.
alter table public.investments drop constraint investments_category_check;
alter table public.investments add constraint investments_category_check check (category in (
  'mutual_fund','equity','fixed_deposit','recurring_deposit','ppf','epf','nps',
  'bond','gsec','gold','sgb','real_estate','pms','aif','other'));
