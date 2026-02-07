package app.edge.reactnative.core;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.RequiresApi;

/**
 * WebViewClient that intercepts requests and serves local assets with COOP/COEP headers.
 *
 * <p>Works with EdgeCoreWebView to serve files from the assets folder with
 * Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers required for
 * SharedArrayBuffer support (needed by mixFetch web workers).
 *
 * <p>Note: WebViewAssetLoader only handles requests within this specific WebView instance. It does
 * not register a system-wide URL handler - other apps cannot access these URLs.
 */
class LocalContentWebViewClient extends WebViewClient {
  /** The domain used for serving local assets. This provides the origin for same-origin policy. */
  static final String ASSET_LOADER_DOMAIN = "edge.bundle";

  /** Base URI for serving bundled assets (e.g., "https://edge.bundle"). */
  static final String BUNDLE_BASE_URI = "https://" + ASSET_LOADER_DOMAIN;

  private final EdgeCoreWebView mWebView;

  LocalContentWebViewClient(EdgeCoreWebView webView) {
    mWebView = webView;
  }

  @Override
  public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
    // Reload on navigation errors (matches iOS didFailProvisionalNavigation behavior)
    mWebView.visitPage();
  }

  @Override
  @RequiresApi(21)
  public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
    Uri uri = request.getUrl();

    // Only intercept requests to our asset loader domain
    if (!ASSET_LOADER_DOMAIN.equals(uri.getHost())) {
      return null; // Let WebView handle external requests normally
    }

    // Get the path without leading slash
    String path = uri.getPath();
    if (path == null || path.isEmpty() || path.equals("/")) {
      return mWebView.createNotFoundResponse();
    }
    String resourcePath = path.startsWith("/") ? path.substring(1) : path;

    // Serve the file with COOP/COEP headers
    return mWebView.serveFileWithHeaders(resourcePath);
  }

  // For API < 21, use the deprecated method
  @Override
  @SuppressWarnings("deprecation")
  public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
    Uri uri = Uri.parse(url);

    // Only intercept requests to our asset loader domain
    if (!ASSET_LOADER_DOMAIN.equals(uri.getHost())) {
      return null;
    }

    String path = uri.getPath();
    if (path == null || path.isEmpty() || path.equals("/")) {
      return mWebView.createNotFoundResponse();
    }
    String resourcePath = path.startsWith("/") ? path.substring(1) : path;

    return mWebView.serveFileWithHeaders(resourcePath);
  }
}
