import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import "sonner/dist/styles.css";
import "./index.css";
import "./themes.css";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
      <Toaster
        richColors
        toastOptions={{
          style: {
            fontSize: "16px",
            padding: "18px 20px",
            minWidth: "320px",
          },
        }}
        position="top-right"
      />
    </BrowserRouter>
  </StrictMode>,
);
