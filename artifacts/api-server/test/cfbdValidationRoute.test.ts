import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import router from "../src/routes/cfbdValidation.js";
test("import endpoint requires cron auth and rejects bad batch before provider calls",async()=>{
 const previous=process.env.NOTIFY_CRON_KEY;process.env.NOTIFY_CRON_KEY="cron-fixture-not-live";
 const app=express().use(express.json()).use(router);const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));const address=server.address();assert.ok(address&&typeof address!=="string");
 try{
 const url=`http://127.0.0.1:${address.port}/coach/ncaaf/data-check`;
 assert.equal((await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({year:2025,week:1})})).status,403);
 const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json","x-cron-key":"cron-fixture-not-live"},body:JSON.stringify({year:2025,week:99})});assert.equal(response.status,400);
 }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));if(previous==null)delete process.env.NOTIFY_CRON_KEY;else process.env.NOTIFY_CRON_KEY=previous;}
});
