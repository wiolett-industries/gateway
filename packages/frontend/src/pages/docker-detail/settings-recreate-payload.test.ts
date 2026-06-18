import { describe, expect, it } from "vitest";
import { buildRecreatePayloadFromForm } from "./SettingsTab";

describe("buildRecreatePayloadFromForm", () => {
  const recreateBaseline = {
    imageTag: "latest",
    ports: "[]",
    mounts: "[]",
    entrypoint: "",
    command: "",
    stopTimeout: "10",
    workingDir: "/app",
    user: "node",
    hostname: "gateway",
    labels: "[]",
  };

  it("builds recreate payload with parsed execution fields and trimmed labels", () => {
    expect(
      buildRecreatePayloadFromForm({
        parsedImageName: "registry.example.com/team/app",
        imageTag: "release-1",
        imageTagChanged: true,
        portsChanged: false,
        ports: [],
        mountsChanged: false,
        mounts: [],
        entrypoint: '"/bin/sh" -lc',
        command: 'node "server.js"',
        stopTimeout: "15",
        workingDir: "/srv/app",
        user: "root",
        hostname: "gateway-next",
        labelsChanged: true,
        labels: [
          { key: " service ", value: "backend" },
          { key: "", value: "ignored" },
        ],
        hasRuntimeChanges: true,
        runtimePayload: { restartPolicy: "always" },
        recreateBaseline,
      })
    ).toEqual({
      image: "registry.example.com/team/app:release-1",
      entrypoint: ["/bin/sh", "-lc"],
      command: ["node", "server.js"],
      stopTimeout: 15,
      workingDir: "/srv/app",
      user: "root",
      hostname: "gateway-next",
      labels: {
        service: "backend",
      },
      restartPolicy: "always",
    });
  });

  it("removes the tag suffix and clears entrypoint/command when values are blanked", () => {
    expect(
      buildRecreatePayloadFromForm({
        parsedImageName: "registry.example.com/team/app",
        imageTag: "",
        imageTagChanged: true,
        portsChanged: false,
        ports: [],
        mountsChanged: false,
        mounts: [],
        entrypoint: "   ",
        command: "",
        stopTimeout: "10",
        workingDir: "/app",
        user: "node",
        hostname: "gateway",
        labelsChanged: false,
        labels: [],
        hasRuntimeChanges: false,
        runtimePayload: null,
        recreateBaseline: {
          ...recreateBaseline,
          entrypoint: "/docker-entrypoint.sh",
          command: "node index.js",
        },
      })
    ).toEqual({
      image: "registry.example.com/team/app",
      entrypoint: [],
      command: [],
    });
  });
});
