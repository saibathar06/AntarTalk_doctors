import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { apiTarget, doctorProxy, localApiGuard } from "./devProxy.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "DOCTOR_");
  const target = apiTarget(
    env.DOCTOR_API_TARGET || "https://antartalk-unified-backend.onrender.com",
  );
  return {
    plugins: [react(), localApiGuard()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      allowedHosts: ["localhost", "127.0.0.1"],
      proxy: { "/api": doctorProxy(target) },
    },
  };
});
