const mockCheckForUpdateAsync = jest.fn();
const mockFetchUpdateAsync = jest.fn();
const mockReloadAsync = jest.fn();
const mockLatestContext = { isUpdatePending: false };

jest.mock("expo-updates", () => ({
  __esModule: true,
  isEnabled: true,
  checkForUpdateAsync: mockCheckForUpdateAsync,
  fetchUpdateAsync: mockFetchUpdateAsync,
  reloadAsync: mockReloadAsync,
  latestContext: mockLatestContext,
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
    mockLatestContext.isUpdatePending = false;
    (global as { __DEV__?: boolean }).__DEV__ = false;
  });

  it("does nothing when no compatible update is available", async () => {
    mockCheckForUpdateAsync.mockResolvedValue({ isAvailable: false });
    await expect(prefetchAndMaybeApplyOta()).resolves.toBe("none");
    expect(mockFetchUpdateAsync).not.toHaveBeenCalled();
    expect(mockReloadAsync).not.toHaveBeenCalled();
  });

  it("downloads an available update without reloading the active session", async () => {
    mockCheckForUpdateAsync.mockResolvedValue({ isAvailable: true });
    mockFetchUpdateAsync.mockImplementation(async () => { mockLatestContext.isUpdatePending = true; });
    await expect(prefetchAndMaybeApplyOta()).resolves.toBe("none");
    expect(mockFetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(mockReloadAsync).not.toHaveBeenCalled();
  });

  it("keeps the running bundle when update download fails", async () => {
    mockCheckForUpdateAsync.mockResolvedValue({ isAvailable: true });
    mockFetchUpdateAsync.mockRejectedValue(new Error("offline"));
    await expect(prefetchAndMaybeApplyOta()).resolves.toBe("none");
    expect(mockReloadAsync).not.toHaveBeenCalled();
  });
});
