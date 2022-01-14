package app.edge.reactnative.core;

import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class Disklet {
  private final File mBase;

  public Disklet(File base) {
    this.mBase = base;
  }

  public void delete(String path) {
    File file = new File(mBase, path);
    deepDelete(file);
  }

  public byte[] getData(String path) throws IOException {
    AtomicFile file = new AtomicFile(new File(mBase, path));
    return file.readFully();
  }

  public String getText(String path) throws IOException {
    AtomicFile file = new AtomicFile(new File(mBase, path));
    byte[] data = file.readFully();
    return new String(data, StandardCharsets.UTF_8);
  }

  public Map<String, String> list(String path) {
    File file = new File(mBase, path);
    try {
      HashMap<String, String> out = new HashMap<String, String>();
      if (file.exists()) {
        if (file.isDirectory()) {
          String prefix = "".equals(path) ? path : path + "/";
          File[] files = file.listFiles();
          for (File child : files) {
            out.put(prefix + child.getName(), child.isDirectory() ? "folder" : "file");
          }
        } else {
          out.put(path, "file");
        }
      }
      return out;
    } catch (Throwable e) {
      return new HashMap<String, String>();
    }
  }

  public void setData(String path, byte[] data) throws IOException {
    File file = new File(mBase, path);
    writeFile(file, data);
  }

  public void setText(String path, String text) throws IOException {
    File file = new File(mBase, path);
    byte[] data = text.getBytes(StandardCharsets.UTF_8);
    writeFile(file, data);
  }

  // helpers -----------------------------------------------------------

  private void deepDelete(File file) {
    if (file.isDirectory()) {
      for (File child : file.listFiles()) deepDelete(child);
    }
    new AtomicFile(file).delete();
  }

  private void writeFile(File file, byte[] data) throws IOException {
    File parent = file.getParentFile();
    if (!parent.exists()) parent.mkdirs();

    AtomicFile atomicFile = new AtomicFile(file);
    FileOutputStream stream = atomicFile.startWrite();
    try {
      stream.write(data);
      atomicFile.finishWrite(stream);
    } catch (IOException e) {
      atomicFile.failWrite(stream);
      throw e;
    }
  }
}
