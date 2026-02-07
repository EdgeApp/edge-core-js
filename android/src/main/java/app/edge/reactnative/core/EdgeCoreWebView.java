package app.edge.reactnative.core;

import android.content.res.AssetManager;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.events.RCTEventEmitter;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;

/**
 * A WebView that loads edge-core-js content using WebViewAssetLoader.
 *
 * <p>Uses WebViewAssetLoader to serve local assets via HTTPS URLs, which: - Provides a proper
 * non-null origin for same-origin policy compliance - Eliminates the need for a local HTTP server -
 * Is more secure (content served directly from assets without network stack)
 *
 * <p>Includes Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers required for
 * SharedArrayBuffer support (needed by mixFetch web workers).
 *
 * <p>Note: WebViewAssetLoader only handles requests within this specific WebView instance. It does
 * not register a system-wide URL handler - other apps cannot access these URLs.
 */
class EdgeCoreWebView extends WebView {
  private static final String TAG = "EdgeCoreWebView";

  /** Default URL for the WebView. Uses the WebViewAssetLoader URL format. */
  private static final String DEFAULT_SOURCE =
      LocalContentWebViewClient.BUNDLE_BASE_URI + "/edge-core-js/index.html";

  private final ThemedReactContext mContext;
  private final EdgeNative mNative;

  // react api--------------------------------------------------------------

  private String mSource;

  public void setSource(String source) {
    mSource = source;
    visitPage();
  }

  public void runJs(String js) {
    post(
        new Runnable() {
          @Override
          public void run() {
            evaluateJavascript(js, null);
          }
        });
  }

  // view api --------------------------------------------------------------

  public EdgeCoreWebView(ThemedReactContext context) {
    super(context);
    mContext = context;
    mNative = new EdgeNative(mContext.getFilesDir());

    getSettings().setAllowFileAccess(false);
    getSettings().setJavaScriptEnabled(true);
    setWebViewClient(new LocalContentWebViewClient(this));
    addJavascriptInterface(new JsMethods(), "edgeCore");

    // WebViewAssetLoader is ready immediately - no async startup needed
    visitPage();
  }

  @Override
  protected void onDetachedFromWindow() {
    super.onDetachedFromWindow();
    destroy();
  }

  // file serving ----------------------------------------------------------

  /**
   * Serve a file from assets with COOP/COEP headers. Package-private for use by
   * LocalContentWebViewClient.
   */
  WebResourceResponse serveFileWithHeaders(String resourcePath) {
    AssetManager assetManager = mContext.getAssets();
    byte[] data = null;

    try (InputStream inputStream = assetManager.open(resourcePath)) {
      data = readAllBytes(inputStream);
      Log.d(TAG, "Serving file: " + resourcePath);
    } catch (IOException e) {
      // File not in assets
    }

    if (data == null) {
      Log.d(TAG, "File not found: " + resourcePath);
      return createNotFoundResponse();
    }

    String mimeType = getMimeType(resourcePath);
    return createResponseWithHeaders(mimeType, data);
  }

  /** Create a WebResourceResponse with COOP/COEP headers for SharedArrayBuffer support. */
  private WebResourceResponse createResponseWithHeaders(String mimeType, byte[] data) {
    Map<String, String> headers = new HashMap<>();
    // CORS headers to allow cross-origin requests (needed for debug mode with localhost)
    headers.put("Access-Control-Allow-Origin", "*");
    headers.put("Cross-Origin-Resource-Policy", "cross-origin");
    // Cross-origin isolation headers required for SharedArrayBuffer (needed by mixFetch web
    // workers)
    headers.put("Cross-Origin-Opener-Policy", "same-origin");
    headers.put("Cross-Origin-Embedder-Policy", "require-corp");

    return new WebResourceResponse(
        mimeType, "UTF-8", 200, "OK", headers, new ByteArrayInputStream(data));
  }

  /** Create a 404 Not Found response. Package-private for use by LocalContentWebViewClient. */
  WebResourceResponse createNotFoundResponse() {
    Map<String, String> headers = new HashMap<>();
    // CORS headers
    headers.put("Access-Control-Allow-Origin", "*");
    headers.put("Cross-Origin-Resource-Policy", "cross-origin");
    // Include COOP/COEP even on error responses
    headers.put("Cross-Origin-Opener-Policy", "same-origin");
    headers.put("Cross-Origin-Embedder-Policy", "require-corp");

    return new WebResourceResponse(
        "text/plain",
        "UTF-8",
        404,
        "Not Found",
        headers,
        new ByteArrayInputStream("Not Found".getBytes()));
  }

  private byte[] readAllBytes(InputStream inputStream) throws IOException {
    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
    byte[] chunk = new byte[4096];
    int bytesRead;
    while ((bytesRead = inputStream.read(chunk)) != -1) {
      buffer.write(chunk, 0, bytesRead);
    }
    return buffer.toByteArray();
  }

  // We only serve HTML, JS, and WASM files
  private String getMimeType(String path) {
    String lowerPath = path.toLowerCase();
    if (lowerPath.endsWith(".html") || lowerPath.endsWith(".htm")) {
      return "text/html";
    } else if (lowerPath.endsWith(".js")) {
      return "application/javascript";
    } else if (lowerPath.endsWith(".wasm")) {
      return "application/wasm";
    }
    return "application/octet-stream";
  }

  // JavaScript interface --------------------------------------------------

  class JsMethods {
    @JavascriptInterface
    public void call(int id, final String name, final String args) {
      mNative.call(name, args, new WebViewPromise(id));
    }

    @JavascriptInterface
    public void postMessage(String message) {
      RCTEventEmitter emitter =
          mContext.getReactApplicationContext().getJSModule(RCTEventEmitter.class);
      WritableMap event = Arguments.createMap();
      event.putString("message", message);
      emitter.receiveEvent(getId(), "onMessage", event);
    }

    @JavascriptInterface
    public void scriptError(String source) {
      RCTEventEmitter emitter =
          mContext.getReactApplicationContext().getJSModule(RCTEventEmitter.class);
      WritableMap event = Arguments.createMap();
      event.putString("source", source);
      emitter.receiveEvent(getId(), "onScriptError", event);
    }
  }

  // utilities -------------------------------------------------------------

  /** Reload the page. Package-private for use by LocalContentWebViewClient. */
  void visitPage() {
    // If source is set, use it directly (e.g., webpack dev server for debugging)
    // Otherwise, use the WebViewAssetLoader URL
    String baseUrl;
    if (mSource != null && !mSource.isEmpty()) {
      baseUrl = mSource;
    } else {
      baseUrl = DEFAULT_SOURCE;
    }

    // Load the page - WebViewAssetLoader intercepts and serves with COOP/COEP headers
    // which are required for SharedArrayBuffer support (needed by mixFetch web workers)
    loadUrl(baseUrl);
  }

  private class WebViewPromise implements PendingCall {
    private final int mId;

    WebViewPromise(int id) {
      mId = id;
    }

    @Override
    public void resolve(Object value) {
      runJs("window.nativeBridge.resolve(" + mId + "," + stringify(value) + ")");
    }

    @Override
    public void reject(String message) {
      runJs("window.nativeBridge.reject(" + mId + "," + stringify(message) + ")");
    }

    private String stringify(Object raw) {
      JSONArray array = new JSONArray();
      array.put(raw);
      String out = array.toString();
      return out.substring(1, out.length() - 1)
          .replace("\u2028", "\\u2028")
          .replace("\u2029", "\\u2029");
    }
  }
}
