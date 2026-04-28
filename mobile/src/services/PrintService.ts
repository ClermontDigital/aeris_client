import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {Alert} from 'react-native';

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

  async printUrl(url: string): Promise<void> {
    try {
      // Validate URL scheme to prevent fetching file://, javascript:, etc.
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        Alert.alert('Print Error', 'Only HTTP/HTTPS URLs can be printed.');
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
}

export default new PrintService();
