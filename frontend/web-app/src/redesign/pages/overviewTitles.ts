// 개요 탭의 패널 순서. "패널 하나씩 보기"의 쪽 번호(1 / N)도 이 순서를 따른다.
export const alertPanelTitles = ['판단 요약', '핵심 계좌', '과거 판단', '처리 이력', '탐지 근거', '씨앗 거래', '돈의 흐름', '룰 적중', '구성 · 거래 16건이 포함된 이유', '데이터 범위·한계'] as const
export const episodePanelTitles = ['판단 요약', '돈의 흐름', '진행 · 최근 처리', '핵심 계좌', '탐지 근거', '룰 적중', '구성 · 거래 29건이 포함된 이유'] as const
export const overviewTitles = { alert: alertPanelTitles, episode: episodePanelTitles } as const
