export function googleCalendarRequestError(data: { error?: string; reconnectRequired?: boolean; permissionRequired?: boolean }, fallback: string) {
  return Object.assign(new Error(data.error || fallback), {
    reconnectRequired: data.reconnectRequired === true || data.permissionRequired === true,
  });
}

export function needsGoogleReconnect(error: unknown) {
  return error instanceof Error && 'reconnectRequired' in error && error.reconnectRequired === true;
}

export function showGoogleConnectAction(configured: boolean, connected: boolean, reconnectRequired: boolean) {
  return configured && (!connected || reconnectRequired);
}
