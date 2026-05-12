import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { translate, type Locale } from "@/i18n";

interface Props {
  locale: Locale;
  children: ReactNode;
}

interface State {
  err: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error) {
    console.error("[ErrorBoundary]", err);
  }

  render() {
    if (!this.state.err) return this.props.children;
    const t = (k: string) => translate(this.props.locale, k);
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
        <div className="rounded-full border border-danger/40 bg-danger/10 p-3 text-danger">
          <AlertTriangle className="size-6" />
        </div>
        <h2 className="display text-3xl">{t("error.boundary.title")}</h2>
        <pre className="max-w-xl whitespace-pre-wrap rounded-md border border-line-strong bg-bg-inset px-4 py-3 text-left text-[12px] font-mono text-ink-2">
          {this.state.err.message}
        </pre>
        <Button variant="primary" onClick={() => this.setState({ err: null })}>
          {t("error.boundary.retry")}
        </Button>
      </div>
    );
  }
}
