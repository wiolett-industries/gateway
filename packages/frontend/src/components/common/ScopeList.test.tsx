import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Node } from "@/types";
import { ScopeList } from "./ScopeList";

const nodes = [
  {
    id: "docker-node",
    type: "docker",
    hostname: "docker-01",
    displayName: "Docker Node",
  },
  {
    id: "nginx-node",
    type: "nginx",
    hostname: "nginx-01",
    displayName: "Nginx Node",
  },
] as Node[];

describe("ScopeList", () => {
  it("shows only Docker nodes for resource-scoped Docker permissions", () => {
    render(
      <ScopeList
        scopes={[
          {
            value: "docker:containers:view",
            label: "View Containers",
            desc: "View Docker containers",
            group: "Docker",
          },
        ]}
        search=""
        selected={["docker:containers:view"]}
        onToggle={vi.fn()}
        resources={{}}
        onToggleResource={vi.fn()}
        nodes={nodes}
        restrictableScopes={["docker:containers:view"]}
      />
    );

    expect(screen.getByText("Docker Node")).toBeInTheDocument();
    expect(screen.queryByText("Nginx Node")).not.toBeInTheDocument();
  });

  it("keeps all nodes available for node-scoped node permissions", () => {
    render(
      <ScopeList
        scopes={[
          {
            value: "nodes:details",
            label: "Node Details",
            desc: "View node details",
            group: "Nodes",
          },
        ]}
        search=""
        selected={["nodes:details"]}
        onToggle={vi.fn()}
        resources={{}}
        onToggleResource={vi.fn()}
        nodes={nodes}
        restrictableScopes={["nodes:details"]}
      />
    );

    expect(screen.getByText("Docker Node")).toBeInTheDocument();
    expect(screen.getByText("Nginx Node")).toBeInTheDocument();
  });

  it("allows removing an additional broad scope even when the group grants resource-scoped access", () => {
    const onToggle = vi.fn();
    render(
      <ScopeList
        scopes={[
          {
            value: "nodes:console",
            label: "Node Console",
            desc: "Open node consoles",
            group: "Nodes",
          },
        ]}
        search=""
        selected={["nodes:console"]}
        onToggle={onToggle}
        inheritedScopes={["nodes:console:nginx-node"]}
        inheritedFromName="viewer"
        nodes={nodes}
        restrictableScopes={["nodes:console"]}
      />
    );

    const baseCheckbox = screen.getAllByRole("checkbox")[0]!;
    expect(baseCheckbox).toBeEnabled();
    fireEvent.click(baseCheckbox);
    expect(onToggle).toHaveBeenCalledWith("nodes:console");
  });
});
