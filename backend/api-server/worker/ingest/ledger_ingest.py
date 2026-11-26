"""Load one date's ledger file straight into the ledger.

The file is read and checked first, without business-table locks: rows go to a temporary table
and the identities they name are kept in memory. If any row fails, the whole file is rejected and
nothing reaches the ledger. Otherwise one transaction under the ingest lock adds the new owners and
accounts (identifiers and names encrypted, accounts numbered per bank), the transactions with their
source upload, and the answer labels.
"""

import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb

from common.frozen_input import StaleExecution
from ingest.entity_attributes import bank_country, entity_type
from ingest.ledger_csv import LedgerReader, RowError

INGEST_LOCK = 17004000
FAMILY = ('김','이','박','최','정','강','조','윤','장','임','한','오','서','신','권','황','안','송','전','홍')
GIVEN = ('민준','서연','서준','지우','도윤','하윤','예준','지민','시우','수빈','주원','지유','지호','서현','준서','민서',
         '건우','수아','현우','윤서','우진','채원','선우','지원','유준','소윤','정우','예은','승우','다은','현준','소율',
         '유찬','지아','승현','은우','태윤','나은','준혁','유진')


def display_name(owner_id):
    if type(owner_id) is not int or owner_id <= 0:
        raise ValueError('Invalid owner number')
    index = owner_id - 1
    return f'{FAMILY[index % len(FAMILY)]}{GIVEN[index // len(FAMILY) % len(GIVEN)]}#{owner_id:05d}'


def _owned(connection, upload_id, token, *, lock=False):
    row = connection.execute('''SELECT business_date,received_at,status,execution_id
        FROM ingest.uploads WHERE upload_id=%s''' + (' FOR UPDATE' if lock else ''), (upload_id,)).fetchone()
    if row is None or row[2] != 'RUNNING' or row[3] != token:
        raise StaleExecution('Upload execution is no longer current')
    return row[:2]


class _Identities:
    """Identities named by the file, checked for agreement within the file."""

    def __init__(self, protector):
        self.protector = protector
        self.banks = {}      # bank -> bank name
        self.owners = {}     # entity id -> [name, token, first row]
        self.accounts = {}   # (bank, account) -> [token, entity id, first row]
        self.conflict = False

    def claim(self, row):
        """Returns the two account tokens of a checked row."""
        tokens = []
        for order, side in enumerate(('from', 'to')):
            # Sender before receiver within a row, so numbering follows reading order.
            first = row['fileRow'] * 2 + order
            bank, account = row[side + 'Bank'], row[side + 'Account']
            entity, name = row[side + 'EntityId'], row[side + 'EntityName']
            if self.banks.setdefault(bank, row[side + 'BankName']) != row[side + 'BankName']:
                self.conflict = True
            owner = self.owners.get(entity)
            if owner is None:
                self.owners[entity] = [name, self.protector.token('entity', entity), first]
            elif owner[0] != name:
                self.conflict = True
            known = self.accounts.get((bank, account))
            if known is None:
                known = self.accounts[(bank, account)] = [
                    self.protector.token('account', str(bank), account), entity, first]
            elif known[1] != entity:
                self.conflict = True
            tokens.append(known[0])
        return tokens


