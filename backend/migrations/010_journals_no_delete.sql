-- @nosplit
CREATE TRIGGER journals_block_delete
BEFORE DELETE ON journals
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Posted journals cannot be deleted.';
END
