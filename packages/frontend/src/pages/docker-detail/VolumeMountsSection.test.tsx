import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type MountEntry, VolumeMountsSection } from "./VolumeMountsSection";

const mounts: MountEntry[] = [
  {
    hostPath: "/srv/app/config",
    containerPath: "/config",
    name: "",
    readOnly: true,
  },
];

function renderSection(canEdit: boolean) {
  return render(
    <VolumeMountsSection
      canEdit={canEdit}
      mounts={mounts}
      setMounts={vi.fn()}
      mountsChanged={false}
      inputCell="h-9"
    />
  );
}

describe("VolumeMountsSection", () => {
  it("keeps existing mounts visible but readonly without mount permission", () => {
    renderSection(false);

    expect(screen.getByDisplayValue("/srv/app/config")).toBeDisabled();
    expect(screen.getByDisplayValue("/config")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
  });

  it("allows mount editing when mount permission is available", () => {
    renderSection(true);

    expect(screen.getByDisplayValue("/srv/app/config")).not.toBeDisabled();
    expect(screen.getByDisplayValue("/config")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /add/i })).toBeInTheDocument();
  });
});
