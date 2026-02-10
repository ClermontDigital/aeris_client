import RNPrint from 'react-native-print';
import Share from 'react-native-share';
import {Alert} from 'react-native';
import {Buffer} from 'buffer';

class PrintService {
  async printHtml(html: string): Promise<void> {
    try {
      await RNPrint.print({html});
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
      await Share.open({
        title: 'Aeris POS',
        message: 'Shared from Aeris POS',
        url: `data:text/html;base64,${Buffer.from(html, 'utf-8').toString('base64')}`,
        type: 'text/html',
      });
    } catch {
      // User cancelled share
    }
  }
}

export default new PrintService();
