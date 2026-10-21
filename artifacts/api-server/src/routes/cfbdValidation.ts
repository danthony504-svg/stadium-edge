import {Router,type IRouter} from "express";
import {authorizeCronRequest} from "../lib/cronAuth.js";
import {importCfbdHistory,cfbdImportSummary} from "../lib/cfbdHistory.js";
const router:IRouter=Router();
/** Protected manual import/check; neither this endpoint nor CFBD is used by Coach requests. */
router.post("/coach/ncaaf/data-check",async(req,res):Promise<void>=>{
 if(!authorizeCronRequest(req,res))return;
 const year=Number(req.body?.year),week=Number(req.body?.week);
 if(!Number.isInteger(year)||year<2013||year>new Date().getUTCFullYear()||!Number.isInteger(week)||week<1||week>16){res.status(400).json({ok:false,error:"year and week 1–16 required"});return;}
 try{res.json(cfbdImportSummary(await importCfbdHistory(year,week)));}
 catch(error){const raw=error instanceof Error?error.message:"";const safe=/^cfbd_[a-z_0-9]+$/.test(raw)?raw:"cfbd_import_failed";res.status(503).json({ok:false,error:safe,validationReady:false});}
});
export default router;
