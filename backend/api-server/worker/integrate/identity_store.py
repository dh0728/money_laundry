"""Public owner/account records and separate authenticated private identities."""

from uuid import uuid4

FAMILY = ('김','이','박','최','정','강','조','윤','장','임','한','오','서','신','권','황','안','송','전','홍')
GIVEN = ('민준','서연','서준','지우','도윤','하윤','예준','지민','시우','수빈','주원','지유','지호','서현','준서','민서',
         '건우','수아','현우','윤서','우진','채원','선우','지원','유준','소윤','정우','예은','승우','다은','현준','소율',
         '유찬','지아','승현','은우','태윤','나은','준혁','유진')


def display_name(owner_id):
    if type(owner_id) is not int or owner_id <= 0:
        raise ValueError('Invalid owner number')
    index = owner_id - 1
    return f'{FAMILY[index % len(FAMILY)]}{GIVEN[index // len(FAMILY) % len(GIVEN)]}#{owner_id:05d}'


def claims(row):
    for side in ('from','to'):
        yield (row[side+'Bank'],row[side+'BankName'],row[side+'Account'],row[side+'EntityId'],row[side+'EntityName'])


class IdentityStore:
    def __init__(self, connection, protector, reports):
        self.db, self.protector = connection, protector
        self.owner_tokens, self.account_tokens = {}, {}
        for report in reports:
            for bank, _, account, owner, _ in claims(report.row):
                self.owner_tokens.setdefault(owner,protector.token('entity',owner))
                self.account_tokens.setdefault((bank,account),protector.token('account',str(bank),account))
        self.banks = dict(connection.execute('SELECT bank_id,name FROM core.banks').fetchall())
        self.owners = {r[1]:r for r in connection.execute('''SELECT owner_id,lookup_token,identity_cipher,name_cipher,key_version
            FROM private.owner_identities WHERE lookup_token=ANY(%s)''',(list(self.owner_tokens.values()),)).fetchall()}
        self.accounts = {(r[1],r[2]):r for r in connection.execute('''SELECT p.account_id,p.bank_id,p.lookup_token,p.identity_cipher,p.key_version,o.lookup_token
            FROM private.account_identities p JOIN core.accounts a USING(account_id,bank_id)
            JOIN private.owner_identities o USING(owner_id) WHERE p.lookup_token=ANY(%s)''',
            (list(self.account_tokens.values()),)).fetchall()}
        self._checked = {}

    def conflicting(self, row):
        for claim in claims(row):
            if claim not in self._checked:
                bank,bank_name,account,owner,name = claim
                prior_bank = self.banks.get(bank)
                stored_owner = self.owners.get(self.owner_tokens[owner])
                stored_account = self.accounts.get((bank,self.account_tokens[(bank,account)]))
                conflict = prior_bank is not None and prior_bank != bank_name
                if stored_owner:
                    _,_,identity,cipher,version = stored_owner
                    conflict |= self.protector.decrypt('entity-id',identity,version) != owner
                    conflict |= self.protector.decrypt('entity-name',cipher,version) != name
                if stored_account:
                    _,_,_,identity,version,owner_token = stored_account
                    conflict |= owner_token != self.owner_tokens[owner]
                    conflict |= self.protector.decrypt(f'account:{bank}',identity,version) != account
                self._checked[claim] = conflict
            if self._checked[claim]:
                return True
        return False

    def _ids(self, table, column, count):
        return [r[0] for r in self.db.execute('SELECT nextval(pg_get_serial_sequence(%s,%s)) FROM generate_series(1,%s)',
            (table,column,count)).fetchall()]

    def _copy(self, table, columns, rows):
        # Identifiers originate only in the fixed call sites below.
        if not rows:
            return
        with self.db.cursor().copy(f'COPY {table}({columns}) FROM STDIN') as copy:
            for row in rows:
                copy.write_row(row)

    def persist(self, rows):
        owners,accounts,banks = {},{},{}
        for row in rows:
            for bank,bank_name,account,owner,name in claims(row):
                banks[bank] = bank_name
                owners[owner] = name
                accounts[(bank,account)] = owner
        with self.db.cursor() as cursor:
            cursor.executemany('''INSERT INTO core.banks(bank_id,name) VALUES(%s,%s)
                ON CONFLICT(bank_id) DO UPDATE SET name=coalesce(core.banks.name,excluded.name)''',list(banks.items()))
        owner_ids = {owner:self.owners[token][0] for owner,token in self.owner_tokens.items() if token in self.owners}
        pending = [owner for owner in owners if owner not in owner_ids]
        ids = self._ids('core.owners','owner_id',len(pending))
        public,private = [],[]
        for owner,identifier in zip(pending,ids):
            owner_ids[owner] = identifier
            public.append((identifier,uuid4(),display_name(identifier)))
            private.append((identifier,self.owner_tokens[owner],self.protector.encrypt('entity-id',owner),
                self.protector.encrypt('entity-name',owners[owner]),self.protector.version))
        self._copy('core.owners','owner_id,service_owner_id,display_name',public)
        self._copy('private.owner_identities','owner_id,lookup_token,identity_cipher,name_cipher,key_version',private)
        account_ids = {key:self.accounts[(key[0],token)][0] for key,token in self.account_tokens.items() if (key[0],token) in self.accounts}
        pending = [key for key in accounts if key not in account_ids]
        ids = self._ids('core.accounts','account_id',len(pending))
        public,private = [],[]
        for (bank,account),identifier in zip(pending,ids):
            account_ids[(bank,account)] = identifier
            public.append((identifier,uuid4(),bank,owner_ids[accounts[(bank,account)]]))
            private.append((identifier,bank,self.account_tokens[(bank,account)],
                self.protector.encrypt(f'account:{bank}',account),self.protector.version))
        self._copy('core.accounts','account_id,service_account_id,bank_id,owner_id',public)
        self._copy('private.account_identities','account_id,bank_id,lookup_token,identity_cipher,key_version',private)
        return account_ids
