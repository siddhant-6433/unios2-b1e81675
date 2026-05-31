import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VisitPipeline } from "./VisitPipeline";

const zero = { scheduled: 0, confirmed: 0, completed: 0, visit_followup: 0, applied: 0, admitted: 0 };

describe("VisitPipeline", () => {
  it("shows the empty state (not an all-zeros funnel) when there are no visits", () => {
    render(
      <VisitPipeline counts={zero} leakageCount={0} activeBox={null} onBoxClick={() => {}} onScheduleVisit={() => {}} />,
    );
    expect(screen.getByText(/no campus visits scheduled yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /schedule a visit/i })).toBeInTheDocument();
  });

  it("renders the funnel boxes with counts when there is data", () => {
    render(
      <VisitPipeline
        counts={{ ...zero, scheduled: 12, completed: 5, admitted: 1 }}
        leakageCount={3}
        activeBox={null}
        onBoxClick={() => {}}
      />,
    );
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    // no-show shown as a dropped chip, not a box
    expect(screen.getByText(/3 no-show/i)).toBeInTheDocument();
  });

  it("fires onBoxClick with the box key when a box is clicked", () => {
    const onBoxClick = vi.fn();
    render(
      <VisitPipeline counts={{ ...zero, scheduled: 12 }} leakageCount={0} activeBox={null} onBoxClick={onBoxClick} />,
    );
    fireEvent.click(screen.getByText("Scheduled"));
    expect(onBoxClick).toHaveBeenCalledWith("scheduled");
  });

  it("suppresses conversion % below the denominator threshold", () => {
    // prior box = 5 (< 20) → between-box % shows as the muted em-dash, not a number
    const { container } = render(
      <VisitPipeline counts={{ ...zero, completed: 5, applied: 1 }} leakageCount={0} activeBox={null} onBoxClick={() => {}} />,
    );
    // No "%" should appear anywhere when every denominator is tiny.
    expect(container.textContent).not.toMatch(/\d+%/);
  });
});
