import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AbvmuCahetAllotmentStep } from "@/components/apply/AbvmuCahetAllotmentStep";
import { DEFAULT_APPLICATION, type ApplicationData } from "@/components/apply/types";
import { ABVMU_CAHET_ALLOTTED_NO, ABVMU_CAHET_ALLOTTED_YES } from "@/lib/abvmuCahetAllotment";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    storage: {
      from: () => ({ upload: mocks.upload }),
    },
  },
}));

vi.mock("@/components/ui/thinking-orb", () => ({
  ButtonOrb: () => null,
}));

function bptApp(overrides: Partial<ApplicationData> = {}): ApplicationData {
  return {
    ...DEFAULT_APPLICATION,
    id: "app-uuid",
    application_id: "APP-26-TEST",
    lead_id: "lead-bpt",
    program_category: "undergraduate",
    course_selections: [{
      course_id: "bpt-1",
      campus_id: "campus-1",
      course_name: "Bachelor of Physiotherapy (BPT)",
      campus_name: "Greater Noida",
      preference_order: 1,
      program_category: "undergraduate",
    }],
    flags: ["portal:nimt"],
    ...overrides,
  };
}

function choose(label: string) {
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(screen.getByText(label));
}

function attachChallan(file: File) {
  const input = document.querySelector("input[type='file']");
  if (!input) throw new Error("challan file input not found");
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.upload.mockReset();
  mocks.rpc.mockImplementation((name: string) => {
    if (name === "lead_abvmu_deposit_amount") {
      return Promise.resolve({ data: 40000, error: null });
    }
    if (name === "submit_abvmu_deposit_claim") {
      return Promise.resolve({ data: { id: "claim-1", status: "pending" }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  mocks.upload.mockResolvedValue({ error: null });
});

describe("AbvmuCahetAllotmentStep", () => {
  it("asks for the ABVMU CAHET allotment before the rest of the form", async () => {
    render(<AbvmuCahetAllotmentStep data={bptApp()} onComplete={vi.fn()} saving={false} />);
    expect(screen.getByText("ABVMU CAHET counselling")).toBeInTheDocument();
    expect(screen.getByText(/allotted a seat by ABVMU CAHET counselling/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/₹40,000/)).toBeInTheDocument();
    });
  });

  it("requires a challan upload when the candidate was allotted a seat", async () => {
    const onComplete = vi.fn();
    render(<AbvmuCahetAllotmentStep data={bptApp()} onComplete={onComplete} saving={false} />);

    choose("Yes — seat allotted by ABVMU CAHET counselling");
    expect(screen.getByText(/Upload ABVMU challan of ₹40,000/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /upload challan and continue/i }));
    expect(await screen.findByText(/Challan file is required/)).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("uploads the challan through the existing ABVMU claim RPC, then continues", async () => {
    const onComplete = vi.fn().mockResolvedValue(true);
    render(<AbvmuCahetAllotmentStep data={bptApp()} onComplete={onComplete} saving={false} />);

    choose("Yes — seat allotted by ABVMU CAHET counselling");
    attachChallan(new File(["challan"], "abvmu-challan.pdf", { type: "application/pdf" }));

    fireEvent.click(screen.getByRole("button", { name: /upload challan and continue/i }));

    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
    expect(mocks.upload.mock.calls[0][0]).toMatch(/^abvmu-claims\/lead-bpt\//);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      "submit_abvmu_deposit_claim",
      expect.objectContaining({
        _lead_id: "lead-bpt",
        _amount: 40000,
        _proof_file_name: "abvmu-challan.pdf",
      }),
    ));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete.mock.calls[0][0]).toContain(ABVMU_CAHET_ALLOTTED_YES);
    expect(onComplete.mock.calls[0][0]).not.toContain(ABVMU_CAHET_ALLOTTED_NO);
  });

  it("continues without an upload when the candidate was not allotted a seat", async () => {
    const onComplete = vi.fn().mockResolvedValue(true);
    render(<AbvmuCahetAllotmentStep data={bptApp()} onComplete={onComplete} saving={false} />);

    choose("No — continue with the regular application");
    fireEvent.click(screen.getByRole("button", { name: /continue with application/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith("submit_abvmu_deposit_claim", expect.anything());
    expect(onComplete.mock.calls[0][0]).toContain(ABVMU_CAHET_ALLOTTED_NO);
  });

  it("still continues if a challan claim is already pending for the lead", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "lead_abvmu_deposit_amount") {
        return Promise.resolve({ data: 40000, error: null });
      }
      if (name === "submit_abvmu_deposit_claim") {
        return Promise.resolve({
          data: null,
          error: { message: "An ABVMU deposit claim is already pending or approved for this lead" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const onComplete = vi.fn().mockResolvedValue(true);
    render(<AbvmuCahetAllotmentStep data={bptApp()} onComplete={onComplete} saving={false} />);

    choose("Yes — seat allotted by ABVMU CAHET counselling");
    attachChallan(new File(["challan"], "abvmu-challan.pdf", { type: "application/pdf" }));
    fireEvent.click(screen.getByRole("button", { name: /upload challan and continue/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });
});
