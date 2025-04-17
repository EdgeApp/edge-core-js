package app.edge.reactnative.core;

import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.events.RCTEventEmitter;
import org.json.JSONArray;

class EdgeCoreWebView extends WebView {
  private static final String TAG = "EdgeCoreWebView";
  private final ThemedReactContext mContext;
  private final EdgeNative mNative;
  private BundleHTTPServer mHttpServer;
  private int mServerPort = 0;
  private boolean mServerReady = false;
  private boolean mIsDestroyed = false;
  private final Handler mMainHandler = new Handler(Looper.getMainLooper());

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

    getSettings().setAllowFileAccess(true);
    getSettings().setJavaScriptEnabled(true);
    setWebViewClient(new Client());
    addJavascriptInterface(new JsMethods(), "edgeCore");

    // Start the HTTP server on an ephemeral port bound to loopback only
    mHttpServer = new BundleHTTPServer(context);
    mHttpServer.start(new BundleHTTPServer.OnServerStartedListener() {
      @Override
      public void onServerStarted(int port) {
        mMainHandler.post(() -> {
          // Check if WebView was destroyed before this callback executed
          if (mIsDestroyed) return;
          
          mServerPort = port;
          mServerReady = true;
          // Now that the server is ready with its assigned port, load the page
          visitPage();
        });
      }

      @Override
      public void onServerError(Exception error) {
        Log.e(TAG, "Failed to start HTTP server: " + error.getMessage());
        // Server failed to start - the WebView won't be able to load local content
      }
    });
  }

  @Override
  protected void onDetachedFromWindow() {
    super.onDetachedFromWindow();
    
    // Mark as destroyed first to prevent callbacks from calling methods on destroyed WebView
    mIsDestroyed = true;
    
    // Stop the HTTP server when view is detached
    if (mHttpServer != null) {
      mHttpServer.stop();
      mHttpServer = null;
    }
    
    destroy();
  }

  // callbacks -------------------------------------------------------------

  class Client extends WebViewClient {
    @Override
    public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
      // Reload on navigation errors (matches iOS didFailProvisionalNavigation behavior)
      visitPage();
    }
  }

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

  private String defaultSource() {
    if (!mServerReady) {
      return null;
    }
    return "http://127.0.0.1:" + mServerPort + "/index.html";
  }

  private void visitPage() {
    // If source is set, use it directly (e.g., webpack dev server for debugging)
    // Otherwise, use the local bundle HTTP server with ephemeral port
    String baseUrl;
    if (mSource != null && !mSource.isEmpty()) {
      baseUrl = mSource;
    } else {
      baseUrl = defaultSource();
      if (baseUrl == null) {
        Log.w(TAG, "visitPage called before server is ready");
        return;
      }
    }
    
    // Load the page from the HTTP server to get COOP/COEP headers
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
