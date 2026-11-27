import { fetchAiReport } from '@/api/aiReport';

// "AI 보고서 다운로드" 때 '이상' 판정마다 서버의 AI 분석 보고서를 받아 PDF 에 넣는다(API.md §14).
// 샘플 모드와 '정상' 판정은 부르지 않는다. 실패한 판정은 aiReportError 로 표시하고 나머지 PDF 는 그대로 만든다.

/** "J-230916-000001" 같은 판정 ID 의 끝 번호가 서버의 판정 번호다. */
export const judgmentNumber = id => {
  const match = /-(\d+)$/.exec(String(id ?? ''));
  return match ? Number(match[1]) : null;
};

export async function attachAiReports(rows, { live = import.meta.env.VITE_API_MODE === 'live', fetch = fetchAiReport } = {}) {
  if (!live) return rows;
  return Promise.all(rows.map(async row => {
    const id = judgmentNumber(row.id);
    if (row.verdict !== 'abnormal' || id == null) return row;
    try {
      return { ...row, aiReport: await fetch(id) };
    } catch (error) {
      return { ...row, aiReportError: error?.message || 'AI 보고서를 만들지 못했습니다.' };
    }
  }));
}

/** PDF 와 화면이 같은 순서로 쓰는 STR 서식 VII 항목 */
export const narrativeSections = [
  ['overview', '분석 요지'], ['subject', '1) 거래자'], ['dates', '2) 거래발생일자'], ['places', '3) 거래발생장소'],
  ['instruments', '4) 수단(상품)'], ['method', '5) 방법(특이거래)'], ['grounds', '6) 혐의거래로 판단한 사유'], ['opinion', '7) 종합의견'],
];
