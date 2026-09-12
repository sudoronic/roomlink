import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { configurationError } from "./supabase/client";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {configurationError ? (
      <main role="alert">
        <h1>RoomLink setup required</h1>
        <p>{configurationError}</p>
      </main>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
