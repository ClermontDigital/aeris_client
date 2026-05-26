import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import {Alert, Platform, ToastAndroid} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// One-time toast prompt for first-time Android users explaining the
// share-sheet → "Print" flow. Persisted so it only fires once per install.
const ANDROID_PRINT_HINT_KEY = '@aeris/android-print-hint-shown';

// Thrown by printInvoicePdf when the signed URL has expired (HTTP 403 on
// download). Callers catch this class specifically to silently re-mint
// the URL and retry once before surfacing a user-facing error.
export class PdfUrlExpiredError extends Error {
  constructor() {
    super('Signed PDF URL has expired');
    this.name = 'PdfUrlExpiredError';
  }
}

// Strip the query string before logging — signed URLs carry the HMAC
// signature in `?signature=…` and a Sentry breadcrumb / console log
// shouldn't carry that downstream. Keeps host + path for debuggability.
function redactUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '[unparseable url]';
  }
}

class PrintService {
  async printHtml(html: string): Promise<void> {
    try {
      await Print.printAsync({html});
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Print failed';
      if (msg.includes('cancel')) return;
      // Fallback: offer to share
      Alert.alert('Print Failed', 'Would you like to share the content instead?', [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Share',
          onPress: () => this.shareHtml(html),
        },
      ]);
    }
  }

  // Print a URL by fetching its HTML with the user's session cookies.
  // `allowedHost` must be supplied — the caller's configured baseUrl host —
  // so a cookie-bearing fetch can't be redirected to an arbitrary third-
  // party host. Without this gate, a redirect inside the WebView could
  // navigate `currentUrl` off-host and a Print tap would leak the
  // Laravel session cookie to wherever the WebView ended up.
  async printUrl(url: string, allowedHost: string): Promise<void> {
    try {
      // Validate URL scheme to prevent fetching file://, javascript:, etc.
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        Alert.alert('Print Error', 'Only HTTP/HTTPS URLs can be printed.');
        return;
      }

      // Host gate. If the WebView drifted off the deployment host (an SSO
      // bounce, a third-party redirect), refuse to send cookies there.
      let allowedHostname: string;
      try {
        allowedHostname = new URL(allowedHost).hostname.toLowerCase();
      } catch {
        Alert.alert('Print Error', 'Server URL is not valid; cannot print.');
        return;
      }
      if (parsed.hostname.toLowerCase() !== allowedHostname) {
        Alert.alert(
          'Print Error',
          'This page is on a different host than your AERIS server. Printing is blocked to protect your session.',
        );
        return;
      }

      // Fetch the page content and print it
      // credentials: 'include' ensures Laravel session cookies are sent
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, {
        credentials: 'include',
        headers: {
          Accept: 'text/html',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      const html = await response.text();
      await this.printHtml(html);
    } catch {
      Alert.alert('Print Error', 'Unable to load the page for printing.');
    }
  }

  private async shareHtml(html: string): Promise<void> {
    try {
      // Generate a PDF from the HTML and share it — better UX for POS receipts
      const {uri} = await Print.printToFileAsync({html});
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Share Receipt',
      });
    } catch {
      // User cancelled share or sharing not available
    }
  }

  // Print an invoice PDF that's been minted by the deployment. `signedUrl`
  // is a short-lived signed URL — fetched without any Authorization header
  // (signature IS the auth). Caller is expected to gate cloud-mode URLs
  // through the HTTPS guard before calling this.
  //
  //   - iOS: `Print.printAsync({uri})` → native AirPrint dialog. The
  //     cashier picks any AirPrint printer on the device's Wi-Fi.
  //   - Android: `expo-print` won't print a PDF URI on Android, so we
  //     hand off to the system share sheet which exposes "Print" alongside
  //     email/AirDrop/etc. First-time toast cues the user where to look.
  //
  // The PDF lands in `cacheDirectory` (auto-evictable, not iCloud-backed)
  // with a timestamped filename, and is deleted in `finally` regardless
  // of outcome via `deleteAsync({idempotent: true})` so a missing file
  // can never throw.
  async printInvoicePdf(signedUrl: string, saleId: number): Promise<void> {
    const filename = `invoice-${saleId}-${Date.now()}.pdf`;
    const localPath = `${FileSystem.cacheDirectory}${filename}`;
    const breadcrumb = redactUrlForLog(signedUrl);
    console.info('[print] invoice fetch start', {saleId, url: breadcrumb});

    try {
      const result = await FileSystem.downloadAsync(signedUrl, localPath);
      // 403 specifically means the signed URL has expired or been tampered
      // with (Laravel's `signed` middleware response). Surface a typed
      // error so CheckoutScreen can re-mint and retry once silently.
      if (result.status === 403) {
        throw new PdfUrlExpiredError();
      }
      if (result.status !== 200) {
        throw new Error(`PDF download failed (HTTP ${result.status})`);
      }
      // Defence-in-depth: a misconfigured server returning HTML on a
      // /invoice-signed.pdf path would otherwise hand garbage to Print.
      const contentType =
        (result.headers && (result.headers['content-type'] || result.headers['Content-Type'])) ||
        '';
      if (!contentType.toLowerCase().includes('application/pdf')) {
        throw new Error(`Unexpected response content-type: ${contentType}`);
      }

      if (Platform.OS === 'ios') {
        try {
          await Print.printAsync({uri: result.uri});
          console.info('[print] invoice success (AirPrint)', {saleId});
        } catch (printErr: unknown) {
          const msg =
            printErr instanceof Error ? printErr.message : String(printErr);
          if (msg.toLowerCase().includes('cancel')) {
            // User cancelled the AirPrint sheet — not an error.
            return;
          }
          // Most common cause: no AirPrint printer on the network. Fall
          // through to share-sheet so the cashier can still hand off to
          // a desktop printer, AirDrop, or save as PDF.
          console.warn('[print] AirPrint unavailable, falling back to share', {
            saleId,
            reason: msg,
          });
          await Sharing.shareAsync(result.uri, {
            mimeType: 'application/pdf',
            dialogTitle: 'Share invoice',
            UTI: 'com.adobe.pdf',
          });
        }
      } else {
        await this.maybeShowAndroidPrintHint();
        await Sharing.shareAsync(result.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Print invoice',
          UTI: 'com.adobe.pdf',
        });
        console.info('[print] invoice handed to share sheet (android)', {
          saleId,
        });
      }
    } catch (error: unknown) {
      if (error instanceof PdfUrlExpiredError) {
        // Re-thrown for the caller to handle (retry). No user alert here.
        throw error;
      }
      const rawMsg = error instanceof Error ? error.message : 'Print failed';
      // Belt-and-braces: if the URL ever leaked into the message, strip it
      // before logging / showing — query string contains the HMAC signature.
      const safeMsg = rawMsg.replace(signedUrl, redactUrlForLog(signedUrl));
      console.warn('[print] invoice failed', {saleId, error: safeMsg});
      if (safeMsg.includes('cancel')) return;
      Alert.alert(
        'Print failed',
        'We could not download or print the invoice. Please try again.',
      );
    } finally {
      await FileSystem.deleteAsync(localPath, {idempotent: true});
    }
  }

  private async maybeShowAndroidPrintHint(): Promise<void> {
    if (Platform.OS !== 'android') return;
    try {
      const already = await AsyncStorage.getItem(ANDROID_PRINT_HINT_KEY);
      if (already) return;
      ToastAndroid.show(
        "Pick 'Print' from the share sheet",
        ToastAndroid.LONG,
      );
      await AsyncStorage.setItem(ANDROID_PRINT_HINT_KEY, '1');
    } catch {
      // Toast is best-effort UX; never break the print flow because the
      // hint mechanism failed.
    }
  }
}

export default new PrintService();
