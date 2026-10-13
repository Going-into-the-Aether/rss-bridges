import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "./generated/build-info": new URL("./src/build-info.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
