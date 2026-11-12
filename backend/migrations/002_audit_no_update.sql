-- @nosplit
CREATE TRIGGER audit_logs_block_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit logs are immutable';
END
