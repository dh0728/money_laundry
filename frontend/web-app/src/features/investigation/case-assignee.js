/**
 * 업무 카드·목록·개요의 담당자 표시. 내 업무는 "내 담당", 남의 업무는 서버가 준 담당자 이름(없으면 아이디)이다.
 * 이름이 없는 샘플 데이터는 예전처럼 "다른 담당자"로 둔다.
 */
export const caseAssigneeLabel = row =>
  row.assigned ? '내 담당' : row.assigneeName || row.assignee || '다른 담당자';
