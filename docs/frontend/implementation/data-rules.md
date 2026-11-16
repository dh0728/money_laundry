<a id="data-and-display-rules"></a>
# 데이터와 화면 표시 규칙

문서 수정: 2026-11-16. 화면 구성은 [구현 인계](frontend-handoff.md), 데이터 전달과 API 미확정 사항은 [API 요구사항](api.md)을 따른다.

<a id="display-id"></a>
## 표시 ID

형식은 `{A|E}-YYMMDD-NNNNNN`이다. `A`는 Alert, `E`는 Episode이며, 날짜 6자리와 일련번호 6자리로 구성한다. 예: `A-261111-000007`, `E-261111-000001`.

- 같은 Alert나 Episode는 모든 화면에서 같은 표시 ID를 사용한다.
- 표시 ID에서 서버 숫자 ID(`alertId`, `caseId`, `episodeId`)를 추출하거나, 반대로 숫자 ID만으로 표시 ID를 만들지 않는다. 변환 규칙은 [미확정](api.md)이며 가짜 데이터에는 두 ID를 각각 둔다.
- 거래 ID `T-…`, `RULE-001` 같은 룰 이름은 이 형식의 적용 대상이 아니다.

<a id="pattern-codes"></a>
## 패턴 코드

구현 기준은 현재 앱의 [codes.ts](../../../frontend/implementation/1.14.0/web-app/src/api/codes.ts)다. [API.md](../../../backend/api-server/API.md) 2.3절은 기존 백엔드 참고 자료다. 아래 표는 현재 `codes.ts`의 키를 사용한다. 특히 코드 3과 4는 `GATHER-SCATTER`, `SCATTER-GATHER`이며 예전 축약명으로 바꾸지 않는다. 작업 대상 앱 경로가 바뀌면 해당 파일을 다시 확인한다.

| 코드 | codes.ts 키 | 화면 이름(태그) | codes.ts 한국어 표시명 |
| --- | --- | --- | --- |
| 0 | NON_PATTERN | NON_PATTERN | 패턴 없는 이상거래 |
| 1 | FAN-OUT | Fan-out | 분산 송금 |
| 2 | FAN-IN | Fan-in | 집중 수취 |
| 3 | GATHER-SCATTER | Gather-scatter | 모아서 뿌리기 |
| 4 | SCATTER-GATHER | Scatter-gather | 뿌려서 모으기 |
| 5 | CYCLE | Cycle | 순환 거래 |
| 6 | RANDOM | Random | 무작위 경로 |
| 7 | BIPARTITE | Bipartite | 그룹 간 교차 송금 |
| 8 | STACK | Stack | 다층 중계 |

- 코드 0은 패턴 없음을 뜻한다. 사람의 '정상' 판정이 아니다.
- `PatternTag`는 `Fan-out 82%`처럼 영어 화면 이름과 확률을 함께 표시한다. 옆에 한국어를 덧붙이지 않는다.
- 유형을 제외할지는 팀에서 결정한다. 화면에서 먼저 없애지 않는다.

<a id="status-age-score"></a>
## 상태·경과일·점수

아래 `StatusTag` 프리셋과 현재 Figma의 의미별 색상 변수를 사용한다.

- 업무 상태는 열람 전, 처리 전, 처리 중, 처리 완료로 구분한다. '완료'로 줄이지 않는다.
- 사람의 판정은 정상 또는 이상이다. '오탐'은 선택지에 넣지 않는다.
- 현재 [대시보드 샘플 데이터](../../../frontend/implementation/1.14.0/web-app/src/next/dashboard-data.ts)는 `riskSettings = { medium: 0.7, high: 0.9 }`를 사용한다([첫 묶음 기록](first-bundle.md)). 이 샘플 설정에서 0.7 미만은 낮음, 0.7 이상 0.9 미만은 주의, 0.9 이상은 위험이다. 운영용 고정 기준이나 합의된 API 계약이 아니다.
- 경과일은 3일 이하 노랑, 3일 초과 7일 이하 주황, 7일 초과 빨강으로 구분한다.
- 점수 범위는 0~1이다. 구간 경계는 룰 엔진 설정에서 받는다(현재는 샘플 설정). 컴포넌트에 숫자를 직접 넣지 않는다. 운영 기준의 백엔드 출처, 룰 버전, 적용 기간은 API 인계 때 확인해야 한다.

<a id="statustag-presets"></a>
## StatusTag 프리셋

업무 상태, 위험도, 경과일, 사람 판정에는 `StatusTag`를 사용한다. 배경은 기존 `Status/*`, 글자와 아이콘은 대응하는 `Status/On/*` 변수를 사용한다. 패턴명은 `PatternTag`, 숫자 점수는 `ScoreTag`, 적용된 필터는 `FilterTag`로 표시한다.

| 프리셋 | 기본 표시명 | 배경 변수 |
| --- | --- | --- |
| abnormal | 이상 | Status/Negative |
| normal | 정상 | Status/Positive |
| unread | 열람 전 | Status/Unread |
| pending | 처리 전 | Status/Pending |
| inProgress | 처리 중 | Status/Info |
| done | 처리 완료 | Status/Positive |
| riskLow | 낮음 | Status/Positive |
| riskMedium | 주의 | Status/Cautionary |
| riskHigh | 위험 | Status/Negative |
| elapsedLow | 3일 경과 | Status/Cautionary |
| elapsedMid | 7일 경과 | Status/Unread |
| elapsedHigh | 13일 경과 | Status/Negative |

경과일 기본 표시명은 예시다. 실제 화면에는 실제 경과일을 표시하고 모래시계 아이콘을 사용한다. 토큰 연결과 컴포넌트 치수는 현재 Figma에서 확인해야 한다. Figma 접근이 중단된 동안에는 확인한 것으로 기록하거나 임의로 바꾸지 않는다.

<a id="names"></a>
## 이름 표시

- 샘플 담당자와 검토자는 `김OO`처럼 가린다. 가짜 데이터에 실명을 넣지 않는다.
- 화면에서 사람을 부를 때는 `님`을 붙인다.

<a id="sample-data"></a>
## 가짜 데이터 일관성

화면 숫자는 적용된 필터, 기간, 권한과 일치해야 한다. 맞지 않으면 시연 전에 고친다.

- 제목의 건수가 `N`이면 행이나 카드도 `N`개다.
- '내 담당'은 현재 사용자에게 배정된 행만 남긴다.
- '사람 판정 이상만'은 사람이 이상으로 판정한 행만 남긴다.
- 기간 표시는 화면에 나오는 거래일·경과일 태그와 일치한다.
- 같은 업무의 표시 ID, 담당자, 상태, 패턴, 점수는 목록과 상세, 카드와 표, 알림 문구에서 모두 일치한다.

<a id="domain-reconciliation"></a>
## 화면 값과 도메인 값의 대응

`codes.ts`에는 `AlertStatus`, `EpisodeStatus`, `AlertResolution`, `EpisodeResolution`도 정의돼 있다. 위 업무 상태 표시명이 저장용 enum 값과 같다고 가정하지 않는다. 화면별로 대응 관계를 기록한다.

기존 `FALSE_POSITIVE` enum과 오탐 선택지를 제외하는 화면 규칙은 아직 맞지 않는다. enum을 삭제하거나 대체 API 값을 만들지 않는다. 해결될 때까지 화면 선택지와 백엔드 값의 대응을 구분해 기록한다.
