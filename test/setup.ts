// Tests run against a real Postgres. Default to the local test database.
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/sv_test";
