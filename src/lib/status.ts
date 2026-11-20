export type TxnStatus =
  | "upcoming" | "due_today" | "paid" | "overdue" | "cancelled" | "renewed"
  | "auto_debit_scheduled" | "awaiting_confirmation";

export const STATUS_META: Record<TxnStatus, { label: string; tone: string }> = {
  upcoming: { label: "Upcoming", tone: "neutral" },
  due_today: { label: "Due today", tone: "warn" },
  overdue: { label: "Overdue", tone: "danger" },
  paid: { label: "Paid", tone: "ok" },
  renewed: { label: "Renewed", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "muted" },
  auto_debit_scheduled: { label: "Auto-debit scheduled", tone: "info" },
  awaiting_confirmation: { label: "Confirm debit", tone: "danger" },
};

export const OPEN_STATUSES: TxnStatus[] = ["upcoming", "due_today", "overdue", "auto_debit_scheduled", "awaiting_confirmation"];

export const CATEGORY_LABEL: Record<string, string> = {
  insurance_premium: "Insurance premium", insurance_renewal: "Insurance renewal", sip: "SIP",
  loan_emi: "Loan EMI", recurring_deposit: "Recurring deposit", fd_maturity: "FD maturity",
  investment_maturity: "Maturity", interest_receipt: "Interest / dividend",
  vehicle_puc: "PUC", vehicle_insurance: "Vehicle insurance", vehicle_road_tax: "Road tax",
  vehicle_fitness: "Fitness certificate", vehicle_registration: "Registration", vehicle_permit: "Permit",
  vehicle_service: "Service", tax_gst: "GST", tax_tds_return: "TDS return", tax_tds_payment: "TDS payment",
  tax_itr: "Income tax return", tax_advance: "Advance tax", tax_audit: "Tax audit",
  compliance_other: "Compliance", document_expiry: "Document expiry", recurring_payment: "Recurring payment", aif_call: "AIF capital call",
  custom: "Custom",
};

/** Colour group used for calendar dots & icons. */
export function categoryGroup(c: string): "insurance" | "loan" | "invest" | "vehicle" | "tax" | "other" {
  if (c.startsWith("insurance")) return "insurance";
  if (c === "loan_emi") return "loan";
  if (["sip", "recurring_deposit", "fd_maturity", "investment_maturity", "interest_receipt"].includes(c)) return "invest";
  if (c.startsWith("vehicle")) return "vehicle";
  if (c.startsWith("tax") || c === "compliance_other") return "tax";
  return "other";
}

/** Inflows (maturities, receipts) aren't deductions. */
export function isInflow(c: string) {
  return ["fd_maturity", "investment_maturity", "interest_receipt"].includes(c);
}
