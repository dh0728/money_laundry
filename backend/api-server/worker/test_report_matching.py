import unittest

from report_matching import Report, identity_conflicts, match


def row(**changes):
    value = dict(occurredAt='2023-09-01T00:00:00Z', fromBank=10, toBank=20,
                 fromAccount='001', toAccount='001', amountReceived='100.00',
                 receivingCurrency='USD', amountPaid='100', paymentCurrency='USD',
                 paymentFormat='ACH', fromBankName='Bank10', toBankName='Bank20',
                 fromEntityId='E1', fromEntityName='Alice', toEntityId='E2', toEntityName='Bob')
    value.update(changes)
    return value


class MatchingTests(unittest.TestCase):
    def test_repeated_occurrences_pair_by_format_then_id(self):
        reports = [Report(i + 1, 1 if i < 3 else 2, 10 if i < 3 else 20,
                          row(paymentFormat=fmt))
                   for i, fmt in enumerate(['ACH', 'Wire', 'ACH', 'Wire', 'ACH', 'ACH'])]
        for ordered in (reports, list(reversed(reports))):
            result = match(ordered, {10, 20})
            self.assertFalse(result.held_versions)
            self.assertEqual([(1, 5), (2, 4), (3, 6)], [(a.id, b.id) for a, b in result.matches])

    def test_multiplicity_mismatch_holds_file_and_counterpart_depends(self):
        reports = [Report(1, 1, 10, row()), Report(2, 1, 10, row()), Report(3, 2, 20, row())]
        result = match(reports, {10, 20})
        self.assertEqual([], result.matches)
        self.assertEqual({1}, result.held_versions)
        self.assertEqual({3}, result.dependency_reports)
        self.assertEqual({1: 'COUNTERPART_MISSING'}, result.reasons)

    def test_held_file_does_not_hold_independent_counterparty_rows(self):
        bc = row(fromBank=20, toBank=30, toAccount='C', fromBankName='Bank20',
                 toBankName='Bank30', fromEntityId='E2', fromEntityName='Bob',
                 toEntityId='E3', toEntityName='Carol')
        reports = [Report(1, 1, 10, row()), Report(2, 2, 20, row()),
                   Report(3, 2, 20, bc), Report(4, 3, 30, bc)]
        result = match(reports, {10, 20, 30}, {1}, {10})
        self.assertEqual([(3, 4)], [(a.id, b.id) for a, b in result.matches])
        self.assertEqual({1}, result.held_versions)
        self.assertEqual({2}, result.dependency_reports)

    def test_identity_and_format_conflicts(self):
        self.assertEqual({1, 2}, identity_conflicts([
            Report(1, 1, 10, row()), Report(2, 2, 20, row(fromEntityName='Other'))]))
        result = match([Report(1, 1, 10, row()), Report(2, 2, 20, row(paymentFormat='Wire'))], {10, 20})
        self.assertEqual({'PAYMENT_FORMAT_CONFLICT'}, set(result.reasons.values()))

    def test_exact_values_not_hash_and_decimal_scale(self):
        result = match([Report(1, 1, 10, row(rowHash='same')),
                        Report(2, 2, 20, row(rowHash='same', occurredAt='2023-09-01T00:00:01Z'))], {10, 20})
        self.assertEqual([], result.matches)
        self.assertEqual({1, 2}, result.held_versions)
        result = match([Report(1, 1, 10, row()), Report(2, 2, 20, row(amountReceived='100'))], {10, 20})
        self.assertEqual(1, len(result.matches))

    def test_internal_and_external_occurrences_remain_distinct(self):
        internal = row(toBank=10, toBankName='Bank10', toAccount='002')
        result = match([Report(1, 1, 10, internal), Report(2, 1, 10, internal),
                        Report(3, 1, 10, row())], {10})
        self.assertEqual(3, len(result.matches))
        self.assertFalse(result.held_versions)


if __name__ == '__main__':
    unittest.main()
