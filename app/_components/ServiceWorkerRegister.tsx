"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production")
      return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
      return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => console.warn("[somniai] SW registration failed:", err));
    };

    if (document.readyState === "complete") {
      register();
    }
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}