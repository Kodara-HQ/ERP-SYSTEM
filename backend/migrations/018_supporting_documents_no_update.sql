-- @nosplit
CREATE TRIGGER supporting_documents_block_update
BEFORE UPDATE ON supporting_documents
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Supporting documents are immutable';
END
