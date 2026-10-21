import {createHash} from "node:crypto";
type ArchivePool={query(text:string,values?:unknown[]):Promise<unknown>;end():Promise<void>};
/** Import-only archive. Never uses the application pool. */
export async function saveCfbdArchive(snapshot:{year:number;week:number;importedAt:string},url:string,factory?:(url:string)=>ArchivePool){
 let pool:ArchivePool|undefined;
 try{
  if(!url.trim())throw Error("missing connection");
  const create=factory??(await import("../../../../lib/db/src/research-pool.js")).createResearchPool;
  const active=create(url);pool=active;
  const payload=JSON.stringify(snapshot),hash=createHash("sha256").update(payload).digest("hex");
  await active.query(`CREATE TABLE IF NOT EXISTS cfbd_history_archives (sha256 text PRIMARY KEY,season integer NOT NULL,week integer NOT NULL,imported_at timestamptz NOT NULL,payload jsonb NOT NULL)`);
  await active.query(`INSERT INTO cfbd_history_archives (sha256,season,week,imported_at,payload) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (sha256) DO NOTHING`,[hash,snapshot.year,snapshot.week,snapshot.importedAt,payload]);
  return hash;
 }catch{throw Error("cfbd_archive_database_error");}
 finally{if(pool)await pool.end().catch(()=>{});}
}