def _stored_conflict(connection, identities, protector):
    """True when the file disagrees with an identity already stored."""
    names = dict(connection.execute('SELECT bank_id,name FROM core.banks WHERE bank_id=ANY(%s)',
                                    (list(identities.banks),)).fetchall())
    if any(names.get(bank) not in (None, name) for bank, name in identities.banks.items()):
        return True
    with connection.cursor() as cursor:
        with cursor.copy('COPY staged_owners(lookup_token,first_row) FROM STDIN') as copy:
            for name, token, first in identities.owners.values():
                copy.write_row((token, first))
        with cursor.copy('COPY staged_accounts(bank_id,lookup_token,owner_token,first_row) FROM STDIN') as copy:
            for (bank, _), (token, entity, first) in identities.accounts.items():
                copy.write_row((bank, token, identities.owners[entity][1], first))
    connection.execute('ANALYZE staged_owners')
    connection.execute('ANALYZE staged_accounts')
    # An account already stored must keep its owner.
    if connection.execute('''SELECT EXISTS(SELECT 1 FROM staged_accounts s
        JOIN private.account_identities p ON p.bank_id=s.bank_id AND p.lookup_token=s.lookup_token
        JOIN core.accounts a ON a.account_id=p.account_id
        JOIN private.owner_identities o ON o.owner_id=a.owner_id WHERE o.lookup_token<>s.owner_token)''').fetchone()[0]:
        return True
    # An owner already stored must keep its name; the token already fixes its identifier.
    by_token = {token: name for name, token, _ in identities.owners.values()}
    with connection.cursor() as cursor:
        cursor.execute('''SELECT o.lookup_token,o.name_cipher,o.key_version FROM staged_owners s
            JOIN private.owner_identities o USING(lookup_token)''')
        for token, cipher, version in cursor:
            if protector.decrypt('entity-name', cipher, version) != by_token[token]:
                return True
    return False


def _persist_identities(connection, identities, protector):
    with connection.cursor() as cursor:
        cursor.executemany('''INSERT INTO core.banks(bank_id,name,country) VALUES(%s,%s,%s)
            ON CONFLICT(bank_id) DO UPDATE SET name=coalesce(core.banks.name,excluded.name),
              country=coalesce(core.banks.country,excluded.country)''',
            [(bank, name, bank_country(name)) for bank, name in identities.banks.items()])
    stored = {token for (token,) in connection.execute('''SELECT s.lookup_token FROM staged_owners s
        JOIN private.owner_identities USING(lookup_token)''')}
    pending = sorted(((first, entity, name, token) for entity, (name, token, first) in identities.owners.items()
                      if token not in stored))
    ids = [r[0] for r in connection.execute(
        "SELECT nextval(pg_get_serial_sequence('core.owners','owner_id')) FROM generate_series(1,%s)",
        (len(pending),))]
    with connection.cursor() as cursor:
        with cursor.copy('COPY core.owners(owner_id,service_owner_id,display_name,entity_type) FROM STDIN') as copy:
            for (_, _, name, _), identifier in zip(pending, ids):
                copy.write_row((identifier, uuid.uuid4(), display_name(identifier), entity_type(name)))
        with cursor.copy('''COPY private.owner_identities(owner_id,lookup_token,identity_cipher,name_cipher,key_version)
                FROM STDIN''') as copy:
            for (_, entity, name, token), identifier in zip(pending, ids):
                copy.write_row((identifier, token, protector.encrypt('entity-id', entity),
                                protector.encrypt('entity-name', name), protector.version))
    stored = {(bank, token) for bank, token in connection.execute('''SELECT s.bank_id,s.lookup_token
        FROM staged_accounts s JOIN private.account_identities p USING(bank_id,lookup_token)''')}
    with connection.cursor() as cursor:
        with cursor.copy('COPY new_accounts(bank_id,lookup_token,identity_cipher,first_row) FROM STDIN') as copy:
            for (bank, account), (token, _, first) in identities.accounts.items():
                if (bank, token) not in stored:
                    copy.write_row((bank, token, protector.encrypt(f'account:{bank}', account), first))
    # Numbers continue each bank's sequence in order of first appearance in the file.
    # Internal ids follow first appearance in the file too, so the ledger reads in file order.
    # Each bank's current top number is read once per bank, not once per new account.
    connection.execute('ANALYZE new_accounts')
    connection.execute('''WITH top AS MATERIALIZED (
          SELECT a.bank_id,max(a.account_no) AS account_no FROM core.accounts a
          WHERE a.bank_id IN (SELECT DISTINCT bank_id FROM new_accounts) GROUP BY a.bank_id),
        ordered AS MATERIALIZED (
          SELECT n.bank_id,n.lookup_token,coalesce(t.account_no,0)
              +row_number() OVER(PARTITION BY n.bank_id ORDER BY n.first_row,n.lookup_token) AS account_no
          FROM new_accounts n LEFT JOIN top t USING(bank_id) ORDER BY n.first_row,n.lookup_token),
        numbered AS MATERIALIZED (
          SELECT o.*,nextval(pg_get_serial_sequence('core.accounts','account_id')) AS account_id FROM ordered o)
        UPDATE new_accounts n SET account_id=x.account_id,account_no=x.account_no FROM numbered x
        WHERE x.bank_id=n.bank_id AND x.lookup_token=n.lookup_token''')
    connection.execute('''INSERT INTO core.accounts(account_id,bank_id,account_no,owner_id) OVERRIDING SYSTEM VALUE
        SELECT n.account_id,n.bank_id,n.account_no,o.owner_id FROM new_accounts n
        JOIN staged_accounts s USING(bank_id,lookup_token)
        JOIN private.owner_identities o ON o.lookup_token=s.owner_token ORDER BY n.account_id''')
    connection.execute('''INSERT INTO private.account_identities(account_id,bank_id,lookup_token,identity_cipher,key_version)
        SELECT account_id,bank_id,lookup_token,identity_cipher,%s FROM new_accounts ORDER BY account_id''',
        (protector.version,))


