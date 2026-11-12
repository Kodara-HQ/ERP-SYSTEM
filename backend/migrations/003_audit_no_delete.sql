-- @nosplit
CREATE TRIGGER audit_logs_block_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit logs cannot be deleted';
END
