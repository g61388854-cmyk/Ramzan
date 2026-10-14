import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { SessionProvider } from "./lib/session";
import { ToastProvider } from "./components/ui";

try {
  const t = localStorage.getItem("pai.theme");
  if (t) document.documentElement.dataset.theme = t;
} catch {
  /* хранилище недоступно */
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </ToastProvider>
  </React.StrictMode>,
);
