import RNPrint from 'react-native-print';
import Share from 'react-native-share';
import {Alert} from 'react-native';

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
      // Fetch the page content and print it
      const response = await fetch(url);
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
        url: `data:text/html;base64,${btoa(html)}`,
        type: 'text/html',
      });
    } catch {
      // User cancelled share
    }
  }
}

export default new PrintService();
