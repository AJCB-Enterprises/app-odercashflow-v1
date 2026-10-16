-- A third reminder type: asking the client for the BIR Form 2307 after tax was
-- withheld on a payment. The row that uses it is inserted in the next
-- migration, because a new enum value can't be used in the transaction that
-- creates it.
ALTER TYPE reminder_type ADD VALUE IF NOT EXISTS 'ewt';
