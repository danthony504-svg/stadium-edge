import test from "node:test";
import assert from "node:assert/strict";
import {saveCfbdArchive} from "../src/lib/cfbdArchive.js";
const snapshot={year:2025,week:1,importedAt:"2026-10-21T15:55:00Z",games:[],validationReady:false};
test("explicit research connection, parameterized idempotent insert, pool cleanup",async()=>{
 const queries:{sql:string;values?:unknown[]}[]=[];let closed=0;
 const factory=(url:string)=>{assert.equal(url,"research-fixture");return {query:async(sql:string,values?:unknown[])=>{queries.push({sql,values});},end:async()=>{closed++;}};};
 const a=await saveCfbdArchive(snapshot,"research-fixture",factory),b=await saveCfbdArchive(snapshot,"research-fixture",factory);
 assert.equal(a,b);assert.equal(closed,2);assert.match(queries[1]!.sql,/ON CONFLICT/);assert.equal(queries[1]!.values![4],JSON.stringify(snapshot));
});
test("database failure hides credentials and closes pool",async()=>{
 let closed=false;
 await assert.rejects(saveCfbdArchive(snapshot,"secret",()=>({query:async()=>{throw Error("secret");},end:async()=>{closed=true;}})),/^Error: cfbd_archive_database_error$/);assert.equal(closed,true);
});
