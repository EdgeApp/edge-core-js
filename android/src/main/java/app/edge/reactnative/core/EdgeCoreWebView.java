package app.edge.reactnative.core;

import android.graphics.Bitmap;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.events.RCTEventEmitter;
import java.io.IOException;
import java.security.SecureRandom;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

class EdgeCoreWebView extends WebView {
  private static final String BASE_URL = "file:///android_asset/";
  private final ExecutorService mPool = Executors.newCachedThreadPool();
  private final ThemedReactContext mContext;
  private final Disklet mDisklet;

  // react api--------------------------------------------------------------

  private String mSource;

  public void setSource(String source) {
    mSource = source;
    visitPage();
  }

  public void runJs(String js) {
    final String clean = js.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
    post(
        new Runnable() {
          @Override
          public void run() {
            evaluateJavascript(clean, null);
          }
        });
  }

  // view api --------------------------------------------------------------

  public EdgeCoreWebView(ThemedReactContext context) {
    super(context);
    mContext = context;
    mDisklet = new Disklet(mContext.getFilesDir());

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
    public void call(int id, final String name, final String args) {
      final PendingCall promise = new PendingCall(id);

      mPool.execute(
          new Runnable() {
            @Override
            public void run() {
              try {
                handleCall(name, new JSONArray(args), promise);
              } catch (Throwable error) {
                promise.reject(error.getMessage());
              }
            }
          });
    }

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

  private void handleCall(String name, JSONArray args, PendingCall promise)
      throws IOException, JSONException {
    switch (name) {
      case "diskletDelete":
        mDisklet.delete(args.getString(0));
        promise.resolve(null);
        break;
      case "diskletGetData":
        promise.resolve(Base64.encodeToString(mDisklet.getData(args.getString(0)), Base64.NO_WRAP));
        break;
      case "diskletGetText":
        promise.resolve(mDisklet.getText(args.getString(0)));
        break;
      case "diskletList":
        promise.resolve(new JSONObject(mDisklet.list(args.getString(0))));
        break;
      case "diskletSetData":
        mDisklet.setData(args.getString(0), Base64.decode(args.getString(1), Base64.DEFAULT));
        promise.resolve(null);
        break;
      case "diskletSetText":
        mDisklet.setText(args.getString(0), args.getString(1));
        promise.resolve(null);
        break;
      case "randomBytes":
        {
          SecureRandom sr = new SecureRandom();
          byte[] entropy = new byte[args.getInt(0)];
          sr.nextBytes(entropy);
          promise.resolve(Base64.encodeToString(entropy, Base64.NO_WRAP));
        }
        break;
      case "scrypt":
        {
          byte[] data = Base64.decode(args.getString(0), Base64.DEFAULT);
          byte[] salt = Base64.decode(args.getString(1), Base64.DEFAULT);
          int n = args.getInt(2);
          int r = args.getInt(3);
          int p = args.getInt(4);
          int dklen = args.getInt(5);
          byte[] out = scrypt(data, salt, n, r, p, dklen);
          if (out == null) promise.reject("Failed scrypt");
          else promise.resolve(Base64.encodeToString(out, Base64.NO_WRAP));
        }
        break;
      default:
        promise.reject("No method " + name);
    }
  }

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

  private class PendingCall {
    private final int mId;

    PendingCall(int id) {
      mId = id;
    }

    public void resolve(Object value) {
      runJs("window.nativeBridge.resolve(" + mId + "," + stringify(value) + ")");
    }

    public void reject(String message) {
      runJs("window.nativeBridge.reject(" + mId + "," + stringify(message) + ")");
    }

    private String stringify(Object raw) {
      JSONArray array = new JSONArray();
      array.put(raw);
      String out = array.toString();
      return out.substring(1, out.length() - 1);
    }
  }

  private native byte[] scrypt(byte[] data, byte[] salt, int n, int r, int p, int dklen);

  static {
    System.loadLibrary("edge-core-jni");
  }
}
