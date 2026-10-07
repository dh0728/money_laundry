import unittest

from identity_store import display_name


class DisplayNameTests(unittest.TestCase):
    def test_persisted_names_keep_code_unique_when_name_cycle_repeats(self):
        self.assertEqual(display_name(1), '김민준#00001')
        self.assertEqual(display_name(20), '홍민준#00020')
        self.assertEqual(display_name(21), '김서연#00021')
        self.assertEqual(display_name(800), '홍유진#00800')
        self.assertEqual(display_name(801), '김민준#00801')
        self.assertTrue(display_name(100000).endswith('#100000'))
        self.assertEqual(len({display_name(i) for i in range(1, 50382)}), 50381)

    def test_invalid_owner_number_is_rejected(self):
        for value in (0, -1, True, '1'):
            with self.assertRaises(ValueError):
                display_name(value)
