const mockCheckForUpdateAsync = jest.fn();
const mockFetchUpdateAsync = jest.fn();
const mockReloadAsync = jest.fn();
const mockLatestContext = { isUpdatePending: false };

Object.defineProperty(global, "__DEV__", { configurable: true, value: false });

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

import { prefetchOtaUpdate } from "./otaUpdater";
import { isOtaReloadBlocked } from "@/lib/otaBlock";

describe("production OTA prefetch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLatestContext.isUpdatePending = false;
    (isOtaReloadBlocked as jest.Mock).mockReturnValue(false);
    Object.defineProperty(global, "__DEV__", { configurable: true, value: false });
  });

  it("does nothing when no compatible update is available", async () => {
    mockCheckForUpdateAsync.mockResolvedValue({ isAvailable: false });
    await expect(prefetchOtaUpdate({ checkForUpdateAsync: mockCheckForUpdateAsync, fetchUpdateAsync: mockFetchUpdateAsync, reloadAsync: mockReloadAsync }, () => mockLatestContext.isUpdatePending)).resolves.toBe("none");
    expect(mockFetchUpdateAsync).not.toHaveBeenCalled();
    expect(mockReloadAsync).not.toHaveBeenCalled();
  });

  it("downloads an available update without reloading the active session", async () => {
    mockCheckForUpdateAsync.mockResolvedValue({ isAvailable: true });
    mockFetchUpdateAsync.mockImplementation(async () => { mockLatestContext.isUpdatePending = true; });
    await expect(prefetchOtaUpdate({ checkForUpdateAsync: mockCheckForUpdateAsync, fetchUpdateAsync: mockFetchUpdateAsync, reloadAsync: mockReloadAsync }, () => mockLatestContext.isUpdatePending)).resolves.toBe("pending");
    expect(mockFetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(mockReloadAsync).not.toHaveBeenCalled();
  });

  it("keeps the running bundle when update download fails", async () => {
    mockCheckForUpdateAsync.mockResolvedValue({ isAvailable: true });
    mockFetchUpdateAsync.mockRejectedValue(new Error("offline"));
    await expect(prefetchOtaUpdate({ checkForUpdateAsync: mockCheckForUpdateAsync, fetchUpdateAsync: mockFetchUpdateAsync, reloadAsync: mockReloadAsync }, () => mockLatestContext.isUpdatePending)).resolves.toBe("none");
    expect(mockReloadAsync).not.toHaveBeenCalled();
  });

  it("stages a compatible update without reloading while Coach blocks reload", async () => {
    (isOtaReloadBlocked as jest.Mock).mockReturnValue(true);
    mockCheckForUpdateAsync.mockResolvedValue({ isAvailable: true });
    mockFetchUpdateAsync.mockImplementation(async () => { mockLatestContext.isUpdatePending = true; });
    await expect(prefetchOtaUpdate({ checkForUpdateAsync: mockCheckForUpdateAsync, fetchUpdateAsync: mockFetchUpdateAsync, reloadAsync: mockReloadAsync }, () => mockLatestContext.isUpdatePending)).resolves.toBe("pending");
    expect(mockReloadAsync).not.toHaveBeenCalled();
  });

  it("applies a staged update once when a safe reload is requested", async () => {
    mockLatestContext.isUpdatePending = true;
    await expect(prefetchOtaUpdate({ checkForUpdateAsync: mockCheckForUpdateAsync, fetchUpdateAsync: mockFetchUpdateAsync, reloadAsync: mockReloadAsync }, () => mockLatestContext.isUpdatePending, true)).resolves.toBe("applied");
    expect(mockReloadAsync).toHaveBeenCalledTimes(1);
  });
});
