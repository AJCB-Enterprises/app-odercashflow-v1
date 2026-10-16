-- A sign-in token used to stay valid for its full 12 hours even after the
-- account's password was changed, so a stolen token survived the very step
-- someone takes to recover from a theft. Record when the password last
-- changed; the API rejects tokens issued before that moment. NULL means the
-- password has never been changed, so no token is affected.
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;
