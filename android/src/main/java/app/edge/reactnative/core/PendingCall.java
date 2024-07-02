package app.edge.reactnative.core;

public interface PendingCall {
  public void resolve(Object value);

  public void reject(String message);
}
