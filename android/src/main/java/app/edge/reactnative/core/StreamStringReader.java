package app.edge.reactnative.core;

import android.util.Base64;
import androidx.annotation.NonNull;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/** Consumes an input stream and converts it to text. */
class StreamStringReader extends ByteArrayOutputStream {
  public void read(@NonNull InputStream in, int sizeHint) throws IOException {
    int size;
    byte[] data = new byte[sizeHint > 0 ? sizeHint : 4096];
    while ((size = in.read(data)) > 0) {
      write(data, 0, size);
    }
  }

  public @NonNull String getUtf8() throws CharacterCodingException {
    return StandardCharsets.UTF_8
        .newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(buf, 0, count))
        .toString();
  }

  public @NonNull String getBase64() {
    return Base64.encodeToString(buf, 0, count, Base64.NO_WRAP);
  }
}
