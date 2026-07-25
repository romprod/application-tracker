import "@fontsource-variable/archivo/index.css";
import "@fontsource-variable/newsreader/index.css";
import { setupIonicReact } from "@ionic/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles.css";
import "./workspace.css";

setupIonicReact({ mode: "md", rippleEffect: false });

const root = document.querySelector("#root");

if (!root) {
  throw new Error("Application root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
