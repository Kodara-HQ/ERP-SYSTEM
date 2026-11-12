-- @nosplit
CREATE TRIGGER journal_lines_block_delete
BEFORE DELETE ON journal_lines
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Posted journal lines cannot be deleted.';
END
