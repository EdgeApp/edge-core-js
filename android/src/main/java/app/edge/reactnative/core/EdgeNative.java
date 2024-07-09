package app.edge.reactnative.core;

import android.util.Base64;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

class EdgeNative {
  private final Disklet mDisklet;
  private final ExecutorService mPool = Executors.newCachedThreadPool();

  public EdgeNative(File base) {
    mDisklet = new Disklet(base);
  }

  /**
   * Handles a native method call on a separate worker thread.
   *
   * <p>The promise resolution will also happen on this worker thread, so be prepared to bounce back
   * to the UI thread if necessary.
   */
  public void call(@NonNull String name, @NonNull String args, @NonNull PendingCall promise) {
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

  private void handleCall(
      @NonNull String name, @NonNull JSONArray args, @NonNull PendingCall promise)
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

      case "fetch":
        handleFetch(args, promise);
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

  private void handleFetch(@NonNull JSONArray args, @NonNull PendingCall promise)
      throws JSONException {
    String uri = args.getString(0);
    String method = args.getString(1);
    JSONObject headers = args.getJSONObject(2);
    String body = args.optString(3);
    boolean bodyIsBase64 = args.optBoolean(4);

    HttpURLConnection connection = null;
    try {
      // Set up the HTTP connection:
      connection = (HttpURLConnection) new URL(uri).openConnection();
      connection.setRequestMethod(method);
      connection.setDoInput(true);
      connection.setUseCaches(false);

      // HTTPS needs help:
      if (connection instanceof HttpsURLConnection) {
        HttpsURLConnection httpsConnection = (HttpsURLConnection) connection;
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, null, null);
        httpsConnection.setSSLSocketFactory(context.getSocketFactory());
      }

      // Add the headers:
      for (Iterator<String> it = headers.keys(); it.hasNext(); ) {
        String key = it.next();
        connection.setRequestProperty(key, headers.getString(key));
      }

      // Add the body:
      if (body.length() > 0) {
        byte[] bodyData =
            bodyIsBase64
                ? Base64.decode(body, Base64.DEFAULT)
                : body.getBytes(StandardCharsets.UTF_8);
        connection.setRequestProperty("Content-Length", Integer.toString(bodyData.length));
        connection.setDoOutput(true);
        OutputStream outStream = connection.getOutputStream();
        outStream.write(bodyData);
        outStream.flush();
        outStream.close();
      }

      // Make the request:
      connection.connect();

      // Read the response status:
      JSONObject response = new JSONObject();
      response.put("status", connection.getResponseCode());

      // Read the response headers:
      JSONObject responseHeaders = new JSONObject();
      for (int i = 0; true; ++i) {
        @Nullable String key = connection.getHeaderFieldKey(i);
        @Nullable String value = connection.getHeaderField(i);
        if (key == null && i == 0) continue; // Might be the HTTP status
        if (key == null || value == null) break;
        responseHeaders.put(key, value);
      }
      response.put("headers", responseHeaders);

      // Read the response body:
      StreamStringReader responseBody = new StreamStringReader();
      responseBody.read(connection.getInputStream(), responseHeaders.optInt("Content-Length"));
      try {
        response.put("body", responseBody.getUtf8());
        response.put("bodyIsBase64", false);
      } catch (Exception error) {
        response.put("body", responseBody.getBase64());
        response.put("bodyIsBase64", true);
      }

      promise.resolve(response);
    } catch (Exception error) {
      promise.reject("Native fetch: " + error.getMessage());
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  private native byte[] scrypt(byte[] data, byte[] salt, int n, int r, int p, int dklen);

  static {
    System.loadLibrary("edge-core-jni");
  }
}
