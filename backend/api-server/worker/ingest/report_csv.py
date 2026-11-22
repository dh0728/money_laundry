"""Strict AML17 reader. Error messages contain locations, never source values."""

import csv
import hashlib
import re
import unicodedata
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

REQUIRED = ('Timestamp', 'From Bank', 'From Account', 'To Bank', 'To Account',
            'Amount Received', 'Receiving Currency', 'Amount Paid', 'Payment Currency',
            'Payment Format', 'From Bank Name', 'To Bank Name', 'From Entity ID',
            'From Entity Name', 'To Entity ID', 'To Entity Name')
CURRENCIES = dict(zip(
    ('Australian Dollar', 'Bitcoin', 'Brazil Real', 'Canadian Dollar', 'Euro', 'Mexican Peso',
     'Ruble', 'Rupee', 'Saudi Riyal', 'Shekel', 'Swiss Franc', 'UK Pound', 'US Dollar', 'Yen', 'Yuan'),
    ('AUD', 'BTC', 'BRL', 'CAD', 'EUR', 'MXN', 'RUB', 'INR', 'SAR', 'ILS', 'CHF', 'GBP', 'USD', 'JPY', 'CNY')))
_FIELD = r'(?:[^",\r\n]*|"(?:[^"]|"")*")'
_RECORD = re.compile(_FIELD + '(?:,' + _FIELD + ')*')
_TRIM = ''.join(chr(value) for value in range(33))


class RowError(ValueError):
    def __init__(self, row, column, reason, *, missing=False, fatal=False):
        super().__init__(reason)
        self.error = dict(row=row, column=column, reason=reason)
        self.missing = missing
        self.fatal = fatal


class _Lines:
    def __init__(self, stream):
        self.stream, self.record = iter(stream), []
        self.first = True

    def __iter__(self):
        return self

    def __next__(self):
        line = next(self.stream)
        if self.first:
            line = line.removeprefix('\ufeff')
            self.first = False
        self.record.append(line)
        return line


class ReportReader:
    def __init__(self, stream, zone='Asia/Seoul'):
        self.lines = _Lines(stream)
        self.reader = csv.reader(self.lines, strict=True)
        self.zone = ZoneInfo(zone)
        header = self._record()
        if header is None:
            raise RowError(1, '', '헤더 없음', fatal=True)
        self.header = [value.strip(_TRIM) for value in header]
        if len(self.header) != len(set(self.header)):
            raise RowError(1, '', '중복 헤더', fatal=True)
        for name in REQUIRED:
            if name not in self.header:
                raise RowError(1, name, '헤더 누락', fatal=True)

    def _record(self):
        self.start = self.reader.line_num + 1
        self.lines.record.clear()
        try:
            record = next(self.reader)
        except StopIteration:
            return None
        except csv.Error:
            raise RowError(self.start, '', 'CSV 따옴표 형식 오류', fatal=True) from None
        if not _RECORD.fullmatch(''.join(self.lines.record).rstrip('\r\n')):
            raise RowError(self.start, '', 'CSV 따옴표 형식 오류', fatal=True)
        return record

    def next(self):
        cols = self._record()
        while cols is not None and (not cols or len(cols) == 1 and not cols[0].strip()):
            cols = self._record()
        if cols is None:
            return None
        if len(cols) != len(self.header):
            raise RowError(self.start, '', '열 수 불일치')
        values = dict(zip(self.header, (value.strip(_TRIM) for value in cols)))
        for name in REQUIRED:
            if not values[name]:
                raise RowError(self.start, name, '필수값 없음', missing=True)

        def bounded(name, size, normalize=False):
            value = unicodedata.normalize('NFC', values[name]) if normalize else values[name]
            if len(value) > size:
                raise RowError(self.start, name, f'최대 {size}자 초과')
            return value

        def bank(name):
            value = values[name]
            if not re.fullmatch(r'[+-]?[0-9]+', value) or not 0 <= int(value) <= 2147483647:
                raise RowError(self.start, name, '은행 코드는 0 이상의 정수')
            return int(value)

        def amount(name):
            try:
                if not re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?', values[name]):
                    raise InvalidOperation
                number = Decimal(values[name])
                if not number.is_finite():
                    raise InvalidOperation
                if number < 0:
                    raise RowError(self.start, name, '금액은 0 이상')
                if number == 0:
                    return '0'
                if number >= Decimal('1e18'):
                    raise RowError(self.start, name, '금액 정수부는 최대 18자리')
                digits = number.as_tuple()
                exponent = digits.exponent
                for digit in reversed(digits.digits):
                    if digit != 0:
                        break
                    exponent += 1
                if exponent < -6:
                    raise RowError(self.start, name, '금액 소수부는 끝자리 0을 제외하고 최대 6자리')
                return format(number.normalize(), 'f')
            except InvalidOperation:
                raise RowError(self.start, name, '금액 형식 오류') from None

        occurred = None
        if not re.fullmatch(r'(?:[0-9]{4}/[0-9]{2}/[0-9]{2} |[0-9]{4}-[0-9]{2}-[0-9]{2}T)[0-9]{2}:[0-9]{2}(?::[0-9]{2})?', values['Timestamp']):
            raise RowError(self.start, 'Timestamp', '시각 형식 오류')
        for fmt in ('%Y/%m/%d %H:%M', '%Y/%m/%d %H:%M:%S', '%Y-%m-%dT%H:%M', '%Y-%m-%dT%H:%M:%S'):
            try:
                occurred = datetime.strptime(values['Timestamp'], fmt).replace(tzinfo=self.zone).astimezone(timezone.utc)
                break
            except ValueError:
                pass
        if occurred is None:
            raise RowError(self.start, 'Timestamp', '시각 형식 오류')
        result = dict(fileRow=self.start, occurredAt=occurred.isoformat().replace('+00:00', 'Z'))
        for prefix, side in (('from', 'From'), ('to', 'To')):
            result[prefix + 'Bank'] = bank(side + ' Bank')
            account = bounded(side + ' Account', 100)
            if '|' in account:
                raise RowError(self.start, side + ' Account', '계좌번호에 | 사용 불가')
            result[prefix + 'Account'] = account
            for suffix, column, size, normalize in (
                ('BankName', ' Bank Name', 100, True), ('EntityId', ' Entity ID', 100, False),
                ('EntityName', ' Entity Name', 200, True)):
                result[prefix + suffix] = bounded(side + column, size, normalize)
        result['amountReceived'] = amount('Amount Received')
        result['amountPaid'] = amount('Amount Paid')
        for field, column in (('receivingCurrency', 'Receiving Currency'), ('paymentCurrency', 'Payment Currency')):
            if values[column] not in CURRENCIES:
                raise RowError(self.start, column, '매핑표에 없는 통화')
            result[field] = CURRENCIES[values[column]]
        result['paymentFormat'] = bounded('Payment Format', 30)
        label = values.get('Is Laundering', '')
        if label not in ('', '0', '1'):
            raise RowError(self.start, 'Is Laundering', '라벨은 0 또는 1')
        result['isLaundering'] = None if not label else label == '1'
        material = '|'.join(str(result[k]) for k in ('occurredAt', 'fromBank', 'fromAccount',
            'toBank', 'toAccount', 'amountReceived', 'receivingCurrency', 'amountPaid',
            'paymentCurrency', 'paymentFormat'))
        result['rowHash'] = hashlib.sha256(material.encode()).hexdigest()
        return result
