# AML 데이터 구조

PostgreSQL 17(`postgres:17-alpine`)을 사용한다. 환경별 업무 DB 하나 안에서 역할별 스키마를 나누며 dev와 prod는 분리한다. 적용 컬럼·키·제약·인덱스의 정본은 [Flyway 마이그레이션](src/main/resources/db/migration)이다. 이 문서는 현재 구조만 설명한다.

## 관계

```mermaid
erDiagram
    banks ||--o{ accounts : bank
    owners ||--o{ accounts : owner
    uploads ||--o{ transactions : loads
    jobs ||--o{ receipts : cutoff
    uploads ||--o{ receipts : received
    jobs ||--o{ runs : executions
    runs ||--o{ input_transactions : freezes
    runs ||--o{ source_manifest : stands_on
    uploads ||--o{ source_manifest : listed
    transactions ||--o{ input_ledger : frozen_versions
    runs ||--o{ scores : computes
    transactions ||--o| current_scores : publishes
    alerts ||--o{ alert_versions : evidence
    alert_versions ||--o{ alert_transactions : evidence_members
    runs ||--o{ alert_plans : prepares
    events ||--o{ event_recipients : notifies
    alerts ||--o{ alert_lineage : relates
    alerts ||--o{ alert_tx_edits : staff_edits
    alerts ||--o{ judgments : judged
    episodes ||--o{ episode_alerts : contains
    alerts ||--o| episode_alerts : belongs
    episodes ||--o{ judgments : judged
    judgments ||--o{ ai_reports : reported
    alerts ||--o{ work_requests : requested
    episodes ||--o{ work_requests : requested
    rules ||--o{ rule_versions : versions
    rules ||--o{ rule_events : changes
    rule_versions ||--o{ rule_backtests : tested
    rule_versions ||--o{ rule_executions : runs
    rule_executions ||--o{ rule_hits : produces
    rule_hits ||--o{ rule_hit_transactions : evidence
```

## 테이블 역할

