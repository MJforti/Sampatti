"use client";
import Link from "next/link";
import { TrendingUp, ShieldCheck, Landmark, Car, Building2, FileText, BarChart3, Settings, Repeat, ChevronRight, Wallet, UserCog, ScrollText, Search, Calculator } from "lucide-react";
import { useApp } from "@/components/providers";
import { AdminToggle } from "@/components/shell";
import { ThemePicker } from "@/components/theme";
import { LogoutButton } from "@/components/logout";
import { PageHeader, SectionTitle } from "@/components/ui";

const ITEMS = [
  ["/m/investments", "Investments", "Mutual funds, equity, FDs, PPF, gold…", TrendingUp],
  ["/m/insurance", "Insurance", "Life, health, vehicle and other policies", ShieldCheck],
  ["/m/loans", "Loans & EMIs", "Outstanding loans and EMI schedule", Landmark],
  ["/m/vehicles", "Vehicles", "PUC, insurance, road tax, fitness", Car],
  ["/m/banks", "Bank accounts", "Accounts and linked auto-debits", Building2],
  ["/outflow", "Cash outflow", "Money going out over the next 12 months, by profile", Wallet],
  ["/deductions", "Bank-wise deductions", "What leaves each account, next 7/15/30 days", Wallet],
  ["/m/obligations", "Recurring payments", "Rent, subscriptions, custom deadlines", Repeat],
  ["/documents", "Documents", "Policies, statements, certificates", FileText],
  ["/reports", "Reports", "Assets, liabilities and outflows", BarChart3],
  ["/calculators", "Calculators", "SIP, home loan EMI, FD, RD, goal planning", Calculator],
  ["/search", "Search", "Find any record", Search],
  ["/settings", "Settings", "Notifications, account, security", Settings],
] as const;

export default function More() {
  const { isUltra, admin } = useApp();
  return (
    <div>
      <PageHeader title="More" />
      <div className="card overflow-hidden">
        {ITEMS.map(([href, title, sub, Icon]) => (
          <Link key={href} href={href} className="flex items-center gap-3 px-4 py-3.5 border-b hairline last:border-0 active:bg-surface-2">
            <span className="size-11 grid place-items-center rounded-xl bg-surface-2 text-ink-2"><Icon className="size-[18px]" strokeWidth={1.5} /></span>
            <div className="flex-1 min-w-0"><div className="text-[15px] font-medium">{title}</div><div className="text-[13px] text-ink-3 truncate">{sub}</div></div>
            <ChevronRight className="size-4 text-ink-3" />
          </Link>
        ))}
      </div>
      <SectionTitle>Appearance</SectionTitle>
      <ThemePicker />

      {admin?.is_admin && (
        <>
          <SectionTitle>Administration</SectionTitle>
          {isUltra && (
            <div className="card overflow-hidden mb-2">
              <Link href="/admin/users" className="flex items-center gap-3 px-4 py-3.5 border-b hairline"><UserCog className="size-5 text-admin" /><span className="flex-1">Users & permissions</span><ChevronRight className="size-4 text-ink-3" /></Link>
              <Link href="/admin/audit" className="flex items-center gap-3 px-4 py-3.5"><ScrollText className="size-5 text-admin" /><span className="flex-1">Activity log</span><ChevronRight className="size-4 text-ink-3" /></Link>
            </div>
          )}
          <AdminToggle />
        </>
      )}
      <div className="mt-6"><LogoutButton /></div>
    </div>
  );
}
