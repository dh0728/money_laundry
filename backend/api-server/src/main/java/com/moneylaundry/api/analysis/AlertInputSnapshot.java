package com.moneylaundry.api.analysis;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Called inside FREEZE_INPUT's integration lock and transaction. */
@Component
public class AlertInputSnapshot {
  private final JdbcTemplate jdbc;

  public AlertInputSnapshot(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public void freeze(UUID run, Instant cutoff) {
    freezeManifest(run, cutoff);
    jdbc.update(
        """
        insert into analysis.alert_origins
        select ?, a.alert_id,v.version,v.evidence from alerts a
        join lateral (select v.* from alert_versions v join analysis_runs r using(run_id)
          join batch_jobs b on b.job_id=r.job_id
          where v.alert_id=a.alert_id and r.status='COMPLETED' and b.status='COMPLETED'
          order by v.version desc limit 1) v on true
        left join lateral (select c.run_id from alert_coverage_checks c
          join analysis_runs r using(run_id) join batch_jobs b on b.job_id=r.job_id
          where c.alert_id=a.alert_id and r.status='COMPLETED' and b.status='COMPLETED'
          order by c.checked_at desc nulls last,b.analysis_cutoff_at desc, b.job_id desc limit 1) c on true
        where exists (
          select 1 from (
            select coalesce(current.business_date,previous.business_date) changed_date
            from (select business_date,state from analysis.alert_source_manifest where run_id=?) current
            full join (select business_date,state from analysis.alert_source_manifest
              where run_id=coalesce(c.run_id,v.run_id)) previous using(business_date)
            where current.state is distinct from previous.state
          ) changed
          where exists (select 1 from jsonb_array_elements(v.evidence->'transactions') member
            where changed.changed_date between
              ((member->>'occurredAt')::timestamptz at time zone 'Asia/Seoul')::date-2
              and ((member->>'occurredAt')::timestamptz at time zone 'Asia/Seoul')::date+2))
          and not exists(select 1 from alerts child join alert_versions cv on cv.alert_id=child.alert_id
            join analysis_runs cr on cr.run_id=cv.run_id join batch_jobs cb on cb.job_id=cr.job_id
            where child.parent_alert_id=a.alert_id and cr.status='COMPLETED' and cb.status='COMPLETED')
        """,
        run,
        run);
    var bounds =
        jdbc.queryForMap(
            """
        select min(t)-interval '24 hours' lo, max(t)+interval '24 hours' hi from (
          select occurred_at t from analysis.input_transactions where run_id=?
          union all select (s->>'occurredAt')::timestamptz from analysis.alert_origins o,
          jsonb_array_elements(o.evidence->'seeds') s where o.run_id=?) x
        """,
            run,
            run);
    if (bounds.get("lo") == null) return;
    Timestamp low = (Timestamp) bounds.get("lo"), high = (Timestamp) bounds.get("hi");
    jdbc.update(
        """
        insert into analysis.input_transactions
        select ?,t.tx_id,'CONTEXT',t.occurred_at,t.business_date,a.bank_id,b.bank_id,
          a.service_account_id,b.service_account_id,e.service_entity_id,f.service_entity_id,
          t.amount_received,t.receiving_currency,t.amount_paid,t.payment_currency,
          t.payment_format,t.amount_usd,t.fx_rate_version
        from transactions t join private.accounts a on a.account_id=t.from_account_id
        join private.accounts b on b.account_id=t.to_account_id
        join private.entities e on e.entity_id=a.entity_id join private.entities f on f.entity_id=b.entity_id
        where t.integration_status='ACTIVE' and t.occurred_at between ? and ?
          and not exists(select 1 from analysis.input_transactions i where i.run_id=? and i.tx_id=t.tx_id)
          and exists(select 1 from (
            select occurred_at moment from analysis.input_transactions where run_id=? and input_role='TARGET'
            union all select (seed->>'occurredAt')::timestamptz from analysis.alert_origins o,
              jsonb_array_elements(o.evidence->'seeds') seed where o.run_id=?) windows
            where t.occurred_at between moment-interval '24 hours' and moment+interval '24 hours')
          and exists(select 1 from transaction_reports tr join private.bank_reports br using(report_id)
            join report_sets rs on rs.current_version_id=br.version_id
            join report_versions rv using(version_id) where tr.tx_id=t.tx_id and rv.received_at<=?)
          and not exists(select 1 from transaction_reports tr join private.bank_reports br using(report_id)
            join report_sets rs on rs.current_version_id=br.version_id
            join report_versions rv using(version_id) where tr.tx_id=t.tx_id and rv.received_at>?)
        """,
        run,
        low,
        high,
        run,
        run,
        run,
        Timestamp.from(cutoff),
        Timestamp.from(cutoff));
    jdbc.update(
        """
        insert into analysis_input_reports select ?,tr.tx_id,tr.report_id
        from analysis.input_transactions i join transaction_reports tr using(tx_id)
        join private.bank_reports br using(report_id) join report_sets s on s.current_version_id=br.version_id
        join report_versions v on v.version_id=br.version_id
        where i.run_id=? and v.received_at<=? on conflict do nothing
        """,
        run,
        run,
        Timestamp.from(cutoff));
    jdbc.update(
        """
        insert into analysis.input_scores
        select ?,i.tx_id,s.job_id,to_jsonb(s)-'run_id'-'tx_id'-'job_id'
        from analysis.input_transactions i join transactions t using(tx_id)
        join inference_results s on s.tx_id=t.tx_id and s.job_id=t.scored_job_id
        join batch_jobs b on b.job_id=s.job_id
        where i.run_id=? and b.status='COMPLETED'
        """,
        run,
        run);
    var dates =
        jdbc.queryForList(
            """
        select distinct d::date from (
          select occurred_at moment from analysis.input_transactions where run_id=? and input_role='TARGET'
          union all select (s->>'occurredAt')::timestamptz from analysis.alert_origins o,
            jsonb_array_elements(o.evidence->'seeds') s where o.run_id=?) w,
          lateral generate_series(((moment-interval '24 hours') at time zone 'Asia/Seoul')::date,
            ((moment+interval '24 hours') at time zone 'Asia/Seoul')::date,interval '1 day') d order by 1
        """,
            java.sql.Date.class,
            run,
            run);
    for (java.sql.Date date : dates) {
      LocalDate day = date.toLocalDate();
      jdbc.update(
          """
          insert into analysis.input_coverage
          select ?,?,count(*)::integer,
            count(*) filter(where v.stage_status='ACTIVE' and v.self_valid and v.received_at<=?)::integer,
            count(*)>0 and bool_and(coalesce(v.stage_status='ACTIVE' and v.self_valid and v.received_at<=?,false)),
            coalesce(jsonb_agg(jsonb_build_object('bankId',sb.bank_id,'versionId',v.version_id,
              'status',case when v.received_at<=? then v.stage_status else 'NOT_RECEIVED' end)), '[]'::jsonb)
          from reporting_scope_banks sb left join report_sets rs on rs.bank_id=sb.bank_id and rs.business_date=sb.business_date
          left join report_versions v on v.version_id=rs.current_version_id where sb.business_date=?
          """,
          run,
          day,
          Timestamp.from(cutoff),
          Timestamp.from(cutoff),
          Timestamp.from(cutoff),
          day);
    }
  }

  private void freezeManifest(UUID run, Instant cutoff) {
    jdbc.update(
        """
        insert into analysis.alert_source_manifest(run_id,business_date,state)
        select ?,d.business_date,jsonb_build_object(
          'scopeRevision',s.scope_revision,
          'banks',coalesce((select jsonb_agg(sb.bank_id order by sb.bank_id)
            from reporting_scope_banks sb where sb.business_date=d.business_date),'[]'::jsonb),
          'reports',coalesce((select jsonb_agg(jsonb_build_object(
            'setId',rs.set_id,'bankId',rs.bank_id,'versionId',rv.version_id,
            'revision',rv.revision,'generation',rs.generation,'status',rv.stage_status)
            order by rs.set_id) from report_sets rs
            join report_versions rv on rv.version_id=rs.current_version_id
            where rs.business_date=d.business_date and rv.received_at<=?),'[]'::jsonb))
        from (select business_date from reporting_scopes union select business_date from report_sets) d
        left join reporting_scopes s using(business_date)
        where d.business_date <= (?::timestamptz at time zone 'Asia/Seoul')::date
        """,
        run,
        Timestamp.from(cutoff),
        Timestamp.from(cutoff));
  }
}
