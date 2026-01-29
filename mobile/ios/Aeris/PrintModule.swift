import Foundation
import UIKit

@objc(AerisPrint)
class PrintModule: NSObject {

  @objc
  func getPrinters(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    // UIPrintInteractionController doesn't expose printer list
    // Printing uses the system print dialog
    resolve([])
  }

  @objc
  func printHtml(_ html: String, jobName: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      let printController = UIPrintInteractionController.shared
      printController.printingItem = nil

      let printInfo = UIPrintInfo(dictionary: nil)
      printInfo.jobName = jobName
      printInfo.outputType = .general
      printController.printInfo = printInfo

      let formatter = UIMarkupTextPrintFormatter(markupText: html)
      formatter.perPageContentInsets = UIEdgeInsets(top: 36, left: 36, bottom: 36, right: 36)
      printController.printFormatter = formatter

      printController.present(animated: true) { _, completed, error in
        if let error = error {
          reject("PRINT_ERROR", error.localizedDescription, error)
        } else {
          resolve(completed)
        }
      }
    }
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
}
