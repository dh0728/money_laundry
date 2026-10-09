package com.moneylaundry.api.storage;

import java.util.Map;

/** 은행이 파일을 올릴 대상(URL·HTTP 메서드·필수 헤더). */
public record UploadTarget(String url, String method, Map<String, String> headers) {}
