import { useState, useEffect } from "react";
import { Plus, Save, ToggleLeft, ToggleRight, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { useConfig, useSaveConfig, useToggleAccount } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import type { Account, Config } from "@/types/domain";
import { BLANK_CONFIG } from "@/types/domain";

export default function AccountsPage() {
  const t = useT();
  const { data: serverCfg } = useConfig();
  const save = useSaveConfig();
  const toggle = useToggleAccount();
  const [cfg, setCfg] = useState<Config>(BLANK_CONFIG);

  useEffect(() => {
    if (serverCfg) setCfg(serverCfg);
  }, [serverCfg]);

  const accounts = cfg.accounts ?? [];
  const isDirty = JSON.stringify(serverCfg?.accounts) !== JSON.stringify(cfg.accounts);

  function patch(i: number, p: Partial<Account>) {
    setCfg({
      ...cfg,
      accounts: accounts.map((a, idx) => (idx === i ? { ...a, ...p } : a)),
    });
  }

  function addAccount() {
    const n = accounts.length + 1;
    setCfg({
      ...cfg,
      accounts: [
        ...accounts,
        {
          label: `account${n}`,
          script_id: "",
          script_ids: [],
          account_type: "consumer",
          enabled: true,
          weight: 1,
          daily_quota: 20000,
        },
      ],
    });
  }

  function remove(i: number) {
    setCfg({ ...cfg, accounts: accounts.filter((_, idx) => idx !== i) });
  }

  async function onSave() {
    try {
      await save.mutateAsync(cfg);
      toast.success(t("toast.accountsSaved"));
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function onToggle(acct: Account) {
    try {
      await toggle.mutateAsync({ label: acct.label, enabled: !acct.enabled });
      patch(accounts.findIndex((a) => a.label === acct.label), { enabled: !acct.enabled });
    } catch (err) {
      toast.error(String(err));
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="label-kicker">{accounts.length} configured</span>
          <p className="mt-1 text-[13px] text-ink-3">
            Each account holds one or more Apps Script deployment IDs the scheduler rotates between.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={addAccount}>
            <Plus />
            {t("accounts.add")}
          </Button>
          <Button variant="primary" onClick={onSave} disabled={!isDirty || save.isPending}>
            <Save />
            {t("accounts.save")}
          </Button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="No accounts yet"
          description={`${t("accounts.empty.prefix")}${t("accounts.add")}${t("accounts.empty.suffix")}`}
          action={
            <Button variant="primary" onClick={addAccount}>
              <Plus />
              {t("accounts.add")}
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {accounts.map((a, i) => (
            <AccountRow
              key={i}
              account={a}
              onToggle={() => onToggle(a)}
              onPatch={(p) => patch(i, p)}
              onRemove={() => remove(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountRow({
  account, onToggle, onPatch, onRemove,
}: {
  account: Account;
  onToggle: () => void;
  onPatch: (p: Partial<Account>) => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <Card className={account.enabled ? "" : "opacity-60"}>
      <div className="grid grid-cols-[auto_1fr_1.5fr_140px_140px_auto] gap-3 items-end p-5">
        <button
          onClick={onToggle}
          title={account.enabled ? t("accounts.disable") : t("accounts.enable")}
          className={`flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
            account.enabled
              ? "border-signal/40 bg-signal/10 text-signal"
              : "border-line-strong bg-bg-inset text-ink-3"
          }`}
        >
          {account.enabled ? <ToggleRight className="size-4" /> : <ToggleLeft className="size-4" />}
        </button>

        <div className="space-y-1.5">
          <Label htmlFor={`label-${account.label}`}>{t("accounts.label")}</Label>
          <Input
            id={`label-${account.label}`}
            value={account.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            placeholder={t("accounts.label")}
          />
        </div>

        <div className="space-y-1.5">
          <Label>{t("accounts.scriptId")}</Label>
          <Input
            value={account.script_id || account.script_ids?.[0] || ""}
            onChange={(e) =>
              onPatch({ script_id: e.target.value, script_ids: [e.target.value] })
            }
            placeholder="AKfycbz…"
            className="font-mono text-[12px]"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select
            value={account.account_type}
            onValueChange={(v) => onPatch({ account_type: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="consumer">{t("accounts.consumer")}</SelectItem>
              <SelectItem value="workspace">{t("accounts.workspace")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>{t("accounts.dailyQuota")}</Label>
          <Input
            type="number"
            value={account.daily_quota}
            onChange={(e) => onPatch({ daily_quota: Number(e.target.value) })}
          />
        </div>

        <button
          onClick={onRemove}
          title={t("accounts.remove")}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-danger/30 text-danger hover:bg-danger/10"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {account.script_ids && account.script_ids.length > 1 && (
        <div className="border-t border-line-subtle/60 px-5 py-2.5 flex items-center gap-2">
          <span className="label-kicker">deployments</span>
          {account.script_ids.map((id, i) => (
            <Badge key={i} tone="muted" className="font-mono normal-case tracking-normal text-[11px]">
              {id.slice(0, 12)}…
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}
