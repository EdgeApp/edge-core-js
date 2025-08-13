package app.edge.reactnative.core;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.module.annotations.ReactModule;

@ReactModule(name = EdgeCoreTurboModule.NAME)
public class EdgeCoreTurboModule extends ReactContextBaseJavaModule implements NativeModule {
  public static final String NAME = "EdgeCore";

  private final EdgeNative mNative;

  public EdgeCoreTurboModule(ReactApplicationContext reactContext) {
    super(reactContext);
    mNative = new EdgeNative(reactContext.getFilesDir());
  }

  @Override
  @NonNull
  public String getName() {
    return NAME;
  }

  // MARK: - Disklet operations

  @ReactMethod
  public void diskletDelete(@NonNull String path, @NonNull Promise promise) {
    PendingCall pendingCall = new PendingCall() {
      @Override
      public void resolve(@Nullable Object result) {
        promise.resolve(null);
      }

      @Override
      public void reject(@NonNull String message) {
        promise.reject("DiskletError", message);
      }
    };
    mNative.call("diskletDelete", "[\"" + path + "\"]", pendingCall);
  }

  @ReactMethod
  public void diskletGetData(@NonNull String path, @NonNull Promise promise) {
    PendingCall pendingCall = new PendingCall() {
      @Override
      public void resolve(@Nullable Object result) {
        promise.resolve(result);
      }

      @Override
      public void reject(@NonNull String message) {
        promise.reject("DiskletError", message);
      }
    };
    mNative.call("diskletGetData", "[\"" + path + "\"]", pendingCall);
  }

  @ReactMethod
  public void diskletGetText(@NonNull String path, @NonNull Promise promise) {
    PendingCall pendingCall = new PendingCall() {
      @Override
      public void resolve(@Nullable Object result) {
        promise.resolve(result);
      }

      @Override
      public void reject(@NonNull String message) {
        promise.reject("DiskletError", message);
      }
    };
    mNative.call("diskletGetText", "[\"" + path + "\"]", pendingCall);
  }

  @ReactMethod
  public void diskletList(@NonNull String path, @NonNull Promise promise) {
    PendingCall pendingCall = new PendingCall() {
      @Override
      public void resolve(@Nullable Object result) {
        promise.resolve(result);
      }

      @Override
      public void reject(@NonNull String message) {
        promise.reject("DiskletError", message);
      }
    };
    mNative.call("diskletList", "[\"" + path + "\"]", pendingCall);
  }

  @ReactMethod
  public void diskletSetData(@NonNull String path, @NonNull String base64Data, @NonNull Promise promise) {
    PendingCall pendingCall = new PendingCall() {
      @Override
      public void resolve(@Nullable Object result) {
        promise.resolve(null);
      }

      @Override
      public void reject(@NonNull String message) {
        promise.reject("DiskletError", message);
      }
    };
    String args = "[\"" + path + "\", \"" + base64Data + "\"]";
    mNative.call("diskletSetData", args, pendingCall);
  }

  @ReactMethod
  public void diskletSetText(@NonNull String path, @NonNull String text, @NonNull Promise promise) {
    PendingCall pendingCall = new PendingCall() {
      @Override
      public void resolve(@Nullable Object result) {
        promise.resolve(null);
      }

      @Override
      public void reject(@NonNull String message) {
        promise.reject("DiskletError", message);
      }
    };
    String args = "[\"" + path + "\", \"" + text.replace("\"", "\\\"") + "\"]";
    mNative.call("diskletSetText", args, pendingCall);
  }

  // MARK: - Network operations

  @ReactMethod
  public void fetch(@NonNull String uri, @NonNull String method, @NonNull ReadableMap headers, 
                   @Nullable String body, boolean bodyIsBase64, @NonNull Promise promise) {
    PendingCall pendingCall = new PendingCall() {
      @Override
      public void resolve(@Nullable Object result) {
        promise.resolve(result);
      }

      @Override
      public void reject(@NonNull String message) {
        promise.reject("NetworkError", message);
      }
    };
    
    // Convert ReadableMap to JSON string
    String headersJson = "{}"; // Simplified for now
    String bodyValue = body != null ? "\"" + body + "\"" : "null";
    String args = "[\"" + uri + "\", \"" + method + "\", " + headersJson + ", " + bodyValue + ", " + bodyIsBase64 + "]";
    mNative.call("fetch", args, pendingCall);
  }

  // MARK: - Crypto operations

  @ReactMethod
  public void randomBytes(int size, @NonNull Promise promise) {
    PendingCall pendingCall = new PendingCall() {
      @Override
      public void resolve(@Nullable Object result) {
        promise.resolve(result);
      }

      @Override
      public void reject(@NonNull String message) {
        promise.reject("CryptoError", message);
      }
    };
    mNative.call("randomBytes", "[" + size + "]", pendingCall);
  }

  @ReactMethod
  public void scrypt(@NonNull String data, @NonNull String salt, int n, int r, int p, int dklen, @NonNull Promise promise) {
    PendingCall pendingCall = new PendingCall() {
      @Override
      public void resolve(@Nullable Object result) {
        promise.resolve(result);
      }

      @Override
      public void reject(@NonNull String message) {
        promise.reject("CryptoError", message);
      }
    };
    String args = "[\"" + data + "\", \"" + salt + "\", " + n + ", " + r + ", " + p + ", " + dklen + "]";
    mNative.call("scrypt", args, pendingCall);
  }
}