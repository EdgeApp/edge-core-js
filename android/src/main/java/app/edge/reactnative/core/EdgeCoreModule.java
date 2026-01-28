package app.edge.reactnative.core;

import androidx.annotation.NonNull;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import java.util.HashMap;
import java.util.Map;

/**
 * Native module that exports constants for edge-core-js. Accessible via
 * NativeModules.EdgeCoreModule.getConstants() in JavaScript.
 */
public class EdgeCoreModule extends ReactContextBaseJavaModule {
  public EdgeCoreModule(ReactApplicationContext context) {
    super(context);
  }

  @NonNull
  @Override
  public String getName() {
    return "EdgeCoreModule";
  }

  @Override
  public Map<String, Object> getConstants() {
    final Map<String, Object> constants = new HashMap<>();
    constants.put("bundleBaseUri", LocalContentWebViewClient.BUNDLE_BASE_URI);
    constants.put("rootBaseUri", "file:///android_asset/");
    return constants;
  }
}
