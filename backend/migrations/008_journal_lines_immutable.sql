-- @nosplit
CREATE TRIGGER journal_lines_block_amount_update
BEFORE UPDATE ON journal_lines
FOR EACH ROW
BEGIN
  IF NOT (
    NEW.debit = OLD.debit
    AND NEW.credit = OLD.credit
    AND NEW.ledger_account_id = OLD.ledger_account_id
    AND NEW.journal_id = OLD.journal_id
    AND NEW.department_id <=> OLD.department_id
    AND NEW.memo <=> OLD.memo
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Posted journal lines cannot be changed.';
  END IF;
END
