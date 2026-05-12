import { useState } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { useT } from "@/i18n";
import { useStatus, useCACertInfo } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Step, StepList } from "../certificate/_step";
import { CopyCode } from "@/components/ui/copy-code";
import { snippet } from "./snippets";

type TermTab = "macos" | "linux" | "powershell" | "cmd";

function detectTermTab(): TermTab {
  const p = (typeof navigator !== "undefined" ? navigator.platform : "").toLowerCase();
  if (p.includes("mac")) return "macos";
  if (p.includes("win")) return "powershell";
  return "linux";
}

export default function TerminalPage() {
  const t = useT();
  const { data: status } = useStatus();
  const { data: info } = useCACertInfo();
  const [tab, setTab] = useState<TermTab>(detectTermTab);

  const httpAddr = status?.listen_address || "127.0.0.1:8085";
  const socksAddr = status?.socks5_address || "127.0.0.1:1080";
  const certPath = info?.cert_path || "";
  const displayPath = certPath || t("term.certPathMissing");

  return (
    <div className="mx-auto max-w-5xl space-y-5 animate-fade-in">
      <Card className="p-5">
        <span className="label-kicker">cli trust</span>
        <h2 className="mt-1 text-[16px] font-medium text-ink-1">{t("term.intro.title")}</h2>
        <p className="mt-1.5 text-[13px] text-ink-2 leading-relaxed max-w-2xl">{t("term.intro.body")}</p>

        <dl className="mt-5 grid gap-y-3 gap-x-6 md:grid-cols-2 text-[12.5px]">
          <KV label={t("term.proxyHttp")} value={httpAddr} mono />
          <KV label={t("term.proxySocks")} value={socksAddr || t("homecert.off")} mono />
          <KV label={t("term.certPath")} value={displayPath} mono full danger={!certPath} />
        </dl>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TermTab)}>
        <TabsList>
          <TabsTrigger value="macos">{t("term.tab.macos")}</TabsTrigger>
          <TabsTrigger value="linux">{t("term.tab.linux")}</TabsTrigger>
          <TabsTrigger value="powershell">{t("term.tab.powershell")}</TabsTrigger>
          <TabsTrigger value="cmd">{t("term.tab.cmd")}</TabsTrigger>
        </TabsList>

        <TabsContent value="macos">
          <UnixShellGuide path={certPath} httpAddr={httpAddr} socksAddr={socksAddr} flavor="macos" />
        </TabsContent>
        <TabsContent value="linux">
          <UnixShellGuide path={certPath} httpAddr={httpAddr} socksAddr={socksAddr} flavor="linux" />
        </TabsContent>
        <TabsContent value="powershell">
          <PowerShellGuide path={certPath} httpAddr={httpAddr} />
        </TabsContent>
        <TabsContent value="cmd">
          <CmdGuide path={certPath} httpAddr={httpAddr} />
        </TabsContent>
      </Tabs>

      <ToolTipsPanel certPath={certPath} />
    </div>
  );
}

function KV({
  label, value, mono, full, danger,
}: { label: string; value: string; mono?: boolean; full?: boolean; danger?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${full ? "md:col-span-2" : ""}`}>
      <dt className="label-kicker">{label}</dt>
      <dd
        className={`break-all ${mono ? "font-mono text-[12px]" : "text-[13px]"} ${
          danger ? "text-danger" : "text-ink-1"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function UnixShellGuide({
  path, httpAddr, socksAddr, flavor,
}: { path: string; httpAddr: string; socksAddr: string; flavor: "macos" | "linux" }) {
  const t = useT();
  return (
    <StepList>
      <Step num="1" title={t("term.session.title")}>
        <p>{t("term.session.body")}</p>
        <CopyCode label={flavor === "macos" ? "zsh" : "bash"} code={snippet.sh(path, httpAddr, socksAddr)} />
      </Step>
      <Step num="2" title={t("term.persist.title")}>
        <p>{flavor === "macos" ? t("term.persistMac.body") : t("term.persistLinux.body")}</p>
      </Step>
      <Step num="!" warn title="">
        <p className="text-ink-3">{t("term.note.proxyOptional")}</p>
      </Step>
    </StepList>
  );
}

function PowerShellGuide({ path, httpAddr }: { path: string; httpAddr: string }) {
  const t = useT();
  return (
    <StepList>
      <Step num="1" title={t("term.session.title")}>
        <p>{t("term.session.body")}</p>
        <CopyCode label="powershell" code={snippet.pwsh(path, httpAddr)} />
      </Step>
      <Step num="2" title={t("term.persist.title")}>
        <p>{t("term.persistPwsh.body")}</p>
      </Step>
      <Step num="!" warn title="">
        <p className="text-ink-3">{t("term.note.proxyOptional")}</p>
      </Step>
    </StepList>
  );
}

function CmdGuide({ path, httpAddr }: { path: string; httpAddr: string }) {
  const t = useT();
  return (
    <StepList>
      <Step num="1" title={t("term.session.title")}>
        <p>{t("term.session.body")}</p>
        <CopyCode label="cmd" code={snippet.cmdSession(path, httpAddr)} />
      </Step>
      <Step num="2" title={t("term.persist.title")}>
        <p>{t("term.persistCmd.body")}</p>
        <CopyCode label="cmd · persist" code={snippet.cmdPersist(path, httpAddr)} />
      </Step>
      <Step num="!" warn title="">
        <p className="text-ink-3">{t("term.note.proxyOptional")}</p>
      </Step>
    </StepList>
  );
}

function ToolTipsPanel({ certPath }: { certPath: string }) {
  const t = useT();
  const cert = certPath || "/path/to/ca.crt";
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <TerminalIcon className="size-3.5 text-ink-3" />
        <span className="text-[13px] font-medium text-ink-1">{t("term.tools.title")}</span>
      </div>
      <StepList>
        <Step num="N" title={t("term.tools.nodeTitle")}>
          <p>{t("term.tools.nodeBody")}</p>
        </Step>
        <Step num="P" title={t("term.tools.pythonTitle")}>
          <p>{t("term.tools.pythonBody")}</p>
        </Step>
        <Step num="G" title={t("term.tools.gitTitle")}>
          <p>{t("term.tools.gitBody")}</p>
          <CopyCode label="git" code={`git config --global http.sslCAInfo "${cert}"`} />
        </Step>
        <Step num="C" title={t("term.tools.curlTitle")}>
          <p>{t("term.tools.curlBody")}</p>
          <CopyCode label="curl" code={`curl --cacert "${cert}" https://example.com`} />
        </Step>
      </StepList>
    </Card>
  );
}
