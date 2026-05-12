import { useMemo, useState } from "react";
import { FileText, Pause, Play, Search } from "lucide-react";
import { useT } from "@/i18n";
import { useStats } from "@/lib/queries";
import type { LogEntry } from "@/types/domain";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

const LEVEL_TONES: Record<string, string> = {
  error: "text-danger",
  warn: "text-warn",
  info: "text-info",
  debug: "text-ink-3",
};

const LEVEL_BG: Record<string, string> = {
  error: "before:bg-danger",
  warn: "before:bg-warn",
  info: "before:bg-info",
  debug: "before:bg-ink-3",
};

const LEVELS = ["all", "error", "warn", "info", "debug"] as const;

export default function LogsPage() {
  const t = useT();
  const { data: stats } = useStats(800);
  const [filter, setFilter] = useState<(typeof LEVELS)[number]>("all");
  const [q, setQ] = useState("");
  const [paused, setPaused] = useState(false);
  const [frozenLogs, setFrozenLogs] = useState<LogEntry[] | null>(null);

  const liveLogs: LogEntry[] = stats?.logs ?? [];
  const logs = paused && frozenLogs ? frozenLogs : liveLogs;

  function togglePause() {
    if (paused) {
      setPaused(false);
      setFrozenLogs(null);
    } else {
      setFrozenLogs(liveLogs);
      setPaused(true);
    }
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return logs
      .slice()
      .reverse()
      .filter((l) => {
        if (filter !== "all" && l.level.toLowerCase() !== filter) return false;
        if (!term) return true;
        return (
          l.message.toLowerCase().includes(term) ||
          (l.source?.toLowerCase().includes(term) ?? false)
        );
      });
  }, [logs, filter, q]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 animate-fade-in flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-ink-3" />
          <Input
            placeholder="Filter logs by message or source"
            className="pl-9 font-mono text-[12.5px]"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="inline-flex rounded-md border border-line-subtle bg-bg-raised/70 p-0.5">
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              onClick={() => setFilter(lvl)}
              className={cn(
                "rounded px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] transition-colors",
                filter === lvl
                  ? "bg-bg-inset text-ink-1 shadow-ring"
                  : "text-ink-3 hover:text-ink-1",
              )}
            >
              {lvl}
            </button>
          ))}
        </div>
        <Button variant={paused ? "primary" : "secondary"} size="sm" onClick={togglePause}>
          {paused ? <Play /> : <Pause />}
          {paused ? "Resume" : "Pause"}
        </Button>
        <Badge tone={paused ? "warn" : "signal"}>
          {paused ? "frozen" : "live"} · {filtered.length}
        </Badge>
      </div>

      <Card className="flex-1 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center p-10">
            <EmptyState
              icon={<FileText className="size-5" />}
              title="No log entries match"
              description={q || filter !== "all" ? "Try clearing filters." : "Logs will stream here as the relay processes requests."}
            />
          </div>
        ) : (
          <ul className="font-mono text-[12.5px] divide-y divide-line-subtle/40 max-h-[calc(100vh-260px)] overflow-y-auto">
            {filtered.map((e, i) => {
              const level = e.level.toLowerCase();
              return (
                <li
                  key={`${e.time}-${i}`}
                  className={cn(
                    "relative grid grid-cols-[auto_56px_120px_1fr] gap-3 px-4 py-2 hover:bg-bg-inset/40 transition-colors",
                    "before:absolute before:inset-y-0 before:left-0 before:w-[2px]",
                    LEVEL_BG[level] || "before:bg-ink-3",
                  )}
                >
                  <span className="text-ink-3 tabular-nums">
                    {new Date(e.time).toLocaleTimeString([], { hour12: false })}
                  </span>
                  <span className={cn("uppercase tracking-wider text-[10.5px] mt-[2px]", LEVEL_TONES[level] || "text-ink-3")}>
                    {e.level}
                  </span>
                  <span className="text-ink-3 truncate">{e.source || "—"}</span>
                  <span className="text-ink-1 break-words leading-relaxed">{e.message}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
