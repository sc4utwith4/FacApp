import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

document.documentElement.lang = "pt-BR";
document.documentElement.setAttribute("translate", "no");
document.body?.setAttribute("translate", "no");
document.body?.classList.add("notranslate");

createRoot(document.getElementById("root")!).render(<App />);
