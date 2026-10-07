"""Integration primitives shared by initial reports and corrected report components."""

import json
from decimal import Decimal, ROUND_HALF_UP

from psycopg.rows import dict_row

from identity_store import IdentityStore
from report_matching import Report, match
from frozen_input import StaleExecution


def read_reports(db, versions, protector):
    by_id = {v['version_id']:v for v in versions}
    result = {identifier:[] for identifier in by_id}
    with db.cursor(row_factory=dict_row) as cursor:
        cursor.execute('SELECT * FROM private.bank_reports WHERE version_id=ANY(%s) ORDER BY report_id',(list(by_id),))
        for stored in cursor:
            version = stored['version_id']
            payload = protector.decrypt(f"report:{version}:{stored['source_row']}",stored['payload_cipher'],stored['key_version'])
            row = json.loads(payload)
            result[version].append(Report(stored['report_id'],version,by_id[version]['bank_id'],row))
    return result


def scope(db, day):
    new = db.execute('INSERT INTO ingest.reporting_scopes(business_date) VALUES(%s) ON CONFLICT DO NOTHING RETURNING scope_revision',(day,)).fetchone()
    revision = db.execute('SELECT scope_revision FROM ingest.reporting_scopes WHERE business_date=%s',(day,)).fetchone()[0]
    if new:
        db.execute('''INSERT INTO ingest.reporting_scope_banks SELECT %s,%s,bank_id FROM core.bank_reporting_periods
            WHERE effective_from_date<=%s AND (effective_to_date IS NULL OR effective_to_date>=%s)''',(day,revision,day,day))
    banks = {r[0] for r in db.execute('SELECT bank_id FROM ingest.reporting_scope_banks WHERE business_date=%s AND scope_revision=%s',(day,revision))}
    return revision,banks


def attempt(db, day, cutoff, revision, versions):
    identifier = db.execute('''INSERT INTO ingest.integration_attempts(business_date,cutoff_at,scope_revision,status)
        VALUES(%s,%s,%s,'PREPARING') RETURNING attempt_id''',(day,cutoff,revision)).fetchone()[0]
    with db.cursor() as cursor:
        cursor.executemany('INSERT INTO ingest.integration_attempt_versions VALUES(%s,%s,%s,%s)',
            [(identifier,v['version_id'],v['generation'],v['revision']) for v in versions])
    return identifier


def open_correction(db, bank, day, version, code, revision=1):
    return db.execute('''INSERT INTO ingest.correction_requests(bank_id,business_date,version_id,reason_code,source_revision)
        VALUES(%s,%s,%s,%s,%s) ON CONFLICT(bank_id,business_date,version_id,reason_code,source_revision)
        DO UPDATE SET reason_code=excluded.reason_code RETURNING correction_id''',
        (bank,day,version,code,revision)).fetchone()[0]


def insert_matches(db, day, matches, identities, fx_version, retained=None):
    retained = retained or {}
    account_ids = identities.persist(first.row for first,_ in matches)
    rates = dict(db.execute('SELECT currency,units_per_usd FROM core.fx_rates WHERE fx_rate_version=%s',(fx_version,)))
    fresh = [pair for pair in matches if pair[0].id not in retained]
    ids = iter(r[0] for r in db.execute("SELECT nextval(pg_get_serial_sequence('ledger.transactions','tx_id')) FROM generate_series(1,%s)",(len(fresh),)))
    values,links = [],[]
    for first,second in matches:
        row = first.row
        identifier = retained.get(first.id)
        if identifier is None:
            identifier = next(ids)
            rate = rates.get(row['paymentCurrency'])
            if rate is None or rate <= 0:
                raise ValueError('FX_RATE_MISSING')
            amount = (Decimal(str(row['amountPaid'])) / rate).quantize(Decimal('.000001'),rounding=ROUND_HALF_UP)
            values.append((identifier,row['occurredAt'],day,account_ids[(row['fromBank'],row['fromAccount'])],
                account_ids[(row['toBank'],row['toAccount'])],row['amountReceived'],row['receivingCurrency'],
                row['amountPaid'],row['paymentCurrency'],row['paymentFormat'],amount,fx_version))
        for report in (first,second):
            if report is not None:
                role = 'INTERNAL' if row['fromBank']==row['toBank'] else 'SENDER' if report.bank==row['fromBank'] else 'RECEIVER'
                links.append((identifier,report.id,role))
    identities._copy('ledger.transactions','tx_id,occurred_at,business_date,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version',values)
    db.execute('''CREATE TEMP TABLE IF NOT EXISTS prepared_links(tx_id bigint,report_id bigint,report_role text)''')
    db.execute('TRUNCATE prepared_links')
    identities._copy('prepared_links','tx_id,report_id,report_role',links)
    if db.execute('''SELECT EXISTS(SELECT 1 FROM prepared_links p JOIN ledger.transaction_reports old USING(report_id)
        WHERE p.tx_id<>old.tx_id)''').fetchone()[0]:
        raise ValueError('REPORT_ALREADY_LINKED')
    db.execute('INSERT INTO ledger.transaction_reports SELECT * FROM prepared_links ON CONFLICT DO NOTHING')
    db.execute("UPDATE private.bank_reports r SET report_status='ACTIVE',error_code=NULL FROM prepared_links p WHERE p.report_id=r.report_id")
    db.execute('''INSERT INTO evaluation.transaction_labels(tx_id,is_laundering)
        SELECT t.tx_id,bool_and(l.is_laundering) FROM ledger.transaction_reports t JOIN evaluation.report_labels l USING(report_id)
        WHERE t.tx_id IN(SELECT tx_id FROM prepared_links) GROUP BY t.tx_id HAVING count(DISTINCT l.is_laundering)=1
        ON CONFLICT(tx_id) DO UPDATE SET is_laundering=excluded.is_laundering''')