def ingest(connection, upload_id, token, stream, protector, fx_version, zone='Asia/Seoul', business_offset_seconds=0.0):
    """``business_offset_seconds`` is business time minus real time (Spring BusinessTime)."""
    if not connection.autocommit:
        raise ValueError('Autocommit connection required')
    day, received = _owned(connection, upload_id, token)
    sequence = connection.execute("SELECT pg_get_serial_sequence('ledger.transactions','tx_id')").fetchone()[0]
    connection.execute(f'''CREATE TEMP TABLE staged(
        tx_id bigint NOT NULL DEFAULT nextval('{sequence}'::regclass), source_row integer PRIMARY KEY,
        occurred_at timestamptz NOT NULL, from_bank integer NOT NULL, from_token text NOT NULL,
        to_bank integer NOT NULL, to_token text NOT NULL, amount_received numeric(24,6) NOT NULL,
        receiving_currency char(3) NOT NULL, amount_paid numeric(24,6) NOT NULL,
        payment_currency char(3) NOT NULL, payment_format varchar(30) NOT NULL, label boolean)''')
    connection.execute('CREATE TEMP TABLE staged_owners(lookup_token text PRIMARY KEY,first_row integer NOT NULL)')
    connection.execute('''CREATE TEMP TABLE staged_accounts(bank_id integer NOT NULL,lookup_token text NOT NULL,
        owner_token text NOT NULL,first_row integer NOT NULL,PRIMARY KEY(bank_id,lookup_token))''')
    connection.execute('''CREATE TEMP TABLE new_accounts(bank_id integer NOT NULL,lookup_token text NOT NULL,
        identity_cipher text NOT NULL,first_row integer NOT NULL,account_id bigint,account_no integer,
        PRIMARY KEY(bank_id,lookup_token))''')
    identities = _Identities(protector)
    local = ZoneInfo(zone)
    errors = []
    count = missing = 0
    incomplete = False

    def error(value):
        if len(errors) < 100:
            errors.append(value)

    try:
        reader = LedgerReader(stream, zone)
        with connection.cursor().copy('''COPY staged(source_row,occurred_at,from_bank,from_token,to_bank,to_token,
                amount_received,receiving_currency,amount_paid,payment_currency,payment_format,label)
                FROM STDIN''') as copy:
            while True:
                try:
                    row = reader.next()
                except UnicodeError:
                    incomplete = True
                    error(dict(row=0, column='', reason='INVALID_UTF8'))
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
                occurred = datetime.fromisoformat(row['occurredAt'])
                if occurred.astimezone(local).date() != day:
                    error(dict(row=row['fileRow'], column='Timestamp', reason='BUSINESS_DATE_MISMATCH'))
                from_token, to_token = identities.claim(row)
                if not errors:
                    copy.write_row((row['fileRow'], occurred, row['fromBank'], from_token, row['toBank'], to_token,
                                    row['amountReceived'], row['receivingCurrency'], row['amountPaid'],
                                    row['paymentCurrency'], row['paymentFormat'], row['isLaundering']))
    except RowError as failure:
        incomplete = True
        error(failure.error)
    except UnicodeError:
        incomplete = True
        error(dict(row=0, column='', reason='INVALID_UTF8'))
    if not count and not incomplete:
        error(dict(row=1, column='', reason='EMPTY_FILE'))
    if identities.conflict:
        error(dict(row=0, column='', reason='IDENTITY_CONFLICT'))
    if not errors and connection.execute('''SELECT EXISTS(SELECT DISTINCT c FROM staged
            CROSS JOIN LATERAL (VALUES(receiving_currency),(payment_currency)) v(c)
            WHERE NOT EXISTS(SELECT 1 FROM core.fx_rates f WHERE f.fx_rate_version=%s AND f.currency=v.c))''',
            (fx_version,)).fetchone()[0]:
        error(dict(row=0, column='', reason='FX_RATE_MISSING'))
    if not errors:
        connection.execute('ANALYZE staged')
    with connection.transaction():
        connection.execute('SELECT pg_advisory_xact_lock(%s)', (INGEST_LOCK,))
        if _owned(connection, upload_id, token, lock=True) != (day, received):
            raise StaleExecution('Upload context changed')
        # A day joins a million rows against the identity tables the previous load just filled:
        # without fresh statistics the planner picks per-row lookups, and small work_mem spills.
        connection.execute("SET LOCAL work_mem='256MB'")
        for table in ('core.accounts', 'core.owners', 'private.account_identities', 'private.owner_identities'):
            connection.execute(f'ANALYZE {table}')
        if not errors and connection.execute('''SELECT EXISTS(SELECT 1 FROM ingest.uploads
                WHERE business_date=%s AND status='COMPLETED')''', (day,)).fetchone()[0]:
            error(dict(row=0, column='', reason='DATE_ALREADY_LOADED'))
        if not errors and _stored_conflict(connection, identities, protector):
            error(dict(row=0, column='', reason='IDENTITY_CONFLICT'))
        valid = not errors
        if valid:
            _persist_identities(connection, identities, protector)
            connection.execute('ANALYZE private.account_identities')
            connection.execute('''INSERT INTO ledger.transactions(tx_id,upload_id,occurred_at,business_date,
                from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,
                payment_format,amount_usd,fx_rate_version) OVERRIDING SYSTEM VALUE
                SELECT s.tx_id,%s,s.occurred_at,%s,fa.account_id,ta.account_id,s.amount_received,s.receiving_currency,
                  s.amount_paid,s.payment_currency,s.payment_format,round(s.amount_paid/f.units_per_usd,6),f.fx_rate_version
                FROM staged s
                JOIN private.account_identities fa ON fa.bank_id=s.from_bank AND fa.lookup_token=s.from_token
                JOIN private.account_identities ta ON ta.bank_id=s.to_bank AND ta.lookup_token=s.to_token
                JOIN core.fx_rates f ON f.fx_rate_version=%s AND f.currency=s.payment_currency
                ORDER BY s.tx_id''', (upload_id, day, fx_version))
            loaded = connection.execute('SELECT count(*) FROM ledger.transactions WHERE upload_id=%s',
                                        (upload_id,)).fetchone()[0]
            if loaded != count:
                raise ValueError('LEDGER_ROW_COUNT_MISMATCH')
            connection.execute('''INSERT INTO evaluation.transaction_labels(tx_id,is_laundering)
                SELECT tx_id,label FROM staged WHERE label IS NOT NULL ORDER BY tx_id''')
        connection.execute('''UPDATE ingest.uploads SET status=%s,row_count=%s,missing_count=%s,duplicate_count=0,
            finished_at=clock_timestamp()+make_interval(secs=>%s),error_code=%s,error_message=%s,validation_errors=%s,
            execution_id=NULL,execution_owner=NULL WHERE upload_id=%s AND execution_id=%s''',
            ('COMPLETED' if valid else 'VALIDATION_FAILED', None if incomplete else count, missing,
             float(business_offset_seconds), None if valid else 'VALIDATION_FAILED',
             None if valid else '파일 전체를 적재하지 않았습니다.', Jsonb(errors), upload_id, token))
