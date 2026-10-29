"""Categories derived from plaintext names while they are visible in 거래 통합.

Only the category is kept; names, numbers and identifiers are not. Values follow the
source spelling and are None when the name does not carry one. Model-specific
encodings (fixed type lists, UNKNOWN) belong to each model's build_input.
The demo data names carry the category as a prefix ("Corporation #33520",
"Some Bank #12"); a bank that sends an explicit customer type replaces this rule.
"""
import re

_ENTITY = re.compile(r'(\S(?:.*\S)?) #\d+')
_BANK_COUNTRY = re.compile(r'(.*?) Bank #')


def entity_type(name):
    match = _ENTITY.fullmatch(name or '')
    return match.group(1) if match else None


def bank_country(name):
    match = _BANK_COUNTRY.match(name or '')
    return match.group(1) if match and match.group(1) else None
