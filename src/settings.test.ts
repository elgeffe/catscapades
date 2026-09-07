import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";

describe("audio settings", () => {
  it("adds the quiet music default to settings saved before music existed", () => {
    const settings = loadSettings({
      getItem: () => JSON.stringify({
        masterVolume: 0.6,
        effectsVolume: 0.5,
        graphics: "low",
        reducedMotion: true,
        highContrast: false,
      }),
    });

    expect(settings.musicVolume).toBe(0.35);
    expect(settings.masterVolume).toBe(0.6);
    expect(settings.graphics).toBe("low");
  });

  it("persists an explicitly muted music bus", () => {
    const setItem = vi.fn();
    saveSettings({ ...DEFAULT_SETTINGS, musicVolume: 0 }, { setItem });

    expect(setItem).toHaveBeenCalledOnce();
    expect(JSON.parse(setItem.mock.calls[0]?.[1] as string)).toMatchObject({ musicVolume: 0 });
  });
});
