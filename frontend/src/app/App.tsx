import { HashRouter } from "react-router-dom";
import { AppProviders } from "./providers";
import { AppRouter } from "./router";

export function App() {
  return (
    <HashRouter>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </HashRouter>
  );
}