| 스키마 | 테이블 | 책임 |
|---|---|---|
| core | users | 직원 계정·비밀번호 해시·역할·자동 배정 순서 |
| core | banks | 은행 번호·이름·국가 |
| core | fx_rates | 버전별 고정 환율 |
| core | owners, accounts | 서비스 식별자·저장 가명·은행과 소유주 관계. 계좌 서비스 ID는 `은행번호-은행 안 일련번호`(account_no에서 생성) |
| private | owner_identities, account_identities | 암호화한 원천 식별자·이름과 검색 토큰 |
| ingest | uploads | 거래 기준일별 원장 파일의 발급·수신·적재 상태, 분석 작업과 독립. 기준일당 적재 완료 하나 |
| ledger | transactions | 거래 원장·출처 파일(upload_id)·USD 금액 |
| analysis | jobs, receipts | 분석 상태·고정 수신 목록 |
| analysis | runs | 실행 세대(입력 위치 input_seq, 적용 cutoff) |
| analysis | stage_results, failures | 단계 완료 체크포인트·실패 이력 |
| analysis | input_transactions | 실행별 불변 TARGET 거래값 |
| analysis | input_ledger | 모든 실행이 함께 쓰는 CONTEXT 거래값 장부(바뀔 때만 새 버전) |
| analysis | target_ownership | 미완료 TARGET 실행 소유권 |
| analysis | input_coverage, source_manifest | 날짜별 원장 적재 여부·거래 수, 실행 입력이 기대는 적재 파일 목록 |
| analysis | model_requests, model_tasks | 모델 요청·회차·관측 |
| analysis | features, scores, current_scores | 실행별 피처·점수, 완료 후 공개되는 거래별 점수 참조 |
| analysis | score_ledger | 입력 고정 때의 완료 현재 점수 장부(선행 점수) |
| analysis | alert_origin_ledger | 입력 고정 때의 모든 공개 Alert(종결·병합 별칭 포함) 공개 근거 버전 장부. 실행 산출 연결은 alert_versions.run_id |
| analysis | alert_plans | 실행 토큰·세대·SHA-256으로 검증하는 공개 준비 계획(canonical JSON TEXT) |
| review | alerts | Alert 담당·상태·종결 결과·조사 착수·처리 기한(due_on)·공개 버전·병합 대표 ID·현재 범위 요약/revision/digest |
| review | episodes | Episode 담당·상태·종결 결과·처리 기한(due_on)·현재 범위 요약/revision/digest. Alert와 별도 테이블 |
| review | alert_versions, alert_transactions, alert_coverage_checks | 버전별 불변 생성 근거·거래·커버리지. alert_transactions.seed_risk는 당시 SEED의 p_laundering이며 나머지는 NULL. 현재 위험도는 현재 조사 범위에서 계산해 root summary와 생성 컬럼 risk_score에 저장 |
| review | judgments | Alert 또는 Episode의 판정(정상/이상, 사유 유형, 근거·관찰·판정 사유, 판정자·시각). 유효한 판정은 사건당 하나이며, 재검토로 다시 열면 이전 판정은 superseded_at을 채워 기록으로 남긴다 |
| review | ai_reports | 법정 STR 작성을 위한 분석 보고서. '의심' 판정(judgment_id) 하나를 근거로 만든다. 코드가 만든 사실 목록·표(facts), Claude 서술(ai_output), 담당자 수정본(edited_output), 입력 해시·모델·프롬프트 버전, 생성 상태(GENERATED/FAILED)·실패 코드, 작성자·수정자와 시각. 다시 만들면 새 줄을 쌓고 최신 줄을 보여 준다 |
| review | work_requests | 보관함의 업무 요청·지시(유형, 대상 사건, 보낸 사람·받는 사람, 사유, 기한, 상태, 처리 내용, 적용 시각과 적용 전 상태, 읽지 않은 사람) |
| review | alert_tx_edits | 직원이 Alert에서 뺀 거래(target 없음)와 다른 OPEN Alert로 옮긴 거래(target 있음), 사유·수정자 |
| review | episode_alerts | Episode에 편입된 Alert. Episode 거래는 소속 Alert의 현재 거래 합집합 |
| review | alert_lineage | MERGED_INTO/FOLLOWUP_OF 관계와 원인 이벤트 |
| review | events, event_recipients, notification_reads | 감사 이력·공개 시 고정 수신자·사용자별 알림 읽음 |
| rules | rules, rule_versions | 룰 이름표와 조건을 가진 버전(정의 JSONB·지문·한 줄 요약·상태·revision). 룰마다 운영 버전 1개와 작업 중 버전 1개까지 |
| rules | events, event_recipients | 룰 변경 기록(만들기·저장·초안 삭제·상태 명령)과 알림 수신자 |
| rules | backtests, backtest_subjects | 백테스트 1회와 대상별 결과. 시연 초기화 때 비운다 |
| rules | executions, hits, hit_transactions | 일일 실행(분석 run × 룰 버전), 적중(버전 × 대상 × 날짜)과 근거 거래. 시연 초기화 때 비운다 |
| rules | alert_seeds (뷰) | Alert 생성 룰의 운영 적중의 근거 거래. Alert 생성기가 읽는 유일한 창구 |
| rules | risk_bands | 위험 점수 구간(주의·위험 시작점). 가장 최근 줄이 현재 값 |
| ops | business_clock | 시연 업무 시각 |
| ops | model_risk_bands | 설정 화면의 모델 점수 위험 구간(주의·위험 시작 점수, 한 행). 화면 표시 기준이며 초기화 대상이 아님 |
| ops | dashboard_dirty | component·영향 범위·source transaction별 요청. PIPELINE/INVESTIGATION scope는 component에서 생성 |
| ops | dashboard_refresh_state | 영역별 성공 버전/시각·연속 실패·재시도 시각·소요시간·안전한 오류 코드 |
| ops | dashboard_model_counts | 거래일·탐지일·이진판정·유형별 건수. 수신/분석/의심 건수와 모델 분포 |
| ops | dashboard_tx_hours, dashboard_score_points, dashboard_first_seen | 거래일별 시간대 건수, 점수(1점 단위) 분포, 처음 등장한 계좌·소유주 수. 대시보드 갱신 작업이 채운다 |
| ops | dashboard_case_counts | 상태·담당·생성/배정/종결/첫 열람 시각·Episode 소속별 사건 건수. 정규화 JSON group_key PK, 변경된 키의 차이만 반영 |
| ops | dashboard_case_items | 우선순위/오래된 Episode용 작은 현재 사건 투영. 상세 JSON 없음 |
| ops | dashboard_report_counts | 거래일별 적재 완료되지 않은 원장 업로드 건수 |
| ops | dashboard_delivery_days | 탐지 업무일과 대상 거래일 대응 |
| ops | resets, reset_files | 초기화 작업·파일 삭제 재시도 |
| evaluation | transaction_labels | 거래별 평가 라벨. 적재 때 저장, 분석·화면 입력에서 제외 |

