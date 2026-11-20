// Declarative description of each record module. Drives list, detail and form screens.
// This is schema metadata (labels, field types), not data — all records live in Supabase.

export type FieldType =
  | "text" | "textarea" | "money" | "date" | "number" | "percent" | "select" | "bool"
  | "entity" | "bank" | "vehicle" | "frequency" | "entities";

export type Field = {
  key: string;                 // column, or "details.x" for JSON fields
  label: string;
  type: FieldType;
  required?: boolean;
  options?: [string, string][];
  help?: string;
  showIf?: (v: Record<string, unknown>) => boolean;
  section?: string;
  placeholder?: string;
};

export type ModuleDef = {
  key: string;                 // route + permission module name
  table: string;
  title: string;
  singular: string;
  icon: string;                // lucide icon name (resolved in components/icons)
  permission: string;          // entity_permissions.categories value
  primary: (r: Record<string, any>) => string;
  secondary: (r: Record<string, any>) => string;
  amountKey?: string;          // main money figure on list rows
  dateKey?: string;            // headline date on list rows
  dateLabel?: string;
  typeKey?: string;            // filter chips
  fields: Field[];
  orderBy: string;
};

export const FREQUENCIES: [string, string][] = [
  ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["half_yearly", "Half-yearly"],
  ["yearly", "Yearly"], ["weekly", "Weekly"], ["once", "One-time"],
];

const opt = (...pairs: string[]): [string, string][] =>
  pairs.map((p) => { const [v, l] = p.split(":"); return [v, l ?? v]; });

export const INVESTMENT_TYPES = opt(
  "mutual_fund:Mutual fund", "equity:Equity", "fixed_deposit:Fixed deposit", "recurring_deposit:Recurring deposit",
  "ppf:PPF", "epf:EPF", "nps:NPS", "bond:Bond", "gsec:Govt. security", "gold:Gold", "sgb:Sovereign Gold Bond",
  "real_estate:Real estate", "other:Other");

const isMF = (v: Record<string, unknown>) => v.category === "mutual_fund";
const isEquity = (v: Record<string, unknown>) => v.category === "equity";
const isDeposit = (v: Record<string, unknown>) => ["fixed_deposit", "recurring_deposit", "bond", "gsec", "sgb", "ppf", "nps", "epf"].includes(String(v.category));
const hasSip = (v: Record<string, unknown>) => v.mode === "sip" || v.category === "recurring_deposit";

