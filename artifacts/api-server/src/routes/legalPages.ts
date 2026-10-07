import { Router, type IRouter } from "express";
import {
  privacyPageHtml,
  supportPageHtml,
  termsPageHtml,
} from "../lib/legalPages";

/**
 * Public Support / Privacy / Terms pages (no auth).
 * Mounted at the host root so App Store Connect can use
 * https://stadium-edge.onrender.com/support
 */

const router: IRouter = Router();

function sendHtml(res: import("express").Response, html: string): void {
  res.status(200).type("html").set({
    "Cache-Control": "public, max-age=300",
    "X-Robots-Tag": "index, follow",
  }).send(html);
}

router.get("/support", (_req, res) => {
  sendHtml(res, supportPageHtml());
});

router.get("/privacy", (_req, res) => {
  sendHtml(res, privacyPageHtml());
});

router.get("/terms", (_req, res) => {
  sendHtml(res, termsPageHtml());
});

export default router;
