#import <React/RCTBridgeModule.h>
#import <ReactCommon/RCTTurboModule.h>

@interface RCT_EXTERN_MODULE(EdgeCoreTurboModule, NSObject)

// Disklet operations
RCT_EXTERN_METHOD(diskletDelete:(NSString *)path
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(diskletGetData:(NSString *)path
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(diskletGetText:(NSString *)path
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(diskletList:(NSString *)path
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(diskletSetData:(NSString *)path
                  base64Data:(NSString *)base64Data
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(diskletSetText:(NSString *)path
                  text:(NSString *)text
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// Network operations
RCT_EXTERN_METHOD(fetch:(NSString *)uri
                  method:(NSString *)method
                  headers:(NSDictionary *)headers
                  body:(NSString *)body
                  bodyIsBase64:(BOOL)bodyIsBase64
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// Crypto operations
RCT_EXTERN_METHOD(randomBytes:(NSNumber *)size
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(scrypt:(NSString *)data
                  salt:(NSString *)salt
                  n:(NSNumber *)n
                  r:(NSNumber *)r
                  p:(NSNumber *)p
                  dklen:(NSNumber *)dklen
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end