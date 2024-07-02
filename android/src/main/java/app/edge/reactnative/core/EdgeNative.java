package app.edge.reactnative.core;

import android.util.Base64;
import java.io.File;
import java.io.IOException;
import java.security.SecureRandom;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
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

  private native byte[] scrypt(byte[] data, byte[] salt, int n, int r, int p, int dklen);

  static {
    System.loadLibrary("edge-core-jni");
  }
}
