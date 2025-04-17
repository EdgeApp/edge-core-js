package app.edge.reactnative.core;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * A simple HTTP server that serves files from the Android assets folder.
 * Includes Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers
 * required for SharedArrayBuffer support (needed by mixFetch web workers).
 * 
 * Security: Binds to loopback interface only (127.0.0.1) on an ephemeral port
 * to prevent access from other devices on the network.
 */
class BundleHTTPServer {
    private static final String TAG = "BundleHTTPServer";

    private final Context mContext;
    private ServerSocket mServerSocket;
    private ExecutorService mExecutor;
    private final AtomicBoolean mRunning = new AtomicBoolean(false);
    private int mAssignedPort = 0;

    /**
     * Callback interface for server start events.
     */
    public interface OnServerStartedListener {
        void onServerStarted(int port);
        void onServerError(Exception error);
    }

    public BundleHTTPServer(Context context) {
        mContext = context;
    }

    /**
     * Returns the assigned port after the server has started.
     * Returns 0 if the server hasn't started yet.
     */
    public int getAssignedPort() {
        return mAssignedPort;
    }

    /**
     * Starts the HTTP server on an ephemeral port bound to loopback only (127.0.0.1).
     * This prevents other devices on the network from connecting to the server.
     * 
     * @param listener Callback to receive the assigned port or error
     */
    public void start(OnServerStartedListener listener) {
        if (mRunning.get()) {
            if (listener != null && mAssignedPort > 0) {
                listener.onServerStarted(mAssignedPort);
            }
            return;
        }

        mExecutor = Executors.newCachedThreadPool();
        mRunning.set(true);

        new Thread(() -> {
            try {
                // Bind to loopback only (127.0.0.1) on port 0 (ephemeral)
                // This prevents access from other devices on the network
                InetAddress loopback = InetAddress.getByName("127.0.0.1");
                mServerSocket = new ServerSocket(0, 50, loopback);
                
                // Get the assigned ephemeral port
                mAssignedPort = mServerSocket.getLocalPort();
                Log.d(TAG, "BundleHttpServer ready on 127.0.0.1:" + mAssignedPort);
                
                // Notify listener of the assigned port
                if (listener != null) {
                    listener.onServerStarted(mAssignedPort);
                }

                while (mRunning.get()) {
                    try {
                        Socket clientSocket = mServerSocket.accept();
                        mExecutor.execute(() -> handleConnection(clientSocket));
                    } catch (IOException e) {
                        if (mRunning.get()) {
                            Log.e(TAG, "Error accepting connection: " + e.getMessage());
                        }
                    }
                }
            } catch (IOException e) {
                Log.e(TAG, "Failed to start HTTP server: " + e.getMessage());
                mRunning.set(false);
                if (listener != null) {
                    listener.onServerError(e);
                }
            }
        }).start();
    }

    public void stop() {
        mRunning.set(false);

        if (mServerSocket != null) {
            try {
                mServerSocket.close();
            } catch (IOException e) {
                Log.e(TAG, "Error closing server socket: " + e.getMessage());
            }
            mServerSocket = null;
        }

        if (mExecutor != null) {
            mExecutor.shutdown();
            mExecutor = null;
        }

        Log.d(TAG, "BundleHttpServer stopped");
    }

    private void handleConnection(Socket clientSocket) {
        try {
            BufferedReader reader = new BufferedReader(new InputStreamReader(clientSocket.getInputStream()));
            OutputStream output = clientSocket.getOutputStream();

            // Read the request line
            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) {
                clientSocket.close();
                return;
            }

            // Parse method and path
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                sendResponse(output, 400, "Bad Request", "text/plain", "Bad Request".getBytes());
                clientSocket.close();
                return;
            }

            String method = parts[0];
            String path = parts[1];

