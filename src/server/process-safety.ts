let installed = false;

/**
 * Firestore/gRPC can reject in a background task before the awaited request
 * promise settles (e.g. ADC lookup failures). Without this guard Node exits,
 * taking down the whole public API instead of returning a controlled 503.
 */
export function installProcessSafetyHandlers(): void {
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', (reason) => {
    const detail = reason instanceof Error ? reason.stack || reason.message : String(reason);
    console.error('[unhandledRejection]', detail);
  });
}
