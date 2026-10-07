"""Whole-report correction with completed-target protection and run fencing."""

from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from uuid import uuid4

from psycopg.types.json import Jsonb

from identity_store import IdentityStore
from report_matching import key, match
from report_integration import attempt, insert_matches, open_correction, scope


def identity(row):
    return key(row) + tuple(row[k] for k in ('paymentFormat','fromBankName','toBankName',
        'fromEntityId','fromEntityName','toEntityId','toEntityName'))


def cancel_affected(db, changed):
    runs = db.execute('''SELECT DISTINCT r.run_id,r.job_id FROM analysis.input_transactions i
        JOIN analysis.runs r USING(run_id) WHERE i.tx_id=ANY(%s) AND r.status IN('READY','ACTIVE')
        ORDER BY r.run_id''',(list(changed),)).fetchall()
    for run,job in runs:
        db.execute("UPDATE analysis.runs SET status='CANCEL_REQUESTED',cancel_requested_at=now(),cancel_reason='REPORT_CORRECTED' WHERE run_id=%s",(run,))
        db.execute("""UPDATE analysis.jobs SET status='FAILED',error_code='RUN_CANCELLED',
            error_message='정정으로 실행이 취소되었습니다.',execution_id=NULL,execution_owner=NULL,retry_at=NULL WHERE current_run_id=%s""",(run,))
        db.execute("""UPDATE analysis.model_tasks SET status='CANCELLED',execution_id=NULL,execution_owner=NULL,
            retry_at=NULL,next_poll_at=NULL,error_code='RUN_CANCELLED',action_required=false,updated_at=now(),
            finished_at=coalesce(finished_at,now()) WHERE run_id=%s AND status<>'CANCELLED'""",(run,))
        db.execute("UPDATE analysis.model_requests SET status='BLOCKED' WHERE run_id=%s AND status='REGISTERED'",(run,))
        for request,round_number,kind in db.execute("SELECT request_id,execution_round,model_kind FROM analysis.model_requests WHERE run_id=%s AND status='PUBLISHED'",(run,)).fetchall():
            cancellation = uuid4()
            now = datetime.now(timezone.utc)
            payload = dict(contract_version=2,job_id=job,model_kind=kind,request_id=str(request),
                execution_round=round_number,run_id=str(run),cancel_id=str(cancellation),
                reason_code='REPORT_CORRECTED',requested_at=now.isoformat())
            db.execute('''INSERT INTO analysis.cancel_outbox(cancel_id,request_id,execution_round,payload,requested_at)
                VALUES(%s,%s,%s,%s,%s) ON CONFLICT(request_id,execution_round) DO NOTHING''',
                (cancellation,request,round_number,Jsonb(payload),now))
        db.execute("""UPDATE analysis.runs SET status='CANCELLED' WHERE run_id=%s AND NOT EXISTS(
            SELECT 1 FROM analysis.model_requests WHERE run_id=%s AND status NOT IN('STOPPED','ALREADY_FINISHED','BLOCKED'))""",(run,run))


def hold(db, day, versions, code, state):
    for v in versions:
        if v['current_version_id'] == v['version_id']:
            continue
        db.execute('UPDATE ingest.report_versions SET stage_status=%s,error_code=%s,revision=revision+1 WHERE version_id=%s',
            ('HELD' if state=='OPEN' else state,code,v['version_id']))
        corrections = [r[0] for r in db.execute('''SELECT c.correction_id FROM ingest.correction_requests c
            JOIN ingest.correction_uploads u USING(correction_id) WHERE u.upload_id=%s''',(v['upload_id'],))]
        if not corrections:
            corrections = [open_correction(db,v['bank_id'],day,v['version_id'],code)]
        for correction in corrections:
            if db.execute('SELECT 1 FROM ingest.correction_uploads WHERE correction_id=%s AND upload_id>%s',(correction,v['upload_id'])).fetchone():
                continue
            db.execute("UPDATE ingest.correction_requests SET status=%s WHERE correction_id=%s AND status<>'RESOLVED'",(state,correction))
            db.execute('DELETE FROM ingest.correction_errors WHERE correction_id=%s',(correction,))
            db.execute("INSERT INTO ingest.correction_errors VALUES(%s,0,NULL,'',%s,'보고 대조와 정정 조건을 확인하세요.')",(correction,code))


