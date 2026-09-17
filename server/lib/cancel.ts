// Helpers for cancelling scraper work when nobody is waiting for the result any more
// (e.g. the user pressed Stop or closed the page).

// Combines a request's own timeout signal with an optional caller cancellation signal.
export function withCancel(timeoutSignal: AbortSignal, cancelSignal?: AbortSignal): AbortSignal {
  return cancelSignal ? AbortSignal.any([timeoutSignal, cancelSignal]) : timeoutSignal;
}

interface Closable {
  close(): Promise<unknown>;
}

// Closes a Puppeteer browser as soon as the signal aborts. Returns a function that removes the
// listener; call it once the browser has been closed normally.
export function closeBrowserOnCancel(browser: Closable, cancelSignal?: AbortSignal): () => void {
  if (!cancelSignal) return () => {};
  const close = () => {
    browser.close().catch(() => {});
  };
  if (cancelSignal.aborted) {
    close();
    return () => {};
  }
  cancelSignal.addEventListener("abort", close, { once: true });
  return () => cancelSignal.removeEventListener("abort", close);
}
