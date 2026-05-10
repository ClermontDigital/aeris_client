import path from 'path';
import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { logger } from './logger';

// Reject IPC calls whose senderFrame doesn't match the renderer URL we
// loaded. Defends against an embedded frame or hijacked webContents
// invoking sensitive channels. Tests that don't supply a senderFrame
// pass through unchanged (NODE_ENV='test' bypass).

const isTest = process.env['NODE_ENV'] === 'test';
const devUrl = process.env['ELECTRON_RENDERER_URL'];
// In packaged builds the renderer URL contains the asar path
// (file:///.../app.asar/out/renderer/index.html), so an exact-equality
// check against a __dirname-relative path is dead. Keep just the
// dev-prefix check + a strict suffix match on the renderer's index.html.
const PACKAGED_SUFFIX = '/' + path.posix.join('renderer', 'index.html');

export function assertSenderIsRenderer(event: IpcMainInvokeEvent): void {
  if (isTest) return;
  const frame = (event as unknown as { senderFrame?: { url?: string } | null }).senderFrame;
  if (frame == null) return;
  const url = frame.url ?? '';
  if (devUrl && url.startsWith(devUrl)) return;
  if (url.startsWith('file://') && url.endsWith(PACKAGED_SUFFIX)) return;
  logger.warn('[senderGuard] rejected call from unexpected frame', { url });
  throw new Error('rejected: sender frame is not the trusted renderer');
}

// Convenience wrapper for ipcMain.handle that asserts the sender frame
// before invoking the body. Cuts the per-handler boilerplate from a
// 4-line stanza to a single call site.
type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
export function safeHandle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertSenderIsRenderer(event);
    return (fn as (...a: unknown[]) => unknown)(event, ...args);
  });
}
