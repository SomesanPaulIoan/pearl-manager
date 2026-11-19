import { createRoot } from "react-dom/client";
import Finance from "./web/Finance";
import "./web/style.css";
import "./page.css";
import PearlRunRate from "./run-rate";

createRoot(document.getElementById("finance")!).render(
  <>
    <PearlRunRate />
    <Finance />
  </>,
);
