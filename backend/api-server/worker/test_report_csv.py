import io
import unittest
from decimal import Decimal
from pathlib import Path

from report_csv import REQUIRED, ReportReader, RowError

HEADER = ','.join(REQUIRED) + '\n'
ROW = '2023/09/01 09:00,10,001,20,002,100,US Dollar,100,US Dollar,ACH,Bank10,Bank20,E1,Alice,E2,Bob\n'


class CsvTests(unittest.TestCase):
    def reader(self, body=ROW, header=HEADER):
        return ReportReader(io.StringIO(header + body, newline=''))

    def test_normalized_exact_values_and_no_numeric_account_conversion(self):
        row = self.reader().next()
        self.assertEqual('2023-09-01T00:00:00Z', row['occurredAt'])
        self.assertEqual('001', row['fromAccount'])
        self.assertEqual('USD', row['paymentCurrency'])
        self.assertEqual('100', row['amountPaid'])
        self.assertIsNone(row['isLaundering'])

    def test_bom_multiline_escaped_quotes_and_physical_lines(self):
        for newline in ('\n', '\r\n', '\r'):
            first = ROW.replace('Alice', '"Alice, ""A""' + newline + 'next"').rstrip('\n') + newline
            reader = self.reader(first + ROW, '\ufeff' + HEADER)
            self.assertIn('Alice, "A"', reader.next()['fromEntityName'])
            self.assertEqual(4, reader.next()['fileRow'])

    def test_header_and_fatal_quoting_errors(self):
        with self.assertRaises(RowError):
            self.reader(header=HEADER.rstrip() + ',Timestamp\n')
        for text in ('"unterminated', ROW.replace('Alice', 'ab"cd'), ROW.replace('Alice', '"Alice"extra')):
            with self.assertRaises(RowError) as error:
                self.reader(text).next()
            self.assertTrue(error.exception.fatal)

    def test_amount_and_timestamp_contract(self):
        for amount in ('-1', '1e18', '0.0000001', 'NaN', '1_00'):
            with self.subTest(amount=amount), self.assertRaises(RowError):
                self.reader(ROW.replace(',100,', ',' + amount + ',', 1)).next()
        self.assertEqual('100', self.reader(ROW.replace(',100,', ',100.0000000,', 1)).next()['amountReceived'])
        with self.assertRaises(RowError):
            self.reader(ROW.replace('2023/09/01', '2023/02/30')).next()

    def test_missing_and_optional_label(self):
        with self.assertRaises(RowError) as error:
            self.reader(ROW.replace(',Alice,', ',,')).next()
        self.assertTrue(error.exception.missing)
        labeled = self.reader(ROW.rstrip() + ',1\n', HEADER.rstrip() + ',Is Laundering\n').next()
        self.assertTrue(labeled['isLaundering'])

    def test_java_compatible_whitespace_and_negative_zero(self):
        row = self.reader(ROW.replace('Alice', '\u00a0Alice\u00a0').replace(',100,', ',-0.0,', 1)).next()
        self.assertEqual('\u00a0Alice\u00a0', row['fromEntityName'])
        self.assertEqual('0', row['amountReceived'])

    def test_timestamp_calendar_and_kst_contract(self):
        for value in ('2026/02/30 00:00','2026-02-30T00:00:00','2026/02/29 12:00:00',
                      '2026-02-29T12:00','2026/09/08 24:00','2026-09-08T24:00:00'):
            with self.subTest(value=value), self.assertRaises(RowError) as error:
                self.reader(ROW.replace('2023/09/01 09:00',value)).next()
            self.assertEqual('Timestamp',error.exception.error['column'])
        for value in ('2024/02/29 12:34','2024/02/29 12:34:00','2024-02-29T12:34','2024-02-29T12:34:00'):
            self.assertEqual('2024-02-29T03:34:00Z',self.reader(ROW.replace('2023/09/01 09:00',value)).next()['occurredAt'])

    def test_database_decimal_boundaries_on_both_sides(self):
        rejected=('123.1234567','0.0000001','1000000000000000000','1E+1000','1E-1000',
                  '1E+2147483647','1E-2147483647','-1','NaN','not-a-number')
        accepted=('0','0.0000000','0E-2147483647','0E+2147483647','0.000001','123.123456',
                  '123.1234560','999999999999999999.999999','1E+17','1E-6')
        for index,name in ((5,'Amount Received'),(7,'Amount Paid')):
            for value in rejected:
                fields=ROW.rstrip('\n').split(',')
                fields[index]=value
                with self.subTest(value=value,index=index),self.assertRaises(RowError) as error:
                    self.reader(','.join(fields)+'\n').next()
                self.assertEqual(name,error.exception.error['column'])
            for value in accepted:
                fields=ROW.rstrip('\n').split(',')
                fields[index]=value
                row=self.reader(','.join(fields)+'\n').next()
                self.assertEqual(Decimal(value),Decimal(row['amountReceived' if index==5 else 'amountPaid']))

    def test_original_hash_is_preserved_for_equivalent_amounts(self):
        base='2024/02/29 12:34,70,A,12,B,123.123456,US Dollar,1,US Dollar,ACH,Bank70,Bank12,E1,Alice,E2,Bob\n'
        first=self.reader(base).next()['rowHash']
        self.assertEqual('5fd92448c2b1f6ada227f099c789d87b0e2082f087c8c7c399164db89f0cf23b',first)
        self.assertEqual(first,self.reader(base.replace('123.123456','123.1234560').replace(',1,',',1.0000000,')).next()['rowHash'])

    def test_limits_count_unicode_codepoints_after_trim(self):
        for index,limit in ((2,100),(4,100),(9,30)):
            for unit in ('A','한','😀'):
                fields=ROW.rstrip('\n').split(',')
                fields[index]=' '+unit*limit+' '
                self.reader(','.join(fields)+'\n').next()
                fields[index]=unit*(limit+1)
                with self.assertRaises(RowError):
                    self.reader(','.join(fields)+'\n').next()

    def test_bank_mock_smoke_fixture(self):
        fixture=Path(__file__).resolve().parents[2]/'bank-mock/fixtures/kubesphere_smoke.csv'
        with fixture.open(encoding='utf-8',newline='') as stream:
            reader=ReportReader(stream)
            row=reader.next()
            self.assertEqual('SMOKE260917A',row['fromAccount'])
            self.assertEqual('SMOKE260917B',row['toAccount'])
            self.assertEqual('2022-09-01T03:34:00Z',row['occurredAt'])
            self.assertIsNone(reader.next())


if __name__ == '__main__':
    unittest.main()