def first_integration(db, day, cutoff, versions, reports, protector, fx_version):
    if not versions:
        return
    integrated = [v for v in versions if v['generation']>0]
    if integrated:
        previous = {r[0] for r in db.execute('''SELECT av.version_id FROM ingest.integration_attempt_versions av
            JOIN ingest.integration_attempts a USING(attempt_id) WHERE a.business_date=%s AND a.status='COMPLETED' ''',(day,))}
        if len(integrated)!=len(versions) or previous != {v['version_id'] for v in versions}:
            raise ValueError('FIXED_INPUT_CHANGED')
        return
    revision,banks = scope(db,day)
    if any(v['bank_id'] not in banks for v in versions):
        raise ValueError('REPORT_OUTSIDE_SCOPE')
    identifier = attempt(db,day,cutoff,revision,versions)
    all_reports = [r for v in versions for r in reports[v['version_id']]]
    identities = IdentityStore(db,protector,all_reports)
    held = {v['version_id'] for v in versions if v['stage_status']=='HELD'}
    held.update(r.version for r in all_reports if r.version not in held and identities.conflicting(r.row))
    invalid_banks = {v['bank_id'] for v in versions if v['version_id'] in held}
    result = match(all_reports,banks,held,invalid_banks)
    insert_matches(db,day,result.matches,identities,fx_version)
    db.execute("UPDATE private.bank_reports SET report_status='DEPENDENCY_HELD',error_code='COUNTERPART_HELD' WHERE report_id=ANY(%s)",(list(result.dependency_reports),))
    for version in versions:
        v = version['version_id']
        direct = v in result.held_versions
        dependent = any(r.id in result.dependency_reports for r in reports[v])
        code = ('INVALID_SELF' if version['stage_status']=='HELD' else result.reasons[v]) if direct else 'COUNTERPART_HELD' if dependent else None
        if direct:
            db.execute("UPDATE private.bank_reports SET report_status='HELD',error_code=coalesce(error_code,%s) WHERE version_id=%s",(result.reasons[v],v))
        db.execute('UPDATE ingest.report_versions SET stage_status=%s,error_code=%s,revision=revision+1 WHERE version_id=%s',
            ('HELD' if direct else 'PARTIALLY_HELD' if dependent else 'ACTIVE',code,v))
        db.execute('UPDATE ingest.report_sets SET current_version_id=%s,generation=generation+1 WHERE set_id=%s AND generation=%s',
            (None if direct else v,version['set_id'],version['generation']))
    db.execute("UPDATE ingest.integration_attempts SET status='COMPLETED' WHERE attempt_id=%s",(identifier,))


def publish_corrections(db, day, protector):
    with db.cursor(row_factory=dict_row) as cursor:
        cursor.execute('''SELECT v.*,s.bank_id FROM ingest.report_versions v JOIN ingest.report_sets s USING(set_id)
            WHERE s.business_date=%s AND v.stage_status IN('HELD','WAITING_COUNTERPART','WAITING_ANALYSIS_RELEASE')''',(day,))
        versions = cursor.fetchall()
    banks = {r[0] for r in db.execute('SELECT bank_id FROM ingest.reporting_scope_banks WHERE business_date=%s',(day,))}
    reported = {r[0] for r in db.execute('SELECT DISTINCT s.bank_id FROM ingest.report_sets s JOIN ingest.report_versions v USING(set_id) WHERE s.business_date=%s',(day,))}
    rows = read_reports(db,[v for v in versions if v['error_code']=='COUNTERPART_MISSING'],protector)
    for v in versions:
        if db.execute('SELECT 1 FROM ingest.correction_uploads WHERE upload_id=%s',(v['upload_id'],)).fetchone():
            continue
        code = v['error_code'] or 'COUNTERPART_MISSING'
        if code == 'COUNTERPART_HELD':
            continue
        absent = set()
        if code == 'COUNTERPART_MISSING':
            for r in rows.get(v['version_id'],[]):
                other = r.row['toBank'] if r.bank == r.row['fromBank'] else r.row['fromBank']
                if other in banks and other not in reported:
                    absent.add(other)
        if absent:
            for bank in absent:
                open_correction(db,bank,day,None,'REPORT_MISSING')
        else:
            open_correction(db,v['bank_id'],day,v['version_id'],code)