분할 경계는 `alert_versions.evidence.boundaryWitnesses`에 거래 ID와 관계 종류로 고정 보존한다. 현재 관련 Alert 이동 대상은 `alert_transactions`의 거래 인덱스와 공개 포인터로 찾으며 병합·후속 계보와 혼용하지 않는다. `alert_coverage_checks.coverage`는 동일 수신 달력을 씨앗별로 복사하지 않고 `{txIds, days}` 묶음에 한 번 저장한다. 공개 API의 날짜별 coverage 형식은 유지한다.

## 식별자와 저장 원칙

- `core.work_id`는 업로드와 분석 작업의 공통 숫자 ID를 발급한다. 실제 저장소는 `ingest.uploads`와 `analysis.jobs`로 분리한다.
- `review.case_id`는 Alert와 Episode의 공통 숫자 ID를 발급한다. API의 `caseId`는 해당 Alert 또는 Episode ID다. 쓰기는 각 실제 테이블에서 수행한다.
- 소유주는 최초 적재 때 서비스 UUID와 `가명이름#코드`를 확정하여 `core.owners.display_name`에 저장한다. 조회마다 원문 이름을 복호화하거나 가명을 재계산하지 않는다. 원문과 서비스 표시값은 별개다.
- 원장 적재는 원문 이름에서 이름·번호가 없는 범주만 뽑아 `core.owners.entity_type`과 `core.banks.country`에 저장한다. 값을 알 수 없으면 NULL이다. 분석 계정은 고정 입력과 같은 키(소유주 서비스 UUID, 은행 ID)로 이 두 열만 읽고, 이름·가명·내부 소유주 번호·계좌 연결은 읽지 못한다.
- 계좌는 은행 안에서 처음 나타난 순서대로 `account_no`를 받고, 서비스 ID `은행번호-일련번호`(4자리 0채움, 넘으면 그대로)가 생성 열로 만들어진다. 원장 파일의 반복 동일 행은 발생 건수대로 거래가 된다. 파일 행 원문은 보관하지 않는다.
- 분석 입력 고정은 실행마다 복사하지 않는다. `input_ledger`·`score_ledger`·`alert_origin_ledger`는 값이 바뀔 때만 새 버전을 열고 이전 버전을 닫는다(`valid_from_seq`~`valid_to_seq`). 실행은 `analysis.runs.input_seq` 하나로 자기 시점을 가리키고, 그 시점에 유효한 버전이 그 실행이 본 값이다. 바뀐 것을 찾을 때도 전체 거래를 다시 계산하지 않는다. 실행이 적용한 기준 시각(`input_cutoff_at`)을 `analysis.runs`에, 기댄 적재 파일 목록을 `source_manifest`에 남기고, 다음 실행은 직전 실행과 목록이 다른 파일의 거래, 두 기준 시각 사이의 거래만 다시 계산한다. 적재된 거래는 바뀌지 않는다.
- 원장, 고정 분석 입력, Alert 생성 근거는 수명과 의미가 달라 각각 보존한다. 당시 근거 JSON은 불변 증거이며, 조사 소속·판정·Episode 연결은 관계형 테이블로 저장한다.
- 새로운 분석은 기존 Alert 근거 JSON을 복사하지 않고 불변 버전 ID를 참조한다. 조사 변경은 근거 버전을 수정하지 않는다.

