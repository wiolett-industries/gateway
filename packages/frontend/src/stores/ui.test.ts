import { syncAILiteModeFromStorageValue, useUIStore } from "@/stores/ui";

afterEach(() => {
  useUIStore.setState({
    aiPanelOpen: false,
    aiLiteMode: false,
  });
});

describe("syncAILiteModeFromStorageValue", () => {
  it("applies lite mode changes from persisted UI storage", () => {
    useUIStore.setState({ aiPanelOpen: true, aiLiteMode: false });

    syncAILiteModeFromStorageValue(JSON.stringify({ state: { aiLiteMode: true } }));

    expect(useUIStore.getState()).toMatchObject({
      aiPanelOpen: false,
      aiLiteMode: true,
    });

    syncAILiteModeFromStorageValue(JSON.stringify({ state: { aiLiteMode: false } }));

    expect(useUIStore.getState().aiLiteMode).toBe(false);
  });

  it("ignores malformed and unrelated persisted UI storage", () => {
    useUIStore.setState({ aiLiteMode: true });

    syncAILiteModeFromStorageValue("{bad json");
    syncAILiteModeFromStorageValue(JSON.stringify({ state: { aiLiteMode: "true" } }));
    syncAILiteModeFromStorageValue(JSON.stringify({ state: { sidebarOpen: false } }));

    expect(useUIStore.getState().aiLiteMode).toBe(true);
  });
});
