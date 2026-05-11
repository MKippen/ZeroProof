-- ZeroProof is single-admin: there's no UI for adding more users, /auth/setup
-- is gated on an empty table, and login no longer asks for a username. Drop
-- the column (and its unique index) so the schema reflects that the User row
-- is a singleton holding only the password hash.
DROP INDEX IF EXISTS "User_username_key";
ALTER TABLE "User" DROP COLUMN "username";
