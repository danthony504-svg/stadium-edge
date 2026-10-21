/** Run offline: node --import ./test/register-hooks.mjs scripts/validateNcaafForecasts.ts INPUT.json */
import {readFileSync} from "node:fs";
import {auditNcaafForecasts,type NcaafForecast} from "../src/lib/ncaafValidation.js";
const path=process.argv[2];
if(!path){console.log(JSON.stringify(auditNcaafForecasts([]),null,2));process.exitCode=2;}
else{const rows=JSON.parse(readFileSync(path,"utf8"));if(!Array.isArray(rows))throw Error("Expected an array of frozen NCAAF forecast records");console.log(JSON.stringify(auditNcaafForecasts(rows as NcaafForecast[]),null,2));}