            // Read and discard headers
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                // Just consume headers
            }

            // Only support GET
            if (!method.equals("GET")) {
                sendResponse(output, 405, "Method Not Allowed", "text/plain", "Method Not Allowed".getBytes());
                clientSocket.close();
                return;
            }

            // Remove query parameters
            int queryIndex = path.indexOf('?');
            if (queryIndex > 0) {
                path = path.substring(0, queryIndex);
            }

            // Require explicit file name - no auto-matching for root path
            if (path.equals("/")) {
                sendResponse(output, 404, "Not Found", "text/plain", "Not Found".getBytes());
                clientSocket.close();
                return;
            }

            // Handle plugin bundle requests (e.g., /plugin/edge-currency-accountbased.bundle/edge-currency-accountbased.js)
            if (path.startsWith("/plugin/")) {
                String pluginPath = path.substring("/plugin/".length());
                servePluginFile(output, pluginPath);
                clientSocket.close();
                return;
            }

            // Remove leading slash and prepend assets path
            String assetPath = "edge-core-js" + path;

            // Try to read the asset (using try-with-resources to ensure stream is closed)
            try {
                AssetManager assetManager = mContext.getAssets();
                try (InputStream inputStream = assetManager.open(assetPath)) {
                    byte[] data = readAllBytes(inputStream);
                    String mimeType = getMimeType(path);
                    sendResponse(output, 200, "OK", mimeType, data);
                }
            } catch (IOException e) {
                Log.d(TAG, "File not found: " + assetPath);
                sendResponse(output, 404, "Not Found", "text/plain", "Not Found".getBytes());
            }

            clientSocket.close();
        } catch (IOException e) {
            Log.e(TAG, "Error handling connection: " + e.getMessage());
            try {
                clientSocket.close();
            } catch (IOException ignored) {
            }
        }
    }

    private void servePluginFile(OutputStream output, String pluginPath) throws IOException {
        AssetManager assetManager = mContext.getAssets();
        byte[] data = null;
        
        // Plugin path format: "edge-currency-accountbased.bundle/edge-currency-accountbased.js"
        // or just: "plugin-bundle.js"
        // Try multiple asset path patterns
        String[] pathsToTry;
        
        if (pluginPath.contains(".bundle/")) {
            // Extract bundle name and file name
            String[] parts = pluginPath.split("\\.bundle/");
            if (parts.length >= 2) {
                String bundleName = parts[0];
                String fileName = parts[1];
                pathsToTry = new String[] {
                    pluginPath,                                    // As-is
                    bundleName + "/" + fileName,                   // Without .bundle
                    bundleName + ".bundle/" + fileName,            // With .bundle as folder
                    fileName,                                      // Just the filename
                    "edge-core/" + pluginPath,                     // In edge-core assets folder
                    "edge-core-js/" + pluginPath                   // In edge-core-js assets folder
                };
            } else {
                pathsToTry = new String[] { pluginPath, "edge-core/" + pluginPath, "edge-core-js/" + pluginPath };
            }
        } else {
            // Just a filename like "plugin-bundle.js"
            // Try to find it in various asset locations
            String fileName = pluginPath;
            int dotIndex = fileName.lastIndexOf('.');
            if (dotIndex > 0) {
                String baseName = fileName.substring(0, dotIndex);
                pathsToTry = new String[] {
                    "edge-core/" + pluginPath,                     // e.g., edge-core/plugin-bundle.js (app's plugin bundle)
                    "edge-core-js/" + pluginPath,                  // e.g., edge-core-js/plugin-bundle.js
                    baseName + ".bundle/" + fileName,              // e.g., plugin-bundle.bundle/plugin-bundle.js
                    baseName + "/" + fileName,                     // e.g., plugin-bundle/plugin-bundle.js
                    pluginPath                                     // Just the filename
                };
            } else {
                pathsToTry = new String[] { "edge-core/" + pluginPath, "edge-core-js/" + pluginPath, pluginPath };
            }
        }
        
        for (String assetPath : pathsToTry) {
            try (InputStream inputStream = assetManager.open(assetPath)) {
                data = readAllBytes(inputStream);
                Log.d(TAG, "Found plugin at: " + assetPath);
                break;
            } catch (IOException e) {
                // Try next path
                Log.d(TAG, "Plugin not found at: " + assetPath);
            }
        }
        
        if (data != null) {
            String mimeType = getMimeType(pluginPath);
            sendResponse(output, 200, "OK", mimeType, data);
        } else {
            Log.e(TAG, "Plugin file not found: " + pluginPath);
            sendResponse(output, 404, "Not Found", "text/plain", ("Not Found: " + pluginPath).getBytes());
        }
    }

    private void sendResponse(OutputStream output, int code, String status, String contentType, byte[] body)
            throws IOException {
        StringBuilder headers = new StringBuilder();
        headers.append("HTTP/1.1 ").append(code).append(" ").append(status).append("\r\n");
        headers.append("Content-Type: ").append(contentType).append("\r\n");
        headers.append("Content-Length: ").append(body.length).append("\r\n");
        headers.append("Connection: close\r\n");
        headers.append("Server: EdgeCoreBundleServer/1.0\r\n");
        // Cross-origin isolation headers required for SharedArrayBuffer (needed by mixFetch web workers)
        headers.append("Cross-Origin-Opener-Policy: same-origin\r\n");
        headers.append("Cross-Origin-Embedder-Policy: require-corp\r\n");
        headers.append("\r\n");

        output.write(headers.toString().getBytes("UTF-8"));
        output.write(body);
        output.flush();
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
}
