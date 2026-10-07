import base64
import unittest

from private_data import PrivateDataProtector


class PrivateDataTests(unittest.TestCase):
    def setUp(self):
        self.encryption = base64.b64encode(bytes(range(32))).decode()
        self.search = base64.b64encode(bytes(range(32, 64))).decode()
        self.protector = PrivateDataProtector(self.encryption, self.search, "test-v1")

    def test_framed_token_and_compatibility_fixture(self):
        self.assertEqual(
            "9c8c56c5626b12ffe857dce4b514197c51b6db3779c14389b75d92e07c2f4f5b",
            self.protector.token("account", "12", "001234"),
        )
        self.assertNotEqual(self.protector.token("entity", "ab", "c"),
                            self.protector.token("entity", "a", "bc"))
        self.assertNotEqual(self.protector.token("entity", "ab", "c"),
                            self.protector.token("account", "ab", "c"))
        self.assertEqual("민감 원문", self.protector.decrypt(
            "entity-name", "IONO38yAReh/kF1igMaUAs221tqMWKkxvAdjUtGHzW7tQO+M0sIOuXE=", "test-v1"))

    def test_random_nonce_and_authenticated_context(self):
        first = self.protector.encrypt("entity-name", "민감 원문")
        self.assertNotEqual(first, self.protector.encrypt("entity-name", "민감 원문"))
        self.assertEqual("민감 원문", self.protector.decrypt("entity-name", first, "test-v1"))
        changed = bytearray(base64.b64decode(first))
        changed[-1] ^= 1
        for purpose, stored in [("account", first), ("entity-name", "!"),
                                ("entity-name", base64.b64encode(changed).decode()),
                                ("entity-name", "AA==")]:
            with self.subTest(purpose=purpose), self.assertRaisesRegex(
                    ValueError, "PRIVATE_DATA_AUTHENTICATION_FAILED"):
                self.protector.decrypt(purpose, stored, "test-v1")
        with self.assertRaisesRegex(ValueError, "PRIVATE_KEY_VERSION_MISMATCH"):
            self.protector.decrypt("entity-name", first, "other")

    def test_invalid_or_identical_keys_rejected(self):
        for encryption, search, version in [
            ("", "", "v1"), ("!", self.search, "v1"),
            (self.encryption, self.encryption.rstrip("="), "v1"),
            (self.encryption, self.search, " "),
        ]:
            with self.assertRaises(ValueError):
                PrivateDataProtector(encryption, search, version)


if __name__ == "__main__":
    unittest.main()
