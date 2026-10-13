import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(eslint.configs.recommended, ...tseslint.configs.recommended, {
  ignores: [".wrangler/**", "coverage/**", "dist/**", "node_modules/**", "generated/build-info.ts"],
});
