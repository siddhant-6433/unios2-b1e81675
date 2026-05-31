import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// Side-effect import: patches supabase.functions.invoke to always send the
// current session's real JWT (fixes 401s from the sb_publishable_ key). See
// src/integrations/supabase/edge.ts.
import "@/integrations/supabase/edge";

createRoot(document.getElementById("root")!).render(<App />);
