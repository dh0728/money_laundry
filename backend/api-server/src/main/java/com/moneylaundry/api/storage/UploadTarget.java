package com.moneylaundry.api.storage;

import java.util.Map;

public record UploadTarget(String url, String method, Map<String, String> headers) {}
