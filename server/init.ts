import { openDb, schemaStats } from './db.ts';
const db = openDb();
console.log('القاعدة جاهزة:', schemaStats(db));