## 실행과 공개 경계

Spring은 인증·API·실행 조정·입력 고정·최종 공개를 담당한다. Python은 원장 CSV 검사·원문 보호·적재와 피처·추론 결과 결합·Alert 생성을 담당한다. 프로세스를 바꾸었다는 이유로 계산이 빨라진다고 가정하지 않으며, 대량 COPY와 집합 연산으로 처리한다.

Python의 데이터 변경과 단계 완료 기록은 같은 DB 트랜잭션이다. Spring은 종료 코드만으로 성공 처리하지 않고 현재 실행 토큰에 해당하는 체크포인트를 확인한다. 별도 Python 프로세스가 Spring JDBC 트랜잭션에 참여하지 않는다.

분석 등록 시 cutoff 이하 전체 수신 ID를 고정한다. 오래된 실행의 후속 쓰기는 실행 토큰·현재 run 확인으로 차단한다. Alert 공개 직전에 cutoff까지의 적재 파일 목록이 고정 때와 같은지 다시 확인한다.

점수는 `(run_id, tx_id)`로 저장하며 완료 전에는 `analysis.current_scores`로 공개하지 않는다. Alert 조회는 root published_version과 버전 published_at을 사용하며 완료한 분석의 공개 근거만 반환한다. 미승인 제안 버전은 일반 상세/버전 목록에서 숨긴다. ALERTS worker는 준비 계획만 저장하고, Spring이 run/job 완료와 공개 버전·범위·요약·계보·이벤트·수신자 변경을 한 트랜잭션에서 확정한다. 열린 Alert의 새 거래는 조사 중에도 자동 편입하되 기존 판정·제외·역할을 보존한다. 추가 ID·시각·연결 이유·전후 버전은 이벤트에 남긴다. Episode는 서로 다른 Alert 두 개 이상을 포함하며 한 Alert의 현재 Episode 소속은 최대 하나다. 연결·해제·종결은 관계와 감사 이력을 함께 변경한다.

## 읽기 전용 뷰

`core.assignable_staff`는 비밀번호 해시를 노출하지 않는 배정 후보 목록이다. `ops.work_items`는 작업 목록, `review.cases`는 공통 사건 목록이다. `review.event_history`, `latest_versions`, `current_members`, `visible_cases`, `notifications`는 현재 조사·완료 근거·알림을 조합한다. 업무 상태의 두 번째 저장소나 구 테이블의 쓰기 호환 계층이 아니다.

`analysis.run_inputs`·`run_scores`·`run_alert_origins`·`run_fact_checks`는 실행의 `input_seq`에 유효한 장부 버전(run_inputs는 그 실행의 TARGET 행 포함)을 보여 주는 읽기 전용 뷰다.

`current_members`는 사건의 현재 거래다. Alert는 현재 `published_version` 거래에서 `alert_tx_edits`로 빼거나 옮긴 거래를 반영하고, Episode는 소속 Alert의 현재 거래를 합친다. 거래 상태(PENDING/DECIDED/EXCLUDED/TRANSFERRED)와 판정은 `judgments`에서 계산하며 따로 저장하지 않는다.

현재 사건 목록 API는 `ReviewCaseSql`에서 공개 사건 조회와 저장된 현재 범위 위험도 조회를 분리한다. 목록은 root summary를 읽고 페이지별 전체 근거 JSON/거래 집계를 실행하지 않는다. CaseSummaryStore가 공개/직원 명령과 같은 트랜잭션에서 요약을 갱신한다. 요약은 재구축 가능한 파생값이며 근거와 직원 판정을 대체하지 않는다. 단일 V1에 공개 포인터·계보·계획·요약 구조를 통합했으므로 기존 dev에는 검증 후 초기화 전환이 필요하다.

