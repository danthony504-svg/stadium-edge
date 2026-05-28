import { Router, type IRouter } from "express";
import healthRouter from "./health";
import oddsRouter from "./odds";
import propsRouter from "./props";
import gamesRouter from "./games";
import injuriesRouter from "./injuries";
import weatherRouter from "./weather";
import chatRouter from "./chat";
import athletesRouter from "./athletes";
import historyRouter from "./history";
import defenseRouter from "./defense";
import teamPeriodStatsRouter from "./teamPeriodStats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(oddsRouter);
router.use(propsRouter);
router.use(gamesRouter);
router.use(injuriesRouter);
router.use(weatherRouter);
router.use(chatRouter);
router.use(athletesRouter);
router.use(historyRouter);
router.use(defenseRouter);
router.use(teamPeriodStatsRouter);

export default router;
