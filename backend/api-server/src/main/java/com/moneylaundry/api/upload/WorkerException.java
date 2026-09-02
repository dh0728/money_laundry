package com.moneylaundry.api.upload;

public class WorkerException extends RuntimeException {

  public WorkerException(String message) {
    super(message);
  }

  public WorkerException(String message, Throwable cause) {
    super(message, cause);
  }
}
