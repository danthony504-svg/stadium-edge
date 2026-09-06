const checkForUpdateAsync = jest.fn();
const fetchUpdateAsync = jest.fn();
const reloadAsync = jest.fn();
const latestContext = { isUpdatePending: false };

jest.mock("expo-updates", () => ({
  __esModule: true,
  isEnabled: true,
  checkForUpdateAsync,
  fetchUpdateAsync,
  reloadAsync,
  latestContext,
}));

jest.mock("react-native", () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Keyboard: { addListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

jest.mock("@/lib/otaBlock", () => ({ isOtaReloadBlocked: jest.fn(() => false) }));

import { prefetchAndMaybeApplyOta } from "./otaUpdater";

describe("production OTA prefetch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    latestContext.isUpdatePending = false;
    (global as { __DEV__?: boolean }).__DEV__ = false;
  });

  it("does nothing when no compatible update is available", async () => {
    checkForUpdateAsync.mockResolvedValue({ isAvailable: false });
    await expect(prefetchAndMaybeApplyOta()).resolves.toBe("none");
    expect(fetchUpdateAsync).not.toHaveBeenCalled();
    expect(reloadAsync).not.toHaveBeenCalled();
  });

  it("downloads an available update without reloading the active session", async () => {
    checkForUpdateAsync.mockResolvedValue({ isAvailable: true });
    fetchUpdateAsync.mockImplementation(async () => { latestContext.isUpdatePending = true; });
    await expect(prefetchAndMaybeApplyOta()).resolves.toBe("pending");
    expect(fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(reloadAsync).not.toHaveBeenCalled();
  });

  it("keeps the running bundle when update download fails", async () => {
    checkForUpdateAsync.mockResolvedValue({ isAvailable: true });
    fetchUpdateAsync.mockRejectedValue(new Error("offline"));
    await expect(prefetchAndMaybeApplyOta()).resolves.toBe("none");
    expect(reloadAsync).not.toHaveBeenCalled();
  });
});
