import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/ui/setup.ts"],
    include: ["test/ui/**/*.test.ts", "test/ui/**/*.test.tsx"],
    css: true,
  },
});
