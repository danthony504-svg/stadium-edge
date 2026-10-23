import { Platform, Share } from "react-native";
import { readCoachPropAuditReport } from "./coachPropAuditStore";

/** Export only on demand; never upload diagnostics automatically. */
export async function downloadCoachPropAudit(): Promise<"shared" | "saved" | "cancelled" | "empty"> {
  const report = await readCoachPropAuditReport();
  try {
    const parsed = JSON.parse(report);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.rows)) return "empty";
  } catch { return "empty"; }

  const filename = "stadium-edge-prop-audit.json";
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([report], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "saved";
  }

  // Already included in the installed app; no new native dependency/build.
  const fs = await import("expo-file-system/legacy");
  if (Platform.OS === "android") {
    const permission = await fs.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) return "cancelled";
    const uri = await fs.StorageAccessFramework.createFileAsync(permission.directoryUri, filename, "application/json");
    await fs.writeAsStringAsync(uri, report, { encoding: fs.EncodingType.UTF8 });
    return "saved";
  }
  if (!fs.cacheDirectory) throw new Error("Report storage unavailable");
  const uri = `${fs.cacheDirectory}${filename}`;
  await fs.writeAsStringAsync(uri, report, { encoding: fs.EncodingType.UTF8 });
  const result = await Share.share({ url: uri, title: "Stadium Edge prop audit" });
  return result.action === Share.dismissedAction ? "cancelled" : "shared";
}
