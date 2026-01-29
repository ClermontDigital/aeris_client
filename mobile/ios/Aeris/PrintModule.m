#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AerisPrint, NSObject)

RCT_EXTERN_METHOD(getPrinters:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(printHtml:(NSString *)html
                  jobName:(NSString *)jobName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
