import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// The standalone frontend mode keeps the existing local browser tests usable.
// cf build / cf deploy use production mode and emit the full Worker + assets.
export default defineConfig(({ mode }) => ({
  plugins: mode === "frontend" ? [] : [cloudflare()],
}));
