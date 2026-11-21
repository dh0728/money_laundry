import { fixtureReviewStatus, fixtureVerdict } from './verdict-fixtures.js';

export const OWNER_COUNT = 12;
export const ACCOUNTS_PER_OWNER = 12;
const TRANSACTIONS_PER_ACCOUNT = 6;
const sampleAmountsUsd = [420, 200, 300, 1680, 500, 600];
const methods = ['계좌이체', '해외송금', '자동이체'];
const hours = [9, 10, 10, 11, 12, 12, 12, 13, 13, 14, 15, 16, 16, 16, 16, 17, 18, 18];
const sampleAccountVerdicts = {
  'ACC-1001': 'abnormal',
  'ACC-1002': 'normal',
  'ACC-1013': 'unjudged',
  'ACC-1014': 'normal',
  'ACC-1026': 'unjudged',
  'ACC-1039': 'normal',
  'ACC-1040': 'unjudged',
  'ACC-1053': 'abnormal',
  'ACC-1065': 'abnormal',
};
export const ownerName = index => `소유주-${String(index + 1).padStart(3, '0')}`;
export const accountCode = (owner, index) => `ACC-${1001 + owner * ACCOUNTS_PER_OWNER + index}`;

function sampleAccount(owner, index) {
  const code = accountCode(owner, index);
  return { owner: ownerName(owner), code, verdict: sampleAccountVerdicts[code] };
}

function transactionPosition(serial) {
  const accountIndex = Math.floor(serial / TRANSACTIONS_PER_ACCOUNT);
  const owner = Math.floor(accountIndex / ACCOUNTS_PER_OWNER);
  const account = accountIndex % ACCOUNTS_PER_OWNER;
  const index = serial % TRANSACTIONS_PER_ACCOUNT;
  return { owner, account, index };
}

export function transactionFixture(codes, serial) {
  const { owner, account, index } = transactionPosition(serial);
  const selectedAccount = sampleAccount(owner, account);
  const otherOwner = (owner + index + 1) % OWNER_COUNT;
  const counterparty = sampleAccount(otherOwner, (account + index) % ACCOUNTS_PER_OWNER);
  const incoming = index % 3 === 1;
  const amount = sampleAmountsUsd[index];
  const code = codes[serial] ?? `T-261111-${String(serial + 1).padStart(8, '0')}`;
  const hour = String(hours[serial % hours.length]).padStart(2, '0');
  const date = code.split('-')[1];
  const timestamp = `20${date.slice(0, 2)}-${date.slice(2, 4)}-${date.slice(4)} ${hour}:${30 + index}`;
  const verdict = fixtureVerdict(code);
  return {
    code, timestamp, amount, currency: 'USD', serial, incoming, verdict,
    status: fixtureReviewStatus(verdict, index % 2 === 0 ? '처리 전' : '처리 중'),
    method: methods[index % methods.length],
    from: incoming ? counterparty : selectedAccount,
    to: incoming ? selectedAccount : counterparty,
  };
}

export function sampleTransactions(codes, owner, account) {
  const first = (owner * ACCOUNTS_PER_OWNER + account) * TRANSACTIONS_PER_ACCOUNT;
  return Array.from({ length: TRANSACTIONS_PER_ACCOUNT }, (_, index) =>
    transactionFixture(codes, first + index));
}

export function findTransactionFixture(codes, code) {
  const index = codes.indexOf(code);
  if (index >= 0) return transactionFixture(codes, index);
  if (!/^T-261111-\d{8}$/.test(code)) return undefined;
  const serial = Number(code.slice(-8)) - 1;
  if (serial < 0 || serial >= OWNER_COUNT * ACCOUNTS_PER_OWNER * TRANSACTIONS_PER_ACCOUNT) return undefined;
  return transactionFixture(codes, serial);
}

export function findLedgerSelection(codes, code) {
  const record = findTransactionFixture(codes, code);
  return record ? transactionPosition(record.serial) : undefined;
}
