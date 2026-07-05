/** Set synchronously before router.push — survives tab navigations that drop query params. */
let hideNextAutoSendBubble = false;

export function markCoachSilentAutoSend(): void {
  hideNextAutoSendBubble = true;
}

export function takeCoachSilentAutoSend(): boolean {
  const hide = hideNextAutoSendBubble;
  hideNextAutoSendBubble = false;
  return hide;
}
