import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.DEPLOY_TARGET === "cloudflare" ? "/" : "/fishing/"
});
