// Bound UI waits even when an SDK request never settles. Abort database fetches
// where supported; always clear the timer and handle late promise rejections.
export async function withRequestTimeout(request, message, onTimeout, milliseconds = 15000) {
  let timer;
  try {
    return await Promise.race([
      request,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
          onTimeout?.();
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
