// Renderer-facing event names emitted from main via webContents.send().
// Kept in a dedicated file so the preload bridge and Zustand stores can
// import them without dragging in the rest of the IPC types.

export const EVENT_AUTH_STATE_CHANGED = 'auth:state-changed';
export const EVENT_SETTINGS_CHANGED = 'settings:changed';
export const EVENT_RELAY_ERROR = 'relay:error'; // transient banner trigger
