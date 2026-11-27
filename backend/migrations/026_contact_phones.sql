-- Company telephone numbers, shown on the public website. Several numbers are separated
-- by " / " and each gets its own call link. Only fills an empty value, so numbers later
-- changed in the ERP are left alone.

UPDATE website_settings SET phone = '+233 59 624 6119 / +233 55 318 4523' WHERE phone IS NULL OR phone = '';
UPDATE companies SET phone = '+233 59 624 6119 / +233 55 318 4523' WHERE phone IS NULL OR phone = '';