class ReportRevisionChanged(RuntimeError):
    pass


def integrate_job(db, job_id, token, protector, fx_version):
    from report_correction import correction_integration
    job = db.execute('SELECT analysis_cutoff_at,status,current_stage,execution_id FROM analysis.jobs WHERE job_id=%s',(job_id,)).fetchone()
    if job is None or job[1:] != ('RUNNING','INTEGRATE',token):
        raise StaleExecution('Integration execution is no longer current')
    cutoff = job[0]
    receipts = db.execute('''SELECT u.business_date,u.upload_id FROM analysis.receipts a JOIN ingest.uploads u USING(upload_id)
        WHERE a.job_id=%s ORDER BY u.business_date,u.upload_id''',(job_id,)).fetchall()
    dates = {}
    for day,upload in receipts:
        dates.setdefault(day,set()).add(upload)
    prepared = {}
    # Decryption and source preparation run before the short ownership/generation check.
    for day,uploads in dates.items():
        if db.execute('''SELECT 1 FROM ingest.report_sets s JOIN ingest.report_versions v ON v.version_id=s.current_version_id
            WHERE s.business_date=%s AND v.received_at>%s''',(day,cutoff)).fetchone():
            raise ValueError('CUTOFF_SUPERSEDED')
        with db.cursor(row_factory=dict_row) as cursor:
            cursor.execute('''SELECT v.*,s.bank_id,s.generation,s.current_version_id FROM ingest.report_versions v
                JOIN ingest.report_sets s USING(set_id) WHERE s.business_date=%s AND v.received_at<=%s
                ORDER BY v.version_no,v.version_id''',(day,cutoff))
            versions = cursor.fetchall()
        eligible = {v['version_id'] for v in versions if v['upload_id'] in uploads}
        if len(eligible)!=len(uploads):
            raise ValueError('FIXED_REPORT_NOT_READY')
        prepared[day] = (versions,eligible,read_reports(db,versions,protector))
    with db.transaction():
        db.execute('SELECT pg_advisory_xact_lock(17004000)')
        current = db.execute('SELECT analysis_cutoff_at,status,current_stage,execution_id FROM analysis.jobs WHERE job_id=%s FOR UPDATE',(job_id,)).fetchone()
        if current != job:
            raise StaleExecution('Integration ownership changed')
        saved = db.execute("SELECT artifact FROM analysis.stage_results WHERE job_id=%s AND stage='INTEGRATE' AND completed",(job_id,)).fetchone()
        if saved:
            db.execute("UPDATE analysis.stage_results SET execution_id=%s WHERE job_id=%s AND stage='INTEGRATE'",(token,job_id))
            return saved[0]
        for day,(versions,eligible,reports) in prepared.items():
            now = db.execute('''SELECT v.version_id,v.revision,s.generation,s.current_version_id
                FROM ingest.report_versions v JOIN ingest.report_sets s USING(set_id) WHERE v.version_id=ANY(%s)''',([v['version_id'] for v in versions],)).fetchall()
            expected = {(v['version_id'],v['revision'],v['generation'],v['current_version_id']) for v in versions}
            if set(now)!=expected:
                raise ReportRevisionChanged('Report generation changed')
            prior = {r[0] for r in db.execute('''SELECT av.version_id FROM ingest.integration_attempt_versions av
                JOIN ingest.integration_attempts a USING(attempt_id) WHERE a.business_date=%s AND a.status='COMPLETED' ''',(day,))}
            unchanged_initial = all(v['version_no']==1 for v in versions) and bool(prior) and prior==eligible
            if unchanged_initial:
                pass
            elif any(v['correction_of_version_id'] is not None or v['version_no']>1 or v['generation']>0 for v in versions):
                correction_integration(db,day,cutoff,versions,eligible,reports,protector,fx_version)
            else:
                selected = [v for v in versions if v['version_id'] in eligible]
                if len({v['set_id'] for v in selected})!=len(selected):
                    raise ValueError('ONE_VERSION_PER_BANK_REQUIRED')
                first_integration(db,day,cutoff,selected,reports,protector,fx_version)
            publish_corrections(db,day,protector)
            db.execute('''INSERT INTO analysis.selected_versions SELECT %s,set_id,current_version_id,generation
                FROM ingest.report_sets WHERE business_date=%s AND current_version_id IS NOT NULL
                ON CONFLICT(job_id,set_id) DO UPDATE SET version_id=excluded.version_id,generation=excluded.generation''',(job_id,day))
        artifact = json.dumps(dict(job_id=job_id,integrated_dates=len(dates)))
        db.execute('''INSERT INTO analysis.stage_results(job_id,stage,execution_id,artifact,completed)
            VALUES(%s,'INTEGRATE',%s,%s,true) ON CONFLICT(job_id,stage) DO UPDATE SET
            execution_id=excluded.execution_id,artifact=excluded.artifact,completed=true''',(job_id,token,artifact))
        return artifact
