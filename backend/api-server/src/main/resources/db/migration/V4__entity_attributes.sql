-- Model-independent categories extracted during 거래 통합, the only stage that sees plaintext
-- names. They carry no name or identifier and are what analysis may read about an owner or a
-- bank: owners.entity_type and the existing banks.country. NULL means not derivable.
ALTER TABLE core.owners ADD COLUMN entity_type TEXT;
