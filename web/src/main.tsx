import "@fontsource-variable/noto-sans-jp";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { connect } from "./ws";
import { initTheme } from "./theme";
import { initNotify } from "./notify";
import "./index.css";

initTheme();
initNotify();
// 2つのタブを見分けられるようにする
if (import.meta.env.DEV) document.title = `Clew :${location.port}`;
connect();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
