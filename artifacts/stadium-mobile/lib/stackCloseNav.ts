/**
 * Dismiss a stack/card screen the same way Account / Plans / Notifications do:
 * go back when there is history; otherwise land on Discover without remounting the app.
 */
export function closeStackOrHome(router: {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: "/") => void;
}): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace("/");
}
