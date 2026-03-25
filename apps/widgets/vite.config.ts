import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: {
        "lead-form": resolve(__dirname, "src/lead-form/index.ts"),
        "rental-booking": resolve(__dirname, "src/rental-booking/index.ts"),
        "transient-booking": resolve(
          __dirname,
          "src/transient-booking/index.ts"
        ),
      },
      formats: ["es"],
      fileName: (format, entryName) => `${entryName}.${format}.js`,
    },
    rollupOptions: {
      output: {
        // Each widget is self-contained — inline React
        inlineDynamicImports: false,
      },
    },
    cssCodeSplit: false,
    target: "es2020",
    minify: "terser",
    outDir: "dist",
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});
