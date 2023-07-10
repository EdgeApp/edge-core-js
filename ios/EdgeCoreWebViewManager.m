#import <React/RCTUIManager.h>

@interface RCT_EXTERN_MODULE(EdgeCoreWebViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(onMessage, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onScriptError, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(allowDebugging, BOOL)
RCT_EXPORT_VIEW_PROPERTY(source, NSString)
RCT_EXTERN_METHOD(runJs:(nonnull NSNumber *)reactTag js:(nonnull NSString *)js)
@end
