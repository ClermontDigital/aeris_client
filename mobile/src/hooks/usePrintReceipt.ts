import {useCallback, useRef, useState} from 'react';
import ApiClient from '../services/ApiClient';
import PrintService, {PdfUrlExpiredError} from '../services/PrintService';
import {useSettingsStore} from '../stores/settingsStore';
import {useTransactionActivityStore} from '../stores/transactionActivityStore';
import {useHaptics} from './useHaptics';
import {PDF_PRINT_ENABLED, isSignedUrlSafe} from '../constants/config';
import {buildReceiptHtml} from '../utils/receiptHtml';

// Shared receipt-print flow. Used by CheckoutScreen (just-completed sale)
// and ReceiptViewerScreen (reprint from transactions). Encapsulates:
//   - PDF_PRINT_ENABLED flag branching (new branded A4 PDF vs legacy HTML)
//   - Cloud/direct mode signed-URL minting
//   - HTTPS guard (cloud HTTPS, direct LAN HTTP only)
//   - PdfUrlExpiredError → silent re-mint + single retry
//   - Double-tap protection via ref-based lock
//   - Error haptic + log breadcrumb (caller decides whether to surface)
//
// Returns `printReceipt(saleId)` which resolves on success and throws on
// failure so the calling screen can decide how to surface the error
// (banner, alert, toast).
export function usePrintReceipt() {
  // Cold-start hydration race protection — fall back to 'relay' so the
  // HTTPS guard treats undecided sessions strictly.
  const connectionMode: 'relay' | 'direct' =
    useSettingsStore(s => s.settings.connectionMode) ?? 'relay';
  const haptics = useHaptics();
  const [isPrinting, setIsPrinting] = useState(false);
  const printLockRef = useRef(false);

  const printReceipt = useCallback(
    async (saleId: number) => {
      if (printLockRef.current) return;
      printLockRef.current = true;
      setIsPrinting(true);
      // BLOCKER-2 (§19.2 rule 1): receipt print/settlement is in flight — defer
      // any auto-failover swap so the print round-trip isn't dropped mid-flight.
      useTransactionActivityStore.getState().setSettlementOrPrintInFlight(true);
      try {
        if (PDF_PRINT_ENABLED) {
          const mintAndPrint = async () => {
            const {url} = await ApiClient.getInvoicePdfUrl(saleId);
            if (!isSignedUrlSafe(url, connectionMode)) {
              throw new Error('Refusing to follow insecure signed PDF URL');
            }
            await PrintService.printInvoicePdf(url, saleId);
          };

          try {
            await mintAndPrint();
          } catch (e) {
            if (e instanceof PdfUrlExpiredError) {
              // 2-min TTL elapsed before we got to the printer. Re-mint
              // and retry once silently — best UX vs "URL expired" flash.
              console.info('[print] signed URL expired, re-minting once', {
                saleId,
              });
              await mintAndPrint();
            } else {
              throw e;
            }
          }
        } else {
          // Legacy fallback — phone-rendered HTML. Path through the same
          // PrintService.printHtml so iOS AirPrint dialog still opens.
          const receipt = await ApiClient.getReceipt(saleId);
          const html = buildReceiptHtml(receipt);
          await PrintService.printHtml(html);
        }
      } catch (err: unknown) {
        haptics.error();
        console.warn('[print] receipt failed', {
          saleId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        printLockRef.current = false;
        setIsPrinting(false);
        useTransactionActivityStore
          .getState()
          .setSettlementOrPrintInFlight(false);
      }
    },
    [connectionMode, haptics],
  );

  return {isPrinting, printReceipt};
}
