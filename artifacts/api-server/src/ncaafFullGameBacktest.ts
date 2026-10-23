import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {runFullGameReplay} from "./lib/ncaafFullGameBacktest.js";
try{const file=process.argv[2];if(!file)throw Error("fullgame_input_required");const input=await readFile(file,"utf8");if(Buffer.byteLength(input)>50_000_000)throw Error("fullgame_input_too_large");console.log(JSON.stringify({...runFullGameReplay(JSON.parse(input)),inputSha256:createHash("sha256").update(input).digest("hex")},null,2));}catch(e){const m=e instanceof Error?e.message:"";console.error(/^fullgame_[a-z_]+$/.test(m)?m:"fullgame_invalid_input_or_run_error");process.exitCode=1;}
