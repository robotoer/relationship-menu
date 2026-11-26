/**
 * How to dictate into a text box with the device's own dictation (spec CV-14). We
 * don't record or transcribe anything ourselves: every text box is a plain field, so
 * the keyboard's microphone (phones and tablets) or the system shortcut (computers)
 * works in it. This only says which one applies here.
 */

export const dictationHint = (userAgent: string, maxTouchPoints = 0): string => {
  const ua = userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) {
    return "To dictate, tap the microphone on your keyboard.";
  }
  if (/Android/.test(ua)) return "To dictate, tap the microphone on your keyboard.";
  if (/Macintosh|Mac OS X/.test(ua)) return "To dictate, press the Fn (🌐) key twice, or choose Edit › Start Dictation.";
  if (/Windows/.test(ua)) return "To dictate, press the Windows key + H.";
  if (/CrOS/.test(ua)) return "To dictate, press Search + D (turn on dictation in accessibility settings first).";
  return "You can use your device's dictation to type here.";
};

export const currentDictationHint = () =>
  typeof navigator === "undefined" ? dictationHint("") : dictationHint(navigator.userAgent ?? "", navigator.maxTouchPoints ?? 0);