export const MODULES: Record<string, ModuleDef> = {
  investments: {
    key: "investments", table: "investments", title: "Investments", singular: "Investment", icon: "TrendingUp",
    permission: "investments", orderBy: "name",
    primary: (r) => r.name, secondary: (r) => [label(INVESTMENT_TYPES, r.category), r.institution].filter(Boolean).join(" · "),
    amountKey: "current_value_paise", dateKey: "next_sip_date", dateLabel: "Next SIP", typeKey: "category",
    fields: [
      { key: "entity_id", label: "Holder", type: "entity", required: true, section: "Basics" },
      { key: "joint_entity_ids", label: "Joint holders", type: "entities" },
      { key: "category", label: "Type", type: "select", options: INVESTMENT_TYPES, required: true },
      { key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Parag Parikh Flexi Cap" },
      { key: "institution", label: "AMC / Bank / Broker", type: "text" },
      { key: "reference_number", label: "Folio / Deposit / Demat no.", type: "text" },
      { key: "mode", label: "Mode", type: "select", options: opt("sip:SIP", "lumpsum:Lump sum"), showIf: (v) => isMF(v) || isEquity(v) },
      { key: "units", label: "Units / Shares", type: "number", showIf: (v) => isMF(v) || isEquity(v) || v.category === "gold" || v.category === "sgb" },
      { key: "purchase_price_paise", label: "Avg. purchase price", type: "money", showIf: isEquity },
      { key: "invested_paise", label: "Total invested", type: "money", required: true, section: "Value" },
      { key: "current_value_paise", label: "Current value", type: "money" },
      { key: "value_as_of", label: "Value as of", type: "date" },
      { key: "value_is_verified", label: "Value verified from statement", type: "bool", help: "Leave off for estimates" },
      { key: "sip_amount_paise", label: "SIP / instalment amount", type: "money", showIf: hasSip, section: "Schedule" },
      { key: "sip_frequency", label: "SIP frequency", type: "frequency", showIf: hasSip },
      { key: "next_sip_date", label: "Next deduction date", type: "date", showIf: hasSip, help: "Reminders are scheduled from this date" },
      { key: "interest_rate", label: "Interest rate (% p.a.)", type: "percent", showIf: isDeposit },
      { key: "start_date", label: "Start / deposit date", type: "date" },
      { key: "maturity_date", label: "Maturity date", type: "date", showIf: (v) => v.mode !== "sip" },
      { key: "maturity_amount_paise", label: "Maturity amount", type: "money", showIf: isDeposit },
      { key: "payout_frequency", label: "Interest payout", type: "select", options: opt("cumulative:Cumulative", "monthly:Monthly", "quarterly:Quarterly", "yearly:Yearly"), showIf: isDeposit },
      { key: "auto_renew", label: "Auto-renewal", type: "bool", showIf: isDeposit },
      { key: "bank_account_id", label: "Linked bank account", type: "bank" },
      { key: "details.tds", label: "TDS details", type: "text", showIf: isDeposit, section: "More" },
      { key: "details.dividends", label: "Dividends received", type: "textarea", showIf: isEquity },
      { key: "details.redemption", label: "Redemption details", type: "textarea", showIf: isMF },
      { key: "details.capital_gains", label: "Capital gains info", type: "textarea", showIf: (v) => isMF(v) || isEquity(v) },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
  },
  insurance: {
    key: "insurance", table: "insurance_policies", title: "Insurance", singular: "Policy", icon: "ShieldCheck",
    permission: "insurance", orderBy: "next_premium_date",
    primary: (r) => r.policy_name || r.insurer, secondary: (r) => [label(INSURANCE_TYPES, r.category), r.insurer, r.policy_number].filter(Boolean).join(" · "),
    amountKey: "premium_paise", dateKey: "next_premium_date", dateLabel: "Next premium", typeKey: "category",
    fields: [],
  },
  loans: {
    key: "loans", table: "loans", title: "Loans & EMIs", singular: "Loan", icon: "Landmark",
    permission: "loans", orderBy: "next_emi_date",
    primary: (r) => `${r.lender} ${label(LOAN_TYPES, r.loan_type)}`, secondary: (r) => (r.account_last4 ? `A/c ••${r.account_last4}` : "") + ` · ${r.interest_rate}% ${r.rate_type}`,
    amountKey: "emi_paise", dateKey: "next_emi_date", dateLabel: "Next EMI", typeKey: "loan_type",
    fields: [],
  },
  vehicles: {
    key: "vehicles", table: "vehicles", title: "Vehicles", singular: "Vehicle", icon: "Car",
    permission: "vehicles", orderBy: "registration_number",
    primary: (r) => r.registration_number, secondary: (r) => [r.make_model, r.fuel_type].filter(Boolean).join(" · "),
    dateKey: "puc_expiry", dateLabel: "PUC valid till",
    fields: [],
  },
  banks: {
    key: "banks", table: "bank_accounts", title: "Bank accounts", singular: "Bank account", icon: "Building2",
    permission: "banks", orderBy: "bank_name",
    primary: (r) => r.nickname || r.bank_name, secondary: (r) => `${label(ACCOUNT_TYPES, r.account_type)}${r.account_last4 ? " · ••" + r.account_last4 : ""}${r.branch ? " · " + r.branch : ""}`,
    fields: [],
  },
  obligations: {
    key: "obligations", table: "recurring_obligations", title: "Recurring payments", singular: "Recurring payment", icon: "Repeat",
    permission: "obligations", orderBy: "next_due_date",
    primary: (r) => r.title, secondary: (r) => `${label(FREQUENCIES, r.frequency)}${r.auto_debit ? " · Auto-debit" : ""}`,
    amountKey: "amount_paise", dateKey: "next_due_date", dateLabel: "Next due",
    fields: [],
  },
};

export const INSURANCE_TYPES = opt("life:Life", "term:Term", "health:Health", "vehicle:Vehicle", "personal_accident:Personal accident", "property:Property", "business:Business", "other:Other");
export const LOAN_TYPES = opt("home:Home loan", "car:Car loan", "personal:Personal loan", "business:Business loan", "term:Term loan", "lap:Loan against property", "las:Loan against securities", "other:Other loan");
export const ACCOUNT_TYPES = opt("savings:Savings", "current:Current", "overdraft:Overdraft", "cash_credit:Cash credit", "nre:NRE", "nro:NRO", "other:Other");
export const TAX_TYPES = opt("tax_gst:GST return", "tax_tds_return:TDS return", "tax_tds_payment:TDS payment", "tax_itr:Income tax return", "tax_advance:Advance tax", "tax_audit:Tax audit", "compliance_other:Other compliance");
export const OBLIGATION_CATEGORIES = opt("recurring_payment:Recurring payment", "custom:Custom deadline", "interest_receipt:Interest / dividend receipt", "insurance_premium:Insurance premium", "sip:SIP", "loan_emi:EMI", "recurring_deposit:Recurring deposit");
const isHealth = (v: Record<string, unknown>) => v.category === "health";

MODULES.insurance.fields = [
  { key: "entity_id", label: "Insured individual / entity", type: "entity", required: true, section: "Policy" },
  { key: "category", label: "Type", type: "select", options: INSURANCE_TYPES, required: true },
  { key: "insurer", label: "Insurance company", type: "text", required: true },
  { key: "policy_name", label: "Policy name", type: "text" },
  { key: "policy_number", label: "Policy number", type: "text" },
  { key: "policyholder", label: "Policyholder", type: "text" },
  { key: "nominee", label: "Nominee", type: "text" },
  { key: "vehicle_id", label: "Vehicle", type: "vehicle", showIf: (v) => v.category === "vehicle" },
  { key: "sum_assured_paise", label: "Sum assured / cover", type: "money", section: "Premium" },
  { key: "premium_paise", label: "Premium amount", type: "money" },
  { key: "premium_frequency", label: "Premium frequency", type: "frequency" },
  { key: "next_premium_date", label: "Next premium due", type: "date", help: "Reminders are scheduled from this date" },
  { key: "grace_days", label: "Grace period (days)", type: "number" },
  { key: "bank_account_id", label: "Debit account", type: "bank" },
  { key: "auto_debit", label: "Auto-debit mandate active", type: "bool" },
  { key: "start_date", label: "Commencement date", type: "date", section: "Dates" },
  { key: "expiry_date", label: "Policy expiry / renewal date", type: "date" },
  { key: "maturity_date", label: "Maturity date", type: "date" },
  { key: "status", label: "Policy status", type: "select", options: opt("active:Active", "lapsed:Lapsed", "matured:Matured", "surrendered:Surrendered", "expired:Expired") },
  { key: "details.floater", label: "Plan type", type: "select", options: opt("individual:Individual", "floater:Family floater"), showIf: isHealth, section: "Health cover" },
  { key: "details.members", label: "Covered members", type: "text", showIf: isHealth },
  { key: "details.ncb", label: "No-claim bonus", type: "text", showIf: isHealth },
  { key: "details.restoration", label: "Restoration benefit", type: "text", showIf: isHealth },
  { key: "details.waiting_periods", label: "Waiting periods", type: "textarea", showIf: isHealth },
  { key: "details.exclusions", label: "Exclusions", type: "textarea", showIf: isHealth },
  { key: "details.claims", label: "Claim history", type: "textarea", showIf: isHealth },
  { key: "details.cashless", label: "Cashless hospitals / TPA", type: "textarea", showIf: isHealth },
  { key: "agent_name", label: "Agent / contact", type: "text", section: "Contact" },
  { key: "agent_phone", label: "Agent phone", type: "text" },
  { key: "notes", label: "Notes", type: "textarea" },
];

MODULES.loans.fields = [
  { key: "entity_id", label: "Borrower", type: "entity", required: true, section: "Loan" },
  { key: "joint_entity_ids", label: "Co-borrowers", type: "entities" },
  { key: "loan_type", label: "Type", type: "select", options: LOAN_TYPES, required: true },
  { key: "lender", label: "Lender", type: "text", required: true },
  { key: "account_last4", label: "Loan a/c (last 4 digits)", type: "text", placeholder: "1234" },
  { key: "principal_paise", label: "Original loan amount", type: "money", required: true, section: "Amounts" },
  { key: "outstanding_paise", label: "Outstanding principal", type: "money", required: true },
  { key: "interest_rate", label: "Interest rate (% p.a.)", type: "percent", required: true },
  { key: "rate_type", label: "Rate type", type: "select", options: opt("floating:Floating", "fixed:Fixed") },
  { key: "emi_paise", label: "EMI amount", type: "money", required: true },
  { key: "next_emi_date", label: "Next EMI date", type: "date", help: "Monthly EMI reminders are scheduled from this date" },
  { key: "tenure_months", label: "Tenure (months)", type: "number" },
  { key: "bank_account_id", label: "EMI debit account", type: "bank" },
  { key: "vehicle_id", label: "Vehicle", type: "vehicle", showIf: (v) => v.loan_type === "car" },
  { key: "start_date", label: "Commencement date", type: "date", section: "Dates" },
  { key: "expected_closure", label: "Expected closure", type: "date" },
  { key: "moratorium_until", label: "Moratorium until", type: "date" },
  { key: "interest_only_until", label: "Interest-only until", type: "date" },
  { key: "details.prepayments", label: "Prepayment history", type: "textarea" },
  { key: "details.rate_history", label: "Rate change history", type: "textarea" },
  { key: "notes", label: "Notes", type: "textarea" },
];

MODULES.vehicles.fields = [
  { key: "entity_id", label: "Owner", type: "entity", required: true, section: "Vehicle" },
  { key: "registration_number", label: "Registration number", type: "text", required: true, placeholder: "MH12AB1234" },
  { key: "make_model", label: "Make & model", type: "text" },
  { key: "registration_date", label: "Registration date", type: "date" },
  { key: "fuel_type", label: "Fuel", type: "select", options: opt("Petrol", "Diesel", "CNG", "Electric", "Hybrid") },
  { key: "fastag_id", label: "FASTag", type: "text" },
  { key: "insurance_provider", label: "Insurer", type: "text", section: "Validity: reminders are sent for each date" },
  { key: "insurance_policy_number", label: "Insurance policy no.", type: "text" },
  { key: "insurance_expiry", label: "Insurance expiry", type: "date" },
  { key: "puc_expiry", label: "PUC valid till", type: "date" },
  { key: "road_tax_expiry", label: "Road tax valid till", type: "date" },
  { key: "fitness_expiry", label: "Fitness certificate valid till", type: "date" },
  { key: "registration_expiry", label: "Registration valid till", type: "date" },
  { key: "permit_expiry", label: "Permit valid till", type: "date" },
  { key: "next_service_date", label: "Next service", type: "date" },
  { key: "details.service_history", label: "Service history", type: "textarea", section: "More" },
  { key: "notes", label: "Notes", type: "textarea" },
];

MODULES.banks.fields = [
  { key: "entity_id", label: "Account holder", type: "entity", required: true },
  { key: "bank_name", label: "Bank", type: "text", required: true },
  { key: "nickname", label: "Nickname", type: "text", placeholder: "e.g. HDFC salary" },
  { key: "account_type", label: "Account type", type: "select", options: ACCOUNT_TYPES },
  { key: "account_last4", label: "Account number (last 4 digits only)", type: "text", placeholder: "1234", help: "Full account numbers, passwords, PINs and OTPs are never stored" },
  { key: "ifsc", label: "IFSC", type: "text", placeholder: "HDFC0001234" },
  { key: "branch", label: "Branch", type: "text" },
  { key: "notes", label: "Notes", type: "textarea" },
];


MODULES.obligations.fields = [
  { key: "entity_id", label: "Responsible individual / entity", type: "entity", required: true },
  { key: "title", label: "Title", type: "text", required: true, placeholder: "e.g. Office rent" },
  { key: "category", label: "Category", type: "select", options: OBLIGATION_CATEGORIES, required: true },
  { key: "amount_paise", label: "Amount", type: "money" },
  { key: "frequency", label: "Repeats", type: "frequency", required: true },
  { key: "next_due_date", label: "Next due date", type: "date", required: true },
  { key: "end_date", label: "Ends on", type: "date" },
  { key: "bank_account_id", label: "Bank account", type: "bank" },
  { key: "auto_debit", label: "Auto-debit", type: "bool" },
  { key: "instructions", label: "Instructions shown in reminders", type: "textarea" },
  { key: "is_active", label: "Active", type: "bool" },
];

export function label(options: [string, string][], value: unknown): string {
  return options.find(([v]) => v === value)?.[1] ?? (value ? String(value) : "");
}

export const MODULE_LIST = ["investments", "insurance", "loans", "vehicles", "banks", "obligations"];
