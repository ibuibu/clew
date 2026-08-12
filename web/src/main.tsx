import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { connect } from "./ws";
import { initTheme } from "./theme";
import "./index.css";

initTheme();
connect();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
