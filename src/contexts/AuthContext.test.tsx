import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signOut: mocks.signOut,
    },
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

function AuthProbe() {
  const { loading, roleLoaded, session } = useAuth();

  return (
    <div>
      <span>loading:{String(loading)}</span>
      <span>roleLoaded:{String(roleLoaded)}</span>
      <span>session:{session?.user?.id ?? "none"}</span>
    </div>
  );
}

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    sessionStorage.clear();
    mocks.getSession.mockReset();
    mocks.onAuthStateChange.mockReset();
    mocks.signOut.mockReset();
    mocks.from.mockReset();
    mocks.rpc.mockReset();
    mocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not leave authenticated users stuck on the route loading screen when role loading never settles", async () => {
    const never = new Promise(() => {});

    mocks.getSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: "user-1",
            email: "user@example.com",
            user_metadata: {},
          },
        },
      },
    });
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => never,
        }),
      }),
    });
    mocks.rpc.mockReturnValue(never);

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await flushPromises();

    expect(screen.getByText("loading:false")).toBeInTheDocument();
    expect(screen.getByText("roleLoaded:false")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(9_000);
      await Promise.resolve();
    });

    expect(screen.getByText("loading:false")).toBeInTheDocument();
    expect(screen.getByText("roleLoaded:true")).toBeInTheDocument();
    expect(screen.getByText("session:user-1")).toBeInTheDocument();
  });

  it("does not leave the app stuck when the initial session lookup never settles", async () => {
    mocks.getSession.mockReturnValue(new Promise(() => {}));

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    expect(screen.getByText("loading:true")).toBeInTheDocument();
    expect(screen.getByText("roleLoaded:false")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(9_000);
      await Promise.resolve();
    });

    expect(screen.getByText("loading:false")).toBeInTheDocument();
    expect(screen.getByText("roleLoaded:true")).toBeInTheDocument();
    expect(screen.getByText("session:none")).toBeInTheDocument();
  });
});
