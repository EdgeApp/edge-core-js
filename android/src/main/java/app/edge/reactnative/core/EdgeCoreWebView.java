package app.edge.reactnative.core;

import android.graphics.Bitmap;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.events.RCTEventEmitter;

class EdgeCoreWebView extends WebView {
  private static final String BASE_URL = "file:///android_asset/";
  private final ThemedReactContext mContext;

  // react api--------------------------------------------------------------

  private String mSource;

  public void setSource(String source) {
    mSource = source;
    visitPage();
  }

  public void runJs(final String js) {
    post(
        new Runnable() {
          public void run() {
            evaluateJavascript(js.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"), null);
          }
        });
  }

  // view api --------------------------------------------------------------

  public EdgeCoreWebView(ThemedReactContext context) {
    super(context);
    mContext = context;

    getSettings().setAllowFileAccess(true);
    getSettings().setJavaScriptEnabled(true);
    setWebViewClient(new Client());
    addJavascriptInterface(new JsMethods(), "edgeCore");
  }

  @Override
  protected void onDetachedFromWindow() {
    super.onDetachedFromWindow();
    destroy();
  }

  // callbacks -------------------------------------------------------------

  class Client extends WebViewClient {
    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
      if (!BASE_URL.equals(url)) visitPage();
    }
  }

  class JsMethods {
    @JavascriptInterface
    public void postMessage(String message) {
      RCTEventEmitter emitter = mContext.getJSModule(RCTEventEmitter.class);
      WritableMap event = Arguments.createMap();
      event.putString("message", message);
      emitter.receiveEvent(getId(), "onMessage", event);
    }

    @JavascriptInterface
    public void scriptError(String source) {
      RCTEventEmitter emitter = mContext.getJSModule(RCTEventEmitter.class);
      WritableMap event = Arguments.createMap();
      event.putString("source", source);
      emitter.receiveEvent(getId(), "onScriptError", event);
    }
  }

  // utilities -------------------------------------------------------------

  private void visitPage() {
    String source = mSource == null ? BASE_URL + "edge-core-js/edge-core.js" : mSource;
    String html =
        "<!doctype html><html><head>"
            + "<meta charset=\"utf-8\">"
            + "<title>edge-core-js</title>"
            + "<script charset=\"utf-8\" defer src=\""
            + source
            + "\" onerror=\"window.edgeCore.scriptError('"
            + source
            + "')\"></script>"
            + "</head><body></body></html>";
    loadDataWithBaseURL(BASE_URL, html, "text/html", null, null);
  }
}