def replace_component(db, day, cutoff, revision, banks, versions, rows, old_rows, protector, fx_version):
    if all(v['current_version_id']==v['version_id'] for v in versions):
        return
    reports = [r for v in versions for r in rows[v['set_id']]]
    identities = IdentityStore(db,protector,reports)
    invalid = {r.version for r in reports if identities.conflicting(r.row)}
    matched = match(reports,banks,invalid)
    old_reports = [r for v in versions for r in old_rows[v['set_id']]]
    linked = dict(db.execute('SELECT report_id,tx_id FROM ledger.transaction_reports WHERE report_id=ANY(%s)',([r.id for r in old_reports],)))
    active = {r[0] for r in db.execute("SELECT tx_id FROM ledger.transactions WHERE tx_id=ANY(%s) AND integration_status='ACTIVE'",(list(linked.values()),))}
    completed = {r[0] for r in db.execute("""SELECT DISTINCT i.tx_id FROM analysis.input_transactions i JOIN analysis.runs r USING(run_id)
        WHERE i.tx_id=ANY(%s) AND i.input_role='TARGET' AND r.status='COMPLETED'""",(list(linked.values()),))}
    old,old_ids = defaultdict(list),set()
    for report in old_reports:
        identifier = linked.get(report.id)
        if identifier in active and identifier not in old_ids:
            old_ids.add(identifier)
            old[identity(report.row)].append(identifier)
    old = {k:deque(sorted(ids,key=lambda i:(i not in completed,i))) for k,ids in old.items()}
    kept,retained = {},set()
    for first,_ in matched.matches:
        queue = old.get(identity(first.row))
        if queue:
            identifier = queue.popleft()
            kept[first.id] = identifier
            retained.add(identifier)
    changed = old_ids-retained
    if matched.held_versions or matched.dependency_reports:
        changed = set()
        for v in versions:
            if v['current_version_id']==v['version_id']:
                continue
            counts = Counter(identity(r.row) for r in rows[v['set_id']])
            for report in sorted(old_rows[v['set_id']],key=lambda r:linked.get(r.id) not in completed):
                signature = identity(report.row)
                if counts[signature]>0:
                    counts[signature]-=1
                elif report.id in linked:
                    changed.add(linked[report.id])
    if changed & completed:
        hold(db,day,versions,'COMPLETED_TARGET_CHANGE_OUT_OF_SCOPE','OPEN')
        return
    if invalid:
        hold(db,day,versions,'INVALID_SELF_OR_CONFIRMED_IDENTITY','OPEN')
        return
    cancel_affected(db,changed)
    if matched.held_versions or matched.dependency_reports:
        hold(db,day,versions,'COUNTERPART_MISSING','WAITING_COUNTERPART')
        reporting = {v['bank_id'] for v in versions}
        for report in reports:
            other = report.row['toBank'] if report.bank==report.row['fromBank'] else report.row['fromBank']
            if other in banks and other not in reporting:
                open_correction(db,other,day,None,'REPORT_MISSING',revision)
        return
    identifier = attempt(db,day,cutoff,revision,versions)
    db.execute("UPDATE ledger.transactions SET integration_status='SUPERSEDED',generation=generation+1 WHERE tx_id=ANY(%s)",(list(changed),))
    insert_matches(db,day,matched.matches,identities,fx_version,kept)
    for v in versions:
        if v['current_version_id'] is not None and v['current_version_id']!=v['version_id']:
            db.execute("UPDATE ingest.report_versions SET stage_status='SUPERSEDED',revision=revision+1 WHERE version_id=%s",(v['current_version_id'],))
        if db.execute('UPDATE ingest.report_sets SET current_version_id=%s,generation=generation+1 WHERE set_id=%s AND generation=%s',
                (v['version_id'],v['set_id'],v['generation'])).rowcount!=1:
            raise ValueError('REPORT_GENERATION_CHANGED')
        db.execute("UPDATE ingest.report_versions SET stage_status='ACTIVE',error_code=NULL,revision=revision+1 WHERE version_id=%s AND revision=%s",(v['version_id'],v['revision']))
        db.execute('''UPDATE ingest.correction_requests c SET status='RESOLVED',replacement_version_id=%s,resolved_at=now(),revision=revision+1
            WHERE bank_id=%s AND business_date=%s AND status<>'RESOLVED' AND NOT EXISTS(
              SELECT 1 FROM ingest.correction_uploads u JOIN ingest.uploads b USING(upload_id)
              WHERE u.correction_id=c.correction_id AND (b.received_at IS NULL OR b.received_at>%s))
            AND NOT EXISTS(SELECT 1 FROM ingest.correction_uploads u JOIN ingest.report_versions newer USING(upload_id)
              WHERE u.correction_id=c.correction_id AND newer.version_no>%s)''',
            (v['version_id'],v['bank_id'],day,cutoff,v['version_no']))
    db.execute("UPDATE ingest.integration_attempts SET status='COMPLETED' WHERE attempt_id=%s",(identifier,))


def correction_integration(db, day, cutoff, all_versions, eligible, reports, protector, fx_version):
    selected = {}
    for v in all_versions:
        if v['current_version_id']==v['version_id']:
            selected[v['set_id']] = v
    for v in all_versions:
        if v['self_valid'] and v['version_id'] in eligible:
            selected[v['set_id']] = v
    if not selected:
        return
    revision,banks = scope(db,day)
    if any(v['bank_id'] not in banks for v in selected.values()):
        raise ValueError('REPORT_OUTSIDE_SCOPE')
    rows,old_rows,links = {},{},{}
    for identifier,v in selected.items():
        rows[identifier] = reports[v['version_id']]
        old_rows[identifier] = reports.get(v['current_version_id'],[])
        keys = {('bank',v['bank_id'])}
        for report in rows[identifier]+old_rows[identifier]:
            r = report.row
            for side in ('from','to'):
                if r[side+'Bank'] in banks:
                    keys.add(('bank',r[side+'Bank']))
                keys.add(('account',r[side+'Bank'],r[side+'Account']))
                keys.add(('owner',r[side+'EntityId']))
        links[identifier] = keys
    remaining = set(selected)
    while remaining:
        component = {min(remaining)}
        while True:
            keys = set().union(*(links[i] for i in component))
            additions = {i for i in remaining if keys & links[i]}-component
            if not additions:
                break
            component.update(additions)
        remaining.difference_update(component)
        replace_component(db,day,cutoff,revision,banks,[selected[i] for i in sorted(component)],rows,old_rows,protector,fx_version)
