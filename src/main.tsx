import { createRoot } from "react-dom/client";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root not found");
}

const root = createRoot(rootElement);

const requiredEnvVars = [
  ["VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL],
  ["VITE_SUPABASE_PUBLISHABLE_KEY", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY],
] as const;

const missingEnvVars = requiredEnvVars
  .filter(([, value]) => !value)
  .map(([name]) => name);

function MissingSupabaseConfig({ missing }: { missing: string[] }) {
  return (
    <main className="min-h-screen bg-[#f0f2f5] px-6 py-10 text-slate-900">
      <section className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 inline-flex rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800">
          Local setup required
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Supabase config is missing</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          The app could not start because the local Vite environment does not define the
          Supabase project URL and publishable key. Add these values to a local env file,
          then restart the dev server.
        </p>
        <pre className="mt-5 overflow-x-auto rounded-md bg-slate-950 p-4 text-sm text-slate-100">
{missing.map((name) => `${name}=...`).join("\n")}
        </pre>
      </section>
    </main>
  );
}

function BootError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : null;

  return (
    <main className="min-h-screen bg-[#f0f2f5] px-6 py-10 text-slate-900">
      <section className="mx-auto max-w-2xl rounded-lg border border-red-200 bg-white p-6 shadow-sm">
        <div className="mb-4 inline-flex rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-700">
          App failed to boot
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Startup error</h1>
        <pre className="mt-5 overflow-x-auto rounded-md bg-slate-950 p-4 text-sm text-slate-100">
          {stack || message}
        </pre>
      </section>
    </main>
  );
}

function renderBootError(error: unknown) {
  root.render(<BootError error={error} />);
}

if (missingEnvVars.length > 0) {
  root.render(<MissingSupabaseConfig missing={missingEnvVars} />);
} else {
  if (import.meta.env.DEV) {
    window.addEventListener("error", (event) => {
      renderBootError(event.error || event.message);
    });
    window.addEventListener("unhandledrejection", (event) => {
      renderBootError(event.reason || "Unhandled promise rejection");
    });
  }

  Promise.all([
    // Side-effect import: patches supabase.functions.invoke to always send the
    // current session's real JWT. See src/integrations/supabase/edge.ts.
    import("@/integrations/supabase/edge"),
    import("./App.tsx"),
  ])
    .then(([, app]) => {
      const App = app.default;
      root.render(<App />);
    })
    .catch((error) => {
      console.error("App boot failed", error);
      root.render(<BootError error={error} />);
    });
}
