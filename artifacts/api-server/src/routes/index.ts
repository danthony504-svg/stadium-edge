import { Router, type IRouter } from "express";
import healthRouter from "./health";
import oddsRouter from "./odds";
import gamesRouter from "./games";
import injuriesRouter from "./injuries";
import weatherRouter from "./weather";
import chatRouter from "./chat";

const router: IRouter = Router();

router.use(healthRouter);
router.use(oddsRouter);
router.use(gamesRouter);
router.use(injuriesRouter);
router.use(weatherRouter);
router.use(chatRouter);

export default router;