## 대시보드 집계 경계

정본은 업무 테이블이며 조회용 테이블은 재구축 가능하다. PIPELINE은 MODEL/REPORTS/DELIVERY component를 같은 RR 트랜잭션에서 공개하고, INVESTIGATION은 CASES component를 독립 공개한다. 변경되지 않은 component를 재계산하지 않는다. 전역 완료 대기나 과거값 복제 테이블은 없다.

statement trigger는 실제 집계 입력이 바뀐 old/new 날짜 또는 caseId를 같은 원본 트랜잭션에 기록한다. 사용자 비밀번호·분석 heartbeat·동일값 UPDATE는 제외한다. source_tx 키로 같은 트랜잭션의 중복을 합친다. worker가 보는 스냅샷 이후 커밋된 요청은 삭제되지 않는다. max(xid)를 커밋 순서로 해석하지 않는다.

모델/보고/전달일은 영향 날짜만 교체한다. 사건은 영향 caseId의 이전/새 투영에서 집계 키별 증감을 구해 같은 트랜잭션에 적용한다. group_key는 지표 차원의 JSON 배열이며 시각은 epoch 값으로 정규화해 세션 시간대 차이를 제거한다.0건 키는 커밋 전에 삭제한다. '*'/TRUNCATE는 복구용 전체 재구축이다.

명시적인 영역 잠금키로 API 인스턴스 간 중복 계산을 막는다. dashboard_publication_version 시퀀스는 성공/초기화 세대를 구분하여 이전 실패가 새 성공/초기화 상태를 덮지 못하게 한다. 실패 시 출력/요청 처리는 rollback하고, 실패운영정보는 버전 검사 후 별도 짧은 트랜잭션에 기록한다.

시연 초기화는 같은 영역 잠금을 고정 순서로 확보하고 집계/dirty를 비운 뒤 빈 상태의 운영 행2개를 만든다. 실행 중 집계 잠금을 얻지 못하면 RESET_BUSY다. 초기화 이전 작업이 데이터를 다시 공개하지 못한다. 운영 상태 행과 조회 투영은 시연 업무 건수/확인 fingerprint에 포함하지 않는다.

제한된 Python 분석 역할에는 ops 권한을 주지 않는다. 고정 search_path·schema-qualified SECURITY DEFINER 트리거로만 변경 요청을 기록한다. 조회/집계 주기와 새 응답은 API.md §7을 따른다.

## 초기화 전환

초기 스키마는 빈 DB용이다. 구 Flyway 이력이 있는 DB 위에 적용하거나 validate를 끄지 않는다. 테스트 업무 데이터는 초기화하고 직원 계정·비밀번호 해시·은행·환율·외부 암호키를 보존하여 같은 환경 DB에 복원한다. 새 버전 DB를 추가하지 않는다. 실제 초기화·배포는 대상 확인과 코드 검증 후 수행한다.

룰 엔진 스키마는 `V2__rule_engine.sql` 이다. V1 위에 그대로 적용된다(DB 를 다시 만들지 않는다). 예전 `review.rules`·`review.rule_history` 를 지우므로 거기 있던 룰과 이력은 사라지고, `ledger.transactions(from_account_id,to_account_id,occurred_at)` 인덱스를 만들기 때문에 거래가 쌓인 DB 에서는 적용에 시간이 걸린다.

스키마 분리만으로 원문 접근 차단이 보장되지는 않는다. 원장 적재와 분석 작업의 접속 역할을 분리하고 분석 역할의 private/evaluation 접근 거부를 실제 PostgreSQL에서 검증해야 한다. 외부 추론 서비스에는 DB 자격증명을 전달하지 않는다.

`core.users.last_assigned_at`은 업무 시각과 분리된 배정 순서 값이다. Alert·Episode가 공통 잠금으로 순환하며 DB 시각과 기존 최대값+1마이크로초 중 큰 값으로 진행한다. 계정 설정과 달리 시연 초기화·설정 복원 시 NULL로 초기화한다.
