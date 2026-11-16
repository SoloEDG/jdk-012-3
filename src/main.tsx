import { createRoot } from "react-dom/client";
import App from "./app/App";
import { ServicesProvider } from "./features/exhibition/ServicesProvider";
import "./app/styles.css";

createRoot(document.getElementById("root")!).render(
  <ServicesProvider>
    <App />
  </ServicesProvider>,
);
