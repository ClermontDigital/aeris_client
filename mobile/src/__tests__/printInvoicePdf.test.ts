/**
 * Integration-ish tests for PrintService.printInvoicePdf.
 *
 * We mock expo-print, expo-file-system/legacy, expo-sharing, and
 * AsyncStorage at the module boundary so the test runs without the
 * native side. Platform is forced to iOS for the happy path; the
 * Android share-sheet branch is exercised separately by toggling
 * `Platform.OS` via the react-native mock.
 */

// --- Mocks (must come before the import) ---
jest.mock('expo-print', () => ({
  printAsync: jest.fn().mockResolvedValue(undefined),
  printToFileAsync: jest.fn().mockResolvedValue({uri: 'file:///tmp/x.pdf'}),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  downloadAsync: jest.fn(),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-sharing', () => ({
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('react-native', () => ({
  Platform: {OS: 'ios'},
  Alert: {alert: jest.fn()},
  ToastAndroid: {show: jest.fn(), LONG: 1},
}));

// --- Imports (after mocks) ---
import PrintService, {PdfUrlExpiredError} from '../services/PrintService';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {Alert} from 'react-native';

const downloadAsync = FileSystem.downloadAsync as jest.Mock;
const deleteAsync = FileSystem.deleteAsync as jest.Mock;
const printAsync = Print.printAsync as jest.Mock;
const shareAsync = Sharing.shareAsync as jest.Mock;
const alert = Alert.alert as jest.Mock;

const SIGNED_URL =
  'https://demo.aeris.team/api/v1/sales/42/invoice-signed.pdf?expires=1&signature=abc';

beforeEach(() => {
  jest.clearAllMocks();
  // Default happy-path download: 200 + PDF content type.
  downloadAsync.mockResolvedValue({
    uri: 'file:///cache/invoice-42-123.pdf',
    status: 200,
    headers: {'content-type': 'application/pdf'},
  });
});

describe('PrintService.printInvoicePdf — iOS happy path', () => {
  it('downloads, prints, then deletes the temp file', async () => {
    await PrintService.printInvoicePdf(SIGNED_URL, 42);

    expect(downloadAsync).toHaveBeenCalledTimes(1);
    expect(downloadAsync.mock.calls[0][0]).toBe(SIGNED_URL);

    expect(printAsync).toHaveBeenCalledTimes(1);
    expect(printAsync.mock.calls[0][0]).toEqual({
      uri: 'file:///cache/invoice-42-123.pdf',
    });

    // Cleanup ran with idempotent:true so a missing file can't throw
    expect(deleteAsync).toHaveBeenCalledWith(expect.any(String), {
      idempotent: true,
    });

    expect(alert).not.toHaveBeenCalled();
  });
});

describe('PrintService.printInvoicePdf — error paths', () => {
  it('throws PdfUrlExpiredError on HTTP 403 so caller can re-mint', async () => {
    downloadAsync.mockResolvedValue({
      uri: 'file:///cache/x.pdf',
      status: 403,
      headers: {'content-type': 'application/json'},
    });

    await expect(
      PrintService.printInvoicePdf(SIGNED_URL, 42),
    ).rejects.toBeInstanceOf(PdfUrlExpiredError);

    // No user-facing alert — the caller handles retry / surfaces.
    expect(alert).not.toHaveBeenCalled();
    // Cleanup still ran
    expect(deleteAsync).toHaveBeenCalled();
  });

  it('rejects non-PDF content-type (server misconfig defence)', async () => {
    downloadAsync.mockResolvedValue({
      uri: 'file:///cache/x.pdf',
      status: 200,
      headers: {'content-type': 'text/html'},
    });

    await PrintService.printInvoicePdf(SIGNED_URL, 42);

    expect(printAsync).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      'Print failed',
      expect.any(String),
    );
  });

  it('falls back to share sheet if AirPrint throws non-cancel error', async () => {
    printAsync.mockRejectedValueOnce(new Error('No printer found'));

    await PrintService.printInvoicePdf(SIGNED_URL, 42);

    expect(printAsync).toHaveBeenCalledTimes(1);
    expect(shareAsync).toHaveBeenCalledTimes(1);
    // Cleanup still ran
    expect(deleteAsync).toHaveBeenCalled();
  });

  it('silently swallows user-cancelled AirPrint without alert', async () => {
    printAsync.mockRejectedValueOnce(new Error('User cancelled'));

    await PrintService.printInvoicePdf(SIGNED_URL, 42);

    expect(shareAsync).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });
});
