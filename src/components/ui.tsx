"use client";
import { X, Loader2, Inbox } from "lucide-react";
import Link from "next/link";
import { useEffect, type ReactNode, type ButtonHTMLAttributes } from "react";
import { STATUS_META, type TxnStatus } from "@/lib/status";

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "admin";
  size?: "md" | "lg" | "sm";
  loading?: boolean;
};
export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: "bg-accent text-accent-ink active:opacity-90",
    secondary: "bg-surface border border-line text-ink active:bg-surface-2",
    ghost: "text-ink-2 active:bg-surface-2",
    danger: "bg-danger text-white active:opacity-90",
    admin: "bg-surface border border-line text-ink active:bg-surface-2",
  }[variant];
  const s = { sm: "h-11 px-3.5 text-sm rounded-xl", md: "h-12 px-4 text-[15px] rounded-2xl", lg: "h-14 px-5 text-base rounded-2xl" }[size];
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx("inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap transition-[background-color,opacity,transform] active:scale-[0.98] select-none disabled:opacity-50", v, s, className)}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

const TONES: Record<string, string> = {
  neutral: "bg-surface-2 text-ink-2",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  ok: "bg-ok-soft text-ok",
  info: "bg-info-soft text-info",
  muted: "bg-surface-2 text-ink-3 line-through",
  admin: "bg-admin-soft text-admin",
};
export function Badge({ tone = "neutral", children, className }: { tone?: string; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}
export function StatusBadge({ status }: { status: TxnStatus }) {
  const m = STATUS_META[status] ?? { label: status, tone: "neutral" };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function Sheet({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40 anim-fade" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg max-h-[92dvh] flex flex-col bg-bg rounded-t-3xl sm:rounded-3xl anim-sheet safe-bottom">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b hairline">
          <h2 className="text-[17px] font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="size-10 -mr-2 grid place-items-center rounded-full active:bg-surface-2"><X className="size-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer && <div className="px-5 py-3 border-t hairline bg-bg">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ open, title, message, confirmLabel = "Confirm", danger, onConfirm, onClose, loading }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean;
  onConfirm: () => void; onClose: () => void; loading?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}
      footer={<div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} className="flex-1" onClick={onConfirm} loading={loading}>{confirmLabel}</Button></div>}>
      <div className="text-[15px] text-ink-2 leading-relaxed">{message}</div>
    </Sheet>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-2">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-[68px]" />)}</div>;
}

export function Empty({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="card px-6 py-10 text-center">
      <Inbox className="mx-auto size-8 text-ink-3" strokeWidth={1.5} />
      <div className="mt-3 font-semibold">{title}</div>
      {message && <p className="mt-1 text-sm text-ink-3">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="card border-danger/30 bg-danger-soft px-4 py-4 text-sm text-danger">
      <div className="font-semibold">Couldn’t load this</div>
      <div className="mt-1 opacity-90 break-words">{error}</div>
      {retry && <button onClick={retry} className="mt-2 font-semibold underline">Try again</button>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-2 mt-6 px-1">
      <h2 className="text-[15px] font-medium text-ink-2">{children}</h2>
      {action}
    </div>
  );
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick}
      className={cx("h-11 px-4 rounded-full text-sm font-medium whitespace-nowrap border transition",
        active ? "bg-ink text-bg border-ink" : "bg-surface text-ink-2 border-line")}>
      {children}
    </button>
  );
}

export function PageHeader({ title, subtitle, back, action }: { title: string; subtitle?: string; back?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 pt-2 pb-3">
      <div className="min-w-0">
        {back && <Link href={back} className="text-sm text-accent font-medium">‹ Back</Link>}
        <h1 className="text-[28px] leading-tight font-medium tracking-tight truncate">{title}</h1>
        {subtitle && <p className="text-sm text-ink-3 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b hairline last:border-0">
      <div className="text-sm text-ink-3 max-w-[45%]">{label}</div>
      <div className="text-[15px] text-right min-w-0 flex-1 [overflow-wrap:break-word] [hyphens:none]">{value ?? "Not set"}</div>
    </div>
  );
}
