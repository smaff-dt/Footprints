/** The whole app outside Dynatrace, with the SDKs replaced by tests/app/mock. */
import { createRoot } from "react-dom/client";
import { App } from "../../ui/App";
createRoot(document.getElementById("root")!).render(<App />);
