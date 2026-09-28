package com.moneylaundry.api.ingest;

/** API.md §1.2 errors[] 한 항목. row는 헤더를 1로 세는 파일 행 번호(헤더 오류는 1). */
public record ValidationError(int row, String column, String reason) {}
