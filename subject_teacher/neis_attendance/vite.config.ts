import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  resolve: { dedupe: ["react", "react-dom"] },
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  test: { environment: "jsdom", globals: true },
});
