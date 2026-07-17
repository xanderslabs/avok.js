import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The package root resolves to this same file, but the explicit .css path is what
// vite/client's ambient "*.css" declaration can type.
import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "./theme/tokens.css";
import App from "./App.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
