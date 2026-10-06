-- One notification per Episode transfer event; keep all audit records and stable event IDs.
CREATE OR REPLACE VIEW work_notifications AS
 SELECT c.assignee_id AS user_id, 'batch:'||r.run_id AS notification_id,
 'ALERT_ASSIGNED'::text AS kind, max(c.assigned_at) AS at,
 '새 Alert 배정'::text AS title,
 count(*)||'건의 Alert가 배정되었습니다.' AS description,
 'ANALYSIS-'||r.job_id AS code, count(*) AS item_count,
 NULL::bigint AS case_id, 'ALERT'::text AS case_kind, r.run_id AS batch_run_id
 FROM review_cases c JOIN alert_versions v ON v.alert_id=c.alert_id AND v.version=1
 JOIN analysis_runs r ON r.run_id=v.run_id JOIN batch_jobs b ON b.job_id=r.job_id
 WHERE r.status='COMPLETED' AND b.status='COMPLETED'
 GROUP BY c.assignee_id,r.run_id,r.job_id
 UNION ALL
 SELECT c.assignee_id,'episode:'||c.case_id,'EPISODE_ASSIGNED',c.assigned_at,
 '새 Episode 배정','Episode 조사가 배정되었습니다.','E-'||c.case_id,1,
 c.case_id,c.kind,NULL::uuid FROM review_cases c WHERE c.kind='EPISODE'
 AND NOT EXISTS(SELECT 1 FROM review_events e WHERE e.case_id=c.case_id AND e.action='TRANSFER')
 UNION ALL
 SELECT c.assignee_id,'event:'||e.event_id,e.action,e.business_at,
 CASE e.action WHEN 'COMMENT' THEN '조사 의견 등록' WHEN 'CLOSE' THEN '사건 종결'
 WHEN 'TRANSFER' THEN 'Episode 편입' WHEN 'UNLINK' THEN 'Alert 연결 해제'
 WHEN 'DISSOLVE' THEN 'Episode 해체' END,
 e.comment,CASE c.kind WHEN 'ALERT' THEN 'A-'||c.alert_id ELSE 'E-'||c.case_id END,
 1,c.case_id,c.kind,NULL::uuid
 FROM review_events e JOIN review_cases c ON c.case_id=e.case_id
 WHERE e.action IN ('COMMENT','CLOSE','TRANSFER','UNLINK','DISSOLVE')
 AND (e.action<>'TRANSFER' OR c.kind='EPISODE')
 AND (c.kind='EPISODE' OR EXISTS(
   SELECT 1 FROM alert_versions v JOIN analysis_runs r USING(run_id)
   JOIN batch_jobs b ON b.job_id=r.job_id
   WHERE v.alert_id=c.alert_id AND r.status='COMPLETED' AND b.status='COMPLETED'));
