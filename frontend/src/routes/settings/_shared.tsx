import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function SettingsCard({
  title, kicker, description, children, className,
}: {
  title: string;
  kicker?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-4 sm:p-5 md:p-6", className)}>
      <div className="mb-4 sm:mb-5">
        {kicker && <span className="label-kicker">{kicker}</span>}
        <h2 className="mt-1 text-[15px] font-medium tracking-tight text-ink-1 sm:text-[16px]">{title}</h2>
        {description && <p className="mt-1.5 text-[12px] text-ink-3 max-w-xl leading-relaxed sm:text-[12.5px]">{description}</p>}
      </div>
      <div className="space-y-4 sm:space-y-5">{children}</div>
    </Card>
  );
}

export function Field({
  label, hint, children, className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {hint && <FieldHint>{hint}</FieldHint>}
    </div>
  );
}

export function ToggleRow({
  label, hint, checked, onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 rounded-lg border border-line-subtle bg-bg-inset/40 px-4 py-3.5">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-ink-1">{label}</p>
        {hint && <p className="mt-1 text-[12px] text-ink-3 leading-relaxed">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function TextField({
  label, hint, value, onChange, placeholder, type = "text",
}: {
  label: string;
  hint?: string;
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "number";
}) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </Field>
  );
}
