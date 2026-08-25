process.env.TEST_DATABASE_URL ??= "postgresql://localhost:5432/postgres?schema=public";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
