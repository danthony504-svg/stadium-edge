/** Render shell/worker: node dist/cfbdHistoryImport.mjs YEAR WEEK. Env key only. */
import {importCfbdHistory,cfbdImportSummary} from "./lib/cfbdHistory.js";
try{console.log(JSON.stringify(cfbdImportSummary(await importCfbdHistory(Number(process.argv[2]),Number(process.argv[3]))),null,2));}
catch(error){const raw=error instanceof Error?error.message:"";console.error(/^cfbd_[a-z_0-9]+$/.test(raw)?raw:"cfbd_import_failed");process.exitCode=1;}
