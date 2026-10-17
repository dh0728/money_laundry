import unittest

from integrate.entity_attributes import bank_country, entity_type


class EntityAttributeTests(unittest.TestCase):
    def test_category_prefix_only(self):
        self.assertEqual(entity_type('Corporation #33520'), 'Corporation')
        self.assertEqual(entity_type('Sole Proprietorship #1'), 'Sole Proprietorship')
        for name in ('Kim Minjun', 'Corporation', '#12', ' #12', 'Corporation #', None, ''):
            with self.subTest(name=name):
                self.assertIsNone(entity_type(name))

    def test_bank_country_prefix_or_none(self):
        self.assertEqual(bank_country('Germany Bank #12'), 'Germany')
        self.assertEqual(bank_country('United States Bank #3'), 'United States')
        for name in ('National Bank of Laramie', 'Savings Bank of Huron', ' Bank #1', None, ''):
            with self.subTest(name=name):
                self.assertIsNone(bank_country(name))


if __name__ == '__main__':
    unittest.main()
