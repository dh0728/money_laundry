"""Stream validation into a private temporary table, then publish atomically."""

import json
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb

from report_csv import ReportReader, RowError
from report_matching import key
from frozen_input import StaleExecution


def _owned(connection, upload_id, token, *, lock=False):
    row = connection.execute('''SELECT bank_id,business_date,received_at,status,execution_id
        FROM ingest.uploads WHERE upload_id=%s''' + (' FOR UPDATE' if lock else ''), (upload_id,)).fetchone()
    if row is None or row[3] != 'RUNNING' or row[4] != token:
        raise StaleExecution('Upload execution is no longer current')
    return row[:3]


def _reporting(connection, bank, day):
    return connection.execute('''SELECT EXISTS(SELECT 1 FROM core.banks b
        JOIN core.bank_reporting_periods p USING(bank_id) WHERE b.bank_id=%s AND b.is_reporting
        AND b.report_format='AML17' AND p.effective_from_date<=%s
        AND (p.effective_to_date IS NULL OR p.effective_to_date>=%s))''', (bank, day, day)).fetchone()[0]


def ingest(connection, upload_id, token, stream, protector, zone='Asia/Seoul'):
    if not connection.autocommit:
        raise ValueError('Autocommit connection required')
    bank, day, received = _owned(connection, upload_id, token)
    version = connection.execute("SELECT nextval(pg_get_serial_sequence('ingest.report_versions','version_id'))").fetchone()[0]
    connection.execute('''CREATE TEMP TABLE prepared_reports(source_row integer PRIMARY KEY,
        match_key text NOT NULL,payload_cipher text NOT NULL,key_version text NOT NULL,label boolean)''')
    errors, claims = [], defaultdict(dict)
    count = missing = 0
    incomplete = False

    def error(value):
        if len(errors) < 100:
            errors.append(value)

    if not _reporting(connection, bank, day):
        error(dict(row=0, column='bankId', reason='REPORTING_NOT_REGISTERED'))
    try:
        reader = ReportReader(stream, zone)
        with connection.cursor().copy('COPY prepared_reports FROM STDIN') as copy:
            while True:
                try:
                    row = reader.next()
                except UnicodeError:
                    incomplete = True
                    error(dict(row=0,column='',reason='INVALID_UTF8'))
                    break
                except RowError as failure:
                    count += 1
                    missing += int(failure.missing)
                    error(failure.error)
                    if failure.fatal:
                        incomplete = True
                        break
                    continue
                if row is None:
                    break
                count += 1
                source_row = row['fileRow']
                if datetime.fromisoformat(row['occurredAt']).astimezone(ZoneInfo(zone)).date() != day:
                    error(dict(row=source_row,column='Timestamp',reason='BUSINESS_DATE_MISMATCH'))
                if bank not in (row['fromBank'], row['toBank']):
                    error(dict(row=source_row,column='bankId',reason='REPORTING_BANK_MISMATCH'))
                for side in ('from','to'):
                    for identity, value in (
                        (('bank',row[side+'Bank']),row[side+'BankName']),
                        (('owner',row[side+'EntityId']),row[side+'EntityName']),
                        (('account',row[side+'Bank'],row[side+'Account']),row[side+'EntityId'])):
                        prior = claims[identity].setdefault('value',value)
                        if prior != value:
                            error(dict(row=0,column='',reason='IDENTITY_CONFLICT'))
                label = row.pop('isLaundering')
                row['isLaundering'] = None
                copy.write_row((source_row,protector.token('match',*(str(v) for v in key(row))),
                    protector.encrypt(f'report:{version}:{source_row}',json.dumps(row,ensure_ascii=False,separators=(',',':'))),
                    protector.version,label))
    except RowError as failure:
        incomplete = True
        error(failure.error)
    except UnicodeError:
        incomplete = True
        error(dict(row=0,column='',reason='INVALID_UTF8'))
    if not count and not incomplete:
        error(dict(row=1,column='',reason='EMPTY_FILE'))
    # No business-table locks are held while reading, parsing or encrypting the file.
    with connection.transaction():
        connection.execute('SELECT pg_advisory_xact_lock(17004000)')
        current = _owned(connection, upload_id, token, lock=True)
        if current != (bank,day,received) or not _reporting(connection,bank,day):
            raise StaleExecution('Upload reporting context changed')
        connection.execute('INSERT INTO ingest.report_sets(bank_id,business_date) VALUES(%s,%s) ON CONFLICT DO NOTHING',(bank,day))
        set_id = connection.execute('SELECT set_id FROM ingest.report_sets WHERE bank_id=%s AND business_date=%s',(bank,day)).fetchone()[0]
        correction = connection.execute('''SELECT c.correction_id,c.version_id FROM ingest.correction_uploads u
            JOIN ingest.correction_requests c USING(correction_id) WHERE u.upload_id=%s''',(upload_id,)).fetchone()
        if correction is None and connection.execute('SELECT EXISTS(SELECT 1 FROM ingest.report_versions WHERE set_id=%s)',(set_id,)).fetchone()[0]:
            raise ValueError('EXPLICIT_CORRECTION_REQUIRED')
        version_no = connection.execute('SELECT count(*) FROM ingest.uploads WHERE bank_id=%s AND business_date=%s AND upload_id<=%s',(bank,day,upload_id)).fetchone()[0]
        valid = not errors
        connection.execute('''INSERT INTO ingest.report_versions(version_id,set_id,upload_id,version_no,received_at,
            stage_status,error_code,row_count,correction_of_version_id,self_valid) OVERRIDING SYSTEM VALUE
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
            (version,set_id,upload_id,version_no,received,'VALIDATED_WAITING_INTEGRATION' if valid else 'HELD',
             None if valid else 'INVALID_SELF',None if incomplete else count,correction[1] if correction else None,valid))
        connection.execute('''INSERT INTO private.bank_reports(version_id,source_row,match_key,payload_cipher,key_version,report_status,error_code)
            SELECT %s,source_row,match_key,payload_cipher,key_version,%s,%s FROM prepared_reports ORDER BY source_row''',
            (version,'WAITING' if valid else 'HELD',None if valid else 'INVALID_SELF'))
        connection.execute('''INSERT INTO evaluation.report_labels(report_id,is_laundering)
            SELECT b.report_id,p.label FROM prepared_reports p JOIN private.bank_reports b USING(source_row)
            WHERE b.version_id=%s AND p.label IS NOT NULL''',(version,))
        latest = correction is None or not connection.execute('''SELECT EXISTS(SELECT 1 FROM ingest.correction_uploads
            WHERE correction_id=%s AND upload_id>%s)''',(correction[0],upload_id)).fetchone()[0]
        if correction and latest:
            connection.execute('''UPDATE ingest.correction_requests SET replacement_version_id=CASE WHEN %s THEN %s ELSE replacement_version_id END,
                status=%s,revision=revision+1 WHERE correction_id=%s AND status<>'RESOLVED' ''',
                (valid,version,'WAITING_COUNTERPART' if valid else 'OPEN',correction[0]))
        if errors and latest:
            correction_id = correction[0] if correction else connection.execute('''INSERT INTO ingest.correction_requests
                (bank_id,business_date,version_id,reason_code,source_revision) VALUES(%s,%s,%s,'INVALID_SELF',1)
                ON CONFLICT(bank_id,business_date,version_id,reason_code,source_revision)
                DO UPDATE SET reason_code=excluded.reason_code RETURNING correction_id''',(bank,day,version)).fetchone()[0]
            connection.execute('DELETE FROM ingest.correction_errors WHERE correction_id=%s',(correction_id,))
            with connection.cursor() as cursor:
                cursor.executemany('INSERT INTO ingest.correction_errors VALUES(%s,%s,%s,%s,%s,%s)',
                    [(correction_id,n,e['row'] or None,e['column'],'INVALID_SELF',e['reason']) for n,e in enumerate(errors)])
        connection.execute('''UPDATE ingest.uploads SET status=%s,row_count=%s,missing_count=%s,duplicate_count=0,
            finished_at=clock_timestamp(),error_code=%s,error_message=%s,validation_errors=%s,
            execution_id=NULL,execution_owner=NULL WHERE upload_id=%s AND execution_id=%s''',
            ('COMPLETED' if valid else 'VALIDATION_FAILED',None if incomplete else count,missing,
             None if valid else 'VALIDATION_FAILED',None if valid else '파일 전체가 보류되었습니다.',Jsonb(errors),upload_id,token))
