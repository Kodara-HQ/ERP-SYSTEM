-- Company contact email, shown on the public website (header, footer, contact page)
-- and used as the reply-to address on enquiry emails. Only fills an empty value,
-- so an address later changed in the ERP is left alone.

UPDATE website_settings SET email = 'info@bajogoenterprise.com' WHERE email IS NULL OR email = '';
UPDATE companies SET email = 'info@bajogoenterprise.com' WHERE email IS NULL OR email = '';
