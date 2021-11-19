package app.edge.reactnative.core;

import android.webkit.WebView;
import androidx.annotation.NonNull;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.common.MapBuilder;
import com.facebook.react.uimanager.SimpleViewManager;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.annotations.ReactProp;
import java.util.HashMap;
import java.util.Map;

public class EdgeCoreWebViewManager extends SimpleViewManager<EdgeCoreWebView> {
  public EdgeCoreWebViewManager(ReactApplicationContext context) {}

  @NonNull
  @Override
  public EdgeCoreWebView createViewInstance(@NonNull ThemedReactContext themedContext) {
    return new EdgeCoreWebView(themedContext);
  }

  @Override
  public Map<String, Object> getExportedCustomDirectEventTypeConstants() {
    final Map<String, Object> constants = new HashMap<>();
    constants.put("onMessage", MapBuilder.of("registrationName", "onMessage"));
    constants.put("onScriptError", MapBuilder.of("registrationName", "onScriptError"));
    return constants;
  }

  @NonNull
  @Override
  public String getName() {
    return "EdgeCoreWebView";
  }

  @Override
  public void receiveCommand(@NonNull EdgeCoreWebView view, String command, ReadableArray args) {
    if ("runJs".equals(command)) {
      view.runJs(args.getString(0));
    }
  }

  @ReactProp(name = "allowDebugging")
  public void setAllowDebugging(@NonNull EdgeCoreWebView view, boolean allow) {
    WebView.setWebContentsDebuggingEnabled(allow);
  }

  @ReactProp(name = "source")
  public void setSource(@NonNull EdgeCoreWebView view, String source) {
    view.setSource(source);
  }
}
