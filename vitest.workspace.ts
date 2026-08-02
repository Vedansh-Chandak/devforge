/// <reference types="vitest" />
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  // All packages with package.json
  "packages/*",
  "apps/*",
]);
