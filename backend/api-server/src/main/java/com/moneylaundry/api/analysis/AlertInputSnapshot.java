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
    // Freeze the full eligible ledger: root windows and transitive seed links
    // are evaluated by one flow policy, not a second calendar policy in SQL.
    jdbc.update(
        """
        insert into analysis.alert_origins
        select ?,a.alert_id,v.version from review.alerts a
        join lateral (select v.version from review.alert_versions v
          join analysis.runs r using(run_id) join analysis.jobs b on b.job_id=r.job_id
          where v.alert_id=a.alert_id and r.status='COMPLETED' and b.status='COMPLETED'
          order by v.version desc limit 1) v on true
        where not exists(select 1 from review.alerts child
          join review.alert_versions cv on cv.alert_id=child.alert_id
          join analysis.runs cr on cr.run_id=cv.run_id join analysis.jobs cb on cb.job_id=cr.job_id
          where child.parent_alert_id=a.alert_id and cr.status='COMPLETED' and cb.status='COMPLETED')
        """,
        run);
    jdbc.update(
        """
        with eligible as materialized (
          select t.tx_id from ledger.transactions t
          join ledger.transaction_reports tr using(tx_id)
          join private.bank_reports br using(report_id)
          join ingest.report_sets rs on rs.current_version_id=br.version_id
          join ingest.report_versions rv using(version_id)
          where t.integration_status='ACTIVE' and t.occurred_at<=?
            and not exists(select 1 from analysis.input_transactions i where i.run_id=? and i.tx_id=t.tx_id)
          group by t.tx_id
          having bool_or(rv.received_at<=?) and not bool_or(rv.received_at>?)
        )
        insert into analysis.input_transactions
        select ?,t.tx_id,'CONTEXT',t.occurred_at,t.business_date,a.bank_id,b.bank_id,
          a.service_account_id,b.service_account_id,e.service_owner_id,f.service_owner_id,
          t.amount_received,t.receiving_currency,t.amount_paid,t.payment_currency,
          t.payment_format,t.amount_usd,t.fx_rate_version
        from eligible c join ledger.transactions t using(tx_id)
        join core.accounts a on a.account_id=t.from_account_id
        join core.accounts b on b.account_id=t.to_account_id
        join core.owners e on e.owner_id=a.owner_id
        join core.owners f on f.owner_id=b.owner_id
        """,
        Timestamp.from(cutoff),
        run,
        Timestamp.from(cutoff),
        Timestamp.from(cutoff),
        run);
    jdbc.update(
        """
        insert into analysis.input_reports select ?,tr.tx_id,tr.report_id
        from analysis.input_transactions i join ledger.transaction_reports tr using(tx_id)
        join private.bank_reports br using(report_id) join ingest.report_sets s on s.current_version_id=br.version_id
        join ingest.report_versions v on v.version_id=br.version_id
        where i.run_id=? and v.received_at<=? on conflict do nothing
        """,
        run,
        run,
        Timestamp.from(cutoff));
    jdbc.update(
        """
        insert into analysis.input_scores
        select ?,i.tx_id,s.run_id,to_jsonb(s)-'run_id'-'tx_id'
        from analysis.input_transactions i join analysis.current_scores c using(tx_id)
        join analysis.scores s on s.tx_id=c.tx_id and s.run_id=c.run_id
        join analysis.runs r on r.run_id=s.run_id
        join analysis.jobs b on b.job_id=r.job_id
        where i.run_id=? and r.status='COMPLETED' and b.status='COMPLETED'
        """,
        run,
        run);
    var dates =
        jdbc.queryForList(
            """
        select d::date from generate_series(
          (select min(business_date)-3 from analysis.input_transactions where run_id=?),
          (?::timestamptz at time zone 'Asia/Seoul')::date, interval '1 day') d order by 1
        """,
            java.sql.Date.class,
            run,
            Timestamp.from(cutoff));
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
          from ingest.reporting_scope_banks sb left join ingest.report_sets rs on rs.bank_id=sb.bank_id and rs.business_date=sb.business_date
          left join ingest.report_versions v on v.version_id=rs.current_version_id where sb.business_date=?
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
        insert into analysis.source_manifest(run_id,business_date,state)
        select ?,d.business_date,jsonb_build_object(
          'scopeRevision',s.scope_revision,
          'banks',coalesce((select jsonb_agg(sb.bank_id order by sb.bank_id)
            from ingest.reporting_scope_banks sb where sb.business_date=d.business_date),'[]'::jsonb),
          'reports',coalesce((select jsonb_agg(jsonb_build_object(
            'setId',rs.set_id,'bankId',rs.bank_id,'versionId',rv.version_id,
            'revision',rv.revision,'generation',rs.generation,'status',rv.stage_status)
            order by rs.set_id) from ingest.report_sets rs
            join ingest.report_versions rv on rv.version_id=rs.current_version_id
            where rs.business_date=d.business_date and rv.received_at<=?),'[]'::jsonb))
        from (select business_date from ingest.reporting_scopes union select business_date from ingest.report_sets) d
        left join ingest.reporting_scopes s using(business_date)
        where d.business_date <= (?::timestamptz at time zone 'Asia/Seoul')::date
        """,
        run,
        Timestamp.from(cutoff),
        Timestamp.from(cutoff));
  }
}
