-- 룰 알림. 사건 알림(V1)처럼 알림을 따로 쌓지 않고 이미 있는 기록에서 읽는다.
-- 받는 사람은 그 일이 일어난 때에 정해 적어 둔다. 나중에 역할이나 담당자가 바뀌어도 그때 받은 사람의 알림이 그대로다.
--   승인 요청 · 승인 요청 철회                 → 그때의 관리자 전원            rules.event_recipients (V2 에 표만 있었다)
--   승인 · 반려 · 중지 · 재개 · 시험 운영 시작 → 그때의 룰 담당자와 버전 작성자  rules.event_recipients
--   백테스트 완료 · 실패                       → 백테스트를 요청한 사람        rules.backtests.requested_by
--   일일 실행 실패                             → 그때의 룰 담당자와 관리자 전원  rules.execution_recipients (새 표)
-- 그 일을 한 본인에게는 보내지 않는다(백테스트는 요청한 뒤 기다리는 일이라 요청한 사람이 받는다).
-- 누구를 적을지는 RuleService(상태 명령)와 RuleRunStep(일일 실행)이 정한다. 읽음은 review.notification_reads 에 남는다.

CREATE TABLE rules.execution_recipients (
 execution_id BIGINT NOT NULL REFERENCES rules.executions ON DELETE CASCADE,
 user_id BIGINT NOT NULL REFERENCES core.users,
 PRIMARY KEY(execution_id,user_id)
);

CREATE VIEW rules.notifications AS
 WITH named AS (
  -- code 는 화면의 룰 번호(RULE-003). RuleService.code 와 같다.
  SELECT rule_id, name,
   'RULE-'||lpad(rule_id::text, greatest(3,length(rule_id::text)), '0') AS code
  FROM rules.rules
 )
 SELECT recipient.user_id, 'rule-event:'||e.event_id AS notification_id,
 'RULE_'||e.action AS kind, e.business_at AS at,
 CASE e.action WHEN 'SUBMITTED' THEN '룰 승인 요청' WHEN 'WITHDRAWN' THEN '룰 승인 요청 철회'
 WHEN 'APPROVED' THEN '룰 승인' WHEN 'REJECTED' THEN '룰 반려'
 WHEN 'PAUSED' THEN '룰 중지' WHEN 'RESUMED' THEN '룰 재개'
 WHEN 'SHADOW_STARTED' THEN '룰 시험 운영 시작' END AS title,
 -- "룰 이름 v1 · 한 사람 · 사유"
 concat_ws(' · ', n.name||coalesce(' v'||v.version_no,''), actor.name, nullif(e.comment,'')) AS description,
 n.code, 1::bigint AS item_count,
 NULL::bigint AS case_id, 'RULE'::text AS case_kind, NULL::uuid AS batch_run_id
 FROM rules.events e JOIN rules.event_recipients recipient USING(event_id)
 JOIN named n USING(rule_id)
 LEFT JOIN rules.rule_versions v ON v.version_id=e.version_id
 LEFT JOIN core.users actor ON actor.user_id=e.actor_id
 WHERE e.action IN ('SUBMITTED','WITHDRAWN','APPROVED','REJECTED','PAUSED','RESUMED','SHADOW_STARTED')
 UNION ALL
 SELECT b.requested_by, 'rule-backtest:'||b.backtest_id,
 CASE b.status WHEN 'COMPLETED' THEN 'RULE_BACKTEST_DONE' ELSE 'RULE_BACKTEST_FAILED' END,
 coalesce(b.finished_at,b.requested_at),
 CASE b.status WHEN 'COMPLETED' THEN '백테스트 완료' ELSE '백테스트 실패' END,
 n.name||' v'||v.version_no, n.code, 1, NULL::bigint, 'RULE', NULL::uuid
 FROM rules.backtests b JOIN rules.rule_versions v USING(version_id) JOIN named n USING(rule_id)
 WHERE b.status IN ('COMPLETED','FAILED')
 UNION ALL
 SELECT recipient.user_id, 'rule-run:'||x.execution_id, 'RULE_RUN_FAILED', x.finished_at,
 '룰 일일 실행 실패',
 n.name||' v'||v.version_no||' · '||CASE x.mode WHEN 'LIVE' THEN '운영' ELSE '시험 운영' END,
 n.code, 1, NULL::bigint, 'RULE', NULL::uuid
 FROM rules.executions x JOIN rules.execution_recipients recipient USING(execution_id)
 JOIN rules.rule_versions v USING(version_id) JOIN named n USING(rule_id)
 WHERE x.status='FAILED' AND x.finished_at IS NOT NULL;

-- 알림 API 는 review.notifications 하나만 읽는다. 사건 알림 뷰는 이름을 바꿔 그대로 두고, 둘을 합친 것을 그 이름으로 둔다.
ALTER VIEW review.notifications RENAME TO case_notifications;
CREATE VIEW review.notifications AS
 SELECT user_id, notification_id, kind, at, title, description, code, item_count, case_id, case_kind, batch_run_id
 FROM review.case_notifications
 UNION ALL
 SELECT user_id, notification_id, kind, at, title, description, code, item_count, case_id, case_kind, batch_run_id
 FROM rules.notifications;
