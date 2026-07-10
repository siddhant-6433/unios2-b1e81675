import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const VENDOR_GROUPS: Array<{ chunk: string; matchers: string[] }> = [
  { chunk: "vendor-runtime", matchers: ["/tslib/", "/@babel/runtime/"] },
  { chunk: "vendor-react", matchers: ["/node_modules/react/", "/node_modules/react-dom/", "/node_modules/scheduler/"] },
  { chunk: "vendor-router", matchers: ["/react-router/", "/react-router-dom/", "/@remix-run/router/", "/history/"] },
  { chunk: "vendor-query-supabase", matchers: ["/@tanstack/react-query/", "/@tanstack/query-core/", "/@supabase/", "/iceberg-js/", "/@lovable.dev/cloud-auth-js/"] },
  {
    chunk: "vendor-ui",
    matchers: [
      "/@radix-ui/",
      "/@floating-ui/",
      "/react-remove-scroll/",
      "/react-remove-scroll-bar/",
      "/react-style-singleton/",
      "/use-callback-ref/",
      "/use-sidecar/",
      "/aria-hidden/",
      "/get-nonce/",
      "/lucide-react/",
      "/class-variance-authority/",
      "/clsx/",
      "/tailwind-merge/",
      "/cmdk/",
      "/sonner/",
      "/vaul/",
    ],
  },
  { chunk: "vendor-forms", matchers: ["/react-hook-form/", "/@hookform/resolvers/", "/zod/", "/input-otp/"] },
  { chunk: "vendor-date", matchers: ["/date-fns/", "/react-day-picker/"] },
  { chunk: "vendor-theme", matchers: ["/next-themes/"] },
  { chunk: "vendor-carousel", matchers: ["/embla-carousel-react/"] },
  { chunk: "vendor-panels", matchers: ["/react-resizable-panels/"] },
  { chunk: "vendor-scholarship", matchers: ["/@nimt/scholarship-slabs/"] },
  {
    chunk: "vendor-charts",
    matchers: [
      "/recharts/",
      "/recharts-scale/",
      "/react-smooth/",
      "/victory-vendor/",
      "/d3-",
      "/decimal.js-light/",
      "/fast-equals/",
      "/eventemitter3/",
      "/internmap/",
      "/tiny-invariant/",
      "/react-is/",
      "/react-transition-group/",
      "/dom-helpers/",
      "/lodash/",
      "/prop-types/",
    ],
  },
  {
    chunk: "vendor-pdf-render",
    matchers: [
      "/canvg/",
      "/core-js/",
      "/dompurify/",
      "/rgbcolor/",
      "/raf/",
      "/performance-now/",
      "/stackblur-canvas/",
      "/svg-pathdata/",
    ],
  },
  {
    chunk: "vendor-pdf-compression",
    matchers: ["/fflate/", "/fast-png/", "/iobuffer/", "/pako/"],
  },
  {
    chunk: "vendor-jspdf",
    matchers: ["/jspdf/"],
  },
  { chunk: "vendor-html2canvas", matchers: ["/html2canvas/"] },
  { chunk: "vendor-spreadsheets", matchers: ["/xlsx/"] },
  { chunk: "vendor-maps", matchers: ["/leaflet/"] },
];

function manualChunks(id: string) {
  const normalizedId = id.replace(/\\/g, "/");
  if (normalizedId.includes("vite/preload-helper") || normalizedId.includes("commonjsHelpers")) return "vendor-runtime";
  if (!normalizedId.includes("/node_modules/")) return;

  for (const group of VENDOR_GROUPS) {
    if (group.matchers.length === 0) continue;
    if (group.matchers.some((matcher) => normalizedId.includes(matcher))) {
      return group.chunk;
    }
  }

  return;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
}));
