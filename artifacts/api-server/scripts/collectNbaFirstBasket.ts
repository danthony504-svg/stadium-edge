import { setTimeout as delay } from "node:timers/promises";
import { firstBasketWeek, MINUTE, slateDate } from "../src/lib/nbaFirstBasketArchive.js";
import { collectFirstBasket, fetchFirstBasketArchiveOdds } from "../src/lib/nbaFirstBasketCollector.js";
import { readFirstBasketCapture } from "../src/lib/nbaFirstBasketService.js";

const root = process.env.NBA_FIRST_BASKET_ARCHIVE_DIR;
if (!root) throw new Error("Set NBA_FIRST_BASKET_ARCHIVE_DIR to the durable archive directory");
const argument = process.argv[2];
if (argument === "--week") {
  console.log(JSON.stringify(await firstBasketWeek(root, process.argv[3] ?? slateDate(Date.now())), null, 2));
} else {
  if (argument && argument !== "--watch") throw new Error("Use --watch to poll, --week to report, or no argument for one poll");
  const key = process.env.ODDS_API_KEY;
  const fastReserve = process.env.NBA_FIRST_BASKET_FAST_RESERVE ? Number(process.env.NBA_FIRST_BASKET_FAST_RESERVE) : undefined;
  if (fastReserve !== undefined && (!Number.isSafeInteger(fastReserve) || fastReserve <= 0)) {
    throw new RangeError("NBA_FIRST_BASKET_FAST_RESERVE must be a positive integer");
  }
  do {
    const started = Date.now();
    const input = await readFirstBasketCapture();
    if (!input) throw new Error("Set NBA_FIRST_BASKET_CAPTURE to the normalized pregame capture");
    const result = await collectFirstBasket(root, input, { now: Date.now, fastReserve,
      ...(key ? { requestOdds: id => fetchFirstBasketArchiveOdds(key, id) } : {}),
    });
    console.log(JSON.stringify({ at: started, ...result }));
    if (argument === "--watch") await delay(Math.max(0, MINUTE - (Date.now() - started)));
  } while (argument === "--watch");
}
