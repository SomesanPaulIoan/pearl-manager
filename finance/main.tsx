import { useState } from "react";
import { createRoot } from "react-dom/client";
import Finance from "./web/Finance";
import "./web/style.css";
import "./page.css";
import PearlRunRate from "./run-rate";

function FinancePage() {
  const [revision, setRevision] = useState(0);
  return <>
    <PearlRunRate revision={revision} onPurchase={() => setRevision(value => value + 1)} />
    <Finance key={revision} />
  </>;
}

createRoot(document.getElementById("finance")!).render(<FinancePage />);
