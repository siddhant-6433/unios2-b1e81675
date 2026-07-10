import { createRoot } from "react-dom/client";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root not found");
}

const root = createRoot(rootElement);

function BootError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : null;

  return (
    <main className="min-h-screen bg-[#f0f2f5] px-6 py-10 text-slate-900">
      <section className="mx-auto max-w-2xl rounded-lg border border-destructive/20 bg-white p-6 shadow-sm">
        <div className="mb-4 inline-flex rounded-full bg-destructive/10 px-3 py-1 text-sm font-medium text-destructive">
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

{
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
