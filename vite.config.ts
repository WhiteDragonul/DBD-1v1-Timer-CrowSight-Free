import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Single entry: the overlay window is the same index.html loaded with the
// "#1v1-overlay" hash (see src/main.tsx), so there is nothing else to build.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: "localhost",
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
