-- @nosplit
CREATE TRIGGER supporting_documents_block_delete
BEFORE DELETE ON supporting_documents
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Supporting documents cannot be deleted';
END
