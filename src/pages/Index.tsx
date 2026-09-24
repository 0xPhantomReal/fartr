import { useEffect, useState } from "react";

/* =========================================================================================
   GRIDIRON SIM — a real Monte-Carlo NFL game simulator.
   Each sim: team pace → play volume → per-player usage (carries/targets) → matchup-adjusted
   efficiency (offense vs the opponent's pass/run defense) → player-vs-player (WR1 vs the
   opponent's top CB) → home-field → real distributions (Gaussian yards, Poisson TDs, Binomial
   catches) → PPR fantasy points. Averaged over N sims. Not random noise — model expectations
   that converge as N grows.

   DATA: pulls the live week's slate + real per-player usage from the proxy Worker
   (SportsDataIO first, free nflverse feeds as backup). If no proxy is configured or it's
   unreachable, it falls back to the curated slate below so the sim always works.
   Set the Worker URL once via the ⚙ control (saved in your browser) or DEFAULT_PROXY.
   ========================================================================================= */

// Paste your deployed Cloudflare Worker URL here (or set it at runtime via the ⚙ control).
const DEFAULT_PROXY = "";

type Pos = "QB" | "RB" | "WR" | "TE";
type Player = {
  name: string; pos: Pos;
  // QB
  pAtt?: number; cmp?: number; ypa?: number; pTD?: number; iNT?: number; rYd?: number; rTD?: number;
  // RB
  car?: number; ypc?: number; ruTD?: number;
  // pass-catchers (RB/WR/TE)
  tgt?: number; cr?: number; ypr?: number; recTD?: number; wr1?: boolean;
  // Depth-chart label (WR1/RB2/TE1…). DERIVED, never baked: it is stamped after injuries and
  // roster cuts land, so benching a team's WR1 promotes WR2 into the slot instead of leaving a hole.
  depth?: string;
};
type Team = { abbr: string; name: string; pace: number; def: { pass: number; run: number; cb: number }; players: Player[] };

/* per-game BASE lines vs an average defense at a neutral site (grounded in recent real usage).
   Used as the offline fallback when the live proxy isn't configured/reachable. */
const CURATED_T: Record<string, Team> = {
  ARI: { abbr: "ARI", name: "Cardinals", pace: 1.03, def: { pass: 1.1, run: 1.09, cb: 1.05 }, players: [
    { name: "J.Brissett", pos: "QB", pAtt: 39.3, cmp: 0.65, ypa: 6.94, pTD: 1.86, iNT: 0.74, rYd: 13.6, rTD: 0.09 },
    { name: "J.Conner", pos: "RB", car: 12.1, ypc: 3, ruTD: 0.43, tgt: 4.6, cr: 0.75, ypr: 4.2, recTD: 0.43 },
    { name: "T.Benson", pos: "RB", car: 8.2, ypc: 5.51, ruTD: 0, tgt: 4.9, cr: 0.75, ypr: 4.9, recTD: 0 },
    { name: "M.Wilson", pos: "WR", tgt: 8.3, cr: 0.63, ypr: 12.9, recTD: 0.53, wr1: true },
    { name: "M.Harrison Jr.", pos: "WR", tgt: 6.2, cr: 0.63, ypr: 14.8, recTD: 0.43 },
    { name: "G.Dortch", pos: "WR", tgt: 4.4, cr: 0.63, ypr: 7.1, recTD: 0.33 },
    { name: "T.McBride", pos: "TE", tgt: 12.4, cr: 0.68, ypr: 9.8, recTD: 0.74 } ] },
  ATL: { abbr: "ATL", name: "Falcons", pace: 1.01, def: { pass: 0.96, run: 1.08, cb: 0.98 }, players: [
    { name: "M.Penix Jr.", pos: "QB", pAtt: 34.7, cmp: 0.6, ypa: 7.18, pTD: 1.13, iNT: 0.43, rYd: 8.8, rTD: 0.14 },
    { name: "B.Robinson", pos: "RB", car: 19.1, ypc: 5.15, ruTD: 0.53, tgt: 7, cr: 0.75, ypr: 10.4, recTD: 0.3 },
    { name: "T.Allgeier", pos: "RB", car: 9.5, ypc: 3.6, ruTD: 0.61, tgt: 1.2, cr: 0.75, ypr: 6.8, recTD: 0 },
    { name: "D.London", pos: "WR", tgt: 10.2, cr: 0.63, ypr: 13.5, recTD: 0.75, wr1: true },
    { name: "D.Mooney", pos: "WR", tgt: 3.8, cr: 0.63, ypr: 13.8, recTD: 0.09 },
    { name: "D.Sills V", pos: "WR", tgt: 1.9, cr: 0.63, ypr: 10.6, recTD: 0.15 },
    { name: "K.Pitts Sr.", pos: "TE", tgt: 8.6, cr: 0.68, ypr: 10.5, recTD: 0.38 } ] },
  BAL: { abbr: "BAL", name: "Ravens", pace: 0.94, def: { pass: 1.15, run: 0.91, cb: 1.03 }, players: [
    { name: "L.Jackson", pos: "QB", pAtt: 26.3, cmp: 0.64, ypa: 8.44, pTD: 1.83, iNT: 0.69, rYd: 30.4, rTD: 0.2 },
    { name: "D.Henry", pos: "RB", car: 20.5, ypc: 5.2, ruTD: 1.06, tgt: 1.3, cr: 0.75, ypr: 10, recTD: 0 },
    { name: "K.Mitchell", pos: "RB", car: 5.1, ypc: 5.78, ruTD: 0.1, tgt: 1, cr: 0.75, ypr: 7, recTD: 0 },
    { name: "Z.Flowers", pos: "WR", tgt: 9.1, cr: 0.63, ypr: 14.1, recTD: 0.38, wr1: true },
    { name: "R.Bateman", pos: "WR", tgt: 2.6, cr: 0.63, ypr: 11.8, recTD: 0.2 },
    { name: "D.Hopkins", pos: "WR", tgt: 2.3, cr: 0.63, ypr: 15, recTD: 0.15 },
    { name: "M.Andrews", pos: "TE", tgt: 4.7, cr: 0.68, ypr: 8.8, recTD: 0.38 } ] },
  BUF: { abbr: "BUF", name: "Bills", pace: 1.04, def: { pass: 0.85, run: 1.15, cb: 0.9 }, players: [
    { name: "J.Allen", pos: "QB", pAtt: 30.7, cmp: 0.69, ypa: 7.97, pTD: 1.66, iNT: 0.66, rYd: 38.6, rTD: 0.94 },
    { name: "J.Cook", pos: "RB", car: 20.6, ypc: 5.25, ruTD: 0.8, tgt: 2.9, cr: 0.75, ypr: 8.8, recTD: 0.15 },
    { name: "T.Johnson", pos: "RB", car: 3.3, ypc: 4, ruTD: 0.23, tgt: 2.1, cr: 0.75, ypr: 11, recTD: 0.15 },
    { name: "K.Shakir", pos: "WR", tgt: 8.1, cr: 0.63, ypr: 10, recTD: 0.32, wr1: true },
    { name: "K.Coleman", pos: "WR", tgt: 5.3, cr: 0.63, ypr: 10.6, recTD: 0.39 },
    { name: "G.Davis", pos: "WR", tgt: 3.6, cr: 0.63, ypr: 10.8, recTD: 0.22 },
    { name: "D.Kincaid", pos: "TE", tgt: 5.4, cr: 0.68, ypr: 14.6, recTD: 0.53 } ] },
  CAR: { abbr: "CAR", name: "Panthers", pace: 0.97, def: { pass: 0.97, run: 1.05, cb: 1.05 }, players: [
    { name: "B.Young", pos: "QB", pAtt: 33.9, cmp: 0.64, ypa: 6.3, pTD: 1.63, iNT: 0.78, rYd: 15.3, rTD: 0.16 },
    { name: "R.Dowdle", pos: "RB", car: 15.7, ypc: 4.56, ruTD: 0.45, tgt: 3.5, cr: 0.75, ypr: 7.6, recTD: 0.08 },
    { name: "C.Hubbard", pos: "RB", car: 10.1, ypc: 3.81, ruTD: 0.09, tgt: 3, cr: 0.75, ypr: 7.4, recTD: 0.26 },
    { name: "T.McMillan", pos: "WR", tgt: 7.4, cr: 0.63, ypr: 14.5, recTD: 0.53, wr1: true },
    { name: "J.Coker", pos: "WR", tgt: 5.4, cr: 0.63, ypr: 11.9, recTD: 0.35 },
    { name: "H.Renfrow", pos: "WR", tgt: 4.5, cr: 0.63, ypr: 6, recTD: 0.43 },
    { name: "J.Sanders", pos: "TE", tgt: 3.7, cr: 0.68, ypr: 6.5, recTD: 0.1 } ] },
  CHI: { abbr: "CHI", name: "Bears", pace: 1.06, def: { pass: 1.08, run: 1.15, cb: 1.1 }, players: [
    { name: "C.Williams", pos: "QB", pAtt: 37.9, cmp: 0.58, ypa: 6.94, pTD: 1.8, iNT: 0.53, rYd: 25.5, rTD: 0.23 },
    { name: "D.Swift", pos: "RB", car: 15.8, ypc: 4.87, ruTD: 0.64, tgt: 3.2, cr: 0.75, ypr: 8.8, recTD: 0.08 },
    { name: "K.Monangai", pos: "RB", car: 11.3, ypc: 4.63, ruTD: 0.38, tgt: 1.6, cr: 0.75, ypr: 9.1, recTD: 0 },
    { name: "R.Odunze", pos: "WR", tgt: 6.6, cr: 0.63, ypr: 15, recTD: 0.64, wr1: true },
    { name: "L.Burden III", pos: "WR", tgt: 5.6, cr: 0.63, ypr: 13.9, recTD: 0.17 },
    { name: "D.Moore", pos: "WR", tgt: 5.3, cr: 0.63, ypr: 13.7, recTD: 0.45 },
    { name: "C.Loveland", pos: "TE", tgt: 6, cr: 0.68, ypr: 12.3, recTD: 0.48 } ] },
  CIN: { abbr: "CIN", name: "Bengals", pace: 1.02, def: { pass: 1.12, run: 1.15, cb: 1.1 }, players: [
    { name: "J.Burrow", pos: "QB", pAtt: 36.7, cmp: 0.67, ypa: 6.99, pTD: 2.41, iNT: 0.8, rYd: 5.8, rTD: 0 },
    { name: "C.Brown", pos: "RB", car: 15.5, ypc: 4.39, ruTD: 0.45, tgt: 6.1, cr: 0.75, ypr: 6.3, recTD: 0.38 },
    { name: "S.Perine", pos: "RB", car: 6.3, ypc: 4.55, ruTD: 0.26, tgt: 1.7, cr: 0.75, ypr: 5.1, recTD: 0 },
    { name: "J.Chase", pos: "WR", tgt: 14, cr: 0.63, ypr: 11.3, recTD: 0.64, wr1: true },
    { name: "T.Higgins", pos: "WR", tgt: 7.1, cr: 0.63, ypr: 14.3, recTD: 0.83 },
    { name: "A.Iosivas", pos: "WR", tgt: 3.5, cr: 0.63, ypr: 13.2, recTD: 0.15 },
    { name: "N.Fant", pos: "TE", tgt: 3.8, cr: 0.68, ypr: 8.5, recTD: 0.26 } ] },
  CLE: { abbr: "CLE", name: "Browns", pace: 0.99, def: { pass: 0.85, run: 1, cb: 0.9 }, players: [
    { name: "S.Sanders", pos: "QB", pAtt: 30, cmp: 0.57, ypa: 6.6, pTD: 1.13, iNT: 1.41, rYd: 23.9, rTD: 0.16 },
    { name: "Q.Judkins", pos: "RB", car: 18.6, ypc: 3.6, ruTD: 0.64, tgt: 2.8, cr: 0.75, ypr: 6.6, recTD: 0 },
    { name: "R.Sanders", pos: "RB", car: 7.7, ypc: 3.41, ruTD: 0.33, tgt: 1.3, cr: 0.75, ypr: 6.1, recTD: 0 },
    { name: "J.Jeudy", pos: "WR", tgt: 5.3, cr: 0.63, ypr: 12.1, recTD: 0.15, wr1: true },
    { name: "C.Tillman", pos: "WR", tgt: 2.9, cr: 0.63, ypr: 12.9, recTD: 0.2 },
    { name: "J.Thrash", pos: "WR", tgt: 2, cr: 0.63, ypr: 10.7, recTD: 0 },
    { name: "H.Fannin Jr.", pos: "TE", tgt: 7.5, cr: 0.68, ypr: 10.1, recTD: 0.48 } ] },
  DAL: { abbr: "DAL", name: "Cowboys", pace: 1.08, def: { pass: 1.15, run: 1.07, cb: 1.1 }, players: [
    { name: "D.Prescott", pos: "QB", pAtt: 40, cmp: 0.67, ypa: 7.59, pTD: 2, iNT: 0.66, rYd: 11.8, rTD: 0.15 },
    { name: "J.Williams", pos: "RB", car: 17.8, ypc: 4.77, ruTD: 0.78, tgt: 3.3, cr: 0.75, ypr: 4, recTD: 0.16 },
    { name: "J.Blue", pos: "RB", car: 8.6, ypc: 3.39, ruTD: 0.26, tgt: 0.3, cr: 0.75, ypr: 4.9, recTD: 0 },
    { name: "G.Pickens", pos: "WR", tgt: 9.8, cr: 0.63, ypr: 15.4, recTD: 0.6, wr1: true },
    { name: "C.Lamb", pos: "WR", tgt: 9.6, cr: 0.63, ypr: 14.4, recTD: 0.28 },
    { name: "R.Flournoy", pos: "WR", tgt: 4.5, cr: 0.63, ypr: 11.9, recTD: 0.32 },
    { name: "J.Ferguson", pos: "TE", tgt: 8, cr: 0.68, ypr: 7.3, recTD: 0.61 } ] },
  DEN: { abbr: "DEN", name: "Broncos", pace: 1.05, def: { pass: 0.89, run: 0.85, cb: 0.9 }, players: [
    { name: "B.Nix", pos: "QB", pAtt: 40.8, cmp: 0.63, ypa: 6.42, pTD: 1.66, iNT: 0.74, rYd: 23.7, rTD: 0.38 },
    { name: "J.Dobbins", pos: "RB", car: 17.3, ypc: 5.05, ruTD: 0.51, tgt: 1.7, cr: 0.75, ypr: 4, recTD: 0 },
    { name: "R.Harvey", pos: "RB", car: 9.7, ypc: 3.7, ruTD: 0.53, tgt: 4.2, cr: 0.75, ypr: 7.6, recTD: 0.38 },
    { name: "C.Sutton", pos: "WR", tgt: 7.8, cr: 0.63, ypr: 13.8, recTD: 0.53, wr1: true },
    { name: "T.Franklin", pos: "WR", tgt: 6.9, cr: 0.63, ypr: 10.9, recTD: 0.45 },
    { name: "M.Mims Jr.", pos: "WR", tgt: 4.4, cr: 0.63, ypr: 8.7, recTD: 0.09 },
    { name: "E.Engram", pos: "TE", tgt: 5.2, cr: 0.68, ypr: 9.2, recTD: 0.08 } ] },
  DET: { abbr: "DET", name: "Lions", pace: 1.02, def: { pass: 1.04, run: 0.98, cb: 1.02 }, players: [
    { name: "J.Goff", pos: "QB", pAtt: 38.5, cmp: 0.68, ypa: 7.9, pTD: 2.26, iNT: 0.61, rYd: 3, rTD: 0 },
    { name: "J.Gibbs", pos: "RB", car: 16.2, ypc: 5.03, ruTD: 0.86, tgt: 6.8, cr: 0.75, ypr: 8, recTD: 0.38 },
    { name: "D.Montgomery", pos: "RB", car: 10.5, ypc: 4.53, ruTD: 0.61, tgt: 2.1, cr: 0.75, ypr: 8, recTD: 0 },
    { name: "A.St. Brown", pos: "WR", tgt: 12.4, cr: 0.63, ypr: 12, recTD: 0.74, wr1: true },
    { name: "J.Williams", pos: "WR", tgt: 6.9, cr: 0.63, ypr: 17.2, recTD: 0.53 },
    { name: "K.Raymond", pos: "WR", tgt: 2.9, cr: 0.63, ypr: 12, recTD: 0.09 },
    { name: "S.LaPorta", pos: "TE", tgt: 7.4, cr: 0.68, ypr: 12.2, recTD: 0.43 } ] },
  GB: { abbr: "GB", name: "Packers", pace: 0.97, def: { pass: 0.93, run: 1.01, cb: 0.92 }, players: [
    { name: "J.Love", pos: "QB", pAtt: 33.2, cmp: 0.66, ypa: 7.7, pTD: 1.74, iNT: 0.51, rYd: 15, rTD: 0 },
    { name: "J.Jacobs", pos: "RB", car: 17.7, ypc: 3.97, ruTD: 0.98, tgt: 3.6, cr: 0.75, ypr: 7.8, recTD: 0.09 },
    { name: "E.Wilson", pos: "RB", car: 8.3, ypc: 3.97, ruTD: 0.23, tgt: 1.3, cr: 0.75, ypr: 6.6, recTD: 0 },
    { name: "C.Watson", pos: "WR", tgt: 6.3, cr: 0.63, ypr: 17.4, recTD: 0.77, wr1: true },
    { name: "R.Doubs", pos: "WR", tgt: 6.2, cr: 0.63, ypr: 13.2, recTD: 0.48 },
    { name: "J.Reed", pos: "WR", tgt: 4.9, cr: 0.63, ypr: 10.9, recTD: 0.19 },
    { name: "T.Kraft", pos: "TE", tgt: 6.7, cr: 0.68, ypr: 15.3, recTD: 0.96 } ] },
  HOU: { abbr: "HOU", name: "Texans", pace: 1.04, def: { pass: 0.88, run: 0.85, cb: 0.9 }, players: [
    { name: "C.Stroud", pos: "QB", pAtt: 34.2, cmp: 0.65, ypa: 7.19, pTD: 1.54, iNT: 0.74, rYd: 16.9, rTD: 0.09 },
    { name: "W.Marks", pos: "RB", car: 13.9, ypc: 3.59, ruTD: 0.24, tgt: 2.3, cr: 0.75, ypr: 8.7, recTD: 0.24 },
    { name: "J.Jordan", pos: "RB", car: 12.2, ypc: 4.49, ruTD: 0, tgt: 3, cr: 0.75, ypr: 4.3, recTD: 0 },
    { name: "N.Collins", pos: "WR", tgt: 8.5, cr: 0.63, ypr: 15.7, recTD: 0.51, wr1: true },
    { name: "J.Higgins", pos: "WR", tgt: 4.3, cr: 0.63, ypr: 12.8, recTD: 0.45 },
    { name: "J.Wayne", pos: "WR", tgt: 4.1, cr: 0.63, ypr: 8.7, recTD: 0 },
    { name: "D.Schultz", pos: "TE", tgt: 8, cr: 0.68, ypr: 9.5, recTD: 0.23 } ] },
  IND: { abbr: "IND", name: "Colts", pace: 0.98, def: { pass: 1.15, run: 0.87, cb: 1.03 }, players: [
    { name: "P.Rivers", pos: "QB", pAtt: 34.7, cmp: 0.63, ypa: 5.92, pTD: 1.7, iNT: 1.3, rYd: -0.4, rTD: 0 },
    { name: "J.Taylor", pos: "RB", car: 21.5, ypc: 4.91, ruTD: 1.2, tgt: 4.1, cr: 0.75, ypr: 8.2, recTD: 0.15 },
    { name: "M.Pittman Jr.", pos: "WR", tgt: 8.5, cr: 0.63, ypr: 9.8, recTD: 0.53, wr1: true },
    { name: "J.Downs", pos: "WR", tgt: 6.5, cr: 0.63, ypr: 9.8, recTD: 0.32 },
    { name: "A.Pierce", pos: "WR", tgt: 5.6, cr: 0.63, ypr: 18, recTD: 0.51 },
    { name: "T.Warren", pos: "TE", tgt: 7.4, cr: 0.68, ypr: 10.8, recTD: 0.3 } ] },
  JAX: { abbr: "JAX", name: "Jaguars", pace: 1.05, def: { pass: 1.04, run: 0.85, cb: 0.9 }, players: [
    { name: "T.Lawrence", pos: "QB", pAtt: 37.3, cmp: 0.61, ypa: 7.16, pTD: 1.94, iNT: 0.8, rYd: 23.9, rTD: 0.6 },
    { name: "T.Etienne Jr.", pos: "RB", car: 17.3, ypc: 4.26, ruTD: 0.53, tgt: 3.2, cr: 0.75, ypr: 8.1, recTD: 0.45 },
    { name: "B.Tuten", pos: "RB", car: 6.3, ypc: 3.7, ruTD: 0.43, tgt: 1, cr: 0.75, ypr: 7.9, recTD: 0.17 },
    { name: "J.Meyers", pos: "WR", tgt: 8.4, cr: 0.63, ypr: 11.1, recTD: 0.24, wr1: true },
    { name: "T.Hunter", pos: "WR", tgt: 7.2, cr: 0.63, ypr: 10.6, recTD: 0.19 },
    { name: "P.Washington", pos: "WR", tgt: 6.5, cr: 0.63, ypr: 14.6, recTD: 0.4 },
    { name: "B.Strange", pos: "TE", tgt: 6.4, cr: 0.68, ypr: 11.7, recTD: 0.33 } ] },
  KC: { abbr: "KC", name: "Chiefs", pace: 1.02, def: { pass: 0.93, run: 0.9, cb: 1 }, players: [
    { name: "P.Mahomes", pos: "QB", pAtt: 40.6, cmp: 0.63, ypa: 7.15, pTD: 1.78, iNT: 0.89, rYd: 34.2, rTD: 0.46 },
    { name: "K.Hunt", pos: "RB", car: 10.9, ypc: 3.75, ruTD: 0.61, tgt: 1.6, cr: 0.75, ypr: 7.9, recTD: 0.08 },
    { name: "I.Pacheco", pos: "RB", car: 10.3, ypc: 3.91, ruTD: 0.1, tgt: 2.2, cr: 0.75, ypr: 5.3, recTD: 0.1 },
    { name: "R.Rice", pos: "WR", tgt: 11.9, cr: 0.63, ypr: 10.8, recTD: 0.8, wr1: true },
    { name: "M.Brown", pos: "WR", tgt: 5.5, cr: 0.63, ypr: 12, recTD: 0.4 },
    { name: "X.Worthy", pos: "WR", tgt: 5.4, cr: 0.63, ypr: 12.7, recTD: 0.09 },
    { name: "T.Kelce", pos: "TE", tgt: 7.4, cr: 0.68, ypr: 11.2, recTD: 0.38 } ] },
  LV: { abbr: "LV", name: "Raiders", pace: 0.91, def: { pass: 0.96, run: 1, cb: 1 }, players: [
    { name: "G.Smith", pos: "QB", pAtt: 33.8, cmp: 0.67, ypa: 6.75, pTD: 1.43, iNT: 1.29, rYd: 8.2, rTD: 0 },
    { name: "A.Jeanty", pos: "RB", car: 17.7, ypc: 3.67, ruTD: 0.38, tgt: 4.9, cr: 0.75, ypr: 6.3, recTD: 0.38 },
    { name: "T.Tucker", pos: "WR", tgt: 6, cr: 0.63, ypr: 12.2, recTD: 0.38, wr1: true },
    { name: "T.Lockett", pos: "WR", tgt: 3.4, cr: 0.63, ypr: 9.1, recTD: 0.08 },
    { name: "J.Bech", pos: "WR", tgt: 2.3, cr: 0.63, ypr: 11.2, recTD: 0 },
    { name: "A.Okwuegbunam", pos: "TE", tgt: 9.4, cr: 0.68, ypr: 6.4, recTD: 0 } ] },
  LAC: { abbr: "LAC", name: "Chargers", pace: 1.05, def: { pass: 0.86, run: 0.9, cb: 0.93 }, players: [
    { name: "J.Herbert", pos: "QB", pAtt: 36.3, cmp: 0.66, ypa: 7.28, pTD: 1.84, iNT: 0.92, rYd: 35.3, rTD: 0.16 },
    { name: "O.Hampton", pos: "RB", car: 15.6, ypc: 4.4, ruTD: 0.57, tgt: 5.4, cr: 0.75, ypr: 6, recTD: 0.14 },
    { name: "K.Vidal", pos: "RB", car: 13.5, ypc: 4.15, ruTD: 0.3, tgt: 1.9, cr: 0.75, ypr: 8.5, recTD: 0.1 },
    { name: "K.Allen", pos: "WR", tgt: 8.6, cr: 0.63, ypr: 9.6, recTD: 0.3, wr1: true },
    { name: "L.McConkey", pos: "WR", tgt: 7.4, cr: 0.63, ypr: 12, recTD: 0.48 },
    { name: "Q.Johnston", pos: "WR", tgt: 6.6, cr: 0.63, ypr: 14.4, recTD: 0.74 },
    { name: "O.Gadsden", pos: "TE", tgt: 5.4, cr: 0.68, ypr: 13.6, recTD: 0.26 } ] },
  LAR: { abbr: "LAR", name: "Rams", pace: 1.04, def: { pass: 1.03, run: 0.95, cb: 0.96 }, players: [
    { name: "M.Stafford", pos: "QB", pAtt: 39.8, cmp: 0.65, ypa: 7.88, pTD: 3.06, iNT: 0.61, rYd: 0.1, rTD: 0 },
    { name: "K.Williams", pos: "RB", car: 17.3, ypc: 4.83, ruTD: 0.66, tgt: 3.2, cr: 0.75, ypr: 7.8, recTD: 0.23 },
    { name: "B.Corum", pos: "RB", car: 9.7, ypc: 5.14, ruTD: 0.45, tgt: 0.8, cr: 0.75, ypr: 4, recTD: 0 },
    { name: "P.Nacua", pos: "WR", tgt: 14.5, cr: 0.63, ypr: 13.3, recTD: 0.71, wr1: true },
    { name: "D.Adams", pos: "WR", tgt: 7.7, cr: 0.63, ypr: 13.1, recTD: 1.14 },
    { name: "X.Smith", pos: "WR", tgt: 2, cr: 0.63, ypr: 16.8, recTD: 0 },
    { name: "C.Parkinson", pos: "TE", tgt: 4.8, cr: 0.68, ypr: 9.5, recTD: 0.69 } ] },
  MIA: { abbr: "MIA", name: "Dolphins", pace: 0.91, def: { pass: 1.03, run: 1.13, cb: 1.09 }, players: [
    { name: "T.Tagovailoa", pos: "QB", pAtt: 31.1, cmp: 0.68, ypa: 6.93, pTD: 1.62, iNT: 1.21, rYd: 3.5, rTD: 0 },
    { name: "D.Achane", pos: "RB", car: 16.9, ypc: 5.67, ruTD: 0.64, tgt: 6.3, cr: 0.75, ypr: 7.3, recTD: 0.32 },
    { name: "J.Wright", pos: "RB", car: 7.9, ypc: 4.11, ruTD: 0.26, tgt: 0.9, cr: 0.75, ypr: 7.8, recTD: 0 },
    { name: "T.Hill", pos: "WR", tgt: 9.4, cr: 0.63, ypr: 12.6, recTD: 0.33, wr1: true },
    { name: "J.Waddle", pos: "WR", tgt: 7.2, cr: 0.63, ypr: 14.2, recTD: 0.48 },
    { name: "M.Washington", pos: "WR", tgt: 4.9, cr: 0.63, ypr: 6.9, recTD: 0.23 },
    { name: "D.Waller", pos: "TE", tgt: 4.4, cr: 0.68, ypr: 11.8, recTD: 0.86 } ] },
  MIN: { abbr: "MIN", name: "Vikings", pace: 0.92, def: { pass: 0.85, run: 1.06, cb: 0.92 }, players: [
    { name: "C.Wentz", pos: "QB", pAtt: 38.3, cmp: 0.65, ypa: 7.19, pTD: 1.54, iNT: 1.28, rYd: 12.9, rTD: 0 },
    { name: "A.Jones Sr.", pos: "RB", car: 12.5, ypc: 4.15, ruTD: 0.22, tgt: 3.5, cr: 0.75, ypr: 7.1, recTD: 0.11 },
    { name: "J.Mason", pos: "RB", car: 11.3, ypc: 4.77, ruTD: 0.48, tgt: 1.3, cr: 0.75, ypr: 4, recTD: 0 },
    { name: "J.Jefferson", pos: "WR", tgt: 8.9, cr: 0.63, ypr: 12.5, recTD: 0.15, wr1: true },
    { name: "J.Addison", pos: "WR", tgt: 5.4, cr: 0.63, ypr: 14.5, recTD: 0.28 },
    { name: "J.Nailor", pos: "WR", tgt: 3.1, cr: 0.63, ypr: 15.3, recTD: 0.3 },
    { name: "T.Hockenson", pos: "TE", tgt: 5.7, cr: 0.68, ypr: 8.6, recTD: 0.26 } ] },
  NE: { abbr: "NE", name: "Patriots", pace: 1, def: { pass: 0.92, run: 0.87, cb: 0.95 }, players: [
    { name: "D.Maye", pos: "QB", pAtt: 32.8, cmp: 0.72, ypa: 8.93, pTD: 2.06, iNT: 0.61, rYd: 30, rTD: 0.3 },
    { name: "T.Henderson", pos: "RB", car: 12, ypc: 5.06, ruTD: 0.6, tgt: 3.1, cr: 0.75, ypr: 6.3, recTD: 0.08 },
    { name: "R.Stevenson", pos: "RB", car: 10.5, ypc: 4.64, ruTD: 0.64, tgt: 3.5, cr: 0.75, ypr: 10.8, recTD: 0.19 },
    { name: "S.Diggs", pos: "WR", tgt: 9, cr: 0.63, ypr: 11.9, recTD: 0.3, wr1: true },
    { name: "M.Hollins", pos: "WR", tgt: 5.5, cr: 0.63, ypr: 12, recTD: 0.17 },
    { name: "K.Boutte", pos: "WR", tgt: 4.2, cr: 0.63, ypr: 16.7, recTD: 0.55 },
    { name: "H.Henry", pos: "TE", tgt: 5.9, cr: 0.68, ypr: 12.8, recTD: 0.53 } ] },
  NO: { abbr: "NO", name: "Saints", pace: 1.03, def: { pass: 0.85, run: 1.03, cb: 0.95 }, players: [
    { name: "T.Shough", pos: "QB", pAtt: 33.7, cmp: 0.68, ypa: 7.29, pTD: 1.03, iNT: 0.7, rYd: 19.2, rTD: 0.35 },
    { name: "A.Kamara", pos: "RB", car: 13.5, ypc: 3.6, ruTD: 0.12, tgt: 4.5, cr: 0.75, ypr: 5.6, recTD: 0 },
    { name: "A.Estimé", pos: "RB", car: 7.4, ypc: 4.31, ruTD: 0.19, tgt: 2.6, cr: 0.75, ypr: 8.6, recTD: 0 },
    { name: "C.Olave", pos: "WR", tgt: 11.2, cr: 0.63, ypr: 11.6, recTD: 0.64, wr1: true },
    { name: "D.Vele", pos: "WR", tgt: 3.5, cr: 0.63, ypr: 11.7, recTD: 0.2 },
    { name: "K.Austin Jr.", pos: "WR", tgt: 2.9, cr: 0.63, ypr: 10.8, recTD: 0.16 },
    { name: "J.Johnson", pos: "TE", tgt: 7.5, cr: 0.68, ypr: 11.6, recTD: 0.23 } ] },
  NYG: { abbr: "NYG", name: "Giants", pace: 1.04, def: { pass: 1.02, run: 1.15, cb: 1.01 }, players: [
    { name: "J.Dart", pos: "QB", pAtt: 27.4, cmp: 0.64, ypa: 6.7, pTD: 1.21, iNT: 0.46, rYd: 39.4, rTD: 0.73 },
    { name: "C.Skattebo", pos: "RB", car: 14.3, ypc: 4.06, ruTD: 0.8, tgt: 4.5, cr: 0.75, ypr: 8.6, recTD: 0.33 },
    { name: "T.Tracy Jr.", pos: "RB", car: 13.3, ypc: 4.2, ruTD: 0.17, tgt: 3.6, cr: 0.75, ypr: 8, recTD: 0.17 },
    { name: "W.Robinson", pos: "WR", tgt: 10.3, cr: 0.63, ypr: 11, recTD: 0.32, wr1: true },
    { name: "M.Nabers", pos: "WR", tgt: 8.1, cr: 0.63, ypr: 15, recTD: 0.65 },
    { name: "D.Slayton", pos: "WR", tgt: 4.8, cr: 0.63, ypr: 14.5, recTD: 0.09 },
    { name: "T.Johnson", pos: "TE", tgt: 5, cr: 0.68, ypr: 11.7, recTD: 0.43 } ] },
  NYJ: { abbr: "NYJ", name: "Jets", pace: 0.97, def: { pass: 1.03, run: 1.15, cb: 1.09 }, players: [
    { name: "B.Cook", pos: "QB", pAtt: 34.7, cmp: 0.58, ypa: 5, pTD: 0.52, iNT: 1.8, rYd: 11.1, rTD: 0 },
    { name: "B.Hall", pos: "RB", car: 17.2, ypc: 4.38, ruTD: 0.32, tgt: 3.4, cr: 0.75, ypr: 9.7, recTD: 0.08 },
    { name: "B.Allen", pos: "RB", car: 5.1, ypc: 4.22, ruTD: 0.33, tgt: 0.9, cr: 0.75, ypr: 7.4, recTD: 0 },
    { name: "G.Wilson", pos: "WR", tgt: 9.3, cr: 0.63, ypr: 11, recTD: 0.73, wr1: true },
    { name: "J.Reynolds", pos: "WR", tgt: 4, cr: 0.63, ypr: 9.2, recTD: 0 },
    { name: "J.Metchie III", pos: "WR", tgt: 3.7, cr: 0.63, ypr: 8.3, recTD: 0.16 },
    { name: "M.Taylor", pos: "TE", tgt: 5.6, cr: 0.68, ypr: 8.4, recTD: 0.1 } ] },
  PHI: { abbr: "PHI", name: "Eagles", pace: 0.97, def: { pass: 0.9, run: 1.06, cb: 0.91 }, players: [
    { name: "J.Hurts", pos: "QB", pAtt: 32.2, cmp: 0.65, ypa: 7.1, pTD: 1.77, iNT: 0.48, rYd: 29.8, rTD: 0.64 },
    { name: "S.Barkley", pos: "RB", car: 19.8, ypc: 4.07, ruTD: 0.56, tgt: 3.5, cr: 0.75, ypr: 7.4, recTD: 0.16 },
    { name: "T.Bigsby", pos: "RB", car: 4.2, ypc: 5.65, ruTD: 0.15, tgt: 0.3, cr: 0.75, ypr: 9.3, recTD: 0 },
    { name: "A.Brown", pos: "WR", tgt: 9.4, cr: 0.63, ypr: 12.9, recTD: 0.6, wr1: true },
    { name: "D.Smith", pos: "WR", tgt: 8.1, cr: 0.63, ypr: 13.1, recTD: 0.3 },
    { name: "J.Dotson", pos: "WR", tgt: 1.9, cr: 0.63, ypr: 14.5, recTD: 0.08 },
    { name: "D.Goedert", pos: "TE", tgt: 6.7, cr: 0.68, ypr: 9.8, recTD: 0.83 } ] },
  PIT: { abbr: "PIT", name: "Steelers", pace: 0.95, def: { pass: 1.15, run: 0.97, cb: 1.03 }, players: [
    { name: "A.Rodgers", pos: "QB", pAtt: 35.3, cmp: 0.66, ypa: 6.67, pTD: 1.7, iNT: 0.56, rYd: 4.3, rTD: 0.08 },
    { name: "J.Warren", pos: "RB", car: 14.9, ypc: 4.54, ruTD: 0.48, tgt: 3.8, cr: 0.75, ypr: 8.3, recTD: 0.16 },
    { name: "K.Gainwell", pos: "RB", car: 7.6, ypc: 4.71, ruTD: 0.38, tgt: 6.5, cr: 0.75, ypr: 6.7, recTD: 0.23 },
    { name: "D.Metcalf", pos: "WR", tgt: 7.1, cr: 0.63, ypr: 14.4, recTD: 0.51, wr1: true },
    { name: "C.Austin III", pos: "WR", tgt: 4, cr: 0.63, ypr: 12, recTD: 0.28 },
    { name: "M.Valdes-Scantling", pos: "WR", tgt: 2.5, cr: 0.63, ypr: 8.6, recTD: 0.13 },
    { name: "P.Freiermuth", pos: "TE", tgt: 4, cr: 0.68, ypr: 11.8, recTD: 0.3 } ] },
  SF: { abbr: "SF", name: "49ers", pace: 1.04, def: { pass: 1.11, run: 0.92, cb: 1.03 }, players: [
    { name: "B.Purdy", pos: "QB", pAtt: 35.8, cmp: 0.69, ypa: 7.63, pTD: 2.52, iNT: 1.26, rYd: 18.5, rTD: 0.43 },
    { name: "C.McCaffrey", pos: "RB", car: 20.7, ypc: 3.86, ruTD: 0.66, tgt: 9.1, cr: 0.75, ypr: 9.1, recTD: 0.53 },
    { name: "B.Robinson Jr.", pos: "RB", car: 6.1, ypc: 4.35, ruTD: 0.15, tgt: 0.8, cr: 0.75, ypr: 4, recTD: 0 },
    { name: "R.Pearsall", pos: "WR", tgt: 7.2, cr: 0.63, ypr: 14.7, recTD: 0, wr1: true },
    { name: "J.Jennings", pos: "WR", tgt: 6.6, cr: 0.63, ypr: 11.7, recTD: 0.68 },
    { name: "K.Bourne", pos: "WR", tgt: 4.2, cr: 0.63, ypr: 14.9, recTD: 0 },
    { name: "G.Kittle", pos: "TE", tgt: 8.6, cr: 0.68, ypr: 11, recTD: 0.82 } ] },
  SEA: { abbr: "SEA", name: "Seahawks", pace: 0.97, def: { pass: 0.92, run: 0.85, cb: 0.9 }, players: [
    { name: "S.Darnold", pos: "QB", pAtt: 31.8, cmp: 0.68, ypa: 8.49, pTD: 1.66, iNT: 0.94, rYd: 6.3, rTD: 0 },
    { name: "K.Walker III", pos: "RB", car: 14.7, ypc: 4.65, ruTD: 0.38, tgt: 2.8, cr: 0.75, ypr: 9.1, recTD: 0 },
    { name: "Z.Charbonnet", pos: "RB", car: 13, ypc: 3.97, ruTD: 0.85, tgt: 1.9, cr: 0.75, ypr: 7.2, recTD: 0 },
    { name: "J.Smith-Njigba", pos: "WR", tgt: 12.6, cr: 0.63, ypr: 15.1, recTD: 0.66, wr1: true },
    { name: "R.Shaheed", pos: "WR", tgt: 5.9, cr: 0.63, ypr: 11.7, recTD: 0.14 },
    { name: "C.Kupp", pos: "WR", tgt: 5.3, cr: 0.63, ypr: 12.6, recTD: 0.16 },
    { name: "A.Barner", pos: "TE", tgt: 5.1, cr: 0.68, ypr: 10, recTD: 0.45 } ] },
  TB: { abbr: "TB", name: "Buccaneers", pace: 1.03, def: { pass: 1.14, run: 0.85, cb: 1.09 }, players: [
    { name: "B.Mayfield", pos: "QB", pAtt: 36.2, cmp: 0.63, ypa: 6.8, pTD: 1.74, iNT: 0.74, rYd: 25.5, rTD: 0.08 },
    { name: "B.Irving", pos: "RB", car: 19.6, ypc: 3.4, ruTD: 0.13, tgt: 4.5, cr: 0.75, ypr: 9.2, recTD: 0.39 },
    { name: "R.White", pos: "RB", car: 8.8, ypc: 4.33, ruTD: 0.3, tgt: 3.6, cr: 0.75, ypr: 5.5, recTD: 0 },
    { name: "M.Evans", pos: "WR", tgt: 6.7, cr: 0.63, ypr: 12.3, recTD: 0.49, wr1: true },
    { name: "E.Egbuka", pos: "WR", tgt: 6.7, cr: 0.63, ypr: 14.9, recTD: 0.45 },
    { name: "C.Godwin Jr.", pos: "WR", tgt: 6.6, cr: 0.63, ypr: 10.9, recTD: 0.29 },
    { name: "C.Otton", pos: "TE", tgt: 6.1, cr: 0.68, ypr: 9.7, recTD: 0.08 } ] },
  TEN: { abbr: "TEN", name: "Titans", pace: 0.96, def: { pass: 1.1, run: 0.98, cb: 1.1 }, players: [
    { name: "C.Ward", pos: "QB", pAtt: 36, cmp: 0.6, ypa: 5.87, pTD: 1, iNT: 0.53, rYd: 10.6, rTD: 0.15 },
    { name: "T.Pollard", pos: "RB", car: 16.1, ypc: 4.47, ruTD: 0.38, tgt: 2.9, cr: 0.75, ypr: 6.2, recTD: 0 },
    { name: "T.Spears", pos: "RB", car: 6.3, ypc: 3.93, ruTD: 0.2, tgt: 5.2, cr: 0.75, ypr: 5.9, recTD: 0 },
    { name: "C.Dike", pos: "WR", tgt: 5.1, cr: 0.63, ypr: 8.8, recTD: 0.3, wr1: true },
    { name: "E.Ayomanor", pos: "WR", tgt: 4.6, cr: 0.63, ypr: 12.5, recTD: 0.32 },
    { name: "C.Ridley", pos: "WR", tgt: 4.4, cr: 0.63, ypr: 17.8, recTD: 0 },
    { name: "C.Okonkwo", pos: "TE", tgt: 5.5, cr: 0.68, ypr: 10, recTD: 0.15 } ] },
  WAS: { abbr: "WAS", name: "Commanders", pace: 0.95, def: { pass: 1.15, run: 1.15, cb: 1.1 }, players: [
    { name: "J.Daniels", pos: "QB", pAtt: 30.4, cmp: 0.61, ypa: 6.71, pTD: 1.47, iNT: 0.56, rYd: 45, rTD: 0.37 },
    { name: "J.Croskey-Merritt", pos: "RB", car: 11.7, ypc: 4.6, ruTD: 0.61, tgt: 0.8, cr: 0.75, ypr: 7.5, recTD: 0 },
    { name: "A.Ekeler", pos: "RB", car: 8, ypc: 3.06, ruTD: 0, tgt: 4.3, cr: 0.75, ypr: 6.7, recTD: 0 },
    { name: "D.Samuel Sr.", pos: "WR", tgt: 8.1, cr: 0.63, ypr: 10.1, recTD: 0.4, wr1: true },
    { name: "T.McLaurin", pos: "WR", tgt: 6.8, cr: 0.63, ypr: 15.3, recTD: 0.39 },
    { name: "R.Chosen", pos: "WR", tgt: 3.4, cr: 0.63, ypr: 9.4, recTD: 0 },
    { name: "Z.Ertz", pos: "TE", tgt: 6.4, cr: 0.68, ypr: 10.1, recTD: 0.39 } ] },
};

/* ---- COLLEGE FOOTBALL: real per-player 2025 usage for the FBS teams, same rate model as the
   NFL set above. Scraped from ESPN (team offense/defense splits + per-athlete season stats).
   Per-game rates use each TEAM's games played, since ESPN's athlete endpoint carries no
   games-played field — fine for starters, slightly understates part-season players. ---- */
const CFB_T: Record<string, Team> = {
  AFA: { abbr: "AFA", name: "Air Force", pace: 1.02, def: { pass: 1.15, run: 1.06, cb: 1.1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 13.7, cmp: 0.59, ypa: 10.62, pTD: 1.08, iNT: 0.58, rYd: 47.1, rTD: 0.55 },
    { name: "Owen Allen", pos: "RB", car: 11, ypc: 5.68, ruTD: 0.42, tgt: 0, cr: 0.72, ypr: 7, recTD: 0 },
    { name: "Jonah Dawson", pos: "WR", tgt: 1.7, cr: 0.6, ypr: 21.7, recTD: 0.08, wr1: true } ] },
  AKR: { abbr: "AKR", name: "Akron", pace: 1.04, def: { pass: 1.05, run: 1.03, cb: 1.09 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 33.7, cmp: 0.52, ypa: 6.5, pTD: 1.67, iNT: 0.75, rYd: 24.2, rTD: 0.15 },
    { name: "Jordan Gant", pos: "RB", car: 17.8, ypc: 4.85, ruTD: 0.5, tgt: 1, cr: 0.72, ypr: 5.3, recTD: 0.08 },
    { name: "Sean Patrick", pos: "RB", car: 5.8, ypc: 3.97, ruTD: 0.08, tgt: 1.3, cr: 0.72, ypr: 12.4, recTD: 0 },
    { name: "Kyan Mason", pos: "WR", tgt: 4.6, cr: 0.6, ypr: 14.6, recTD: 0.42, wr1: true },
    { name: "Miles Burris", pos: "WR", tgt: 1.9, cr: 0.6, ypr: 9.6, recTD: 0 },
    { name: "Cameron Monteiro", pos: "WR", tgt: 1.1, cr: 0.6, ypr: 13.6, recTD: 0 },
    { name: "Conner Cravaack", pos: "TE", tgt: 2.3, cr: 0.65, ypr: 8.2, recTD: 0.17 } ] },
  ALA: { abbr: "ALA", name: "Alabama", pace: 0.99, def: { pass: 0.85, run: 0.85, cb: 0.91 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 34.9, cmp: 0.66, ypa: 7.56, pTD: 2.13, iNT: 0.33, rYd: 18.7, rTD: 0.28 },
    { name: "Daniel Hill", pos: "RB", car: 5, ypc: 3.79, ruTD: 0.4, tgt: 2.6, cr: 0.72, ypr: 7.3, recTD: 0.07 },
    { name: "Kevin Riley", pos: "RB", car: 3.9, ypc: 3.8, ruTD: 0.13, tgt: 1.8, cr: 0.72, ypr: 9.3, recTD: 0.07 },
    { name: "Ryan Coleman-Williams", pos: "WR", tgt: 5.4, cr: 0.6, ypr: 14.1, recTD: 0.27, wr1: true },
    { name: "Noah Rogers", pos: "WR", tgt: 3.7, cr: 0.6, ypr: 13.4, recTD: 0.13 },
    { name: "Lotzeir Brooks", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 13.8, recTD: 0.13 },
    { name: "Kaleb Edwards", pos: "TE", tgt: 1.1, cr: 0.65, ypr: 13.6, recTD: 0.07 } ] },
  APP: { abbr: "APP", name: "App State", pace: 1.06, def: { pass: 1.15, run: 0.99, cb: 1.05 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 39.1, cmp: 0.59, ypa: 6.57, pTD: 1.77, iNT: 1.15, rYd: 23, rTD: 0.18 },
    { name: "Jaquari Lewis", pos: "RB", car: 10.8, ypc: 4.41, ruTD: 0.46, tgt: 3.4, cr: 0.72, ypr: 6, recTD: 0 },
    { name: "J'Marion Burnette", pos: "RB", car: 2.2, ypc: 2.93, ruTD: 0, tgt: 0.1, cr: 0.72, ypr: 16, recTD: 0.08 },
    { name: "Chris Lofton", pos: "WR", tgt: 7.1, cr: 0.6, ypr: 16.7, recTD: 0.31, wr1: true },
    { name: "Sam Pickett III", pos: "WR", tgt: 4.2, cr: 0.6, ypr: 13.6, recTD: 0.15 },
    { name: "Sam Mbake", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 8.6, recTD: 0.08 },
    { name: "Darrin Fugitt", pos: "TE", tgt: 3.8, cr: 0.65, ypr: 10.7, recTD: 0.15 } ] },
  ARIZ: { abbr: "ARIZ", name: "Arizona", pace: 1.04, def: { pass: 0.85, run: 0.95, cb: 0.9 }, players: [
    { name: "Noah Fifita", pos: "QB", pAtt: 32.9, cmp: 0.64, ypa: 7.54, pTD: 2.23, iNT: 0.46, rYd: 16.6, rTD: 0.23 },
    { name: "Ismail Mahdi", pos: "RB", car: 10.3, ypc: 6.41, ruTD: 0.31, tgt: 1.8, cr: 0.72, ypr: 7, recTD: 0.08 },
    { name: "Antwan Roberts Jr.", pos: "RB", car: 6.9, ypc: 5.69, ruTD: 0.31, tgt: 0.7, cr: 0.72, ypr: 8.3, recTD: 0 },
    { name: "Rodney Gallagher III", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 8.7, recTD: 0, wr1: true },
    { name: "Chris Hunter III", pos: "WR", tgt: 3.5, cr: 0.6, ypr: 13.8, recTD: 0.15 },
    { name: "Tre Spivey", pos: "WR", tgt: 2.9, cr: 0.6, ypr: 16.6, recTD: 0.54 },
    { name: "Cole Rusk", pos: "TE", tgt: 2.2, cr: 0.65, ypr: 11.4, recTD: 0.08 } ] },
  ARK: { abbr: "ARK", name: "Arkansas", pace: 0.98, def: { pass: 1.1, run: 1.15, cb: 1.1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 31.8, cmp: 0.61, ypa: 8.28, pTD: 1.83, iNT: 0.92, rYd: 34.5, rTD: 0.42 },
    { name: "Braylen Russell", pos: "RB", car: 4.6, ypc: 5.2, ruTD: 0.42, tgt: 0.5, cr: 0.72, ypr: 6.8, recTD: 0 },
    { name: "Jasper Parker", pos: "RB", car: 2.1, ypc: 3.72, ruTD: 0.17, tgt: 0, cr: 0.72, ypr: 7, recTD: 0 },
    { name: "Donovan Faupel", pos: "WR", tgt: 8.5, cr: 0.6, ypr: 10.8, recTD: 0.58, wr1: true },
    { name: "Jamari Hawkins", pos: "WR", tgt: 5.3, cr: 0.6, ypr: 16.4, recTD: 0.17 },
    { name: "Chris Marshall", pos: "WR", tgt: 4.2, cr: 0.6, ypr: 19.1, recTD: 0.17 },
    { name: "Jaden Platt", pos: "TE", tgt: 2.7, cr: 0.65, ypr: 14.1, recTD: 0.17 } ] },
  ARMY: { abbr: "ARMY", name: "Army", pace: 1.01, def: { pass: 0.88, run: 1.02, cb: 0.97 }, players: [
    { name: "Cale Hellums", pos: "QB", pAtt: 6.7, cmp: 0.54, ypa: 7.98, pTD: 0.31, iNT: 0.23, rYd: 94.1, rTD: 1.38 },
    { name: "Brady Anderson", pos: "WR", tgt: 1.8, cr: 0.6, ypr: 24, recTD: 0.15, wr1: true },
    { name: "Samari Howard", pos: "WR", tgt: 1.4, cr: 0.6, ypr: 12.1, recTD: 0.08 } ] },
  ARST: { abbr: "ARST", name: "Arkansas St", pace: 1.1, def: { pass: 1.13, run: 1.12, cb: 1.1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 39.2, cmp: 0.66, ypa: 6.63, pTD: 1.54, iNT: 0.92, rYd: 22.2, rTD: 0.22 },
    { name: "Kenyon Clay", pos: "RB", car: 10.7, ypc: 3.76, ruTD: 0.23, tgt: 4, cr: 0.72, ypr: 5.5, recTD: 0.23 },
    { name: "Devin Spencer", pos: "RB", car: 8.3, ypc: 5.18, ruTD: 0.23, tgt: 2.7, cr: 0.72, ypr: 5, recTD: 0 },
    { name: "Chauncy Cobb", pos: "WR", tgt: 9.4, cr: 0.6, ypr: 10.9, recTD: 0.08, wr1: true },
    { name: "Hunter Summers", pos: "WR", tgt: 5.6, cr: 0.6, ypr: 11.5, recTD: 0.31 },
    { name: "Jaylen Bonelli", pos: "WR", tgt: 2.8, cr: 0.6, ypr: 9.1, recTD: 0.23 },
    { name: "Joshua Burrell", pos: "TE", tgt: 4.3, cr: 0.65, ypr: 8.1, recTD: 0.15 } ] },
  ASU: { abbr: "ASU", name: "Arizona St", pace: 1.07, def: { pass: 1.07, run: 0.85, cb: 0.93 }, players: [
    { name: "Cutter Boley", pos: "QB", pAtt: 23.2, cmp: 0.66, ypa: 7.18, pTD: 1.15, iNT: 0.92, rYd: 6.5, rTD: 0.15 },
    { name: "Marquis Gillis", pos: "RB", car: 14.2, ypc: 6.25, ruTD: 0.54, tgt: 1.2, cr: 0.72, ypr: 7.7, recTD: 0.08 },
    { name: "David Avit", pos: "RB", car: 9.6, ypc: 5.5, ruTD: 0.62, tgt: 1, cr: 0.72, ypr: 9.3, recTD: 0 },
    { name: "Omarion Miller", pos: "WR", tgt: 5.8, cr: 0.6, ypr: 18, recTD: 0.62, wr1: true },
    { name: "Reed Harris", pos: "WR", tgt: 5, cr: 0.6, ypr: 17.3, recTD: 0.38 },
    { name: "Raiden Vines-Bright", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 9.9, recTD: 0.08 },
    { name: "Kristian Ingman", pos: "TE", tgt: 2.7, cr: 0.65, ypr: 14.9, recTD: 0 } ] },
  AUB: { abbr: "AUB", name: "Auburn", pace: 1.02, def: { pass: 1.06, run: 0.85, cb: 1.02 }, players: [
    { name: "Byrum Brown", pos: "QB", pAtt: 28.4, cmp: 0.66, ypa: 9.26, pTD: 2.33, iNT: 0.58, rYd: 84, rTD: 1.17 },
    { name: "Jeremiah Cobb", pos: "RB", car: 14.6, ypc: 5.54, ruTD: 0.42, tgt: 1.3, cr: 0.72, ypr: 7.5, recTD: 0 },
    { name: "Tae Meadows", pos: "RB", car: 13.3, ypc: 4.37, ruTD: 0.5, tgt: 1.3, cr: 0.72, ypr: 5.8, recTD: 0 },
    { name: "Keshaun Singleton", pos: "WR", tgt: 6.9, cr: 0.6, ypr: 17.5, recTD: 0.67, wr1: true },
    { name: "Jeremiah Koger", pos: "WR", tgt: 5.3, cr: 0.6, ypr: 15.7, recTD: 0.67 },
    { name: "Christian Neptune", pos: "WR", tgt: 5.3, cr: 0.6, ypr: 8.8, recTD: 0.08 },
    { name: "Jake Johnson", pos: "TE", tgt: 2.1, cr: 0.65, ypr: 9, recTD: 0.08 } ] },
  BALL: { abbr: "BALL", name: "Ball State", pace: 0.91, def: { pass: 1.04, run: 1.15, cb: 1.09 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 23.2, cmp: 0.56, ypa: 6.04, pTD: 1, iNT: 0.67, rYd: 23.7, rTD: 0.17 },
    { name: "TJ Horton", pos: "RB", car: 5, ypc: 3, ruTD: 0, tgt: 1.7, cr: 0.72, ypr: 4.7, recTD: 0.08 },
    { name: "Jalen Bonds", pos: "RB", car: 2.3, ypc: 2.85, ruTD: 0.08, tgt: 0.2, cr: 0.72, ypr: 16, recTD: 0 },
    { name: "CJ Nelson", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 17.9, recTD: 0.25, wr1: true },
    { name: "Donovan Hamilton", pos: "WR", tgt: 2.8, cr: 0.6, ypr: 12.2, recTD: 0 },
    { name: "Jabari Smith", pos: "WR", tgt: 2.1, cr: 0.6, ypr: 11.1, recTD: 0.25 } ] },
  BAY: { abbr: "BAY", name: "Baylor", pace: 1.1, def: { pass: 0.9, run: 1.15, cb: 0.96 }, players: [
    { name: "DJ Lagway", pos: "QB", pAtt: 28.1, cmp: 0.63, ypa: 6.72, pTD: 1.33, iNT: 1.17, rYd: 11.3, rTD: 0.08 },
    { name: "Caden Knighten", pos: "RB", car: 8.7, ypc: 4.51, ruTD: 0.08, tgt: 1.3, cr: 0.72, ypr: 12.2, recTD: 0.08 },
    { name: "Gavin Freeman", pos: "WR", tgt: 7.4, cr: 0.6, ypr: 9.1, recTD: 0.33, wr1: true },
    { name: "Dre'lon Miller", pos: "WR", tgt: 2.8, cr: 0.6, ypr: 7.9, recTD: 0.08 },
    { name: "Jadon Porter", pos: "WR", tgt: 1.3, cr: 0.6, ypr: 9.4, recTD: 0.08 },
    { name: "Tony Livingston", pos: "TE", tgt: 1.4, cr: 0.65, ypr: 10.8, recTD: 0.17 } ] },
  BC: { abbr: "BC", name: "Boston College", pace: 1.03, def: { pass: 1.15, run: 1.15, cb: 1.1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 37.8, cmp: 0.63, ypa: 7.41, pTD: 1.67, iNT: 1, rYd: 18.7, rTD: 0.27 },
    { name: "Evan Dickens", pos: "RB", car: 19.1, ypc: 5.85, ruTD: 1.33, tgt: 0.6, cr: 0.72, ypr: 12.2, recTD: 0.08 },
    { name: "Nolan Ray", pos: "RB", car: 5.6, ypc: 4.31, ruTD: 0.17, tgt: 1.3, cr: 0.72, ypr: 4.5, recTD: 0 },
    { name: "Javarius Green", pos: "WR", tgt: 1.8, cr: 0.6, ypr: 11.5, recTD: 0, wr1: true },
    { name: "Dawson Pough", pos: "WR", tgt: 1.8, cr: 0.6, ypr: 15.2, recTD: 0.08 },
    { name: "Kaelan Chudzinski", pos: "TE", tgt: 3.1, cr: 0.65, ypr: 13, recTD: 0.33 } ] },
  BGSU: { abbr: "BGSU", name: "Bowling Green", pace: 0.94, def: { pass: 0.93, run: 0.94, cb: 1.07 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 23.8, cmp: 0.58, ypa: 6.35, pTD: 1.08, iNT: 1, rYd: 28, rTD: 0.22 },
    { name: "Ke'Marion Baldwin", pos: "RB", car: 13.3, ypc: 4.89, ruTD: 0.5, tgt: 0.9, cr: 0.72, ypr: 4.8, recTD: 0 },
    { name: "Austyn Dendy", pos: "RB", car: 9, ypc: 4.56, ruTD: 0.42, tgt: 0.5, cr: 0.72, ypr: 16, recTD: 0.08 },
    { name: "Isaiah Dawson", pos: "WR", tgt: 5.8, cr: 0.6, ypr: 13.7, recTD: 0.33, wr1: true },
    { name: "Nick Sowell", pos: "WR", tgt: 2.9, cr: 0.6, ypr: 11.8, recTD: 0.08 },
    { name: "Winn Sharp", pos: "WR", tgt: 0.7, cr: 0.6, ypr: 9.2, recTD: 0 } ] },
  BOIS: { abbr: "BOIS", name: "Boise St", pace: 1.1, def: { pass: 0.85, run: 1.08, cb: 0.9 }, players: [
    { name: "Maddux Madsen", pos: "QB", pAtt: 21.6, cmp: 0.58, ypa: 7.73, pTD: 1.29, iNT: 0.64, rYd: 5.8, rTD: 0.29 },
    { name: "Dylan Riley", pos: "RB", car: 13.9, ypc: 5.77, ruTD: 0.71, tgt: 1.5, cr: 0.72, ypr: 9.9, recTD: 0.14 },
    { name: "Sire Gaines", pos: "RB", car: 11.5, ypc: 5.04, ruTD: 0.57, tgt: 1.1, cr: 0.72, ypr: 6.5, recTD: 0.07 },
    { name: "Darren Morris", pos: "WR", tgt: 3.2, cr: 0.6, ypr: 18.8, recTD: 0.29, wr1: true },
    { name: "Ben Ford", pos: "WR", tgt: 2.5, cr: 0.6, ypr: 15.5, recTD: 0.36 },
    { name: "Cam Bates", pos: "WR", tgt: 2, cr: 0.6, ypr: 17.8, recTD: 0.07 } ] },
  BUFF: { abbr: "BUFF", name: "Buffalo", pace: 1.03, def: { pass: 0.86, run: 1.05, cb: 0.92 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 34.3, cmp: 0.57, ypa: 6.67, pTD: 1.58, iNT: 1.17, rYd: 23.8, rTD: 0.25 },
    { name: "Terrance Shelton Jr.", pos: "RB", car: 4.8, ypc: 4.28, ruTD: 0.08, tgt: 0.9, cr: 0.72, ypr: 5.3, recTD: 0 },
    { name: "James McNeil Jr.", pos: "RB", car: 1, ypc: 5.58, ruTD: 0.17, tgt: 0, cr: 0.72, ypr: 7, recTD: 0 },
    { name: "Jasaiah Gathings", pos: "WR", tgt: 5, cr: 0.6, ypr: 11.4, recTD: 0.25, wr1: true },
    { name: "Patrick Clacks III", pos: "WR", tgt: 1.7, cr: 0.6, ypr: 5.9, recTD: 0.17 },
    { name: "Chance Morrow", pos: "WR", tgt: 1.1, cr: 0.6, ypr: 16.1, recTD: 0.17 } ] },
  BYU: { abbr: "BYU", name: "BYU", pace: 1, def: { pass: 0.96, run: 0.85, cb: 0.92 }, players: [
    { name: "Bear Bachmeier", pos: "QB", pAtt: 27.6, cmp: 0.65, ypa: 7.84, pTD: 1.07, iNT: 0.5, rYd: 37.6, rTD: 0.79 },
    { name: "LJ Martin", pos: "RB", car: 16.9, ypc: 5.53, ruTD: 0.86, tgt: 3.6, cr: 0.72, ypr: 7.1, recTD: 0 },
    { name: "Jovesa Damuni", pos: "RB", car: 1.4, ypc: 5.84, ruTD: 0.07, tgt: 0.6, cr: 0.72, ypr: 7.3, recTD: 0 },
    { name: "Jojo Phillips", pos: "WR", tgt: 1.7, cr: 0.6, ypr: 11.5, recTD: 0, wr1: true },
    { name: "Tiger Bachmeier", pos: "WR", tgt: 0.8, cr: 0.6, ypr: 8.4, recTD: 0 },
    { name: "Walker Lyons", pos: "TE", tgt: 2.2, cr: 0.65, ypr: 11.2, recTD: 0.14 } ] },
  CAL: { abbr: "CAL", name: "California", pace: 1.02, def: { pass: 0.94, run: 1.04, cb: 0.9 }, players: [
    { name: "Jaron-Keawe Sagapolutele", pos: "QB", pAtt: 37.8, cmp: 0.64, ypa: 7.02, pTD: 1.38, iNT: 0.69, rYd: -9.2, rTD: 0.31 },
    { name: "Ashten Emory", pos: "RB", car: 9.2, ypc: 4.78, ruTD: 0.31, tgt: 1.7, cr: 0.72, ypr: 6.4, recTD: 0.15 },
    { name: "Adam Mohammed", pos: "RB", car: 8.2, ypc: 4.93, ruTD: 0.38, tgt: 1.8, cr: 0.72, ypr: 8.1, recTD: 0 },
    { name: "Chase Hendricks", pos: "WR", tgt: 9.1, cr: 0.6, ypr: 14.6, recTD: 0.54, wr1: true },
    { name: "Ian Strong", pos: "WR", tgt: 6.7, cr: 0.6, ypr: 14.7, recTD: 0.38 },
    { name: "Jordan King", pos: "WR", tgt: 2.8, cr: 0.6, ypr: 12.1, recTD: 0.15 },
    { name: "Dorian Thomas", pos: "TE", tgt: 6.6, cr: 0.65, ypr: 10, recTD: 0.31 } ] },
  CCU: { abbr: "CCU", name: "Coastal", pace: 1, def: { pass: 1.08, run: 1.15, cb: 1.05 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 30.7, cmp: 0.55, ypa: 5.52, pTD: 1.23, iNT: 1, rYd: 28.1, rTD: 0.23 },
    { name: "Kente Edwards", pos: "RB", car: 15.3, ypc: 7.31, ruTD: 1.54, tgt: 1.1, cr: 0.72, ypr: 6.7, recTD: 0 },
    { name: "Dominic Lee-Knicely", pos: "RB", car: 5.2, ypc: 5.71, ruTD: 0.23, tgt: 1.3, cr: 0.72, ypr: 8.3, recTD: 0.08 },
    { name: "Tristian Gardner", pos: "WR", tgt: 3.8, cr: 0.6, ypr: 15.5, recTD: 0.46, wr1: true },
    { name: "Goldie Lawrence", pos: "WR", tgt: 3.8, cr: 0.6, ypr: 14.9, recTD: 0.15 },
    { name: "Robby Washington", pos: "WR", tgt: 3.7, cr: 0.6, ypr: 9.6, recTD: 0.23 },
    { name: "Cyrus Ellison", pos: "TE", tgt: 1.7, cr: 0.65, ypr: 11.4, recTD: 0.08 } ] },
  CIN: { abbr: "CIN", name: "Cincinnati", pace: 0.9, def: { pass: 1.01, run: 1.15, cb: 1.04 }, players: [
    { name: "JC French IV", pos: "QB", pAtt: 29.9, cmp: 0.64, ypa: 7.53, pTD: 1.54, iNT: 0.62, rYd: 24.2, rTD: 0.46 },
    { name: "Zylan Perry", pos: "RB", car: 10.6, ypc: 4.99, ruTD: 0.62, tgt: 1.7, cr: 0.72, ypr: 6.6, recTD: 0 },
    { name: "Cole Tabb", pos: "RB", car: 8.8, ypc: 3.9, ruTD: 0.23, tgt: 0.4, cr: 0.72, ypr: 5.5, recTD: 0 },
    { name: "Malachi Henry", pos: "WR", tgt: 8.8, cr: 0.6, ypr: 12.9, recTD: 0.77, wr1: true },
    { name: "Larenzo Fenner", pos: "WR", tgt: 5.6, cr: 0.6, ypr: 22.8, recTD: 1.15 },
    { name: "JV Gibson", pos: "WR", tgt: 2.3, cr: 0.6, ypr: 11.1, recTD: 0.08 } ] },
  CLEM: { abbr: "CLEM", name: "Clemson", pace: 1.02, def: { pass: 1.15, run: 0.85, cb: 0.95 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 36.5, cmp: 0.65, ypa: 7.33, pTD: 1.69, iNT: 0.54, rYd: 22.4, rTD: 0.31 },
    { name: "Chris Johnson Jr.", pos: "RB", car: 5.2, ypc: 7.15, ruTD: 0.31, tgt: 1.8, cr: 0.72, ypr: 10.6, recTD: 0.08 },
    { name: "Gideon Davidson", pos: "RB", car: 4.6, ypc: 4.33, ruTD: 0, tgt: 1.2, cr: 0.72, ypr: 8.5, recTD: 0 },
    { name: "T.J. Moore", pos: "WR", tgt: 6.7, cr: 0.6, ypr: 16.1, recTD: 0.31, wr1: true },
    { name: "Tristan Smith", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 10, recTD: 0.08 },
    { name: "Tyler Brown", pos: "WR", tgt: 2.8, cr: 0.6, ypr: 8.7, recTD: 0 },
    { name: "Christian Bentancur", pos: "TE", tgt: 2.4, cr: 0.65, ypr: 10.8, recTD: 0.23 } ] },
  CLT: { abbr: "CLT", name: "Charlotte", pace: 0.93, def: { pass: 1.15, run: 1.15, cb: 1.1 }, players: [
    { name: "Grayson Loftis", pos: "QB", pAtt: 19.3, cmp: 0.55, ypa: 6.1, pTD: 0.67, iNT: 0.67, rYd: -7.2, rTD: 0 },
    { name: "Jariel Cobb", pos: "RB", car: 4.3, ypc: 3.73, ruTD: 0, tgt: 0.9, cr: 0.72, ypr: 6.1, recTD: 0 },
    { name: "Khamani Alexander", pos: "RB", car: 1, ypc: 4.17, ruTD: 0, tgt: 0.2, cr: 0.72, ypr: 8.5, recTD: 0 },
    { name: "Cam Pedro", pos: "WR", tgt: 9, cr: 0.6, ypr: 12.5, recTD: 0.33, wr1: true },
    { name: "Jaden Barnes", pos: "WR", tgt: 7.6, cr: 0.6, ypr: 11.1, recTD: 0.58 },
    { name: "Zyheem Collick", pos: "WR", tgt: 4.9, cr: 0.6, ypr: 19.1, recTD: 0.33 },
    { name: "Logan Mauldin", pos: "TE", tgt: 3.3, cr: 0.65, ypr: 13.1, recTD: 0.17 } ] },
  CMU: { abbr: "CMU", name: "C Michigan", pace: 0.92, def: { pass: 0.96, run: 0.97, cb: 0.94 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 19.6, cmp: 0.69, ypa: 8.52, pTD: 1.23, iNT: 0.54, rYd: 29.4, rTD: 0.26 },
    { name: "Jayden Clerveaux", pos: "RB", car: 12.4, ypc: 4.73, ruTD: 0.38, tgt: 0.6, cr: 0.72, ypr: 6.2, recTD: 0 },
    { name: "Brock Townsend", pos: "RB", car: 6.3, ypc: 5.1, ruTD: 0.31, tgt: 1.4, cr: 0.72, ypr: 11.2, recTD: 0.31 },
    { name: "Langston Lewis", pos: "WR", tgt: 5.5, cr: 0.6, ypr: 13.9, recTD: 0.23, wr1: true },
    { name: "Tommy McIntosh", pos: "WR", tgt: 4, cr: 0.6, ypr: 13.6, recTD: 0.23 },
    { name: "Justin Ruffin Jr.", pos: "WR", tgt: 0.9, cr: 0.6, ypr: 9, recTD: 0 },
    { name: "Jaden Allen", pos: "TE", tgt: 2.2, cr: 0.65, ypr: 9.8, recTD: 0.08 } ] },
  COLO: { abbr: "COLO", name: "Colorado", pace: 0.98, def: { pass: 0.93, run: 1.15, cb: 1.07 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 29.8, cmp: 0.59, ypa: 6.8, pTD: 1.42, iNT: 0.92, rYd: 22.6, rTD: 0.25 },
    { name: "Micah Welch", pos: "RB", car: 8, ypc: 4, ruTD: 0.33, tgt: 1.3, cr: 0.72, ypr: 3.4, recTD: 0 },
    { name: "Damian Henderson II", pos: "RB", car: 7.6, ypc: 6.21, ruTD: 0.42, tgt: 0.8, cr: 0.72, ypr: 9.3, recTD: 0 },
    { name: "Danny Scudero", pos: "WR", tgt: 12.2, cr: 0.6, ypr: 14.7, recTD: 0.83, wr1: true },
    { name: "Kam Perry", pos: "WR", tgt: 6, cr: 0.6, ypr: 22.7, recTD: 0.5 },
    { name: "DeAndre Moore Jr.", pos: "WR", tgt: 5.3, cr: 0.6, ypr: 14, recTD: 0.33 },
    { name: "Zach Atkins", pos: "TE", tgt: 2.6, cr: 0.65, ypr: 7.5, recTD: 0 } ] },
  CONN: { abbr: "CONN", name: "UConn", pace: 0.99, def: { pass: 1, run: 1.15, cb: 1.02 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 34.8, cmp: 0.68, ypa: 8.16, pTD: 2.31, iNT: 0.08, rYd: 29, rTD: 0.4 },
    { name: "Kenji Christian", pos: "RB", car: 8.1, ypc: 5.03, ruTD: 0.31, tgt: 1.8, cr: 0.72, ypr: 11.4, recTD: 0.08 },
    { name: "Trey Cornist", pos: "RB", car: 8.1, ypc: 4.48, ruTD: 0.08, tgt: 0, cr: 0.72, ypr: 7, recTD: 0 },
    { name: "Shamar Porter", pos: "WR", tgt: 2.3, cr: 0.6, ypr: 13, recTD: 0.08, wr1: true },
    { name: "Cam Abshire", pos: "WR", tgt: 1.3, cr: 0.6, ypr: 9.2, recTD: 0 },
    { name: "Emanuel Ross", pos: "WR", tgt: 1.3, cr: 0.6, ypr: 11, recTD: 0.08 } ] },
  CSU: { abbr: "CSU", name: "Colorado St", pace: 0.94, def: { pass: 1.02, run: 1.15, cb: 1.1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 32.8, cmp: 0.62, ypa: 6.58, pTD: 1.25, iNT: 1, rYd: 19.5, rTD: 0.22 },
    { name: "Mel Brown", pos: "RB", car: 2.7, ypc: 8, ruTD: 0.17, tgt: 0.5, cr: 0.72, ypr: 3, recTD: 0 },
    { name: "Oliver Lundberg", pos: "RB", car: 1.9, ypc: 6, ruTD: 0.08, tgt: 0, cr: 0.72, ypr: 7, recTD: 0 },
    { name: "Tommy Maher", pos: "WR", tgt: 4.4, cr: 0.6, ypr: 11.2, recTD: 0, wr1: true },
    { name: "Lavon Brown", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 11.1, recTD: 0 },
    { name: "Jackson Harper", pos: "WR", tgt: 1.1, cr: 0.6, ypr: 6.4, recTD: 0.08 } ] },
  DEL: { abbr: "DEL", name: "Delaware", pace: 1.09, def: { pass: 1.13, run: 1.06, cb: 1.05 }, players: [
    { name: "Nick Minicucci", pos: "QB", pAtt: 39.4, cmp: 0.63, ypa: 7.19, pTD: 1.77, iNT: 0.54, rYd: 18.1, rTD: 0.77 },
    { name: "Jo Silver", pos: "RB", car: 9.2, ypc: 5.48, ruTD: 0.38, tgt: 3.1, cr: 0.72, ypr: 7.7, recTD: 0.08 },
    { name: "Viron Ellison Jr.", pos: "RB", car: 9.1, ypc: 3.9, ruTD: 0.31, tgt: 2.2, cr: 0.72, ypr: 9.1, recTD: 0.15 },
    { name: "Bryson Graves", pos: "WR", tgt: 4.5, cr: 0.6, ypr: 9.4, recTD: 0.15, wr1: true },
    { name: "Donovan Lewis", pos: "WR", tgt: 2.6, cr: 0.6, ypr: 11, recTD: 0.08 },
    { name: "Elijah Sessoms", pos: "TE", tgt: 2.6, cr: 0.65, ypr: 8.6, recTD: 0.15 } ] },
  DUKE: { abbr: "DUKE", name: "Duke", pace: 1.03, def: { pass: 1.15, run: 0.98, cb: 1.1 }, players: [
    { name: "Walker Eget", pos: "QB", pAtt: 28.1, cmp: 0.59, ypa: 7.76, pTD: 1.21, iNT: 0.64, rYd: 6.9, rTD: 0 },
    { name: "Nate Sheppard", pos: "RB", car: 14.3, ypc: 5.66, ruTD: 0.79, tgt: 3.7, cr: 0.72, ypr: 7.7, recTD: 0.07 },
    { name: "Wilhelm Daal II", pos: "RB", car: 5.7, ypc: 5.49, ruTD: 0.14, tgt: 1.1, cr: 0.72, ypr: 4.6, recTD: 0 },
    { name: "Jared Richardson", pos: "WR", tgt: 9.5, cr: 0.6, ypr: 12.9, recTD: 0.86, wr1: true },
    { name: "Javen Nicholas", pos: "WR", tgt: 7.1, cr: 0.6, ypr: 12.3, recTD: 0.36 },
    { name: "Jonah Burton", pos: "WR", tgt: 2.5, cr: 0.6, ypr: 11.1, recTD: 0 },
    { name: "Jeremiah Hasley", pos: "TE", tgt: 4.4, cr: 0.65, ypr: 11.4, recTD: 0.43 } ] },
  ECU: { abbr: "ECU", name: "East Carolina", pace: 1.1, def: { pass: 1.06, run: 0.85, cb: 0.93 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 33.8, cmp: 0.65, ypa: 8.06, pTD: 1.69, iNT: 0.46, rYd: 31.7, rTD: 0.48 },
    { name: "Michael Allen", pos: "RB", car: 5.9, ypc: 5, ruTD: 0.31, tgt: 1.3, cr: 0.72, ypr: 11.6, recTD: 0.08 },
    { name: "TJ Engleman Jr.", pos: "RB", car: 4.5, ypc: 5.19, ruTD: 0.08, tgt: 0.7, cr: 0.72, ypr: 5.3, recTD: 0 },
    { name: "Ja'Keith Hamilton", pos: "WR", tgt: 5.1, cr: 0.6, ypr: 13.6, recTD: 0.38, wr1: true },
    { name: "Jaquaize Pettaway", pos: "WR", tgt: 1.7, cr: 0.6, ypr: 4, recTD: 0 },
    { name: "Tyler Johnson", pos: "WR", tgt: 0.9, cr: 0.6, ypr: 10.3, recTD: 0 },
    { name: "Kanen Hamlett", pos: "TE", tgt: 1.5, cr: 0.65, ypr: 10.9, recTD: 0.15 } ] },
  EMU: { abbr: "EMU", name: "E Michigan", pace: 0.99, def: { pass: 0.85, run: 1.15, cb: 1.06 }, players: [
    { name: "Noah Kim", pos: "QB", pAtt: 33.5, cmp: 0.61, ypa: 7.01, pTD: 1.5, iNT: 0.92, rYd: 15.5, rTD: 0.5 },
    { name: "Nick Devereaux", pos: "WR", tgt: 4.7, cr: 0.6, ypr: 15, recTD: 0.58, wr1: true },
    { name: "Benson Prosper", pos: "WR", tgt: 2.9, cr: 0.6, ypr: 8.4, recTD: 0 },
    { name: "Harold Mack", pos: "WR", tgt: 2.8, cr: 0.6, ypr: 16.7, recTD: 0.17 },
    { name: "Joshua Long", pos: "TE", tgt: 4.7, cr: 0.65, ypr: 9.6, recTD: 0.25 } ] },
  FAU: { abbr: "FAU", name: "FAU", pace: 1.1, def: { pass: 1.08, run: 1.15, cb: 1.08 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 48.5, cmp: 0.66, ypa: 7.01, pTD: 2.33, iNT: 1.67, rYd: 18.8, rTD: 0.22 },
    { name: "Kaden Shields-Dutton", pos: "RB", car: 7, ypc: 5.48, ruTD: 0.5, tgt: 2, cr: 0.72, ypr: 6.4, recTD: 0.08 },
    { name: "Easton Messer", pos: "WR", tgt: 14.4, cr: 0.6, ypr: 10.1, recTD: 0.5, wr1: true },
    { name: "Dominique Henry", pos: "WR", tgt: 5.6, cr: 0.6, ypr: 14.4, recTD: 0.33 },
    { name: "RJ Garcia II", pos: "WR", tgt: 3.8, cr: 0.6, ypr: 10.5, recTD: 0 },
    { name: "AJ Johnson", pos: "TE", tgt: 2.6, cr: 0.65, ypr: 11.6, recTD: 0.42 } ] },
  FIU: { abbr: "FIU", name: "FIU", pace: 1.05, def: { pass: 1.15, run: 1.08, cb: 1 }, players: [
    { name: "JJ Kohl", pos: "QB", pAtt: 16.6, cmp: 0.62, ypa: 6.78, pTD: 0.92, iNT: 0.15, rYd: 3.8, rTD: 0.08 },
    { name: "Anthony Carrie", pos: "RB", car: 7.9, ypc: 4.55, ruTD: 0.38, tgt: 1.1, cr: 0.72, ypr: 5.5, recTD: 0 },
    { name: "Devonte Lyons", pos: "RB", car: 2.8, ypc: 3.84, ruTD: 0.08, tgt: 1.3, cr: 0.72, ypr: 5.4, recTD: 0 },
    { name: "Greg Gaines III", pos: "WR", tgt: 8.3, cr: 0.6, ypr: 15.7, recTD: 0.31, wr1: true },
    { name: "Kyle McNeal", pos: "WR", tgt: 4, cr: 0.6, ypr: 10, recTD: 0.08 },
    { name: "Maguire Anderson", pos: "WR", tgt: 3.2, cr: 0.6, ypr: 11.2, recTD: 0.08 },
    { name: "Jackson Verdugo", pos: "TE", tgt: 1.2, cr: 0.65, ypr: 10.1, recTD: 0.08 } ] },
  FLA: { abbr: "FLA", name: "Florida", pace: 0.95, def: { pass: 1.02, run: 1.03, cb: 1.1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 31.2, cmp: 0.63, ypa: 6.56, pTD: 1.5, iNT: 1.17, rYd: 24.6, rTD: 0.17 },
    { name: "Jadan Baugh", pos: "RB", car: 18.3, ypc: 5.32, ruTD: 0.67, tgt: 3.8, cr: 0.72, ypr: 6.4, recTD: 0.17 },
    { name: "London Montgomery", pos: "RB", car: 13, ypc: 4.76, ruTD: 0.58, tgt: 1.7, cr: 0.72, ypr: 5.1, recTD: 0 },
    { name: "Vernell Brown III", pos: "WR", tgt: 5.6, cr: 0.6, ypr: 12.8, recTD: 0, wr1: true },
    { name: "Micah Mays Jr.", pos: "WR", tgt: 2.5, cr: 0.6, ypr: 16.8, recTD: 0.17 },
    { name: "TJ Abrams", pos: "WR", tgt: 1.9, cr: 0.6, ypr: 14.4, recTD: 0 },
    { name: "Evan Chieca", pos: "TE", tgt: 4, cr: 0.65, ypr: 8.2, recTD: 0.33 } ] },
  FRES: { abbr: "FRES", name: "Fresno St", pace: 0.99, def: { pass: 0.85, run: 0.88, cb: 0.9 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 28.7, cmp: 0.64, ypa: 6.39, pTD: 1.08, iNT: 1, rYd: 30.7, rTD: 0.34 },
    { name: "Bryson Donelson", pos: "RB", car: 10.8, ypc: 4.29, ruTD: 0.38, tgt: 1.8, cr: 0.72, ypr: 6.3, recTD: 0 },
    { name: "Rayshon Luke", pos: "RB", car: 8.6, ypc: 6.27, ruTD: 0.46, tgt: 3.8, cr: 0.72, ypr: 6.3, recTD: 0.15 },
    { name: "Josiah Freeman", pos: "WR", tgt: 6.7, cr: 0.6, ypr: 12.3, recTD: 0.46, wr1: true },
    { name: "Ezekiel Avit", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 9.1, recTD: 0 },
    { name: "Jahlil McClain", pos: "WR", tgt: 1.7, cr: 0.6, ypr: 13, recTD: 0.08 },
    { name: "Jake Appleget", pos: "TE", tgt: 0.8, cr: 0.65, ypr: 8.1, recTD: 0.08 } ] },
  FSU: { abbr: "FSU", name: "Florida St", pace: 1.05, def: { pass: 0.88, run: 0.92, cb: 0.99 }, players: [
    { name: "Dean DeNobile", pos: "QB", pAtt: 28.9, cmp: 0.64, ypa: 7.29, pTD: 1.58, iNT: 0.58, rYd: -0.1, rTD: 0.17 },
    { name: "Gemari Sands", pos: "RB", car: 8.8, ypc: 4.43, ruTD: 0, tgt: 4.6, cr: 0.72, ypr: 5.4, recTD: 0 },
    { name: "Ousmane Kromah", pos: "RB", car: 6, ypc: 5.67, ruTD: 0, tgt: 1, cr: 0.72, ypr: 16, recTD: 0.08 },
    { name: "Duce Robinson", pos: "WR", tgt: 7.8, cr: 0.6, ypr: 19.3, recTD: 0.5, wr1: true },
    { name: "Micahi Danzy", pos: "WR", tgt: 3.8, cr: 0.6, ypr: 21.1, recTD: 0.25 },
    { name: "Jayvan Boggs", pos: "WR", tgt: 1.3, cr: 0.6, ypr: 11.4, recTD: 0.08 },
    { name: "Desirrio Riles", pos: "TE", tgt: 3.6, cr: 0.65, ypr: 12.9, recTD: 0.17 } ] },
  GASO: { abbr: "GASO", name: "GA Southern", pace: 1.03, def: { pass: 1.11, run: 1.15, cb: 1.06 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 33.2, cmp: 0.63, ypa: 7.44, pTD: 2, iNT: 0.69, rYd: 27.7, rTD: 0.28 },
    { name: "David Mbadinga", pos: "RB", car: 3.8, ypc: 4, ruTD: 0.08, tgt: 0.5, cr: 0.72, ypr: 3.6, recTD: 0 },
    { name: "Terrance Gibbs", pos: "RB", car: 1.3, ypc: 3.59, ruTD: 0.08, tgt: 0.7, cr: 0.72, ypr: 9.7, recTD: 0 },
    { name: "Taylor Bradshaw", pos: "WR", tgt: 2.1, cr: 0.6, ypr: 8.2, recTD: 0.08, wr1: true },
    { name: "Josh Dallas", pos: "WR", tgt: 1, cr: 0.6, ypr: 8.5, recTD: 0 } ] },
  GAST: { abbr: "GAST", name: "Georgia St", pace: 1.05, def: { pass: 1.11, run: 1.15, cb: 1.1 }, players: [
    { name: "Ayden Pereira", pos: "QB", pAtt: 25.8, cmp: 0.51, ypa: 5.95, pTD: 0.75, iNT: 0.58, rYd: 71.3, rTD: 0.58 },
    { name: "Savion Hart", pos: "RB", car: 14.6, ypc: 4.66, ruTD: 0.83, tgt: 1.7, cr: 0.72, ypr: 15, recTD: 0.17 },
    { name: "Dennis Murray Jr.", pos: "RB", car: 1.1, ypc: 4.08, ruTD: 0, tgt: 1.5, cr: 0.72, ypr: 7.6, recTD: 0.08 },
    { name: "Owen Dupree", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 11.9, recTD: 0.33, wr1: true },
    { name: "DJ Riles", pos: "WR", tgt: 2.2, cr: 0.6, ypr: 11, recTD: 0.08 },
    { name: "Grant Hollier", pos: "TE", tgt: 2.7, cr: 0.65, ypr: 13.7, recTD: 0.33 } ] },
  GT: { abbr: "GT", name: "Georgia Tech", pace: 0.99, def: { pass: 1.08, run: 1.09, cb: 1.06 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 30.3, cmp: 0.7, ypa: 8.66, pTD: 1.23, iNT: 0.54, rYd: 35.5, rTD: 0.48 },
    { name: "Justice Haynes", pos: "RB", car: 9.3, ypc: 7.08, ruTD: 0.77, tgt: 1.4, cr: 0.72, ypr: 3.8, recTD: 0 },
    { name: "Malachi Hosley", pos: "RB", car: 7.5, ypc: 7.11, ruTD: 0.54, tgt: 1.5, cr: 0.72, ypr: 8.5, recTD: 0 },
    { name: "Isaiah Fuhrmann", pos: "WR", tgt: 5.9, cr: 0.6, ypr: 19.7, recTD: 0.69, wr1: true },
    { name: "Jordan Allen", pos: "WR", tgt: 2.8, cr: 0.6, ypr: 13.8, recTD: 0 },
    { name: "Chris Corbo", pos: "TE", tgt: 5.3, cr: 0.65, ypr: 11.5, recTD: 0.31 } ] },
  HAW: { abbr: "HAW", name: "Hawai'i", pace: 1.05, def: { pass: 1.04, run: 0.89, cb: 1.06 }, players: [
    { name: "Micah Alejado", pos: "QB", pAtt: 33.1, cmp: 0.66, ypa: 7.22, pTD: 1.85, iNT: 0.69, rYd: 8.1, rTD: 0.08 },
    { name: "Cam Barfield", pos: "RB", car: 6.2, ypc: 4.64, ruTD: 0.31, tgt: 2.9, cr: 0.72, ypr: 9.5, recTD: 0.23 },
    { name: "DeVon Rice", pos: "RB", car: 2, ypc: 3.62, ruTD: 0.23, tgt: 0.3, cr: 0.72, ypr: 11, recTD: 0 },
    { name: "Pofele Ashlock", pos: "WR", tgt: 9.7, cr: 0.6, ypr: 10.9, recTD: 0.62, wr1: true },
    { name: "Blaze Kamoku", pos: "WR", tgt: 1.2, cr: 0.6, ypr: 9.8, recTD: 0.08 },
    { name: "Carson Brown", pos: "WR", tgt: 0.9, cr: 0.6, ypr: 11.9, recTD: 0 },
    { name: "Devon Tauaefa", pos: "TE", tgt: 1.7, cr: 0.65, ypr: 7.6, recTD: 0 } ] },
  HOU: { abbr: "HOU", name: "Houston", pace: 1.06, def: { pass: 1.01, run: 0.86, cb: 1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 29, cmp: 0.64, ypa: 7.46, pTD: 2, iNT: 0.77, rYd: 32.1, rTD: 0.26 },
    { name: "DJ Butler", pos: "RB", car: 5.2, ypc: 4.43, ruTD: 0, tgt: 0.9, cr: 0.72, ypr: 7.3, recTD: 0 },
    { name: "Makhi Hughes", pos: "RB", car: 1.3, ypc: 4.12, ruTD: 0, tgt: 0.2, cr: 0.72, ypr: 12, recTD: 0 },
    { name: "Amare Thomas", pos: "WR", tgt: 8.6, cr: 0.6, ypr: 14.4, recTD: 0.92, wr1: true },
    { name: "Stephon Johnson", pos: "WR", tgt: 1.7, cr: 0.6, ypr: 21.2, recTD: 0.15 },
    { name: "Harvey Broussard III", pos: "WR", tgt: 1.2, cr: 0.6, ypr: 14, recTD: 0.08 },
    { name: "Patrick Overmyer", pos: "TE", tgt: 3.2, cr: 0.65, ypr: 12.7, recTD: 0.38 } ] },
  ILL: { abbr: "ILL", name: "Illinois", pace: 0.95, def: { pass: 1, run: 0.85, cb: 0.94 }, players: [
    { name: "Katin Houser", pos: "QB", pAtt: 31.4, cmp: 0.66, ypa: 8.09, pTD: 1.46, iNT: 0.46, rYd: 14.8, rTD: 0.69 },
    { name: "Aidan Laughery", pos: "RB", car: 5.8, ypc: 5.09, ruTD: 0.23, tgt: 1, cr: 0.72, ypr: 6, recTD: 0 },
    { name: "Alex Perry", pos: "WR", tgt: 7.2, cr: 0.6, ypr: 15, recTD: 0.69, wr1: true },
    { name: "Jayshon Platt", pos: "WR", tgt: 5.9, cr: 0.6, ypr: 15.7, recTD: 0.38 },
    { name: "Hudson Clement", pos: "WR", tgt: 4.6, cr: 0.6, ypr: 12.6, recTD: 0.23 },
    { name: "Kaden Feagin", pos: "TE", tgt: 1.9, cr: 0.65, ypr: 11.8, recTD: 0.15 } ] },
  IOWA: { abbr: "IOWA", name: "Iowa", pace: 0.91, def: { pass: 0.85, run: 0.85, cb: 0.9 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 22, cmp: 0.63, ypa: 6.51, pTD: 0.92, iNT: 0.62, rYd: 31.8, rTD: 0.43 },
    { name: "L.J. Phillips Jr.", pos: "RB", car: 22.7, ypc: 6.51, ruTD: 1.46, tgt: 3, cr: 0.72, ypr: 7, recTD: 0.08 },
    { name: "Kamari Moulton", pos: "RB", car: 13.1, ypc: 5.16, ruTD: 0.38, tgt: 1.7, cr: 0.72, ypr: 6.1, recTD: 0 },
    { name: "Tony Diaz", pos: "WR", tgt: 8.6, cr: 0.6, ypr: 13.1, recTD: 0.85, wr1: true },
    { name: "Evan James", pos: "WR", tgt: 8.3, cr: 0.6, ypr: 12.2, recTD: 0.54 },
    { name: "Reece Vander Zee", pos: "WR", tgt: 1.9, cr: 0.6, ypr: 14.6, recTD: 0.15 },
    { name: "Zach Ortwerth", pos: "TE", tgt: 1.1, cr: 0.65, ypr: 8.4, recTD: 0 } ] },
  ISU: { abbr: "ISU", name: "Iowa State", pace: 1.03, def: { pass: 1, run: 0.92, cb: 0.96 }, players: [
    { name: "Jaylen Raynor", pos: "QB", pAtt: 41.8, cmp: 0.66, ypa: 6.71, pTD: 1.58, iNT: 0.92, rYd: 35.3, rTD: 0.58 },
    { name: "Cameron Pettaway", pos: "RB", car: 6, ypc: 5.07, ruTD: 0, tgt: 0.9, cr: 0.72, ypr: 16, recTD: 0.17 },
    { name: "Arnold Barnes III", pos: "RB", car: 4.3, ypc: 4.25, ruTD: 0, tgt: 0.2, cr: 0.72, ypr: 8, recTD: 0 },
    { name: "Cody Jackson", pos: "WR", tgt: 7.4, cr: 0.6, ypr: 15.1, recTD: 0.5, wr1: true },
    { name: "Omari Hayes", pos: "WR", tgt: 5.4, cr: 0.6, ypr: 13.2, recTD: 0.08 },
    { name: "Carter Pabst", pos: "WR", tgt: 1.3, cr: 0.6, ypr: 18.7, recTD: 0.08 },
    { name: "Tyler Fortenberry", pos: "TE", tgt: 4.1, cr: 0.65, ypr: 9.2, recTD: 0.17 } ] },
  IU: { abbr: "IU", name: "Indiana", pace: 0.99, def: { pass: 0.87, run: 0.85, cb: 0.9 }, players: [
    { name: "Josh Hoover", pos: "QB", pAtt: 25.8, cmp: 0.66, ypa: 8.41, pTD: 1.81, iNT: 0.81, rYd: 0.3, rTD: 0.13 },
    { name: "Turbo Richard", pos: "RB", car: 9.1, ypc: 5.17, ruTD: 0.56, tgt: 2.6, cr: 0.72, ypr: 7.1, recTD: 0.13 },
    { name: "Khobie Martin", pos: "RB", car: 4.9, ypc: 6.47, ruTD: 0.38, tgt: 0.1, cr: 0.72, ypr: 14, recTD: 0 },
    { name: "Nick Marsh", pos: "WR", tgt: 6.1, cr: 0.6, ypr: 11.2, recTD: 0.38, wr1: true },
    { name: "Shazz Preston", pos: "WR", tgt: 4.5, cr: 0.6, ypr: 16.8, recTD: 0.25 },
    { name: "Charlie Becker", pos: "WR", tgt: 3.5, cr: 0.6, ypr: 20, recTD: 0.25 } ] },
  JMU: { abbr: "JMU", name: "James Madison", pace: 1.06, def: { pass: 0.85, run: 0.85, cb: 0.9 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 27.5, cmp: 0.58, ypa: 7.68, pTD: 1.86, iNT: 0.71, rYd: 43.5, rTD: 0.54 },
    { name: "Seth Cromwell", pos: "RB", car: 10.7, ypc: 4.31, ruTD: 0.64, tgt: 1.6, cr: 0.72, ypr: 4.1, recTD: 0 },
    { name: "Nick Herman", pos: "RB", car: 10.3, ypc: 7.18, ruTD: 0.43, tgt: 1.3, cr: 0.72, ypr: 9.2, recTD: 0 },
    { name: "Noah Grevious", pos: "WR", tgt: 6.2, cr: 0.6, ypr: 14.1, recTD: 0.21, wr1: true },
    { name: "Jeremiah Harrison", pos: "WR", tgt: 4.5, cr: 0.6, ypr: 17.2, recTD: 0.36 },
    { name: "Michael Scott", pos: "WR", tgt: 1, cr: 0.6, ypr: 10.6, recTD: 0.07 },
    { name: "Cole Keller", pos: "TE", tgt: 2.4, cr: 0.65, ypr: 10.3, recTD: 0.14 } ] },
  JVST: { abbr: "JVST", name: "Jax State", pace: 1.04, def: { pass: 1.08, run: 0.96, cb: 1.04 }, players: [
    { name: "Caden Creel", pos: "QB", pAtt: 15.1, cmp: 0.62, ypa: 7.18, pTD: 0.64, iNT: 0.29, rYd: 76.8, rTD: 0.5 },
    { name: "Khristian Lando", pos: "RB", car: 3.6, ypc: 3.92, ruTD: 0.07, tgt: 0.3, cr: 0.72, ypr: 9.7, recTD: 0 },
    { name: "Andrew Paul", pos: "RB", car: 2.1, ypc: 4.23, ruTD: 0.21, tgt: 0.2, cr: 0.72, ypr: 14.5, recTD: 0 },
    { name: "Darius Cannon", pos: "WR", tgt: 9, cr: 0.6, ypr: 9.6, recTD: 0.21, wr1: true },
    { name: "Ronnel Johnson", pos: "WR", tgt: 4.2, cr: 0.6, ypr: 13.2, recTD: 0.14 },
    { name: "Deondre Johnson", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 24, recTD: 0.43 } ] },
  KENN: { abbr: "KENN", name: "Kennesaw St", pace: 1.03, def: { pass: 1.01, run: 1.15, cb: 1.03 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 30.2, cmp: 0.61, ypa: 8.04, pTD: 1.86, iNT: 0.79, rYd: 28.7, rTD: 0.29 },
    { name: "Latrelle Murrell", pos: "RB", car: 12.6, ypc: 5.08, ruTD: 0.21, tgt: 2.2, cr: 0.72, ypr: 11.2, recTD: 0.29 },
    { name: "Devaughn Slaughter", pos: "WR", tgt: 6.5, cr: 0.6, ypr: 10, recTD: 0.21, wr1: true },
    { name: "Zion Booker", pos: "WR", tgt: 5.5, cr: 0.6, ypr: 9.1, recTD: 0.14 },
    { name: "Brayden Munroe", pos: "WR", tgt: 5.5, cr: 0.6, ypr: 15.1, recTD: 0.21 },
    { name: "Gerard Bullock Jr.", pos: "TE", tgt: 2.5, cr: 0.65, ypr: 6.8, recTD: 0.07 } ] },
  KENT: { abbr: "KENT", name: "Kent State", pace: 0.9, def: { pass: 1.09, run: 1.15, cb: 1.03 }, players: [
    { name: "Dru DeShields", pos: "QB", pAtt: 20, cmp: 0.57, ypa: 8.46, pTD: 1.5, iNT: 0.25, rYd: 3, rTD: 0.25 },
    { name: "Donovan Delaney Jr.", pos: "RB", car: 1.3, ypc: 2.5, ruTD: 0.08, tgt: 0, cr: 0.72, ypr: 7, recTD: 0 },
    { name: "Wayne Harris", pos: "WR", tgt: 4.9, cr: 0.6, ypr: 10.9, recTD: 0.08, wr1: true },
    { name: "Ardell Banks", pos: "WR", tgt: 1.7, cr: 0.6, ypr: 17.1, recTD: 0.17 },
    { name: "Terik Mulder", pos: "TE", tgt: 2.4, cr: 0.65, ypr: 10.4, recTD: 0.33 } ] },
  KSU: { abbr: "KSU", name: "Kansas St", pace: 0.93, def: { pass: 1.02, run: 1.09, cb: 0.96 }, players: [
    { name: "Avery Johnson", pos: "QB", pAtt: 28.4, cmp: 0.6, ypa: 6.99, pTD: 1.5, iNT: 0.5, rYd: 39.8, rTD: 0.67 },
    { name: "Joe Jackson", pos: "RB", car: 14.1, ypc: 5.39, ruTD: 0.67, tgt: 2.5, cr: 0.72, ypr: 5.4, recTD: 0.08 },
    { name: "Rodney Fields Jr.", pos: "RB", car: 10.3, ypc: 4.95, ruTD: 0.08, tgt: 3.2, cr: 0.72, ypr: 9.9, recTD: 0.08 },
    { name: "Josh Manning", pos: "WR", tgt: 4, cr: 0.6, ypr: 11, recTD: 0.17, wr1: true },
    { name: "Adonis Moise", pos: "WR", tgt: 0.8, cr: 0.6, ypr: 9.3, recTD: 0 },
    { name: "Garrett Oakley", pos: "TE", tgt: 4.9, cr: 0.65, ypr: 10.2, recTD: 0.5 } ] },
  KU: { abbr: "KU", name: "Kansas", pace: 0.97, def: { pass: 0.98, run: 1.15, cb: 1.02 }, players: [
    { name: "Chase Jenkins", pos: "QB", pAtt: 14.3, cmp: 0.69, ypa: 5.96, pTD: 0.75, iNT: 0.17, rYd: 44.3, rTD: 0.42 },
    { name: "Jalen Dupree", pos: "RB", car: 8.5, ypc: 4.98, ruTD: 0.17, tgt: 1.4, cr: 0.72, ypr: 6.9, recTD: 0 },
    { name: "Dylan Edwards", pos: "RB", car: 2.8, ypc: 6.03, ruTD: 0.17, tgt: 0.3, cr: 0.72, ypr: 5.7, recTD: 0 },
    { name: "Nik McMillan", pos: "WR", tgt: 8.6, cr: 0.6, ypr: 15.8, recTD: 0.25, wr1: true },
    { name: "Cam Pickett", pos: "WR", tgt: 6.3, cr: 0.6, ypr: 10.6, recTD: 0.25 },
    { name: "Nahzae Cox", pos: "WR", tgt: 5.6, cr: 0.6, ypr: 11.8, recTD: 0.42 },
    { name: "Carter Moses", pos: "TE", tgt: 3.3, cr: 0.65, ypr: 12.3, recTD: 0.17 } ] },
  LIB: { abbr: "LIB", name: "Liberty", pace: 1.03, def: { pass: 0.9, run: 1.15, cb: 0.95 }, players: [
    { name: "Ethan Vasko", pos: "QB", pAtt: 22.2, cmp: 0.57, ypa: 7.37, pTD: 0.83, iNT: 1, rYd: 21.5, rTD: 0.42 },
    { name: "Terron Kellman", pos: "RB", car: 5.4, ypc: 5.09, ruTD: 0.33, tgt: 0.6, cr: 0.72, ypr: 10.4, recTD: 0 },
    { name: "Kanye Udoh", pos: "RB", car: 4.7, ypc: 4.29, ruTD: 0.17, tgt: 0.1, cr: 0.72, ypr: 6, recTD: 0 },
    { name: "Rashawn Cunningham", pos: "WR", tgt: 4.7, cr: 0.6, ypr: 18.5, recTD: 0.58, wr1: true },
    { name: "Jamari Person", pos: "WR", tgt: 3.9, cr: 0.6, ypr: 11.3, recTD: 0 },
    { name: "Refeno Vangates", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 13.7, recTD: 0.25 } ] },
  LOU: { abbr: "LOU", name: "Louisville", pace: 0.96, def: { pass: 0.87, run: 0.85, cb: 0.9 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 32.2, cmp: 0.64, ypa: 6.86, pTD: 1.38, iNT: 0.69, rYd: 29.5, rTD: 0.38 },
    { name: "Isaac Brown", pos: "RB", car: 7.8, ypc: 8, ruTD: 0.54, tgt: 1.4, cr: 0.72, ypr: 3.7, recTD: 0 },
    { name: "Keyjuan Brown", pos: "RB", car: 7.4, ypc: 7.33, ruTD: 0.46, tgt: 1.3, cr: 0.72, ypr: 9.8, recTD: 0 },
    { name: "Jackson Voth", pos: "WR", tgt: 6.5, cr: 0.6, ypr: 11.8, recTD: 0.38, wr1: true },
    { name: "Tre Richardson", pos: "WR", tgt: 5.9, cr: 0.6, ypr: 17.5, recTD: 0.54 },
    { name: "Lawayne McCoy", pos: "WR", tgt: 3.5, cr: 0.6, ypr: 14.7, recTD: 0.23 },
    { name: "Brody Foley", pos: "TE", tgt: 4.4, cr: 0.65, ypr: 14.3, recTD: 0.54 } ] },
  LSU: { abbr: "LSU", name: "LSU", pace: 0.94, def: { pass: 0.94, run: 0.85, cb: 0.91 }, players: [
    { name: "Landen Clark", pos: "QB", pAtt: 21.3, cmp: 0.56, ypa: 8.38, pTD: 1.38, iNT: 0.62, rYd: 47.2, rTD: 0.85 },
    { name: "Caden Durham", pos: "RB", car: 8.5, ypc: 4.55, ruTD: 0.23, tgt: 1.7, cr: 0.72, ypr: 5.7, recTD: 0 },
    { name: "Harlem Berry", pos: "RB", car: 8, ypc: 4.72, ruTD: 0.15, tgt: 0.9, cr: 0.72, ypr: 4, recTD: 0 },
    { name: "Jackson Harris", pos: "WR", tgt: 6.3, cr: 0.6, ypr: 19.7, recTD: 0.92, wr1: true },
    { name: "Jayce Brown", pos: "WR", tgt: 5.3, cr: 0.6, ypr: 17.4, recTD: 0.38 },
    { name: "Tre' Brown", pos: "WR", tgt: 4.9, cr: 0.6, ypr: 20.1, recTD: 0.31 },
    { name: "Trey'Dez Green", pos: "TE", tgt: 3.9, cr: 0.65, ypr: 13.1, recTD: 0.54 } ] },
  LT: { abbr: "LT", name: "Louisiana Tech", pace: 0.98, def: { pass: 1.1, run: 0.9, cb: 0.91 }, players: [
    { name: "Blake Baker", pos: "QB", pAtt: 11.9, cmp: 0.66, ypa: 8.07, pTD: 0.38, iNT: 0.23, rYd: 20, rTD: 0.23 },
    { name: "Andrew Burnette", pos: "RB", car: 7.3, ypc: 5.17, ruTD: 0.69, tgt: 0.2, cr: 0.72, ypr: 4.5, recTD: 0 },
    { name: "Marcus Calwise Jr.", pos: "WR", tgt: 4.1, cr: 0.6, ypr: 13, recTD: 0.38, wr1: true },
    { name: "Jalen Mickens", pos: "WR", tgt: 2.6, cr: 0.6, ypr: 8.9, recTD: 0.08 },
    { name: "David Pierro", pos: "WR", tgt: 1, cr: 0.6, ypr: 11.1, recTD: 0 },
    { name: "Eli Finley", pos: "TE", tgt: 4.5, cr: 0.65, ypr: 11.7, recTD: 0 } ] },
  "M-OH": { abbr: "M-OH", name: "Miami OH", pace: 0.93, def: { pass: 0.92, run: 0.89, cb: 0.91 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 26.5, cmp: 0.49, ypa: 7.07, pTD: 1.21, iNT: 0.79, rYd: 27.1, rTD: 0.24 },
    { name: "Rodney Nelson", pos: "RB", car: 21, ypc: 6.14, ruTD: 1.29, tgt: 3, cr: 0.72, ypr: 7.6, recTD: 0.07 },
    { name: "D'Shawntae Jones", pos: "RB", car: 4.5, ypc: 4.4, ruTD: 0.5, tgt: 0, cr: 0.72, ypr: 7, recTD: 0 },
    { name: "Maleek Huggins", pos: "WR", tgt: 7.6, cr: 0.6, ypr: 13.5, recTD: 0.57, wr1: true },
    { name: "Keith Reynolds", pos: "WR", tgt: 4.3, cr: 0.6, ypr: 9.8, recTD: 0.07 },
    { name: "Braylon Isom", pos: "WR", tgt: 1.2, cr: 0.6, ypr: 14.1, recTD: 0.21 },
    { name: "Christian Ross", pos: "TE", tgt: 2, cr: 0.65, ypr: 9.7, recTD: 0.07 } ] },
  MASS: { abbr: "MASS", name: "UMass", pace: 0.96, def: { pass: 0.98, run: 1.15, cb: 1.1 }, players: [
    { name: "Logan Inagawa", pos: "QB", pAtt: 15.8, cmp: 0.68, ypa: 7.33, pTD: 0.75, iNT: 0.33, rYd: 33.2, rTD: 0.75 },
    { name: "Jordan Washington", pos: "RB", car: 7.2, ypc: 3.95, ruTD: 0.25, tgt: 2.5, cr: 0.72, ypr: 9.2, recTD: 0.08 },
    { name: "Elijah Faulkner", pos: "RB", car: 3.3, ypc: 2.85, ruTD: 0, tgt: 0.1, cr: 0.72, ypr: 5, recTD: 0 },
    { name: "Devin Matthews", pos: "WR", tgt: 5, cr: 0.6, ypr: 18, recTD: 0.58, wr1: true },
    { name: "Kezion Dia-Johnson", pos: "WR", tgt: 0.8, cr: 0.6, ypr: 12.2, recTD: 0.08 },
    { name: "Max Dowling", pos: "TE", tgt: 2.6, cr: 0.65, ypr: 10, recTD: 0.25 } ] },
  MD: { abbr: "MD", name: "Maryland", pace: 0.99, def: { pass: 1.04, run: 1.15, cb: 1 }, players: [
    { name: "Malik Washington", pos: "QB", pAtt: 39.4, cmp: 0.58, ypa: 6.26, pTD: 1.42, iNT: 0.75, rYd: 25.3, rTD: 0.33 },
    { name: "Iverson Howard", pos: "RB", car: 3.3, ypc: 3.21, ruTD: 0, tgt: 0.2, cr: 0.72, ypr: 3, recTD: 0 },
    { name: "Na'eem Abdul-Rahim Gladding", pos: "WR", tgt: 7.1, cr: 0.6, ypr: 13.1, recTD: 0.5, wr1: true },
    { name: "Chris Durr Jr.", pos: "WR", tgt: 6.3, cr: 0.6, ypr: 10.4, recTD: 0.33 },
    { name: "Kaleb Webb", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 14.5, recTD: 0.17 },
    { name: "Dorian Fleming", pos: "TE", tgt: 5.1, cr: 0.65, ypr: 8.8, recTD: 0.25 } ] },
  MEM: { abbr: "MEM", name: "Memphis", pace: 1.02, def: { pass: 1.04, run: 0.88, cb: 1.06 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 31.7, cmp: 0.67, ypa: 7.21, pTD: 1.31, iNT: 0.69, rYd: 33, rTD: 0.52 },
    { name: "Dallan Hayden", pos: "RB", car: 5.4, ypc: 4.66, ruTD: 0.08, tgt: 0.4, cr: 0.72, ypr: 3.8, recTD: 0 },
    { name: "Jaylin Carter", pos: "RB", car: 2.9, ypc: 4.37, ruTD: 0.15, tgt: 2.1, cr: 0.72, ypr: 6.7, recTD: 0 },
    { name: "Tychaun Chapman", pos: "WR", tgt: 3.2, cr: 0.6, ypr: 17.9, recTD: 0.23, wr1: true },
    { name: "Brady Kluse", pos: "WR", tgt: 2.8, cr: 0.6, ypr: 10.9, recTD: 0.15 },
    { name: "Bryce Dorsey", pos: "WR", tgt: 1, cr: 0.6, ypr: 8.6, recTD: 0 },
    { name: "Hunter Tipton", pos: "TE", tgt: 4.6, cr: 0.65, ypr: 10.5, recTD: 0.15 } ] },
  MIA: { abbr: "MIA", name: "Miami", pace: 0.99, def: { pass: 0.94, run: 0.85, cb: 0.9 }, players: [
    { name: "Darian Mensah", pos: "QB", pAtt: 31.3, cmp: 0.67, ypa: 7.95, pTD: 2.13, iNT: 0.38, rYd: -2, rTD: 0.06 },
    { name: "Mark Fletcher Jr.", pos: "RB", car: 13.5, ypc: 5.52, ruTD: 0.75, tgt: 1.5, cr: 0.72, ypr: 8.2, recTD: 0.13 },
    { name: "CharMar Brown", pos: "RB", car: 7.6, ypc: 3.89, ruTD: 0.44, tgt: 1.7, cr: 0.72, ypr: 6.9, recTD: 0.13 },
    { name: "Malachi Toney", pos: "WR", tgt: 11.4, cr: 0.6, ypr: 11.1, recTD: 0.63, wr1: true },
    { name: "Cooper Barkate", pos: "WR", tgt: 7.5, cr: 0.6, ypr: 15.4, recTD: 0.44 },
    { name: "Vandrevius Jacobs", pos: "WR", tgt: 3.3, cr: 0.6, ypr: 17.1, recTD: 0.25 },
    { name: "Elija Lofton", pos: "TE", tgt: 2.2, cr: 0.65, ypr: 9.5, recTD: 0.19 } ] },
  MICH: { abbr: "MICH", name: "Michigan", pace: 0.97, def: { pass: 0.97, run: 0.85, cb: 0.91 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 26.2, cmp: 0.59, ypa: 7.14, pTD: 0.85, iNT: 0.77, rYd: 37.8, rTD: 0.51 },
    { name: "Jordan Marshall", pos: "RB", car: 11.5, ypc: 6.21, ruTD: 0.77, tgt: 1, cr: 0.72, ypr: 10.2, recTD: 0 },
    { name: "Bryson Kuzdzal", pos: "RB", car: 5.8, ypc: 4.29, ruTD: 0.31, tgt: 0.4, cr: 0.72, ypr: 3, recTD: 0 },
    { name: "Andrew Marsh", pos: "WR", tgt: 5.8, cr: 0.6, ypr: 14.5, recTD: 0.31, wr1: true },
    { name: "JJ Buchanan", pos: "WR", tgt: 3.3, cr: 0.6, ypr: 16.4, recTD: 0.38 },
    { name: "Channing Goodwin", pos: "WR", tgt: 1.5, cr: 0.6, ypr: 12.3, recTD: 0 },
    { name: "Zack Marshall", pos: "TE", tgt: 1.9, cr: 0.65, ypr: 12.4, recTD: 0.08 } ] },
  MINN: { abbr: "MINN", name: "Minnesota", pace: 0.9, def: { pass: 0.97, run: 0.85, cb: 1.05 }, players: [
    { name: "Drake Lindsey", pos: "QB", pAtt: 29.9, cmp: 0.63, ypa: 6.12, pTD: 1.38, iNT: 0.46, rYd: -9.2, rTD: 0.31 },
    { name: "Darius Taylor", pos: "RB", car: 11, ypc: 4.69, ruTD: 0.31, tgt: 3.6, cr: 0.72, ypr: 7.2, recTD: 0 },
    { name: "TJ Thomas", pos: "RB", car: 7, ypc: 4.22, ruTD: 0.46, tgt: 1.6, cr: 0.72, ypr: 8.3, recTD: 0 },
    { name: "Javon Tracy", pos: "WR", tgt: 4.7, cr: 0.6, ypr: 12.3, recTD: 0.46, wr1: true },
    { name: "Jalen Smith", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 15, recTD: 0.31 },
    { name: "Noah Jennings", pos: "WR", tgt: 2.9, cr: 0.6, ypr: 14, recTD: 0 } ] },
  MISS: { abbr: "MISS", name: "Ole Miss", pace: 1.09, def: { pass: 0.91, run: 0.99, cb: 0.92 }, players: [
    { name: "Trinidad Chambliss", pos: "QB", pAtt: 29.7, cmp: 0.66, ypa: 8.85, pTD: 1.47, iNT: 0.2, rYd: 35.1, rTD: 0.53 },
    { name: "Kewan Lacy", pos: "RB", car: 20.4, ypc: 5.12, ruTD: 1.6, tgt: 2.7, cr: 0.72, ypr: 6.1, recTD: 0 },
    { name: "Joshua Dye", pos: "RB", car: 19.7, ypc: 6.21, ruTD: 1.87, tgt: 0.6, cr: 0.72, ypr: 5.7, recTD: 0 },
    { name: "Johntay Cook II", pos: "WR", tgt: 5, cr: 0.6, ypr: 12.2, recTD: 0.13, wr1: true },
    { name: "Deuce Alexander", pos: "WR", tgt: 4.9, cr: 0.6, ypr: 15.5, recTD: 0.13 },
    { name: "Darrell Gill Jr.", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 15.8, recTD: 0.33 },
    { name: "Caleb Odom", pos: "TE", tgt: 1.9, cr: 0.65, ypr: 10.4, recTD: 0.13 } ] },
  MIZ: { abbr: "MIZ", name: "Missouri", pace: 1.06, def: { pass: 0.85, run: 0.85, cb: 0.9 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 27.8, cmp: 0.63, ypa: 6.75, pTD: 1.15, iNT: 0.85, rYd: 41.1, rTD: 0.48 },
    { name: "Ahmad Hardy", pos: "RB", car: 19.7, ypc: 6.44, ruTD: 1.23, tgt: 0.6, cr: 0.72, ypr: 3.7, recTD: 0 },
    { name: "Xai'Shaun Edwards", pos: "RB", car: 14.9, ypc: 5.25, ruTD: 0.92, tgt: 1.9, cr: 0.72, ypr: 5.9, recTD: 0 },
    { name: "Cayden Lee", pos: "WR", tgt: 5.6, cr: 0.6, ypr: 14.4, recTD: 0.23, wr1: true },
    { name: "Donovan Olugbode", pos: "WR", tgt: 3.8, cr: 0.6, ypr: 13.4, recTD: 0.15 },
    { name: "Caleb Goodie Sr.", pos: "WR", tgt: 3.7, cr: 0.6, ypr: 16.7, recTD: 0.15 },
    { name: "Brett Norfleet", pos: "TE", tgt: 3.7, cr: 0.65, ypr: 8.2, recTD: 0.38 } ] },
  MOST: { abbr: "MOST", name: "Missouri St", pace: 0.98, def: { pass: 1.06, run: 1.02, cb: 1.02 }, players: [
    { name: "Skyler Locklear", pos: "QB", pAtt: 16.2, cmp: 0.55, ypa: 6.72, pTD: 1, iNT: 0.85, rYd: 30.5, rTD: 0.62 },
    { name: "Ramone Green Jr.", pos: "RB", car: 4, ypc: 5.35, ruTD: 0.08, tgt: 3.1, cr: 0.72, ypr: 15.4, recTD: 0.23 },
    { name: "Jmariyae Robinson", pos: "WR", tgt: 5.6, cr: 0.6, ypr: 14.4, recTD: 0.54, wr1: true },
    { name: "Makai Cope", pos: "WR", tgt: 2.6, cr: 0.6, ypr: 13.5, recTD: 0 },
    { name: "Mekhi Miller", pos: "WR", tgt: 1.2, cr: 0.6, ypr: 6.4, recTD: 0 },
    { name: "Jeron Askren", pos: "TE", tgt: 2.2, cr: 0.65, ypr: 11.8, recTD: 0.38 } ] },
  MRSH: { abbr: "MRSH", name: "Marshall", pace: 1.04, def: { pass: 1.15, run: 0.99, cb: 1.1 }, players: [
    { name: "Carlos Del Rio-Wilson", pos: "QB", pAtt: 21.3, cmp: 0.67, ypa: 7.98, pTD: 1.42, iNT: 0.42, rYd: 55, rTD: 0.5 },
    { name: "TJ Lester", pos: "RB", car: 8.4, ypc: 4.28, ruTD: 0.5, tgt: 1, cr: 0.72, ypr: 3, recTD: 0 },
    { name: "Jo'Shon Barbie", pos: "RB", car: 4.7, ypc: 4.45, ruTD: 0.42, tgt: 0.6, cr: 0.72, ypr: 6, recTD: 0 },
    { name: "Demarcus Lacey", pos: "WR", tgt: 9, cr: 0.6, ypr: 11.8, recTD: 0.42, wr1: true },
    { name: "Owen Sweeney", pos: "WR", tgt: 6.1, cr: 0.6, ypr: 16.4, recTD: 0.67 },
    { name: "De'Andre Tamarez", pos: "WR", tgt: 4.4, cr: 0.6, ypr: 12.3, recTD: 0.17 },
    { name: "Toby Payne", pos: "TE", tgt: 4.7, cr: 0.65, ypr: 10.6, recTD: 0.25 } ] },
  MSST: { abbr: "MSST", name: "Mississippi St", pace: 1.08, def: { pass: 1.03, run: 1.15, cb: 1.03 }, players: [
    { name: "AJ Swann", pos: "QB", pAtt: 17.1, cmp: 0.59, ypa: 6.73, pTD: 0.77, iNT: 0.62, rYd: -0.9, rTD: 0 },
    { name: "Fluff Bothwell", pos: "RB", car: 10.9, ypc: 4.77, ruTD: 0.46, tgt: 1.5, cr: 0.72, ypr: 7.5, recTD: 0 },
    { name: "Xavier Gayten", pos: "RB", car: 2.2, ypc: 5.41, ruTD: 0.15, tgt: 0.3, cr: 0.72, ypr: 3, recTD: 0 },
    { name: "Anthony Evans III", pos: "WR", tgt: 8.6, cr: 0.6, ypr: 12.4, recTD: 0.31, wr1: true },
    { name: "Marquis Johnson", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 12.1, recTD: 0.15 } ] },
  MSU: { abbr: "MSU", name: "Michigan St", pace: 0.96, def: { pass: 1.06, run: 0.98, cb: 1.07 }, players: [
    { name: "Alessio Milivojevic", pos: "QB", pAtt: 14.4, cmp: 0.64, ypa: 7.32, pTD: 0.83, iNT: 0.25, rYd: -4.9, rTD: 0.08 },
    { name: "Cam Edwards", pos: "RB", car: 17.5, ypc: 5.9, ruTD: 1.25, tgt: 2.2, cr: 0.72, ypr: 9.8, recTD: 0.08 },
    { name: "Marvis Parrish", pos: "RB", car: 8.8, ypc: 5.43, ruTD: 0.08, tgt: 4.2, cr: 0.72, ypr: 5.6, recTD: 0.08 },
    { name: "Jameel Gardner Jr.", pos: "WR", tgt: 4.4, cr: 0.6, ypr: 13.9, recTD: 0.17, wr1: true },
    { name: "Chrishon McCray", pos: "WR", tgt: 3.3, cr: 0.6, ypr: 13.8, recTD: 0.25 },
    { name: "KK Smith", pos: "WR", tgt: 1.1, cr: 0.6, ypr: 15.4, recTD: 0.17 } ] },
  MTSU: { abbr: "MTSU", name: "MTSU", pace: 1.02, def: { pass: 1.15, run: 0.95, cb: 1.1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 41.7, cmp: 0.6, ypa: 6.39, pTD: 1.92, iNT: 0.58, rYd: 19, rTD: 0.18 },
    { name: "DJ Taylor", pos: "RB", car: 2.2, ypc: 7.65, ruTD: 0.17, tgt: 0.8, cr: 0.72, ypr: 7.7, recTD: 0.08 },
    { name: "Antonio Martin", pos: "RB", car: 1.6, ypc: 6.79, ruTD: 0.08, tgt: 0, cr: 0.72, ypr: 7, recTD: 0 },
    { name: "Cam'ron Lacy", pos: "WR", tgt: 5.3, cr: 0.6, ypr: 14.4, recTD: 0.25, wr1: true },
    { name: "AJ Jones", pos: "WR", tgt: 3.9, cr: 0.6, ypr: 7.7, recTD: 0.42 },
    { name: "Landon Collins", pos: "WR", tgt: 2.2, cr: 0.6, ypr: 11.3, recTD: 0.08 } ] },
  NCSU: { abbr: "NCSU", name: "NC State", pace: 0.96, def: { pass: 1.15, run: 0.92, cb: 1.07 }, players: [
    { name: "CJ Bailey", pos: "QB", pAtt: 30.5, cmp: 0.69, ypa: 7.82, pTD: 1.92, iNT: 0.69, rYd: 16.5, rTD: 0.46 },
    { name: "Jayden Scott", pos: "RB", car: 8.2, ypc: 5.61, ruTD: 0.31, tgt: 1.6, cr: 0.72, ypr: 8.8, recTD: 0 },
    { name: "Davion Gause", pos: "RB", car: 4.7, ypc: 4.25, ruTD: 0.23, tgt: 1.7, cr: 0.72, ypr: 8.3, recTD: 0.15 },
    { name: "Keenan Jackson", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 10, recTD: 0.15, wr1: true },
    { name: "Teddy Hoffmann", pos: "WR", tgt: 3.2, cr: 0.6, ypr: 14, recTD: 0.23 },
    { name: "Davion Dozier", pos: "WR", tgt: 2.6, cr: 0.6, ypr: 22.4, recTD: 0.38 },
    { name: "Hunter Provience", pos: "TE", tgt: 1.3, cr: 0.65, ypr: 12.3, recTD: 0.08 } ] },
  ND: { abbr: "ND", name: "Notre Dame", pace: 0.94, def: { pass: 0.98, run: 0.85, cb: 0.9 }, players: [
    { name: "CJ Carr", pos: "QB", pAtt: 24.4, cmp: 0.67, ypa: 9.35, pTD: 2, iNT: 0.5, rYd: 2.8, rTD: 0.25 },
    { name: "Nolan James Jr.", pos: "RB", car: 1.2, ypc: 2.64, ruTD: 0, tgt: 0, cr: 0.72, ypr: 7, recTD: 0 },
    { name: "Jordan Faison", pos: "WR", tgt: 6.8, cr: 0.6, ypr: 13.1, recTD: 0.33, wr1: true },
    { name: "Micah Gilbert", pos: "WR", tgt: 1.3, cr: 0.6, ypr: 10.3, recTD: 0.08 },
    { name: "Mylan Graham", pos: "WR", tgt: 0.8, cr: 0.6, ypr: 15.5, recTD: 0 } ] },
  NEB: { abbr: "NEB", name: "Nebraska", pace: 0.95, def: { pass: 0.85, run: 1.15, cb: 0.9 }, players: [
    { name: "Anthony Colandrea", pos: "QB", pAtt: 32.1, cmp: 0.66, ypa: 8.29, pTD: 1.77, iNT: 0.69, rYd: 49.9, rTD: 0.77 },
    { name: "Isaiah Mozee", pos: "RB", car: 2, ypc: 4.42, ruTD: 0, tgt: 1.5, cr: 0.72, ypr: 11.1, recTD: 0 },
    { name: "Mekhi Nelson", pos: "RB", car: 2.1, ypc: 5.44, ruTD: 0.15, tgt: 0.9, cr: 0.72, ypr: 12.8, recTD: 0 },
    { name: "Kwazi Gilmer", pos: "WR", tgt: 6.4, cr: 0.6, ypr: 10.7, recTD: 0.31, wr1: true },
    { name: "Jacory Barney Jr.", pos: "WR", tgt: 5.8, cr: 0.6, ypr: 10.8, recTD: 0.38 },
    { name: "Nyziah Hunter", pos: "WR", tgt: 5.5, cr: 0.6, ypr: 14.3, recTD: 0.38 },
    { name: "Luke Lindenmeyer", pos: "TE", tgt: 3.4, cr: 0.65, ypr: 10.8, recTD: 0.15 } ] },
  NEV: { abbr: "NEV", name: "Nevada", pace: 0.9, def: { pass: 1.01, run: 1, cb: 1.05 }, players: [
    { name: "Carter Jones", pos: "QB", pAtt: 14.3, cmp: 0.64, ypa: 5.96, pTD: 0.5, iNT: 0.67, rYd: 3, rTD: 0 },
    { name: "Herschel Turner", pos: "RB", car: 5.8, ypc: 5.12, ruTD: 0, tgt: 0.3, cr: 0.72, ypr: 3, recTD: 0 },
    { name: "Ky Woods", pos: "RB", car: 1.6, ypc: 5.42, ruTD: 0, tgt: 0.9, cr: 0.72, ypr: 11.1, recTD: 0.08 },
    { name: "Damien Morgan", pos: "WR", tgt: 7.4, cr: 0.6, ypr: 11.5, recTD: 0.25, wr1: true },
    { name: "Donnie Cheers", pos: "WR", tgt: 6.1, cr: 0.6, ypr: 13.3, recTD: 0.42 },
    { name: "Jaceon Doss", pos: "WR", tgt: 4, cr: 0.6, ypr: 22.7, recTD: 0.42 } ] },
  NIU: { abbr: "NIU", name: "N Illinois", pace: 0.93, def: { pass: 0.85, run: 1.15, cb: 0.93 }, players: [
    { name: "Taron Dickens", pos: "QB", pAtt: 30.4, cmp: 0.74, ypa: 9.61, pTD: 3.17, iNT: 0.17, rYd: 26.8, rTD: 0.08 },
    { name: "Telly Johnson Jr.", pos: "RB", car: 10.3, ypc: 5.74, ruTD: 0.33, tgt: 1.9, cr: 0.72, ypr: 6.1, recTD: 0 },
    { name: "Elijah Porter", pos: "RB", car: 1, ypc: 6.67, ruTD: 0, tgt: 0.1, cr: 0.72, ypr: 16, recTD: 0.08 },
    { name: "DeAree Rogers", pos: "WR", tgt: 6.4, cr: 0.6, ypr: 11, recTD: 0.25, wr1: true },
    { name: "George Dimopoulos", pos: "WR", tgt: 1.5, cr: 0.6, ypr: 5.3, recTD: 0 },
    { name: "Rickey Taylor Jr.", pos: "WR", tgt: 1.3, cr: 0.6, ypr: 14.9, recTD: 0.08 } ] },
  NMSU: { abbr: "NMSU", name: "New Mexico St", pace: 1.03, def: { pass: 1.09, run: 1.1, cb: 0.98 }, players: [
    { name: "Trey Hedden", pos: "QB", pAtt: 34.9, cmp: 0.68, ypa: 7.08, pTD: 1.42, iNT: 1.08, rYd: -14.7, rTD: 0.08 },
    { name: "James Jones", pos: "RB", car: 8.2, ypc: 8, ruTD: 0.75, tgt: 0.6, cr: 0.72, ypr: 10, recTD: 0 },
    { name: "Dijon Stanley", pos: "RB", car: 6.3, ypc: 4.11, ruTD: 0.17, tgt: 2.8, cr: 0.72, ypr: 5.5, recTD: 0 },
    { name: "TK King", pos: "WR", tgt: 5.7, cr: 0.6, ypr: 14.3, recTD: 0.25, wr1: true },
    { name: "Brodie Malone-Bradford", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 11, recTD: 0.17 },
    { name: "Lyndon Ravare", pos: "WR", tgt: 2.8, cr: 0.6, ypr: 11.5, recTD: 0.08 },
    { name: "Josiah Thomas", pos: "TE", tgt: 3.6, cr: 0.65, ypr: 8.1, recTD: 0.25 } ] },
  NU: { abbr: "NU", name: "Northwestern", pace: 0.95, def: { pass: 0.89, run: 0.91, cb: 1.02 }, players: [
    { name: "Aidan Chiles", pos: "QB", pAtt: 15.6, cmp: 0.63, ypa: 6.86, pTD: 0.77, iNT: 0.23, rYd: 17.5, rTD: 0.46 },
    { name: "Caleb Komolafe", pos: "RB", car: 14.6, ypc: 4.95, ruTD: 0.85, tgt: 1.2, cr: 0.72, ypr: 5.5, recTD: 0.08 },
    { name: "Joseph Himon II", pos: "RB", car: 7.6, ypc: 4.91, ruTD: 0.08, tgt: 2.2, cr: 0.72, ypr: 5.6, recTD: 0 },
    { name: "Hayden Eligon II", pos: "WR", tgt: 4.7, cr: 0.6, ypr: 14.1, recTD: 0.23, wr1: true },
    { name: "Ricky Ahumaraeze", pos: "WR", tgt: 1.3, cr: 0.6, ypr: 20, recTD: 0 },
    { name: "Alex Honig", pos: "TE", tgt: 1.5, cr: 0.65, ypr: 12.5, recTD: 0.23 } ] },
  ODU: { abbr: "ODU", name: "Old Dominion", pace: 1.02, def: { pass: 0.88, run: 0.93, cb: 0.9 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 25.5, cmp: 0.58, ypa: 8.47, pTD: 1.62, iNT: 0.77, rYd: 42.9, rTD: 0.48 },
    { name: "Devin Roche", pos: "RB", car: 8.5, ypc: 5.68, ruTD: 0.31, tgt: 0.5, cr: 0.72, ypr: 6.2, recTD: 0 },
    { name: "Maurki James", pos: "RB", car: 4.3, ypc: 4, ruTD: 0.15, tgt: 0.6, cr: 0.72, ypr: 6.5, recTD: 0 },
    { name: "Kendall Harris", pos: "WR", tgt: 4.7, cr: 0.6, ypr: 12.9, recTD: 0.23, wr1: true },
    { name: "Sidney Mbanasor", pos: "WR", tgt: 0.8, cr: 0.6, ypr: 11.3, recTD: 0 } ] },
  OHIO: { abbr: "OHIO", name: "Ohio", pace: 1, def: { pass: 0.96, run: 0.96, cb: 1.06 }, players: [
    { name: "Matt Vezza", pos: "QB", pAtt: 28.4, cmp: 0.61, ypa: 7.24, pTD: 1.46, iNT: 0.54, rYd: 46.5, rTD: 0.62 },
    { name: "Duncan Brune", pos: "RB", car: 9.2, ypc: 4.88, ruTD: 0.62, tgt: 0.5, cr: 0.72, ypr: 11.4, recTD: 0 },
    { name: "Victor Rosa", pos: "RB", car: 2.3, ypc: 5.17, ruTD: 0.15, tgt: 1.6, cr: 0.72, ypr: 9.8, recTD: 0.08 },
    { name: "Dom Dorwart", pos: "WR", tgt: 1.4, cr: 0.6, ypr: 10.8, recTD: 0, wr1: true },
    { name: "Eian Pugh", pos: "WR", tgt: 0.8, cr: 0.6, ypr: 12.5, recTD: 0 } ] },
  OKST: { abbr: "OKST", name: "Oklahoma St", pace: 0.96, def: { pass: 1.15, run: 1.11, cb: 1.1 }, players: [
    { name: "Drew Mestemaker", pos: "QB", pAtt: 38.6, cmp: 0.69, ypa: 9.46, pTD: 2.83, iNT: 0.75, rYd: 7.4, rTD: 0.42 },
    { name: "Caleb Hawkins", pos: "RB", car: 19.3, ypc: 6.21, ruTD: 2.08, tgt: 3.7, cr: 0.72, ypr: 11.6, recTD: 0.33 },
    { name: "Tre Page III", pos: "RB", car: 9.3, ypc: 7.49, ruTD: 0.58, tgt: 0.8, cr: 0.72, ypr: 4.1, recTD: 0 },
    { name: "Miles Coleman", pos: "WR", tgt: 6.5, cr: 0.6, ypr: 11.7, recTD: 0.17, wr1: true },
    { name: "Chris Barnes", pos: "WR", tgt: 5.4, cr: 0.6, ypr: 14, recTD: 0.25 },
    { name: "Israel Polk", pos: "WR", tgt: 4.6, cr: 0.6, ypr: 15.9, recTD: 0.67 },
    { name: "Morgan McPhaul", pos: "TE", tgt: 1.9, cr: 0.65, ypr: 11.6, recTD: 0.08 } ] },
  ORE: { abbr: "ORE", name: "Oregon", pace: 0.98, def: { pass: 0.85, run: 0.85, cb: 0.9 }, players: [
    { name: "Dante Moore", pos: "QB", pAtt: 27.5, cmp: 0.72, ypa: 8.65, pTD: 2, iNT: 0.67, rYd: 10.4, rTD: 0.13 },
    { name: "Jordon Davison", pos: "RB", car: 7.5, ypc: 5.9, ruTD: 1, tgt: 1.1, cr: 0.72, ypr: 5.2, recTD: 0 },
    { name: "Dierre Hill Jr.", pos: "RB", car: 5, ypc: 8, ruTD: 0.33, tgt: 1.5, cr: 0.72, ypr: 8.6, recTD: 0.07 },
    { name: "Iverson Hooks", pos: "WR", tgt: 8, cr: 0.6, ypr: 12.9, recTD: 0.47, wr1: true },
    { name: "Jeremiah McClellan", pos: "WR", tgt: 4.2, cr: 0.6, ypr: 14.7, recTD: 0.2 },
    { name: "Dakorien Moore", pos: "WR", tgt: 3.8, cr: 0.6, ypr: 14.6, recTD: 0.2 },
    { name: "Jamari Johnson", pos: "TE", tgt: 3.3, cr: 0.65, ypr: 15.9, recTD: 0.2 } ] },
  ORST: { abbr: "ORST", name: "Oregon St", pace: 1.04, def: { pass: 1.02, run: 1.05, cb: 1.08 }, players: [
    { name: "Braden Atkinson", pos: "QB", pAtt: 33.9, cmp: 0.66, ypa: 8.87, pTD: 2.83, iNT: 0.92, rYd: 0.8, rTD: 0.08 },
    { name: "Cornell Hatcher Jr.", pos: "RB", car: 4.3, ypc: 5.62, ruTD: 0.17, tgt: 0.6, cr: 0.72, ypr: 3.4, recTD: 0.08 },
    { name: "AJ Newberry", pos: "RB", car: 1.5, ypc: 3.17, ruTD: 0.25, tgt: 0.2, cr: 0.72, ypr: 9, recTD: 0 },
    { name: "Adonis McDaniel", pos: "WR", tgt: 7.2, cr: 0.6, ypr: 13, recTD: 0.5, wr1: true },
    { name: "Xavyion Noland", pos: "WR", tgt: 5.1, cr: 0.6, ypr: 21, recTD: 0.58 },
    { name: "Eddie Freauff", pos: "WR", tgt: 1.7, cr: 0.6, ypr: 12, recTD: 0.08 },
    { name: "Eric Olsen", pos: "TE", tgt: 6.5, cr: 0.65, ypr: 11.1, recTD: 0.17 } ] },
  OSU: { abbr: "OSU", name: "Ohio State", pace: 0.94, def: { pass: 0.85, run: 0.85, cb: 0.9 }, players: [
    { name: "Julian Sayin", pos: "QB", pAtt: 27.9, cmp: 0.77, ypa: 9.23, pTD: 2.29, iNT: 0.57, rYd: -3.1, rTD: 0 },
    { name: "Bo Jackson", pos: "RB", car: 12.8, ypc: 6.09, ruTD: 0.43, tgt: 1.9, cr: 0.72, ypr: 10.5, recTD: 0.07 },
    { name: "Ja'Kobi Jackson", pos: "RB", car: 1.9, ypc: 3.63, ruTD: 0, tgt: 0.4, cr: 0.72, ypr: 6.8, recTD: 0 },
    { name: "Jeremiah Smith", pos: "WR", tgt: 10.4, cr: 0.6, ypr: 14.3, recTD: 0.86, wr1: true },
    { name: "Devin McCuin", pos: "WR", tgt: 7.7, cr: 0.6, ypr: 11.2, recTD: 0.57 },
    { name: "Brandon Inniss", pos: "WR", tgt: 4.3, cr: 0.6, ypr: 7.5, recTD: 0.21 } ] },
  OU: { abbr: "OU", name: "Oklahoma", pace: 1, def: { pass: 0.9, run: 0.85, cb: 0.9 }, players: [
    { name: "John Mateer", pos: "QB", pAtt: 30.5, cmp: 0.62, ypa: 7.27, pTD: 1.08, iNT: 0.85, rYd: 33.2, rTD: 0.62 },
    { name: "Tory Blaylock", pos: "RB", car: 9.2, ypc: 4, ruTD: 0.31, tgt: 1.4, cr: 0.72, ypr: 5.9, recTD: 0 },
    { name: "Lloyd Avant", pos: "RB", car: 6.9, ypc: 4.63, ruTD: 0.38, tgt: 2.6, cr: 0.72, ypr: 10.9, recTD: 0.08 },
    { name: "Isaiah Sategna III", pos: "WR", tgt: 8.6, cr: 0.6, ypr: 14.4, recTD: 0.62, wr1: true },
    { name: "Trell Harris", pos: "WR", tgt: 7.6, cr: 0.6, ypr: 14.4, recTD: 0.38 },
    { name: "Parker Livingstone", pos: "WR", tgt: 3.7, cr: 0.6, ypr: 17.8, recTD: 0.46 },
    { name: "Rocky Beers", pos: "TE", tgt: 3.7, cr: 0.65, ypr: 12.5, recTD: 0.54 } ] },
  PITT: { abbr: "PITT", name: "Pitt", pace: 1.03, def: { pass: 1.08, run: 0.85, cb: 1 }, players: [
    { name: "Mason Heintschel", pos: "QB", pAtt: 24.3, cmp: 0.64, ypa: 7.45, pTD: 1.23, iNT: 0.62, rYd: 6.8, rTD: 0.15 },
    { name: "Ethan Shine", pos: "RB", car: 14.8, ypc: 3.97, ruTD: 0.38, tgt: 2.4, cr: 0.72, ypr: 11.1, recTD: 0.08 },
    { name: "Justin Cook", pos: "RB", car: 0.7, ypc: 3.44, ruTD: 0, tgt: 0.9, cr: 0.72, ypr: 5.5, recTD: 0 },
    { name: "Malik Knight", pos: "WR", tgt: 6, cr: 0.6, ypr: 16.5, recTD: 0.54, wr1: true },
    { name: "Cataurus Hicks", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 17.6, recTD: 0.31 },
    { name: "Elijah Lagg", pos: "TE", tgt: 2.4, cr: 0.65, ypr: 8.2, recTD: 0 } ] },
  PSU: { abbr: "PSU", name: "Penn State", pace: 0.94, def: { pass: 0.85, run: 0.95, cb: 0.92 }, players: [
    { name: "Rocco Becht", pos: "QB", pAtt: 26.1, cmp: 0.6, ypa: 7.62, pTD: 1.23, iNT: 0.69, rYd: 8.9, rTD: 0.62 },
    { name: "Carson Hansen", pos: "RB", car: 14.5, ypc: 5.06, ruTD: 0.46, tgt: 2, cr: 0.72, ypr: 7.1, recTD: 0 },
    { name: "James Peoples", pos: "RB", car: 4.7, ypc: 5.64, ruTD: 0.23, tgt: 1.1, cr: 0.72, ypr: 5, recTD: 0 },
    { name: "Chase Sowell", pos: "WR", tgt: 4.1, cr: 0.6, ypr: 15.6, recTD: 0.15, wr1: true },
    { name: "Keith Jones Jr.", pos: "WR", tgt: 4, cr: 0.6, ypr: 14.1, recTD: 0.31 },
    { name: "Brett Eskildsen", pos: "WR", tgt: 3.8, cr: 0.6, ypr: 17.5, recTD: 0.38 },
    { name: "Benjamin Brahmer", pos: "TE", tgt: 4.4, cr: 0.65, ypr: 12.1, recTD: 0.46 } ] },
  PUR: { abbr: "PUR", name: "Purdue", pace: 0.97, def: { pass: 1.11, run: 1.15, cb: 1.1 }, players: [
    { name: "Ryan Browne", pos: "QB", pAtt: 28.2, cmp: 0.59, ypa: 6.37, pTD: 0.75, iNT: 0.83, rYd: 17.2, rTD: 0.33 },
    { name: "Fame Ijeboi", pos: "RB", car: 8.1, ypc: 4.55, ruTD: 0.17, tgt: 1.4, cr: 0.72, ypr: 4.5, recTD: 0.08 },
    { name: "Antonio Harris", pos: "RB", car: 5.8, ypc: 4.42, ruTD: 0.17, tgt: 2, cr: 0.72, ypr: 8.1, recTD: 0 },
    { name: "Bisi Owens", pos: "WR", tgt: 9.2, cr: 0.6, ypr: 10.5, recTD: 0.42, wr1: true },
    { name: "Corey Smith", pos: "WR", tgt: 1.9, cr: 0.6, ypr: 16.9, recTD: 0.08 },
    { name: "Jaylan Hornsby", pos: "WR", tgt: 1.1, cr: 0.6, ypr: 12.9, recTD: 0.08 },
    { name: "Kylan Fox", pos: "TE", tgt: 2.1, cr: 0.65, ypr: 8.6, recTD: 0.08 } ] },
  RICE: { abbr: "RICE", name: "Rice", pace: 1, def: { pass: 1.1, run: 1.09, cb: 1.1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 17.2, cmp: 0.66, ypa: 5.67, pTD: 0.85, iNT: 0.31, rYd: 36.9, rTD: 0.31 },
    { name: "Quinton Jackson", pos: "RB", car: 13.8, ypc: 4.94, ruTD: 0.46, tgt: 0.4, cr: 0.72, ypr: 16, recTD: 0.08 },
    { name: "DAndre Hardeman Jr.", pos: "RB", car: 6.3, ypc: 3.96, ruTD: 0.15, tgt: 0.1, cr: 0.72, ypr: 3, recTD: 0 },
    { name: "Max Mosey", pos: "WR", tgt: 6.4, cr: 0.6, ypr: 9.8, recTD: 0, wr1: true },
    { name: "Braylen Walker", pos: "WR", tgt: 0.8, cr: 0.6, ypr: 8.2, recTD: 0 } ] },
  RUTG: { abbr: "RUTG", name: "Rutgers", pace: 1.05, def: { pass: 1.02, run: 1.15, cb: 1.1 }, players: [
    { name: "Dylan Lonergan", pos: "QB", pAtt: 23.7, cmp: 0.67, ypa: 7.13, pTD: 1, iNT: 0.42, rYd: -3.1, rTD: 0.08 },
    { name: "Ja'shon Benjamin", pos: "RB", car: 5.7, ypc: 4.82, ruTD: 0.17, tgt: 0.5, cr: 0.72, ypr: 4.8, recTD: 0 },
    { name: "KJ Duff", pos: "WR", tgt: 8.3, cr: 0.6, ypr: 18.1, recTD: 0.58, wr1: true },
    { name: "Ben Black III", pos: "WR", tgt: 1.1, cr: 0.6, ypr: 14.9, recTD: 0.08 },
    { name: "Kam Anthony", pos: "TE", tgt: 0.9, cr: 0.65, ypr: 16.7, recTD: 0.17 } ] },
  SC: { abbr: "SC", name: "South Carolina", pace: 0.94, def: { pass: 0.99, run: 0.91, cb: 0.98 }, players: [
    { name: "LaNorris Sellers", pos: "QB", pAtt: 24.4, cmp: 0.61, ypa: 8.32, pTD: 1.08, iNT: 0.67, rYd: 22.5, rTD: 0.42 },
    { name: "Matt Fuller", pos: "RB", car: 6, ypc: 3.61, ruTD: 0.17, tgt: 0.7, cr: 0.72, ypr: 5.3, recTD: 0 },
    { name: "Christian Clark", pos: "RB", car: 4.6, ypc: 4.29, ruTD: 0.17, tgt: 0.5, cr: 0.72, ypr: 14.3, recTD: 0 },
    { name: "Nyck Harbor", pos: "WR", tgt: 4.2, cr: 0.6, ypr: 20.6, recTD: 0.5, wr1: true },
    { name: "DJ Black", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 12.4, recTD: 0.17 },
    { name: "Jayden Sellers", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 15.3, recTD: 0.08 },
    { name: "Brady Hunt", pos: "TE", tgt: 2.7, cr: 0.65, ypr: 8, recTD: 0 } ] },
  SDSU: { abbr: "SDSU", name: "San Diego St", pace: 0.97, def: { pass: 0.85, run: 0.86, cb: 0.9 }, players: [
    { name: "Jayden Denegal", pos: "QB", pAtt: 18.7, cmp: 0.59, ypa: 7.44, pTD: 0.69, iNT: 0.62, rYd: 7.6, rTD: 0.31 },
    { name: "Lucky Sutton", pos: "RB", car: 19.5, ypc: 5.11, ruTD: 0.77, tgt: 0.5, cr: 0.72, ypr: 3, recTD: 0 },
    { name: "Javion Kinnard", pos: "RB", car: 0.9, ypc: 4.67, ruTD: 0, tgt: 1.9, cr: 0.72, ypr: 12.7, recTD: 0.08 },
    { name: "Jordan Napier", pos: "WR", tgt: 6.2, cr: 0.6, ypr: 13.1, recTD: 0.15, wr1: true },
    { name: "Aldrich Doe", pos: "WR", tgt: 4.7, cr: 0.6, ypr: 12.6, recTD: 0.15 },
    { name: "Donovan Brown", pos: "WR", tgt: 4.2, cr: 0.6, ypr: 15.7, recTD: 0.15 },
    { name: "Jackson Ford", pos: "TE", tgt: 1.2, cr: 0.65, ypr: 8.6, recTD: 0.08 } ] },
  SHSU: { abbr: "SHSU", name: "Sam Houston", pace: 0.95, def: { pass: 1.15, run: 1.15, cb: 1.1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 32.4, cmp: 0.55, ypa: 5.68, pTD: 1, iNT: 0.83, rYd: 23.7, rTD: 0.17 },
    { name: "Landan Brown", pos: "RB", car: 7, ypc: 5.8, ruTD: 0.42, tgt: 4.3, cr: 0.72, ypr: 6.4, recTD: 0 },
    { name: "Alton McCaskill", pos: "RB", car: 7.3, ypc: 4.2, ruTD: 0.08, tgt: 1, cr: 0.72, ypr: 7.3, recTD: 0.08 },
    { name: "Grady O'Neill", pos: "WR", tgt: 5.3, cr: 0.6, ypr: 10.3, recTD: 0.08, wr1: true },
    { name: "Chris Reed", pos: "WR", tgt: 4.2, cr: 0.6, ypr: 15.3, recTD: 0.42 },
    { name: "Kamari Maxwell", pos: "WR", tgt: 3.2, cr: 0.6, ypr: 16.7, recTD: 0.33 } ] },
  SJSU: { abbr: "SJSU", name: "San José St", pace: 1, def: { pass: 1.13, run: 1.05, cb: 1.1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 40.8, cmp: 0.56, ypa: 6.92, pTD: 1.42, iNT: 1.42, rYd: 21.5, rTD: 0.23 },
    { name: "Jabari Bates", pos: "RB", car: 2.3, ypc: 7.11, ruTD: 0.17, tgt: 0.1, cr: 0.72, ypr: 12, recTD: 0 },
    { name: "Viliami Teu", pos: "RB", car: 1.4, ypc: 4.12, ruTD: 0.08, tgt: 0, cr: 0.72, ypr: 7, recTD: 0 },
    { name: "Jordan Anderson", pos: "WR", tgt: 3.3, cr: 0.6, ypr: 15, recTD: 0, wr1: true },
    { name: "Cooper Hoch", pos: "WR", tgt: 0.7, cr: 0.6, ypr: 8.6, recTD: 0 } ] },
  SMU: { abbr: "SMU", name: "SMU", pace: 0.99, def: { pass: 1.15, run: 0.85, cb: 1 }, players: [
    { name: "Kevin Jennings", pos: "QB", pAtt: 34.9, cmp: 0.66, ypa: 8.02, pTD: 2, iNT: 1, rYd: 4.2, rTD: 0.31 },
    { name: "Kendrick Raphael", pos: "RB", car: 17.8, ypc: 4.06, ruTD: 1, tgt: 3.6, cr: 0.72, ypr: 7.2, recTD: 0.08 },
    { name: "Dramekco Green", pos: "RB", car: 1.9, ypc: 3.6, ruTD: 0.08, tgt: 0.2, cr: 0.72, ypr: 4.5, recTD: 0 },
    { name: "Yamir Knight", pos: "WR", tgt: 6.9, cr: 0.6, ypr: 11.8, recTD: 0.38, wr1: true },
    { name: "Yannick Smith", pos: "WR", tgt: 5.6, cr: 0.6, ypr: 13.3, recTD: 0.38 },
    { name: "Jalen Cooper", pos: "WR", tgt: 2.4, cr: 0.6, ypr: 16.9, recTD: 0.15 },
    { name: "Randy Pittman Jr.", pos: "TE", tgt: 2.7, cr: 0.65, ypr: 9, recTD: 0.15 } ] },
  STAN: { abbr: "STAN", name: "Stanford", pace: 0.98, def: { pass: 1.15, run: 0.85, cb: 1.1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 32.6, cmp: 0.57, ypa: 6.81, pTD: 1.17, iNT: 1, rYd: 15.2, rTD: 0.13 },
    { name: "Micah Ford", pos: "RB", car: 12.1, ypc: 4.43, ruTD: 0.33, tgt: 1.3, cr: 0.72, ypr: 10.8, recTD: 0 },
    { name: "Sedrick Irvin", pos: "RB", car: 3.4, ypc: 2.88, ruTD: 0.08, tgt: 0.2, cr: 0.72, ypr: 6.5, recTD: 0 },
    { name: "Nico Brown", pos: "WR", tgt: 9.9, cr: 0.6, ypr: 15.3, recTD: 0.92, wr1: true },
    { name: "Caden High", pos: "WR", tgt: 5.1, cr: 0.6, ypr: 11.2, recTD: 0.08 },
    { name: "Marcus Brown", pos: "WR", tgt: 1.7, cr: 0.6, ypr: 7.2, recTD: 0.08 },
    { name: "Benji Blackburn", pos: "TE", tgt: 1.2, cr: 0.65, ypr: 12.1, recTD: 0.08 } ] },
  SYR: { abbr: "SYR", name: "Syracuse", pace: 1.05, def: { pass: 1.15, run: 1.15, cb: 1.1 }, players: [
    { name: "Amari Odom", pos: "QB", pAtt: 24.3, cmp: 0.65, ypa: 8.91, pTD: 1.58, iNT: 0.67, rYd: 28.9, rTD: 0.58 },
    { name: "Ahmad Miller", pos: "RB", car: 13.6, ypc: 6.35, ruTD: 0.42, tgt: 0.6, cr: 0.72, ypr: 5.2, recTD: 0 },
    { name: "Ju'Juan Johnson", pos: "RB", car: 3.4, ypc: 3.78, ruTD: 0.17, tgt: 2, cr: 0.72, ypr: 4.2, recTD: 0 },
    { name: "Justus Ross-Simmons", pos: "WR", tgt: 2.8, cr: 0.6, ypr: 15.6, recTD: 0.42, wr1: true },
    { name: "Tyshawn Russell", pos: "WR", tgt: 1.3, cr: 0.6, ypr: 9.2, recTD: 0 },
    { name: "Darius Johnson", pos: "WR", tgt: 0.8, cr: 0.6, ypr: 8, recTD: 0 },
    { name: "Noah Meyers", pos: "TE", tgt: 4.1, cr: 0.65, ypr: 11.2, recTD: 0.25 } ] },
  "TA&M": { abbr: "TA&M", name: "Texas A&M", pace: 1.04, def: { pass: 0.85, run: 0.87, cb: 0.9 }, players: [
    { name: "Marcel Reed", pos: "QB", pAtt: 29, cmp: 0.62, ypa: 8.41, pTD: 1.92, iNT: 0.92, rYd: 37.9, rTD: 0.46 },
    { name: "Rueben Owens II", pos: "RB", car: 9.2, ypc: 5.37, ruTD: 0.38, tgt: 1.4, cr: 0.72, ypr: 10, recTD: 0 },
    { name: "Jamarion Morrow", pos: "RB", car: 3.3, ypc: 4.23, ruTD: 0.08, tgt: 0.6, cr: 0.72, ypr: 13.3, recTD: 0.15 },
    { name: "Mario Craver", pos: "WR", tgt: 7.6, cr: 0.6, ypr: 15.5, recTD: 0.31, wr1: true },
    { name: "Isaiah Horton", pos: "WR", tgt: 5.4, cr: 0.6, ypr: 12.2, recTD: 0.62 },
    { name: "Ashton Bethel-Roman", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 21, recTD: 0.38 },
    { name: "Richie Anderson III", pos: "TE", tgt: 3.7, cr: 0.65, ypr: 9.7, recTD: 0.23 } ] },
  TCU: { abbr: "TCU", name: "TCU", pace: 1.03, def: { pass: 1.13, run: 0.89, cb: 1.06 }, players: [
    { name: "Jaden Craig", pos: "QB", pAtt: 26, cmp: 0.62, ypa: 8.49, pTD: 1.92, iNT: 0.54, rYd: 6, rTD: 0.23 },
    { name: "Jeremy Payne", pos: "RB", car: 8.5, ypc: 5.66, ruTD: 0.38, tgt: 2.4, cr: 0.72, ypr: 9.4, recTD: 0.15 },
    { name: "Jon Denman", pos: "RB", car: 3.8, ypc: 3.56, ruTD: 0.23, tgt: 0.3, cr: 0.72, ypr: 3, recTD: 0 },
    { name: "Jordan Dwyer", pos: "WR", tgt: 6.9, cr: 0.6, ypr: 13.5, recTD: 0.54, wr1: true },
    { name: "Jeremy Scott", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 17.4, recTD: 0.31 },
    { name: "Ed Small", pos: "WR", tgt: 2.1, cr: 0.6, ypr: 11.6, recTD: 0.15 } ] },
  TEM: { abbr: "TEM", name: "Temple", pace: 0.93, def: { pass: 0.92, run: 1.15, cb: 1.09 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 28.9, cmp: 0.62, ypa: 6.83, pTD: 2.33, iNT: 0.17, rYd: 26.5, rTD: 0.22 },
    { name: "Hunter Smith", pos: "RB", car: 5.2, ypc: 6.5, ruTD: 0.17, tgt: 0.7, cr: 0.72, ypr: 9, recTD: 0 },
    { name: "Keveun Mason", pos: "RB", car: 2.3, ypc: 5.96, ruTD: 0.08, tgt: 0.7, cr: 0.72, ypr: 5, recTD: 0 },
    { name: "Jayce Freeman", pos: "WR", tgt: 5.7, cr: 0.6, ypr: 18.9, recTD: 0.67, wr1: true },
    { name: "Colin Chase", pos: "WR", tgt: 5.6, cr: 0.6, ypr: 10.4, recTD: 0.33 },
    { name: "JoJo Bermudez", pos: "WR", tgt: 5.3, cr: 0.6, ypr: 13.2, recTD: 0.33 },
    { name: "Peter Clarke", pos: "TE", tgt: 3.8, cr: 0.65, ypr: 16.1, recTD: 0.5 } ] },
  TENN: { abbr: "TENN", name: "Tennessee", pace: 1.07, def: { pass: 1.12, run: 1.02, cb: 1.02 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 33.6, cmp: 0.67, ypa: 8.71, pTD: 2, iNT: 0.77, rYd: 31.2, rTD: 0.54 },
    { name: "DeSean Bishop", pos: "RB", car: 14, ypc: 5.91, ruTD: 1.23, tgt: 1.6, cr: 0.72, ypr: 9, recTD: 0 },
    { name: "Javin Gordon", pos: "RB", car: 9.8, ypc: 4.03, ruTD: 0.38, tgt: 1.4, cr: 0.72, ypr: 7.2, recTD: 0.08 },
    { name: "Braylon Staley", pos: "WR", tgt: 8.7, cr: 0.6, ypr: 12.3, recTD: 0.46, wr1: true },
    { name: "Mike Matthews", pos: "WR", tgt: 6.8, cr: 0.6, ypr: 15.3, recTD: 0.31 },
    { name: "Ian Duarte", pos: "WR", tgt: 5.9, cr: 0.6, ypr: 11.3, recTD: 0.23 },
    { name: "Ethan Davis", pos: "TE", tgt: 2.5, cr: 0.65, ypr: 12.2, recTD: 0.15 } ] },
  TEX: { abbr: "TEX", name: "Texas", pace: 0.97, def: { pass: 1.08, run: 0.85, cb: 0.93 }, players: [
    { name: "Arch Manning", pos: "QB", pAtt: 31.1, cmp: 0.61, ypa: 7.83, pTD: 2, iNT: 0.54, rYd: 30.7, rTD: 0.77 },
    { name: "Raleek Brown", pos: "RB", car: 14.3, ypc: 6.13, ruTD: 0.31, tgt: 3.6, cr: 0.72, ypr: 7, recTD: 0.15 },
    { name: "Hollywood Smothers", pos: "RB", car: 12.3, ypc: 5.87, ruTD: 0.46, tgt: 4, cr: 0.72, ypr: 5.1, recTD: 0.08 },
    { name: "Cam Coleman", pos: "WR", tgt: 7.2, cr: 0.6, ypr: 12.6, recTD: 0.38, wr1: true },
    { name: "Sterling Berkhalter", pos: "WR", tgt: 3.8, cr: 0.6, ypr: 13.9, recTD: 0.15 },
    { name: "Emmett Mosley V", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 14.6, recTD: 0.23 },
    { name: "Michael Masunas", pos: "TE", tgt: 2.2, cr: 0.65, ypr: 12.2, recTD: 0.23 } ] },
  TLSA: { abbr: "TLSA", name: "Tulsa", pace: 1.1, def: { pass: 0.99, run: 1.15, cb: 1.05 }, players: [
    { name: "Baylor Hayes", pos: "QB", pAtt: 26.3, cmp: 0.59, ypa: 6.83, pTD: 1, iNT: 0.5, rYd: 15.8, rTD: 0.25 },
    { name: "DJ McKinney", pos: "RB", car: 9.3, ypc: 4.18, ruTD: 0.58, tgt: 1.7, cr: 0.72, ypr: 10.7, recTD: 0 },
    { name: "Trequan Jones", pos: "RB", car: 8.8, ypc: 7.54, ruTD: 0.5, tgt: 0.7, cr: 0.72, ypr: 3.3, recTD: 0 },
    { name: "Javon Ross", pos: "WR", tgt: 7.2, cr: 0.6, ypr: 13.2, recTD: 0.33, wr1: true },
    { name: "Grayson Tempest", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 12.4, recTD: 0.08 },
    { name: "Josh Smith", pos: "WR", tgt: 1.3, cr: 0.6, ypr: 22.3, recTD: 0.08 } ] },
  TOL: { abbr: "TOL", name: "Toledo", pace: 1, def: { pass: 0.85, run: 0.85, cb: 0.9 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 30.7, cmp: 0.64, ypa: 7.76, pTD: 2.08, iNT: 0.77, rYd: 31.9, rTD: 0.34 },
    { name: "CJ Miller", pos: "RB", car: 12.9, ypc: 5.67, ruTD: 1.08, tgt: 2.8, cr: 0.72, ypr: 12.1, recTD: 0.23 },
    { name: "Corey Smith", pos: "RB", car: 1.1, ypc: 2.5, ruTD: 0, tgt: 0, cr: 0.72, ypr: 7, recTD: 0 },
    { name: "Rico Bond", pos: "WR", tgt: 7.7, cr: 0.6, ypr: 11.6, recTD: 0.46, wr1: true },
    { name: "Kalvin Gilbert Jr.", pos: "WR", tgt: 5.9, cr: 0.6, ypr: 14.2, recTD: 0.54 },
    { name: "Adjatay Dabbs", pos: "WR", tgt: 5.8, cr: 0.6, ypr: 19, recTD: 0.62 },
    { name: "Peyton Strickland", pos: "TE", tgt: 2.8, cr: 0.65, ypr: 9.4, recTD: 0.31 } ] },
  TROY: { abbr: "TROY", name: "Troy", pace: 0.99, def: { pass: 0.9, run: 1.15, cb: 1 }, players: [
    { name: "Tucker Kilcrease", pos: "QB", pAtt: 15.9, cmp: 0.59, ypa: 6.92, pTD: 0.64, iNT: 0.43, rYd: 9, rTD: 0.36 },
    { name: "Jordan Lovett", pos: "RB", car: 6.4, ypc: 3.81, ruTD: 0.14, tgt: 1.3, cr: 0.72, ypr: 6.6, recTD: 0 },
    { name: "TJ Lott", pos: "WR", tgt: 1, cr: 0.6, ypr: 10.5, recTD: 0.07, wr1: true },
    { name: "Mojo Dortch", pos: "WR", tgt: 0.8, cr: 0.6, ypr: 9, recTD: 0 } ] },
  TTU: { abbr: "TTU", name: "Texas Tech", pace: 1.1, def: { pass: 0.87, run: 0.85, cb: 0.9 }, players: [
    { name: "Thomas Castellanos", pos: "QB", pAtt: 22.1, cmp: 0.58, ypa: 8.93, pTD: 1.07, iNT: 0.64, rYd: 39.8, rTD: 0.64 },
    { name: "Cameron Dickey", pos: "RB", car: 14.9, ypc: 5.38, ruTD: 1, tgt: 2.5, cr: 0.72, ypr: 9, recTD: 0.14 },
    { name: "Jalen Jones", pos: "WR", tgt: 6.1, cr: 0.6, ypr: 22.9, recTD: 0.64, wr1: true },
    { name: "Coy Eakin", pos: "WR", tgt: 5.7, cr: 0.6, ypr: 13.3, recTD: 0.43 },
    { name: "Kenny Johnson", pos: "WR", tgt: 5.7, cr: 0.6, ypr: 14.5, recTD: 0.36 },
    { name: "Terrance Carter Jr.", pos: "TE", tgt: 6, cr: 0.65, ypr: 11.3, recTD: 0.36 } ] },
  TULN: { abbr: "TULN", name: "Tulane", pace: 1, def: { pass: 1.15, run: 0.85, cb: 1.08 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 30.4, cmp: 0.62, ypa: 8.08, pTD: 1.29, iNT: 0.64, rYd: 29.9, rTD: 0.37 },
    { name: "Jamauri McClure", pos: "RB", car: 5.9, ypc: 6.51, ruTD: 0.14, tgt: 0.3, cr: 0.72, ypr: 3, recTD: 0 },
    { name: "Jaylin Lucas", pos: "RB", car: 1.9, ypc: 5.93, ruTD: 0, tgt: 1.1, cr: 0.72, ypr: 8, recTD: 0 },
    { name: "Anthony Brown-Stephens", pos: "WR", tgt: 4.9, cr: 0.6, ypr: 12.8, recTD: 0.14, wr1: true },
    { name: "Zycarl Lewis Jr.", pos: "WR", tgt: 2.9, cr: 0.6, ypr: 13.8, recTD: 0.14 },
    { name: "Garrett Mmahat", pos: "WR", tgt: 1.2, cr: 0.6, ypr: 12.4, recTD: 0 },
    { name: "Dawson Johnson", pos: "TE", tgt: 1.1, cr: 0.65, ypr: 9.9, recTD: 0.07 } ] },
  TXST: { abbr: "TXST", name: "Texas St", pace: 1.06, def: { pass: 1, run: 1.1, cb: 1 }, players: [
    { name: "Brad Jackson", pos: "QB", pAtt: 27.1, cmp: 0.71, ypa: 9.16, pTD: 1.62, iNT: 0.54, rYd: 57.2, rTD: 1.31 },
    { name: "Jaylen Jenkins", pos: "RB", car: 2.4, ypc: 5.48, ruTD: 0.15, tgt: 0.1, cr: 0.72, ypr: 5, recTD: 0 },
    { name: "Torrance Burgess Jr.", pos: "RB", car: 1.5, ypc: 4.75, ruTD: 0.08, tgt: 0, cr: 0.72, ypr: 7, recTD: 0 },
    { name: "Beau Sparks", pos: "WR", tgt: 10.8, cr: 0.6, ypr: 14.3, recTD: 0.77, wr1: true },
    { name: "Chris Dawn Jr.", pos: "WR", tgt: 8.3, cr: 0.6, ypr: 15.5, recTD: 0.31 },
    { name: "Kylen Evans", pos: "WR", tgt: 1.9, cr: 0.6, ypr: 14.1, recTD: 0.08 },
    { name: "Blake Smith", pos: "TE", tgt: 1.2, cr: 0.65, ypr: 10.5, recTD: 0 } ] },
  UAB: { abbr: "UAB", name: "UAB", pace: 1.04, def: { pass: 1.07, run: 1.15, cb: 1.1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 36.4, cmp: 0.66, ypa: 7.29, pTD: 1.67, iNT: 1.25, rYd: 25, rTD: 0.33 },
    { name: "Ja'Vin Simpkins", pos: "RB", car: 10.4, ypc: 4.73, ruTD: 0.17, tgt: 2, cr: 0.72, ypr: 4.4, recTD: 0 },
    { name: "Bam McReynolds", pos: "RB", car: 10.3, ypc: 5.18, ruTD: 0.25, tgt: 1.9, cr: 0.72, ypr: 5.6, recTD: 0.08 },
    { name: "Kaleb Brown", pos: "WR", tgt: 2.4, cr: 0.6, ypr: 15, recTD: 0.17, wr1: true },
    { name: "Antonio Ferguson", pos: "TE", tgt: 1.3, cr: 0.65, ypr: 11.5, recTD: 0 } ] },
  UCF: { abbr: "UCF", name: "UCF", pace: 0.99, def: { pass: 0.85, run: 1, cb: 0.94 }, players: [
    { name: "Alonza Barnett III", pos: "QB", pAtt: 30.8, cmp: 0.58, ypa: 7.58, pTD: 1.92, iNT: 0.67, rYd: 49.1, rTD: 1.25 },
    { name: "Landen Chambers", pos: "RB", car: 20.2, ypc: 5.26, ruTD: 0.83, tgt: 3.1, cr: 0.72, ypr: 8.8, recTD: 0 },
    { name: "Agyeman Addae", pos: "RB", car: 1, ypc: 4.17, ruTD: 0, tgt: 0.8, cr: 0.72, ypr: 10, recTD: 0.08 },
    { name: "Josh Derry", pos: "WR", tgt: 10.1, cr: 0.6, ypr: 15.1, recTD: 1.08, wr1: true },
    { name: "Jonathan Bibbs", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 14.7, recTD: 0.25 },
    { name: "Waden Charles", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 11.2, recTD: 0 },
    { name: "Grayson Brousseau", pos: "TE", tgt: 0.9, cr: 0.65, ypr: 6.4, recTD: 0 } ] },
  UCLA: { abbr: "UCLA", name: "UCLA", pace: 0.92, def: { pass: 0.9, run: 1.15, cb: 1.02 }, players: [
    { name: "Nico Iamaleava", pos: "QB", pAtt: 26.9, cmp: 0.64, ypa: 5.97, pTD: 1.08, iNT: 0.58, rYd: 42.1, rTD: 0.33 },
    { name: "Wayne Knight", pos: "RB", car: 17.3, ypc: 6.63, ruTD: 0.75, tgt: 4.6, cr: 0.72, ypr: 9.9, recTD: 0.08 },
    { name: "Dylan Lee", pos: "RB", car: 2.1, ypc: 4.68, ruTD: 0.08, tgt: 0.1, cr: 0.72, ypr: 7, recTD: 0 },
    { name: "Landon Ellis", pos: "WR", tgt: 5, cr: 0.6, ypr: 17.3, recTD: 0.42, wr1: true },
    { name: "Mikey Matthews", pos: "WR", tgt: 4.6, cr: 0.6, ypr: 10.5, recTD: 0.17 },
    { name: "Semaj Morgan", pos: "WR", tgt: 2.8, cr: 0.6, ypr: 11.2, recTD: 0.08 },
    { name: "Brayden Loftin", pos: "TE", tgt: 0.8, cr: 0.65, ypr: 9.2, recTD: 0 } ] },
  UGA: { abbr: "UGA", name: "Georgia", pace: 1.06, def: { pass: 1, run: 0.85, cb: 0.93 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 29.8, cmp: 0.69, ypa: 7.39, pTD: 1.79, iNT: 0.5, rYd: 32.8, rTD: 0.44 },
    { name: "Nate Frazier", pos: "RB", car: 12.4, ypc: 5.47, ruTD: 0.43, tgt: 1.6, cr: 0.72, ypr: 7.3, recTD: 0.07 },
    { name: "Dante Dowdell", pos: "RB", car: 8, ypc: 5, ruTD: 0.21, tgt: 0.7, cr: 0.72, ypr: 4.3, recTD: 0 },
    { name: "Isiah Canion", pos: "WR", tgt: 3.9, cr: 0.6, ypr: 14.5, recTD: 0.29, wr1: true },
    { name: "London Humphreys", pos: "WR", tgt: 2.1, cr: 0.6, ypr: 15.3, recTD: 0.21 },
    { name: "Lawson Luckie", pos: "TE", tgt: 1.6, cr: 0.65, ypr: 10.5, recTD: 0.29 } ] },
  UK: { abbr: "UK", name: "Kentucky", pace: 1, def: { pass: 1.1, run: 0.89, cb: 1.1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 30.7, cmp: 0.62, ypa: 6.58, pTD: 1.25, iNT: 1.17, rYd: 25, rTD: 0.32 },
    { name: "Jason Patterson", pos: "RB", car: 4.8, ypc: 3.95, ruTD: 0.08, tgt: 2, cr: 0.72, ypr: 5, recTD: 0.08 },
    { name: "CJ Baxter", pos: "RB", car: 4.5, ypc: 3.63, ruTD: 0, tgt: 1.4, cr: 0.72, ypr: 3.4, recTD: 0.08 },
    { name: "Shane Carr", pos: "WR", tgt: 6.9, cr: 0.6, ypr: 14.9, recTD: 0.33, wr1: true },
    { name: "Xavier Daisy", pos: "WR", tgt: 2.5, cr: 0.6, ypr: 9.8, recTD: 0.08 },
    { name: "DJ Miller", pos: "WR", tgt: 1.8, cr: 0.6, ypr: 13.5, recTD: 0.17 },
    { name: "Willie Rodriguez", pos: "TE", tgt: 2.9, cr: 0.65, ypr: 13.5, recTD: 0.08 } ] },
  UL: { abbr: "UL", name: "Louisiana", pace: 0.99, def: { pass: 1.03, run: 1.15, cb: 1.09 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 26.4, cmp: 0.55, ypa: 6.14, pTD: 0.92, iNT: 1.08, rYd: 33, rTD: 0.4 },
    { name: "Anthony Reagan Jr.", pos: "RB", car: 9.4, ypc: 5.5, ruTD: 0.69, tgt: 2.6, cr: 0.72, ypr: 8.4, recTD: 0.08 },
    { name: "Steven Blanco", pos: "RB", car: 2.3, ypc: 5.2, ruTD: 0.15, tgt: 0.1, cr: 0.72, ypr: 16, recTD: 0 },
    { name: "Shelton Sampson Jr.", pos: "WR", tgt: 4.1, cr: 0.6, ypr: 16.8, recTD: 0.46, wr1: true },
    { name: "Landon Strother", pos: "WR", tgt: 1.3, cr: 0.6, ypr: 7.8, recTD: 0 },
    { name: "Jaydon Johnson", pos: "WR", tgt: 0.8, cr: 0.6, ypr: 8.5, recTD: 0 },
    { name: "Caden Jensen", pos: "TE", tgt: 3.4, cr: 0.65, ypr: 8, recTD: 0.08 } ] },
  ULM: { abbr: "ULM", name: "UL Monroe", pace: 0.91, def: { pass: 1.02, run: 1.08, cb: 1.06 }, players: [
    { name: "Aidan Armenta", pos: "QB", pAtt: 21.1, cmp: 0.58, ypa: 6.44, pTD: 1, iNT: 0.67, rYd: 4.8, rTD: 0.17 },
    { name: "Nic Trujillo", pos: "WR", tgt: 3.2, cr: 0.6, ypr: 16, recTD: 0.33, wr1: true },
    { name: "JP Coulter", pos: "WR", tgt: 2.9, cr: 0.6, ypr: 11.1, recTD: 0 },
    { name: "Cade Callahan", pos: "TE", tgt: 2.4, cr: 0.65, ypr: 14.7, recTD: 0.25 } ] },
  UNC: { abbr: "UNC", name: "North Carolina", pace: 0.9, def: { pass: 0.97, run: 0.85, cb: 0.93 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 29.6, cmp: 0.64, ypa: 6.2, pTD: 1.08, iNT: 0.5, rYd: 18.9, rTD: 0.18 },
    { name: "Demon June", pos: "RB", car: 7, ypc: 5.52, ruTD: 0.17, tgt: 2, cr: 0.72, ypr: 9.4, recTD: 0.08 },
    { name: "Benjamin Hall", pos: "RB", car: 5.9, ypc: 3.86, ruTD: 0.17, tgt: 0.9, cr: 0.72, ypr: 4.3, recTD: 0 },
    { name: "Jordan Shipp", pos: "WR", tgt: 8.3, cr: 0.6, ypr: 11.2, recTD: 0.5, wr1: true },
    { name: "Mason Humphrey", pos: "WR", tgt: 4.9, cr: 0.6, ypr: 18.6, recTD: 0.33 },
    { name: "Trech Kekahuna", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 8.1, recTD: 0 },
    { name: "Jelani Thurman", pos: "TE", tgt: 0.9, cr: 0.65, ypr: 12, recTD: 0.08 } ] },
  UNLV: { abbr: "UNLV", name: "UNLV", pace: 0.98, def: { pass: 1.11, run: 1.15, cb: 1.08 }, players: [
    { name: "Jackson Arnold", pos: "QB", pAtt: 15.4, cmp: 0.63, ypa: 6.09, pTD: 0.43, iNT: 0.14, rYd: 22.2, rTD: 0.57 },
    { name: "Jai'Den Thomas", pos: "RB", car: 10.6, ypc: 7, ruTD: 0.86, tgt: 3.9, cr: 0.72, ypr: 6.1, recTD: 0.07 },
    { name: "Jaylon Glover", pos: "RB", car: 4.6, ypc: 6, ruTD: 0.07, tgt: 0.6, cr: 0.72, ypr: 8.5, recTD: 0 },
    { name: "Taz Reddicks", pos: "WR", tgt: 3.6, cr: 0.6, ypr: 13, recTD: 0, wr1: true },
    { name: "DeAngelo Irvin Jr.", pos: "WR", tgt: 2.1, cr: 0.6, ypr: 10.4, recTD: 0.07 },
    { name: "Taeshaun Lyons", pos: "WR", tgt: 1.9, cr: 0.6, ypr: 15.1, recTD: 0.21 } ] },
  UNM: { abbr: "UNM", name: "New Mexico", pace: 0.94, def: { pass: 1.05, run: 0.85, cb: 1.02 }, players: [
    { name: "Jack Layne", pos: "QB", pAtt: 25.2, cmp: 0.65, ypa: 7.6, pTD: 1, iNT: 0.77, rYd: 11.7, rTD: 0.31 },
    { name: "Scottre Humphrey", pos: "RB", car: 5.9, ypc: 4.53, ruTD: 0.38, tgt: 0.3, cr: 0.72, ypr: 7.3, recTD: 0.08 },
    { name: "Kiefer Sibley", pos: "RB", car: 3.5, ypc: 6.09, ruTD: 0.38, tgt: 0.3, cr: 0.72, ypr: 11.3, recTD: 0 },
    { name: "Troy Omeire", pos: "WR", tgt: 4, cr: 0.6, ypr: 16.6, recTD: 0.38, wr1: true },
    { name: "Shawn Miller", pos: "WR", tgt: 1.9, cr: 0.6, ypr: 13.3, recTD: 0.08 },
    { name: "Zhaiel Smith", pos: "WR", tgt: 1, cr: 0.6, ypr: 14, recTD: 0 },
    { name: "Cade Keith", pos: "TE", tgt: 2.4, cr: 0.65, ypr: 12.7, recTD: 0.23 } ] },
  UNT: { abbr: "UNT", name: "North Texas", pace: 1.06, def: { pass: 0.85, run: 1.15, cb: 0.9 }, players: [
    { name: "Tayven Jackson", pos: "QB", pAtt: 22.5, cmp: 0.63, ypa: 6.83, pTD: 0.71, iNT: 0.57, rYd: 6.1, rTD: 0.21 },
    { name: "Nick Osho", pos: "RB", car: 8.5, ypc: 5.76, ruTD: 0.57, tgt: 1, cr: 0.72, ypr: 4.2, recTD: 0.07 },
    { name: "Jahiem White", pos: "RB", car: 1.7, ypc: 5.54, ruTD: 0.21, tgt: 0.3, cr: 0.72, ypr: 5, recTD: 0 },
    { name: "James Tyre", pos: "WR", tgt: 8.1, cr: 0.6, ypr: 12.2, recTD: 0.79, wr1: true },
    { name: "Grayson O'Bara", pos: "WR", tgt: 5.2, cr: 0.6, ypr: 13.4, recTD: 0.14 },
    { name: "Corri Milliner", pos: "WR", tgt: 2.9, cr: 0.6, ypr: 14.2, recTD: 0.21 } ] },
  USA: { abbr: "USA", name: "South Alabama", pace: 1.05, def: { pass: 0.94, run: 1.15, cb: 1.02 }, players: [
    { name: "Bishop Davenport", pos: "QB", pAtt: 24.5, cmp: 0.68, ypa: 7.05, pTD: 1, iNT: 0.5, rYd: 27.1, rTD: 0.75 },
    { name: "Keenan Phillips", pos: "RB", car: 10.5, ypc: 4.8, ruTD: 0.25, tgt: 1.2, cr: 0.72, ypr: 5.8, recTD: 0 },
    { name: "PJ Martin", pos: "RB", car: 5, ypc: 5.43, ruTD: 0.17, tgt: 0.6, cr: 0.72, ypr: 9.8, recTD: 0 },
    { name: "Anthony Eager", pos: "WR", tgt: 5.6, cr: 0.6, ypr: 8.5, recTD: 0.08, wr1: true },
    { name: "Brendan Jenkins", pos: "WR", tgt: 1.3, cr: 0.6, ypr: 13, recTD: 0.08 },
    { name: "Everett Hunter", pos: "TE", tgt: 3.1, cr: 0.65, ypr: 11.8, recTD: 0.25 } ] },
  USC: { abbr: "USC", name: "USC", pace: 0.97, def: { pass: 0.95, run: 0.95, cb: 0.97 }, players: [
    { name: "Jayden Maiava", pos: "QB", pAtt: 31, cmp: 0.66, ypa: 9.21, pTD: 1.85, iNT: 0.77, rYd: 12.1, rTD: 0.46 },
    { name: "King Miller", pos: "RB", car: 12, ypc: 6.23, ruTD: 0.62, tgt: 1.7, cr: 0.72, ypr: 6.9, recTD: 0 },
    { name: "Waymond Jordan", pos: "RB", car: 6.8, ypc: 6.55, ruTD: 0.38, tgt: 0.7, cr: 0.72, ypr: 7.9, recTD: 0 },
    { name: "Terrell Anderson", pos: "WR", tgt: 5, cr: 0.6, ypr: 16.1, recTD: 0.38, wr1: true },
    { name: "Tanook Hines", pos: "WR", tgt: 4.4, cr: 0.6, ypr: 16.5, recTD: 0.15 } ] },
  USF: { abbr: "USF", name: "South Florida", pace: 1.05, def: { pass: 1.12, run: 0.96, cb: 0.93 }, players: [
    { name: "KJ Cooper", pos: "QB", pAtt: 19.7, cmp: 0.61, ypa: 6.29, pTD: 1, iNT: 0.46, rYd: 20.9, rTD: 0.23 },
    { name: "D.J. Crowther", pos: "RB", car: 14.7, ypc: 4.86, ruTD: 0.77, tgt: 1.7, cr: 0.72, ypr: 7.5, recTD: 0 },
    { name: "Jason Collins Jr.", pos: "RB", car: 8.2, ypc: 3.94, ruTD: 0.46, tgt: 1.5, cr: 0.72, ypr: 4.4, recTD: 0 },
    { name: "Kenny Odom", pos: "WR", tgt: 7.9, cr: 0.6, ypr: 9.4, recTD: 0.46, wr1: true },
    { name: "Mudia Reuben", pos: "WR", tgt: 4.6, cr: 0.6, ypr: 13.8, recTD: 0.38 },
    { name: "Cameron Seldon", pos: "WR", tgt: 2.9, cr: 0.6, ypr: 7.2, recTD: 0.15 },
    { name: "Wyatt Sullivan", pos: "TE", tgt: 2.1, cr: 0.65, ypr: 9.8, recTD: 0.15 } ] },
  USM: { abbr: "USM", name: "Southern Miss", pace: 1.06, def: { pass: 1.05, run: 1.15, cb: 0.98 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 34.9, cmp: 0.64, ypa: 7.62, pTD: 2, iNT: 0.85, rYd: 24.5, rTD: 0.28 },
    { name: "Brandon Hood", pos: "RB", car: 7.5, ypc: 3.76, ruTD: 0.15, tgt: 1.2, cr: 0.72, ypr: 8, recTD: 0 },
    { name: "Robert Briggs", pos: "RB", car: 4.8, ypc: 4.9, ruTD: 0.08, tgt: 1.4, cr: 0.72, ypr: 7.3, recTD: 0.08 },
    { name: "AJ Little", pos: "WR", tgt: 3.5, cr: 0.6, ypr: 12.8, recTD: 0.08, wr1: true },
    { name: "Preston Kilgore", pos: "TE", tgt: 0.8, cr: 0.65, ypr: 6.9, recTD: 0 } ] },
  USU: { abbr: "USU", name: "Utah State", pace: 0.98, def: { pass: 1.15, run: 1.15, cb: 0.99 }, players: [
    { name: "Bryson Barnes", pos: "QB", pAtt: 27.4, cmp: 0.59, ypa: 7.87, pTD: 1.38, iNT: 0.38, rYd: 56.9, rTD: 0.77 },
    { name: "Javen Jacobs", pos: "RB", car: 5, ypc: 6.6, ruTD: 0.38, tgt: 4.6, cr: 0.72, ypr: 8.8, recTD: 0.23 },
    { name: "Anthony Garcia", pos: "WR", tgt: 2.6, cr: 0.6, ypr: 17.4, recTD: 0.15, wr1: true },
    { name: "Kahanu Davis", pos: "WR", tgt: 0.8, cr: 0.6, ypr: 24, recTD: 0.08 },
    { name: "Broc Lane", pos: "TE", tgt: 2.2, cr: 0.65, ypr: 11.5, recTD: 0.15 } ] },
  UTAH: { abbr: "UTAH", name: "Utah", pace: 1.09, def: { pass: 0.85, run: 1.15, cb: 0.9 }, players: [
    { name: "Devon Dampier", pos: "QB", pAtt: 25.7, cmp: 0.63, ypa: 7.46, pTD: 1.85, iNT: 0.38, rYd: 64.2, rTD: 0.77 },
    { name: "Wayshawn Parker", pos: "RB", car: 11.5, ypc: 6.58, ruTD: 0.46, tgt: 1.4, cr: 0.72, ypr: 14.2, recTD: 0.23 },
    { name: "Steve Chavez-Soto", pos: "RB", car: 6.7, ypc: 5.15, ruTD: 0.54, tgt: 0.3, cr: 0.72, ypr: 5, recTD: 0 },
    { name: "Braden Pegan", pos: "WR", tgt: 7.7, cr: 0.6, ypr: 15.4, recTD: 0.38, wr1: true },
    { name: "Kyri Shoels", pos: "WR", tgt: 7.6, cr: 0.6, ypr: 13, recTD: 0.15 },
    { name: "Larry Simmons", pos: "WR", tgt: 1.9, cr: 0.6, ypr: 18.7, recTD: 0.46 },
    { name: "Noah Bennee", pos: "TE", tgt: 2.7, cr: 0.65, ypr: 11.5, recTD: 0 } ] },
  UTEP: { abbr: "UTEP", name: "UTEP", pace: 0.98, def: { pass: 1.02, run: 1.13, cb: 0.99 }, players: [
    { name: "EJ Colson Jr.", pos: "QB", pAtt: 24.7, cmp: 0.71, ypa: 7.24, pTD: 1.33, iNT: 0.33, rYd: 23.9, rTD: 0.25 },
    { name: "Lamar Sperling", pos: "RB", car: 3.3, ypc: 6, ruTD: 0.08, tgt: 0.3, cr: 0.72, ypr: 4, recTD: 0 },
    { name: "Kam Thomas", pos: "RB", car: 1.3, ypc: 2.5, ruTD: 0, tgt: 0.5, cr: 0.72, ypr: 6.5, recTD: 0 },
    { name: "Carver Cheeks", pos: "WR", tgt: 9.9, cr: 0.6, ypr: 13.1, recTD: 0.5, wr1: true },
    { name: "Jaylan Brown", pos: "WR", tgt: 1.4, cr: 0.6, ypr: 10.3, recTD: 0 },
    { name: "Royal Capell", pos: "WR", tgt: 1.4, cr: 0.6, ypr: 4.7, recTD: 0 } ] },
  UTSA: { abbr: "UTSA", name: "UTSA", pace: 1.03, def: { pass: 1.02, run: 1, cb: 1.04 }, players: [
    { name: "Owen McCown", pos: "QB", pAtt: 31.5, cmp: 0.68, ypa: 7.3, pTD: 2.31, iNT: 0.54, rYd: 1.8, rTD: 0.08 },
    { name: "Will Henderson III", pos: "RB", car: 9.6, ypc: 6.93, ruTD: 0.46, tgt: 2, cr: 0.72, ypr: 6.9, recTD: 0.15 },
    { name: "A'Marion Peterson", pos: "RB", car: 3.8, ypc: 3.61, ruTD: 0.23, tgt: 0.2, cr: 0.72, ypr: 3.5, recTD: 0 },
    { name: "David Amador II", pos: "WR", tgt: 5.8, cr: 0.6, ypr: 9.8, recTD: 0.31, wr1: true },
    { name: "DJ Allen Jr.", pos: "WR", tgt: 2.6, cr: 0.6, ypr: 9.5, recTD: 0.23 },
    { name: "Jamel Hardy Jr.", pos: "WR", tgt: 1.7, cr: 0.6, ypr: 10.2, recTD: 0.08 },
    { name: "Miles Campbell", pos: "TE", tgt: 2.7, cr: 0.65, ypr: 14.3, recTD: 0.15 } ] },
  UVA: { abbr: "UVA", name: "Virginia", pace: 1.1, def: { pass: 0.9, run: 0.85, cb: 0.94 }, players: [
    { name: "Beau Pribula", pos: "QB", pAtt: 19.3, cmp: 0.67, ypa: 7.19, pTD: 0.79, iNT: 0.64, rYd: 21.2, rTD: 0.43 },
    { name: "Jekail Middlebrook", pos: "RB", car: 10, ypc: 5.37, ruTD: 0.29, tgt: 4, cr: 0.72, ypr: 10.3, recTD: 0.21 },
    { name: "Solomon Beebe", pos: "RB", car: 4, ypc: 6.04, ruTD: 0.43, tgt: 3.1, cr: 0.72, ypr: 9.2, recTD: 0 },
    { name: "Jacquon Gibson", pos: "WR", tgt: 7.5, cr: 0.6, ypr: 9.8, recTD: 0, wr1: true },
    { name: "Da'Shawn Martin", pos: "WR", tgt: 3.9, cr: 0.6, ypr: 15.4, recTD: 0.29 },
    { name: "Rico Flores Jr.", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 10.5, recTD: 0 },
    { name: "John Rogers", pos: "TE", tgt: 1, cr: 0.65, ypr: 11.2, recTD: 0.07 } ] },
  VAN: { abbr: "VAN", name: "Vanderbilt", pace: 0.93, def: { pass: 1.15, run: 0.85, cb: 1 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 30.8, cmp: 0.7, ypa: 9.34, pTD: 2.31, iNT: 0.62, rYd: 31.6, rTD: 0.54 },
    { name: "Sedrick Alexander", pos: "RB", car: 8.1, ypc: 5.4, ruTD: 0.85, tgt: 2, cr: 0.72, ypr: 10.5, recTD: 0.31 },
    { name: "Junior Sherrill", pos: "WR", tgt: 6.9, cr: 0.6, ypr: 14.5, recTD: 0.54, wr1: true },
    { name: "Tristen Brown", pos: "WR", tgt: 1.3, cr: 0.6, ypr: 13.7, recTD: 0 },
    { name: "Kayleb Barnett", pos: "WR", tgt: 0.8, cr: 0.6, ypr: 8.8, recTD: 0.08 },
    { name: "Jayvontay Conner", pos: "TE", tgt: 2.7, cr: 0.65, ypr: 14.5, recTD: 0.23 } ] },
  VT: { abbr: "VT", name: "Virginia Tech", pace: 0.95, def: { pass: 1.03, run: 1.02, cb: 1.1 }, players: [
    { name: "Ethan Grunkemeyer", pos: "QB", pAtt: 14.8, cmp: 0.69, ypa: 7.52, pTD: 0.67, iNT: 0.33, rYd: -3.8, rTD: 0.08 },
    { name: "Bill Davis", pos: "RB", car: 13.2, ypc: 4.85, ruTD: 0.5, tgt: 1.2, cr: 0.72, ypr: 7.9, recTD: 0 },
    { name: "Marcellous Hawkins Jr.", pos: "RB", car: 9.8, ypc: 6.35, ruTD: 0.08, tgt: 1.4, cr: 0.72, ypr: 6.2, recTD: 0.08 },
    { name: "Que'Sean Brown", pos: "WR", tgt: 8.9, cr: 0.6, ypr: 13.2, recTD: 0.42, wr1: true },
    { name: "Ayden Greene", pos: "WR", tgt: 4.3, cr: 0.6, ypr: 16.6, recTD: 0.25 },
    { name: "Takye Heath", pos: "WR", tgt: 3.1, cr: 0.6, ypr: 9.1, recTD: 0.25 },
    { name: "Luke Reynolds", pos: "TE", tgt: 3.3, cr: 0.65, ypr: 9.9, recTD: 0 } ] },
  WAKE: { abbr: "WAKE", name: "Wake Forest", pace: 0.99, def: { pass: 0.95, run: 0.85, cb: 0.9 }, players: [
    { name: "Gio Lopez", pos: "QB", pAtt: 20.1, cmp: 0.65, ypa: 6.69, pTD: 0.77, iNT: 0.38, rYd: 10.2, rTD: 0.23 },
    { name: "Sawyer Seidl", pos: "RB", car: 14.5, ypc: 4.77, ruTD: 1, tgt: 2, cr: 0.72, ypr: 9.3, recTD: 0.31 },
    { name: "Ty Clark III", pos: "RB", car: 5.8, ypc: 4.31, ruTD: 0.23, tgt: 1.8, cr: 0.72, ypr: 12.3, recTD: 0.08 },
    { name: "Carlos Hernandez", pos: "WR", tgt: 5.1, cr: 0.6, ypr: 15.3, recTD: 0.23, wr1: true },
    { name: "Drayden Dickmann", pos: "WR", tgt: 4.7, cr: 0.6, ypr: 8.7, recTD: 0.23 },
    { name: "Wondame Davis Jr.", pos: "WR", tgt: 3.3, cr: 0.6, ypr: 23.5, recTD: 0.46 },
    { name: "Kamrean Johnson", pos: "TE", tgt: 1.3, cr: 0.65, ypr: 11.1, recTD: 0.08 } ] },
  WASH: { abbr: "WASH", name: "Washington", pace: 0.96, def: { pass: 0.97, run: 0.85, cb: 0.9 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 28.5, cmp: 0.69, ypa: 8.59, pTD: 2, iNT: 0.62, rYd: 29.8, rTD: 0.46 },
    { name: "Jayden Limar", pos: "RB", car: 3.5, ypc: 5.7, ruTD: 0.23, tgt: 1.2, cr: 0.72, ypr: 6.8, recTD: 0 },
    { name: "Jordan Washington", pos: "RB", car: 2.1, ypc: 8, ruTD: 0.08, tgt: 0, cr: 0.72, ypr: 7, recTD: 0 },
    { name: "Christian Moss", pos: "WR", tgt: 5.8, cr: 0.6, ypr: 15.3, recTD: 0.15, wr1: true },
    { name: "Dezmen Roebuck", pos: "WR", tgt: 5.4, cr: 0.6, ypr: 13.3, recTD: 0.54 },
    { name: "Chris Lawson", pos: "WR", tgt: 1.3, cr: 0.6, ypr: 11.5, recTD: 0 },
    { name: "Decker DeGraaf", pos: "TE", tgt: 3.8, cr: 0.65, ypr: 11.3, recTD: 0.15 } ] },
  WIS: { abbr: "WIS", name: "Wisconsin", pace: 0.9, def: { pass: 1, run: 0.85, cb: 1.08 }, players: [
    { name: "Colton Joseph", pos: "QB", pAtt: 24.2, cmp: 0.6, ypa: 9.05, pTD: 1.75, iNT: 0.83, rYd: 83.9, rTD: 1.08 },
    { name: "Abu Sama III", pos: "RB", car: 11.7, ypc: 5.23, ruTD: 0.42, tgt: 0.6, cr: 0.72, ypr: 3.8, recTD: 0 },
    { name: "Darrion Dupree", pos: "RB", car: 6.9, ypc: 4.37, ruTD: 0.17, tgt: 0.8, cr: 0.72, ypr: 4, recTD: 0 },
    { name: "Jaylon Domingeaux", pos: "WR", tgt: 7.2, cr: 0.6, ypr: 16.5, recTD: 0.92, wr1: true },
    { name: "Shamar Rigby", pos: "WR", tgt: 3.5, cr: 0.6, ypr: 14, recTD: 0.08 },
    { name: "Chris Brooks Jr.", pos: "WR", tgt: 1.5, cr: 0.6, ypr: 11.3, recTD: 0 },
    { name: "Jacob Harris", pos: "TE", tgt: 2.4, cr: 0.65, ypr: 9.6, recTD: 0.42 } ] },
  WKU: { abbr: "WKU", name: "Western KY", pace: 1.04, def: { pass: 1.03, run: 1.15, cb: 0.9 }, players: [
    { name: "Team QB", pos: "QB", pAtt: 38.1, cmp: 0.66, ypa: 7.15, pTD: 1.62, iNT: 1, rYd: 24.2, rTD: 0.35 },
    { name: "Sincere Baines", pos: "RB", car: 9.5, ypc: 5.78, ruTD: 0.23, tgt: 1.4, cr: 0.72, ypr: 3.5, recTD: 0.08 },
    { name: "Ajay Allen", pos: "RB", car: 7.5, ypc: 5.1, ruTD: 0.38, tgt: 1.1, cr: 0.72, ypr: 9.8, recTD: 0 },
    { name: "Jyziah Rockwell", pos: "WR", tgt: 9.2, cr: 0.6, ypr: 15.7, recTD: 0.54, wr1: true },
    { name: "K.D. Hutchinson", pos: "WR", tgt: 8.5, cr: 0.6, ypr: 9.4, recTD: 0.23 },
    { name: "Moussa Barry", pos: "WR", tgt: 4.4, cr: 0.6, ypr: 14.4, recTD: 0.08 } ] },
  WMU: { abbr: "WMU", name: "W Michigan", pace: 0.99, def: { pass: 0.85, run: 0.85, cb: 0.91 }, players: [
    { name: "Broc Lowry", pos: "QB", pAtt: 18.7, cmp: 0.63, ypa: 6.88, pTD: 0.64, iNT: 0.21, rYd: 68.8, rTD: 1 },
    { name: "Jalen Buckley", pos: "RB", car: 12.8, ypc: 5.6, ruTD: 0.64, tgt: 1.2, cr: 0.72, ypr: 6.3, recTD: 0.07 },
    { name: "Lolo Mataele", pos: "RB", car: 4.1, ypc: 4.42, ruTD: 0.21, tgt: 0.5, cr: 0.72, ypr: 3, recTD: 0 },
    { name: "Baylin Brooks", pos: "WR", tgt: 3.2, cr: 0.6, ypr: 13.8, recTD: 0, wr1: true },
    { name: "Aveion Chenault", pos: "WR", tgt: 2.7, cr: 0.6, ypr: 12, recTD: 0.14 },
    { name: "Nate Levicki", pos: "TE", tgt: 3.6, cr: 0.65, ypr: 14.5, recTD: 0.43 } ] },
  WSU: { abbr: "WSU", name: "Washington St", pace: 0.98, def: { pass: 0.85, run: 0.85, cb: 0.91 }, players: [
    { name: "Caden Pinnick", pos: "QB", pAtt: 26.5, cmp: 0.7, ypa: 9.29, pTD: 2.46, iNT: 0.77, rYd: 33.6, rTD: 0.23 },
    { name: "Kirby Vorhees", pos: "RB", car: 10.6, ypc: 4.17, ruTD: 0.38, tgt: 2, cr: 0.72, ypr: 6.6, recTD: 0 },
    { name: "Leo Pulalasi", pos: "RB", car: 2.9, ypc: 5.39, ruTD: 0, tgt: 1.3, cr: 0.72, ypr: 6.4, recTD: 0 },
    { name: "Tony Freeman", pos: "WR", tgt: 6.9, cr: 0.6, ypr: 10.9, recTD: 0.23, wr1: true },
    { name: "Jordan Dees", pos: "WR", tgt: 4.6, cr: 0.6, ypr: 14.1, recTD: 0.23 },
    { name: "Trey Leckner", pos: "TE", tgt: 2.8, cr: 0.65, ypr: 7.8, recTD: 0.23 } ] },
  WVU: { abbr: "WVU", name: "West Virginia", pace: 1.06, def: { pass: 1.15, run: 0.96, cb: 1.1 }, players: [
    { name: "Scotty Fox Jr.", pos: "QB", pAtt: 14.2, cmp: 0.59, ypa: 7.51, pTD: 0.58, iNT: 0.5, rYd: 16.8, rTD: 0.25 },
    { name: "Cam Cook", pos: "RB", car: 24.6, ypc: 5.62, ruTD: 1.33, tgt: 3.5, cr: 0.72, ypr: 9.5, recTD: 0 },
    { name: "DJ Epps", pos: "WR", tgt: 6.5, cr: 0.6, ypr: 10.9, recTD: 0.42, wr1: true },
    { name: "John Neider", pos: "WR", tgt: 3.8, cr: 0.6, ypr: 15.6, recTD: 0.17 },
    { name: "Jaden Bray", pos: "WR", tgt: 1, cr: 0.6, ypr: 13.6, recTD: 0 },
    { name: "Josh Sapp", pos: "TE", tgt: 1.4, cr: 0.65, ypr: 13.6, recTD: 0 } ] },
  WYO: { abbr: "WYO", name: "Wyoming", pace: 0.97, def: { pass: 0.85, run: 1.12, cb: 0.9 }, players: [
    { name: "Tyler Hughes", pos: "QB", pAtt: 25.7, cmp: 0.66, ypa: 7.56, pTD: 1.67, iNT: 0.25, rYd: 55.8, rTD: 0.92 },
    { name: "Markell Holman", pos: "RB", car: 19.3, ypc: 4.61, ruTD: 0.58, tgt: 4.5, cr: 0.72, ypr: 8.1, recTD: 0.17 },
    { name: "Samuel Harris", pos: "RB", car: 8.3, ypc: 5.58, ruTD: 0.08, tgt: 1.9, cr: 0.72, ypr: 11.5, recTD: 0 },
    { name: "Deion DeBlanc", pos: "WR", tgt: 2.4, cr: 0.6, ypr: 5.3, recTD: 0, wr1: true },
    { name: "Jackson Holman", pos: "WR", tgt: 1.8, cr: 0.6, ypr: 10.7, recTD: 0 },
    { name: "Eric Richardson", pos: "WR", tgt: 1.4, cr: 0.6, ypr: 11.2, recTD: 0.08 } ] },
};
type League = "nfl" | "cfb";
type Game = { away: string; home: string; slot: string; awayRank?: number; homeRank?: number };
const CURATED_GAMES: Game[] = [
  { away: "KC", home: "BUF", slot: "Sun · 4:25 PM" },
  { away: "PHI", home: "DAL", slot: "Sun · 8:20 PM" },
  { away: "SF", home: "LAR", slot: "Sun · 4:05 PM" },
  { away: "BAL", home: "CIN", slot: "Sun · 1:00 PM" },
  { away: "DET", home: "GB", slot: "Thu · 8:15 PM" },
  { away: "MIN", home: "MIA", slot: "Mon · 8:15 PM" },
];

/* abbr → full name, so teams that only come from the live feed still render a name */
const TEAM_NAMES: Record<string, string> = {
  ARI: "Cardinals", ATL: "Falcons", BAL: "Ravens", BUF: "Bills", CAR: "Panthers", CHI: "Bears",
  CIN: "Bengals", CLE: "Browns", DAL: "Cowboys", DEN: "Broncos", DET: "Lions", GB: "Packers",
  HOU: "Texans", IND: "Colts", JAX: "Jaguars", KC: "Chiefs", LV: "Raiders", LAC: "Chargers",
  LAR: "Rams", MIA: "Dolphins", MIN: "Vikings", NE: "Patriots", NO: "Saints", NYG: "Giants",
  NYJ: "Jets", PHI: "Eagles", PIT: "Steelers", SF: "49ers", SEA: "Seahawks", TB: "Buccaneers",
  TEN: "Titans", WAS: "Commanders", WSH: "Commanders", JAC: "Jaguars",
};

/* ---- live data layer: proxy Worker (SportsDataIO → nflverse) with curated fallback ---- */
type DataSet = { T: Record<string, Team>; games: Game[]; source: string; week: number | null; skipped?: number; inj?: InjReport; offRoster?: { team: string; name: string; pos: string }[]; teamIds?: { abbr: string; id: string }[]; staleTeams?: string[]; liveTeams?: string[] };

/* =========================================================================================
   INJURIES — ESPN publishes a league-wide report, CORS-open, no proxy or key needed.
   Anyone Out / on IR / Doubtful / Questionable is cut from the roster before the sim runs.
   The sim previously had no status check at all, so players who were not going to take a
   snap were being projected at full season usage.
   ========================================================================================= */
type InjRow = { name: string; pos: string; team: string; status: string; detail: string; note: string };
type InjReport = { byName: Map<string, InjRow>; cut: InjRow[]; total: number; fetched: boolean };
const CUT_STATUS = new Set(["out", "injured reserve", "doubtful", "questionable"]);
// The two feeds share no common name form: the baked rosters store "J.Brissett" while ESPN's injury
// report says "Jacoby Brissett". Matching on the normalised full string found 2 of 1078 players and cut
// nobody — the filter was silently inert. First-initial + last-name + position is the one key both sides
// can produce, and it lifts the match to 181 with 33 cut. Position is in the key because it removes
// almost every collision; only 2 remain across the whole 800-row feed.
const nameKey = (n: string, pos?: string) => {
  const t = String(n || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/[^a-z. ]/g, " ").replace(/\s+/g, " ").trim();
  // Split on BOTH periods and spaces. Splitting on "." alone meant a full name with no internal
  // period ("Marvin Harrison Jr.") became a single part, so the last-name slot got the whole name with
  // spaces removed — "m|marvinharrison" against the roster's "m|harrison". That silently benched active
  // WR1s, which is worse than the stale-roster bug it was meant to fix.
  const parts = t.split(/[.\s]+/).filter(Boolean);
  if (!parts.length) return "";
  return (parts[0][0] || "") + "|" + parts[parts.length - 1] + "|" + (pos || "");
};

/* =========================================================================================
   LIVE PLAYER USAGE — the real fix for both stale rosters and thin depth.

   Rosters were baked into this file: about seven players per team, scraped once, never aged
   out. That gave two problems at once — only a handful of players per team, and 35% of them no
   longer on the team they were listed under.

   ESPN's byathlete endpoint returns real season usage keyed to each player's CURRENT team, so
   sourcing from it fixes the staleness at the root instead of filtering stale data afterwards.
   One sort only returns that category's leaders, so several sorts are merged and de-duplicated
   by athlete id: that lifts coverage from 154 players to 333 skill players, about 10.4 per team
   — enough for WR1-4, RB1-3, TE1-2 rather than one of each.
   ========================================================================================= */
const USAGE_SORTS = [
  "receiving.receptions", "receiving.receivingTargets",
  "rushing.rushingAttempts", "rushing.rushingYards",
  "passing.passingAttempts", "scoring.totalTouchdowns", "general.gamesPlayed",
];
const SKILL = new Set(["QB", "RB", "WR", "TE"]);

async function loadUsage(league: "nfl" | "cfb"): Promise<Record<string, Player[]> | null> {
  const path = league === "cfb" ? "college-football" : "nfl";
  const seen = new Map<string, any>();
  let labels: Record<string, string[]> = {};
  for (const sort of USAGE_SORTS) {
    try {
      const r = await fetch(`https://site.api.espn.com/apis/common/v3/sports/football/${path}/statistics/byathlete?limit=1000&sort=${sort}`);
      if (!r.ok) continue;
      const d = await r.json();
      // The stat NAMES live in the top-level glossary, not on each athlete — the per-athlete
      // objects carry bare value arrays that are meaningless without this.
      if (!Object.keys(labels).length) for (const c of (d?.categories || [])) labels[c.name] = c.names || [];
      for (const at of (d?.athletes || [])) { const id = at?.athlete?.id; if (id && !seen.has(id)) seen.set(id, at); }
    } catch { /* one sort failing just narrows coverage */ }
  }
  if (!seen.size || !Object.keys(labels).length) return null;

  const val = (at: any, cat: string, name: string): number => {
    const c = (at.categories || []).find((x: any) => x.name === cat);
    const i = (labels[cat] || []).indexOf(name);
    const v = i >= 0 && c?.values ? c.values[i] : null;
    return typeof v === "number" && isFinite(v) ? v : 0;
  };

  const byTeam: Record<string, Player[]> = {};
  for (const at of seen.values()) {
    const pos = at?.athlete?.position?.abbreviation;
    const team = canon(at?.athlete?.teamShortName || at?.athlete?.team?.abbreviation);
    if (!SKILL.has(pos) || !team) continue;
    const gp = Math.max(1, val(at, "general", "gamesPlayed"));
    const per = (c: string, n: string) => val(at, c, n) / gp;                 // season totals → per game
    const tgt = per("receiving", "receivingTargets");
    const recs = val(at, "receiving", "receptions");
    const tgts = val(at, "receiving", "receivingTargets");
    const p: Player = { name: at.athlete.displayName, pos } as Player;
    if (pos === "QB") {
      p.pAtt = per("passing", "passingAttempts");
      p.cmp = (val(at, "passing", "completionPct") || 62) / 100;
      p.ypa = val(at, "passing", "yardsPerPassAttempt") || 6.8;
      p.pTD = per("passing", "passingTouchdowns");
      p.iNT = per("passing", "interceptions");
      p.rYd = val(at, "rushing", "rushingYardsPerGame");
      p.rTD = per("rushing", "rushingTouchdowns");
      if (!(p.pAtt > 2)) continue;                                            // a third-stringer with two throws is noise
    } else if (pos === "RB") {
      p.car = per("rushing", "rushingAttempts");
      p.ypc = val(at, "rushing", "yardsPerRushAttempt") || 4.2;
      p.ruTD = per("rushing", "rushingTouchdowns");
      p.tgt = tgt; p.cr = tgts > 0 ? recs / tgts : 0.72;
      p.ypr = val(at, "receiving", "yardsPerReception") || 7;
      p.recTD = per("receiving", "receivingTouchdowns");
      if (!(p.car >= 0.5 || tgt >= 0.5)) continue;
    } else {
      p.tgt = tgt; p.cr = tgts > 0 ? recs / tgts : 0.62;
      p.ypr = val(at, "receiving", "yardsPerReception") || 11;
      p.recTD = per("receiving", "receivingTouchdowns");
      if (!(tgt >= 0.5)) continue;
    }
    (byTeam[team] ??= []).push(p);
  }
  return byTeam;
}

/* Depth chart. Runs LAST — after usage, roster and injury cuts — so the labels describe who is
   actually available, and a WR1 ruled out promotes WR2 rather than leaving the slot empty.
   Caps are what a game realistically gives meaningful snaps to; beyond them the tail is special
   teams and emergency bodies, and listing them only dilutes the sim. */
const DEPTH_CAP: Record<Pos, number> = { QB: 2, RB: 3, WR: 5, TE: 3 };
const usageOf = (p: Player) => (p.pAtt ?? 0) + (p.car ?? 0) + (p.tgt ?? 0);
function reslot(T: Record<string, Team>): Record<string, Team> {
  const out: Record<string, Team> = {};
  for (const [abbr, t] of Object.entries(T)) {
    const kept: Player[] = [];
    for (const pos of ["QB", "RB", "WR", "TE"] as Pos[]) {
      const grp = t.players.filter((p) => p.pos === pos).sort((x, y) => usageOf(y) - usageOf(x));
      grp.slice(0, DEPTH_CAP[pos]).forEach((p, i) => kept.push({ ...p, depth: pos + (i + 1), wr1: pos === "WR" && i === 0 }));
    }
    // Keep the card ordered by who actually touches the ball, not by position block.
    out[abbr] = { ...t, players: kept.sort((x, y) => usageOf(y) - usageOf(x)) };
  }
  return out;
}

// Swap in live usage where we have enough of a team to simulate; keep the baked roster otherwise.
function applyUsage(T: Record<string, Team>, usage: Record<string, Player[]> | null): { T: Record<string, Team>; live: string[] } {
  if (!usage) return { T, live: [] };
  const out: Record<string, Team> = {}; const live: string[] = [];
  for (const [abbr, t] of Object.entries(T)) {
    const ps = usage[abbr];
    // Needs a passer and some skill around him; below that the merge under-covered this team and
    // the baked roster, stale as it is, simulates better than four players would.
    if (ps && ps.length >= 5 && ps.some((p) => p.pos === "QB")) { out[abbr] = { ...t, players: ps }; live.push(abbr); }
    else out[abbr] = t;
  }
  return { T: out, live };
}

/* =========================================================================================
   CURRENT ROSTERS — the per-player usage baked into this file was scraped once and never
   ages out, so traded and released players keep being projected for their old team. Measured
   against ESPN's live rosters, 85 of 242 baked NFL skill players (35%) are no longer on the
   team they are listed under — Tyler Allgeier is on Arizona while this file still has him in
   Atlanta.

   ESPN's roster endpoint groups players as offense / defense / specialTeam /
   injuredReserveOrOut / suspended / practiceSquad. Only the first three can take a snap, so
   the rest are dropped along with anyone the roster no longer contains at all.

   Only teams on THIS week's slate are fetched — a handful of calls rather than the whole
   league, and it works for CFB, where team ids are not a tidy range.
   ========================================================================================= */
type RosterReport = { byTeam: Map<string, Set<string>>; dropped: { team: string; name: string; pos: string }[]; fetched: boolean; stale?: string[] };
const PLAYABLE = /^(offense|defense|specialteam)$/i;

async function loadRosters(league: "nfl" | "cfb", teams: { abbr: string; id: string }[]): Promise<RosterReport> {
  const byTeam = new Map<string, Set<string>>();
  const path = league === "cfb" ? "college-football" : "nfl";
  let i = 0;
  const worker = async () => {
    while (i < teams.length) {
      const t = teams[i++];
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/${path}/teams/${t.id}/roster`);
        if (!r.ok) continue;
        const d = await r.json();
        const live = (d?.athletes || []).filter((g: any) => PLAYABLE.test(String(g?.position || "").replace(/\s/g, "")))
          .flatMap((g: any) => g?.items || []);
        const set = new Set<string>();
        for (const a of live) { const pos = a?.position?.abbreviation; if (pos) set.add(nameKey(a?.displayName, pos)); }
        if (set.size) byTeam.set(t.abbr, set);
      } catch { /* one team failing must not blank the rest */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, teams.length) }, worker));
  return { byTeam, dropped: [], fetched: byTeam.size > 0 };
}

// Drop anyone the current roster does not carry. A team whose roster failed to load keeps ALL
// its players — a fetch hiccup must not silently empty a roster and skew the game.
function applyRosters(T: Record<string, Team>, rr: RosterReport): { T: Record<string, Team>; dropped: RosterReport["dropped"]; stale: string[] } {
  if (!rr.fetched) return { T, dropped: [], stale: [] };
  const dropped: RosterReport["dropped"] = [];
  const stale: string[] = [];
  const out: Record<string, Team> = {};
  for (const [abbr, t] of Object.entries(T)) {
    const live = rr.byTeam.get(abbr);
    if (!live) { out[abbr] = t; continue; }
    const keep = t.players.filter((p) => {
      if (live.has(nameKey(p.name, p.pos))) return true;
      dropped.push({ team: abbr, name: p.name, pos: p.pos });
      return false;
    });
    // Fewer than three survivors means the match failed, not that the team is empty — a two-man
    // roster cannot be simulated. Keep the baked players, but record the team: it is showing stale
    // data and saying so is better than quietly projecting players who left.
    if (keep.length >= 3) { out[abbr] = { ...t, players: keep }; }
    else { out[abbr] = t; stale.push(abbr); for (const d of dropped.filter((x) => x.team === abbr)) dropped.splice(dropped.indexOf(d), 1); }
  }
  return { T: out, dropped, stale };
}

async function loadInjuries(league: "nfl" | "cfb"): Promise<InjReport> {
  const empty: InjReport = { byName: new Map(), cut: [], total: 0, fetched: false };
  const path = league === "cfb" ? "college-football" : "nfl";
  try {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/${path}/injuries`);
    if (!r.ok) return empty;
    const d = await r.json();
    const rows: InjRow[] = [];
    for (const t of (d?.injuries || [])) for (const i of (t?.injuries || [])) {
      const nm = i?.athlete?.displayName; if (!nm) continue;
      rows.push({
        name: nm, pos: i?.athlete?.position?.abbreviation || "", team: t?.displayName || "",
        status: String(i?.status || ""), detail: String(i?.details?.type || ""),
        note: String(i?.shortComment || i?.longComment || ""),
      });
    }
    const byName = new Map<string, InjRow>();
    for (const row of rows) byName.set(nameKey(row.name, row.pos), row);
    return { byName, cut: rows.filter((x) => CUT_STATUS.has(x.status.toLowerCase())), total: rows.length, fetched: rows.length > 0 };
  } catch { return empty; }
}

// Remove the unavailable, and hand back what was removed so the UI can show it rather than
// silently changing the numbers.
function applyInjuries(T: Record<string, Team>, inj: InjReport): { T: Record<string, Team>; removed: InjRow[] } {
  if (!inj.fetched) return { T, removed: [] };
  const removed: InjRow[] = [];
  const out: Record<string, Team> = {};
  for (const [abbr, t] of Object.entries(T)) {
    const keep = t.players.filter((p) => {
      const hit = inj.byName.get(nameKey(p.name, p.pos));
      if (hit && CUT_STATUS.has(hit.status.toLowerCase())) { removed.push({ ...hit, team: abbr }); return false; }
      return true;
    });
    out[abbr] = keep.length === t.players.length ? t : { ...t, players: keep };
  }
  return { T: out, removed };
}
const CURATED: DataSet = { T: CURATED_T, games: CURATED_GAMES, source: "curated", week: null };

async function fetchJSON(url: string, ms = 7000): Promise<any> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return await r.json();
  } finally { clearTimeout(to); }
}

async function loadLive(proxy: string): Promise<DataSet> {
  const base = proxy.replace(/\/+$/, "");
  const [pj, gj] = await Promise.all([fetchJSON(base + "/players"), fetchJSON(base + "/games")]);
  const T: Record<string, Team> = {};
  for (const abbr in (pj.teams || {})) {
    const w = pj.teams[abbr];
    if (!w || !Array.isArray(w.players) || !w.players.length) continue;
    T[abbr] = { abbr, name: TEAM_NAMES[abbr] || abbr, pace: w.pace || 1, def: w.def || { pass: 1, run: 1, cb: 1 }, players: w.players };
  }
  const games: Game[] = (gj.games || [])
    .filter((g: any) => g && T[g.away] && T[g.home])
    .map((g: any) => ({ away: g.away, home: g.home, slot: g.slot || `Week ${gj.week ?? ""}` }));
  if (Object.keys(T).length < 2 || !games.length) throw new Error("live feed returned nothing usable");
  const src = pj.source === gj.source ? pj.source : `${gj.source}/${pj.source}`;
  return { T, games, source: src, week: gj.week ?? null };
}

/* ESPN scoreboard is CORS-open, so the REAL current-week slate loads client-side with no
   proxy. We pair it with the baked 32-team usage dataset so every game actually simulates.
   Deploying the Worker upgrades this to live season-to-date usage. */
const ESPN_ABBR: Record<string, string> = { WSH: "WAS", JAC: "JAX", LVR: "LV", LAV: "LV", ARZ: "ARI", GBP: "GB", KAN: "KC", NWE: "NE", NOR: "NO", SFO: "SF", TAM: "TB" };
const canon = (a?: string) => (a ? ESPN_ABBR[a] || a : "");
const ESPN_PATH: Record<League, string> = { nfl: "nfl", cfb: "college-football" };
// CFB: the scoreboard defaults to a CURATED ~22-game subset (ranked/featured). groups=80 = all of FBS, which is the
// real ~75-game slate. Without it most of the week is silently missing. NFL needs no filter — 16 games is the whole week.
const ESPN_Q: Record<League, string> = { nfl: "", cfb: "?limit=300&groups=80" };
async function loadESPN(T: Record<string, Team>, league: League): Promise<DataSet> {
  const d = await fetchJSON(`https://site.api.espn.com/apis/site/v2/sports/football/${ESPN_PATH[league]}/scoreboard${ESPN_Q[league]}`);
  const week: number | null = d?.week?.number ?? null;
  const games: Game[] = [];
  const ids = new Map<string, string>();      // slate teams only — a roster call each, not the whole league
  let skipped = 0;
  for (const e of (d.events || [])) {
    const comp = e.competitions && e.competitions[0]; if (!comp || !Array.isArray(comp.competitors)) continue;
    const aC = comp.competitors.find((x: any) => x.homeAway === "away"), hC = comp.competitors.find((x: any) => x.homeAway === "home");
    const away = canon(aC?.team?.abbreviation), home = canon(hC?.team?.abbreviation);
    if (!T[away] || !T[home]) { skipped++; continue; }               // a team we have no usage data for (FCS opponents in CFB) — can't be simulated, so it's surfaced rather than silently dropped
    const dt = new Date(e.date);
    const slot = isNaN(+dt) ? `Week ${week ?? ""}` : dt.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const rk = (c: any) => { const r = Number(c?.curatedRank?.current); return r > 0 && r < 99 ? r : undefined; }; // AP rank (CFB only) — shown on the game card
    games.push({ away, home, slot, awayRank: rk(aC), homeRank: rk(hC) });
    for (const [ab, c] of [[away, aC], [home, hC]] as const) { const id = c?.team?.id; if (id && !ids.has(ab)) ids.set(ab, String(id)); }
  }
  if (!games.length) throw new Error("no ESPN games matched the dataset");
  return { T, games, source: "espn", week, skipped, teamIds: [...ids].map(([abbr, id]) => ({ abbr, id })) };
}

/* ---- seeded RNG + distributions ---- */
const mul = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const gauss = (r: () => number, m: number, s: number) => { const u = r() || 1e-9; return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
const pois = (r: () => number, l: number) => { if (l <= 0) return 0; const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= r(); } while (p > L && k < 40); return k - 1; };
const binom = (r: () => number, n: number, p: number) => { let c = 0; for (let i = 0; i < n; i++) if (r() < p) c++; return c; };

type Line = { pAtt: number; cmp: number; pYd: number; pTD: number; int: number; car: number; ruYd: number; ruTD: number; tgt: number; rec: number; reYd: number; reTD: number };
const zero = (): Line => ({ pAtt: 0, cmp: 0, pYd: 0, pTD: 0, int: 0, car: 0, ruYd: 0, ruTD: 0, tgt: 0, rec: 0, reYd: 0, reTD: 0 });
const fpOf = (l: Line) => l.pYd * 0.04 + l.pTD * 4 - l.int * 2 + l.ruYd * 0.1 + l.ruTD * 6 + l.rec + l.reYd * 0.1 + l.reTD * 6;

function simPlayer(p: Player, d: Team["def"], hm: number, pace: number, r: () => number): { line: Line; teamTD: number } {
  const l = zero(); let teamTD = 0;
  if (p.pos === "QB") {
    const att = Math.max(8, Math.round(gauss(r, p.pAtt! * pace, p.pAtt! * 0.12)));
    l.pAtt = att; l.cmp = binom(r, att, clamp(p.cmp!, 0.35, 0.82));
    l.pYd = Math.max(0, Math.round(gauss(r, att * p.ypa! * d.pass * hm, att * p.ypa! * 0.22)));
    l.pTD = pois(r, p.pTD! * d.pass * hm * pace); l.int = pois(r, p.iNT! * (2 - d.pass));
    l.ruYd = Math.max(0, Math.round(gauss(r, p.rYd! * d.run * hm, Math.max(6, p.rYd! * 0.4)))); l.ruTD = pois(r, p.rTD! * pace);
    teamTD = l.pTD + l.ruTD;
  } else if (p.pos === "RB") {
    const car = Math.max(0, Math.round(gauss(r, p.car! * pace, p.car! * 0.16)));
    l.car = car; l.ruYd = Math.max(0, Math.round(gauss(r, car * p.ypc! * d.run * hm, Math.max(10, car * p.ypc! * 0.3)))); l.ruTD = pois(r, p.ruTD! * d.run * pace);
    l.tgt = Math.max(0, Math.round(gauss(r, p.tgt! * pace, Math.max(1, p.tgt! * 0.35)))); l.rec = binom(r, l.tgt, clamp(p.cr!, 0.3, 0.95));
    l.reYd = Math.max(0, Math.round(gauss(r, l.rec * p.ypr! * hm, Math.max(6, l.rec * p.ypr! * 0.35)))); l.reTD = pois(r, p.recTD!);
    teamTD = l.ruTD;
  } else {
    const mm = d.pass * (p.wr1 ? d.cb : 1) * hm;
    l.tgt = Math.max(0, Math.round(gauss(r, p.tgt! * pace, Math.max(1, p.tgt! * 0.28)))); l.rec = binom(r, l.tgt, clamp(p.cr!, 0.3, 0.9));
    l.reYd = Math.max(0, Math.round(gauss(r, l.rec * p.ypr! * mm, Math.max(8, l.rec * p.ypr! * 0.35)))); l.reTD = pois(r, p.recTD! * mm * pace);
  }
  return { line: l, teamTD };
}

type PRes = { name: string; pos: Pos; depth?: string; fp: number; sd: number; line: Line; p10: number; p50: number; p90: number; boomPct: number; bustPct: number };
type RankRow = PRes & { team: string; opp: string; home: boolean; slot: string };  // a player pooled across the whole slate, with their game's kickoff
type TRes = { abbr: string; name: string; pts: number; ptsSd: number; winPct: number; players: PRes[] };

/* Incremental runner so a big N genuinely animates a progress bar and each RUN
   uses a fresh random seed (so results carry real Monte-Carlo variation run-to-run,
   converging as N grows — never a canned, identical answer). */
/* A 0.5-point histogram per player. The per-sim spread is the whole story here — a WR1's fantasy
   points have a standard deviation around 7 — and collapsing it to a mean is what made the output
   look identical run to run. Storing every sample would be ~20 players x N doubles; 200 buckets is
   a few KB and answers any percentile. */
const HB = 200, HW = 0.5;                                     // 200 buckets x 0.5 pt = 0-100 pts
const pctOf = (h: Uint32Array, n: number, q: number) => {
  let want = q * n, c = 0;
  for (let i = 0; i < HB; i++) { c += h[i]; if (c >= want) return i * HW; }
  return (HB - 1) * HW;
};
type Acc = { p: Player; sum: Line; fpSum: number; fp2: number; hist: Uint32Array; boom: number; bust: number };
type SimState = { home: Team; away: Team; H: Acc[]; A: Acc[]; r: () => number; pace: number; done: number; winH: number; winA: number; tie: number; ptsH: number; ptsA: number; ptsH2: number; ptsA2: number };

const mkAcc = (t: Team): Acc[] => t.players.map((p) => ({ p, sum: zero(), fpSum: 0, fp2: 0, hist: new Uint32Array(HB), boom: 0, bust: 0 }));
function simInit(home: Team, away: Team, seed: number): SimState {
  return { home, away, H: mkAcc(home), A: mkAcc(away), r: mul(seed), pace: (home.pace + away.pace) / 2, done: 0, winH: 0, winA: 0, tie: 0, ptsH: 0, ptsA: 0, ptsH2: 0, ptsA2: 0 };
}
function runTeam(st: SimState, roster: Acc[], oppDef: Team["def"], hm: number): number {
  let td = 0;
  for (const e of roster) { const { line, teamTD } = simPlayer(e.p, oppDef, hm, st.pace, st.r); td += teamTD; for (const k in line) (e.sum as any)[k] += (line as any)[k]; const fp = fpOf(line); e.fpSum += fp; e.fp2 += fp * fp;
    e.hist[Math.min(HB - 1, Math.max(0, Math.floor(fp / HW)))]++;   // one bucket per sim → percentiles for free
    if (fp >= 20) e.boom++; if (fp < 10) e.bust++; }
  return td * 7 + pois(st.r, 1.6) * 3;
}
function simStep(st: SimState, k: number) {
  for (let i = 0; i < k; i++) {
    const pH = runTeam(st, st.H, st.away.def, 1.03), pA = runTeam(st, st.A, st.home.def, 0.985);
    st.ptsH += pH; st.ptsA += pA; st.ptsH2 += pH * pH; st.ptsA2 += pA * pA;
    if (pH > pA) st.winH++; else if (pA > pH) st.winA++; else st.tie++;
  }
  st.done += k;
}
function simFinish(st: SimState): { home: TRes; away: TRes } {
  const N = Math.max(1, st.done);
  const finish = (t: Team, roster: Acc[], pts: number, pts2: number, win: number): TRes => {
    const mp = pts / N;
    return {
      abbr: t.abbr, name: t.name, pts: mp, ptsSd: Math.sqrt(Math.max(0, pts2 / N - mp * mp)), winPct: (win + st.tie / 2) / N,
      players: roster.map((e) => { const line = zero() as any; for (const k in e.sum) line[k] = (e.sum as any)[k] / N; const mean = e.fpSum / N; return { name: e.p.name, pos: e.p.pos, depth: e.p.depth, fp: mean, sd: Math.sqrt(Math.max(0, e.fp2 / N - mean * mean)), line,
        p10: pctOf(e.hist, N, 0.10), p50: pctOf(e.hist, N, 0.50), p90: pctOf(e.hist, N, 0.90),
        boomPct: e.boom / N, bustPct: e.bust / N }; }).sort((a, b) => b.fp - a.fp),
    };
  };
  return { home: finish(st.home, st.H, st.ptsH, st.ptsH2, st.winH), away: finish(st.away, st.A, st.ptsA, st.ptsA2, st.winA) };
}

/* ---- UI ---- */
const C = { bg: "#0a1410", panel: "#10201a", panel2: "#16281f", line: "#1f3a30", chalk: "#eaf3ee", mut: "#7fa394", field: "#2fbd6f", gold: "#ffd23f", red: "#ff5a52" };
const box = { background: "#10201a", border: "1px solid #1f3a30", borderRadius: 12 };
const num = (n: number, d = 1) => n.toFixed(d);

/* The spread was always being computed and then discarded into a single mean. p10/p50/p90 is the
   part a fantasy decision actually turns on: two players can share a 16-point average while one
   ranges 12-20 and the other 2-40. */
function Spread({ p, small }: { p: PRes; small?: boolean }) {
  const fs2 = small ? 9 : 10;
  return (
    <div style={{ fontSize: fs2, color: C.mut, fontFamily: "ui-monospace,monospace", whiteSpace: "nowrap" }}>
      <span style={{ color: C.red }}>{num(p.p10)}</span>
      <span style={{ opacity: 0.5 }}> / </span>
      <span style={{ color: C.chalk }}>{num(p.p50)}</span>
      <span style={{ opacity: 0.5 }}> / </span>
      <span style={{ color: C.field }}>{num(p.p90)}</span>
      {!small && <span style={{ opacity: 0.7 }}>  ·  boom {Math.round(p.boomPct * 100)}% bust {Math.round(p.bustPct * 100)}%</span>}
    </div>
  );
}

function statLine(p: PRes): string {
  const l = p.line;
  if (p.pos === "QB") return `${num(l.cmp, 0)}/${num(l.pAtt, 0)}, ${num(l.pYd, 0)} yd, ${num(l.pTD)} TD, ${num(l.int)} INT · ${num(l.ruYd, 0)} ru`;
  if (p.pos === "RB") return `${num(l.car, 0)} car, ${num(l.ruYd, 0)} yd, ${num(l.ruTD)} TD · ${num(l.rec)}/${num(l.tgt, 0)} for ${num(l.reYd, 0)}`;
  return `${num(l.rec)}/${num(l.tgt, 0)} tgt, ${num(l.reYd, 0)} yd, ${num(l.reTD)} TD`;
}

const readProxy = () => { try { return localStorage.getItem("gs_proxy") || DEFAULT_PROXY; } catch { return DEFAULT_PROXY; } };

function Index() {
  const [sel, setSel] = useState<number | null>(null);
  const [sims, setSims] = useState(2000);
  const [res, setRes] = useState<{ home: TRes; away: TRes; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [data, setData] = useState<DataSet>(CURATED);
  const [loading, setLoading] = useState(true);
  const [proxy, setProxy] = useState(readProxy);
  const [showCfg, setShowCfg] = useState(false);
  const [draft, setDraft] = useState(proxy);
  const [league, setLeague] = useState<League>(() => { try { return (localStorage.getItem("gs_league") as League) || "nfl"; } catch { return "nfl"; } });
  const [ranks, setRanks] = useState<RankRow[] | null>(null);
  const [rankBusy, setRankBusy] = useState(false);
  const [rankProg, setRankProg] = useState(0);
  const [posFilter, setPosFilter] = useState<"ALL" | Pos>("ALL");

  // resolve data: Worker (NFL only, full live) → ESPN real slate + baked usage → offline demo
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const base = league === "cfb" ? CFB_T : CURATED_T;
      // Fetched once per league change and applied to whichever dataset wins below, so the cut
      // happens in exactly one place rather than being repeated down each fallback path.
      const inj = await loadInjuries(league);
      const usage = await loadUsage(league);      // real per-player season usage, keyed to current teams
      const withInj = async (d: DataSet): Promise<DataSet> => {
        // Usage first — it carries each player's CURRENT team, so it replaces stale rosters wholesale
        // rather than trying to repair them. The roster pass then removes anyone who has stats but is
        // on IR or the practice squad, and the injury pass removes anyone ruled out this week.
        const afterUsage = applyUsage(d.T, usage);
        const rr = d.teamIds?.length ? await loadRosters(league, d.teamIds) : { byTeam: new Map<string, Set<string>>(), dropped: [], fetched: false };
        const afterRoster = applyRosters(afterUsage.T, rr);
        const { T: afterInj, removed } = applyInjuries(afterRoster.T, inj);
        const T = reslot(afterInj);                 // depth chart last, so cuts promote the man behind
        return { ...d, T, inj: { ...inj, cut: removed }, offRoster: afterRoster.dropped, staleTeams: afterRoster.stale, liveTeams: afterUsage.live };
      };
      if (league === "nfl" && proxy) { try { const d = await loadLive(proxy); if (alive) { setData(await withInj(d)); setSel(null); setRes(null); setRanks(null); setLoading(false); } return; } catch { /* fall back */ } }
      try { const d = await loadESPN(base, league); if (alive) { setData(await withInj(d)); setSel(null); setRes(null); setRanks(null); setLoading(false); } return; } catch { /* fall back */ }
      if (alive) { setData(await withInj(league === "cfb" ? { T: CFB_T, games: [], source: "curated", week: null } : CURATED)); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [proxy, league]);

  const pickLeague = (l: League) => { if (l === league) return; try { localStorage.setItem("gs_league", l); } catch {} setSel(null); setRes(null); setLeague(l); };

  const TT = data.T;
  const games = data.games;
  const saveProxy = () => { const v = draft.trim(); try { v ? localStorage.setItem("gs_proxy", v) : localStorage.removeItem("gs_proxy"); } catch {} setProxy(v); setShowCfg(false); };

  const run = () => {
    if (sel == null || busy) return;
    const g = games[sel]; const n = clamp(Math.round(sims) || 1, 100, 100000);
    const seed = ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) || 1; // fresh seed every run → real variation
    setBusy(true); setRes(null); setProgress(0);
    const st = simInit(TT[g.home], TT[g.away], seed);
    const chunk = Math.max(250, Math.round(n / 60));
    const tick = () => {
      const t0 = performance.now();
      while (st.done < n && performance.now() - t0 < 24) simStep(st, Math.min(chunk, n - st.done));
      setProgress(st.done / n);
      if (st.done < n) requestAnimationFrame(tick);
      else { setRes({ ...simFinish(st), n }); setBusy(false); }
    };
    requestAnimationFrame(tick);
  };

  // ---- SLATE RANKINGS: simulate EVERY game on the slate, pool the players, rank by projected FP ----
  const runAll = () => {
    if (rankBusy || !games.length) return;
    const n = clamp(Math.round(sims) || 1, 100, 20000);             // capped: this runs once per game on the slate
    setRankBusy(true); setRanks(null); setRankProg(0);
    const rows: RankRow[] = [];
    let gi = 0;
    const step = () => {
      const t0 = performance.now();
      while (gi < games.length && performance.now() - t0 < 30) {     // a few games per frame → the bar actually moves
        const g = games[gi];
        const st = simInit(TT[g.home], TT[g.away], ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) || 1);
        simStep(st, n);
        const out = simFinish(st);
        for (const p of out.home.players) rows.push({ ...p, team: g.home, opp: g.away, home: true, slot: g.slot });
        for (const p of out.away.players) rows.push({ ...p, team: g.away, opp: g.home, home: false, slot: g.slot });
        gi++;
      }
      setRankProg(gi / games.length);
      if (gi < games.length) requestAnimationFrame(step);
      else { rows.sort((a, b) => b.fp - a.fp); setRanks(rows); setRankBusy(false); }
    };
    requestAnimationFrame(step);
  };
  const shownRanks = ranks ? (posFilter === "ALL" ? ranks : ranks.filter((r) => r.pos === posFilter)) : [];

  const live = data.source !== "curated";
  const srcLabel = data.source.includes("sportsdataio") ? "live · SportsDataIO" + (data.source.includes("nflverse") ? " + nflverse" : "")
    : data.source.includes("nflverse") ? "live · nflverse (free)"
    : data.source === "espn" ? `Week ${data.week ?? ""} · ESPN slate`.trim()
    : "offline demo";

  const Team = ({ t }: { t: TRes }) => (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${C.line}` }}>
        <div><span style={{ fontWeight: 800, fontSize: 18 }}>{t.abbr}</span> <span style={{ color: C.mut, fontSize: 12 }}>{t.name}</span></div>
        <div style={{ textAlign: "right" }}><div style={{ fontFamily: "ui-monospace,monospace", fontSize: 22, fontWeight: 800, color: C.field }}>{num(t.pts)}</div><div style={{ fontSize: 11, color: C.mut }}>{num(t.winPct * 100)}% win · most games {Math.max(0, Math.round(t.pts - t.ptsSd))}–{Math.round(t.pts + t.ptsSd)}</div></div>
      </div>
      <div style={{ padding: 6 }}>
        {t.players.map((p) => (
          <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderBottom: `1px solid #14261f` }}>
            <span style={{ width: 30, fontSize: 10, fontWeight: 800, color: p.pos === "QB" ? C.gold : p.pos === "RB" ? "#57c7ff" : p.pos === "WR" ? "#ff8ad1" : "#c6a0ff" }}>{p.depth || p.pos}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: C.mut, fontFamily: "ui-monospace,monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{statLine(p)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 17, fontWeight: 800, color: C.chalk }}>{num(p.fp)}</div>
              <Spread p={p} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: `radial-gradient(120% 80% at 50% 0%, #12261c, ${C.bg})`, color: C.chalk, fontFamily: "system-ui,sans-serif" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "22px 16px 60px" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <div style={{ fontSize: 26 }}>🏈</div>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: -0.5 }}>GRIDIRON&nbsp;SIM</h1>
            <div style={{ fontSize: 12, color: C.mut }}>Monte-Carlo NFL game simulator · {data.week ? `Week ${data.week}` : "Week slate"} · PPR scoring</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", border: `1px solid ${C.line}`, borderRadius: 20, overflow: "hidden", background: "#0e1c15" }}>
              {(["nfl", "cfb"] as League[]).map((l) => (
                <button key={l} onClick={() => pickLeague(l)} style={{ background: league === l ? C.field : "transparent", color: league === l ? "#04140c" : C.mut, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 800, padding: "6px 12px", letterSpacing: 0.4 }}>
                  {l === "nfl" ? "NFL" : "NCAA"}
                </button>
              ))}
            </div>
            <span title={srcLabel} style={{ fontSize: 11, fontWeight: 700, padding: "5px 9px", borderRadius: 20, border: `1px solid ${C.line}`, color: loading ? C.gold : live ? C.field : C.mut, background: "#0e1c15", whiteSpace: "nowrap" }}>
              <span style={{ marginRight: 6 }}>●</span>{loading ? "loading…" : srcLabel}
            </span>
            <button onClick={() => { setDraft(proxy); setShowCfg((s) => !s); }} title="Data source" style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: 8, color: C.mut, cursor: "pointer", padding: "5px 8px", fontSize: 13 }}>⚙</button>
          </div>
        </div>

        {showCfg && (
          <div style={{ ...box, padding: 14, margin: "12px 0", fontSize: 12, color: C.mut }}>
            <div style={{ marginBottom: 8 }}>Live-data proxy URL (your Cloudflare Worker) — <b>NFL only</b>. Leave blank to use the baked usage dataset. NCAA always runs on its baked 2025 dataset + the live ESPN slate.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://your-worker.workers.dev" style={{ flex: 1, minWidth: 220, ...box, color: C.chalk, padding: "9px 10px", fontFamily: "ui-monospace,monospace", fontSize: 12 }} />
              <button onClick={saveProxy} style={{ background: `linear-gradient(135deg,${C.field},#1e8f52)`, color: "#04140c", border: "none", borderRadius: 8, fontWeight: 800, padding: "9px 16px", cursor: "pointer" }}>Save</button>
            </div>
          </div>
        )}

        {sel == null ? (
          <>
            {/* SLATE RANKINGS — simulate every game, pool the players, rank by projected FP */}
            <div style={{ ...box, padding: 14, margin: "18px 0 4px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>Slate rankings</div>
                  <div style={{ fontSize: 11, color: C.mut, marginTop: 2 }}>Simulate all {games.length} games and rank every player by projected fantasy points</div>
                </div>
                <button onClick={runAll} disabled={rankBusy || loading || !games.length} style={{ background: rankBusy || loading || !games.length ? "#16281f" : `linear-gradient(135deg,${C.gold},#d89b00)`, color: rankBusy || loading || !games.length ? C.mut : "#1a1200", border: "none", borderRadius: 10, fontWeight: 900, padding: "10px 18px", cursor: rankBusy ? "default" : "pointer", whiteSpace: "nowrap" }}>
                  {rankBusy ? `SIMULATING ${Math.round(rankProg * games.length)}/${games.length}…` : ranks ? "RE-RUN ⟳" : "RANK ALL PLAYERS ▸"}
                </button>
              </div>
              {rankBusy && (
                <div style={{ marginTop: 12, height: 8, borderRadius: 8, background: "#0e1c15", border: `1px solid ${C.line}`, overflow: "hidden" }}>
                  <div style={{ width: `${Math.round(rankProg * 100)}%`, height: "100%", background: `linear-gradient(90deg,${C.gold},${C.field})`, transition: "width .08s linear" }} />
                </div>
              )}
              {ranks && !rankBusy && (
                <>
                  <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
                    {(["ALL", "QB", "RB", "WR", "TE"] as const).map((p) => (
                      <button key={p} onClick={() => setPosFilter(p)} style={{ ...box, cursor: "pointer", padding: "6px 12px", fontSize: 11, fontWeight: 800, color: posFilter === p ? "#04140c" : C.mut, background: posFilter === p ? C.field : "#0e1c15", border: `1px solid ${C.line}` }}>{p}</button>
                    ))}
                    <div style={{ marginLeft: "auto", fontSize: 11, color: C.mut, alignSelf: "center" }}>{shownRanks.length} players · {clamp(Math.round(sims) || 1, 100, 20000).toLocaleString()} sims/game</div>
                  </div>
                  <div style={{ marginTop: 10, maxHeight: 520, overflowY: "auto" }}>
                    {shownRanks.map((p, i) => (
                      <div key={p.team + p.name + i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: `1px solid #14261f` }}>
                        <span style={{ width: 26, textAlign: "right", fontSize: 12, fontWeight: 800, color: i === 0 ? C.gold : C.mut, fontFamily: "ui-monospace,monospace" }}>{i + 1}</span>
                        <span style={{ width: 28, fontSize: 10, fontWeight: 800, color: p.pos === "QB" ? C.gold : p.pos === "RB" ? "#57c7ff" : p.pos === "WR" ? "#ff8ad1" : "#c6a0ff" }}>{p.depth || p.pos}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{p.name} <span style={{ color: C.mut, fontWeight: 400, fontSize: 11 }}>{p.team} {p.home ? "vs" : "@"} {p.opp}</span>{p.slot ? <span style={{ color: C.field, fontWeight: 600, fontSize: 11, marginLeft: 6 }}>{p.slot}</span> : null}</div>
                          <div style={{ fontSize: 11, color: C.mut, fontFamily: "ui-monospace,monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{statLine(p)}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 16, fontWeight: 800, color: C.chalk }}>{num(p.fp)}</div>
                          <Spread p={p} small />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div style={{ margin: "18px 0 10px", fontSize: 13, color: C.mut, textTransform: "uppercase", letterSpacing: 1 }}>{loading ? "Loading this week's games…" : data.week ? `Week ${data.week} Games (${games.length})` : "This Week's Games"} — tap to simulate{!loading && data.skipped ? <span style={{ textTransform: "none", letterSpacing: 0, color: "#7fa394" }}> · {data.skipped} hidden ({league === "cfb" ? "non-FBS opponent" : "no player data"})</span> : null}</div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", opacity: loading ? 0.4 : 1 }}>
              {games.map((g, i) => (
                <button key={i} onClick={() => { setSel(i); setRes(null); }} style={{ ...box, cursor: "pointer", textAlign: "left", padding: "14px 16px", color: C.chalk, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 800 }}>
                      {g.awayRank && <span style={{ color: C.gold, fontSize: 11, marginRight: 3 }}>#{g.awayRank}</span>}{TT[g.away].abbr} <span style={{ color: C.mut, fontWeight: 400 }}>@</span> {g.homeRank && <span style={{ color: C.gold, fontSize: 11, marginRight: 3 }}>#{g.homeRank}</span>}{TT[g.home].abbr}
                    </div>
                    <div style={{ fontSize: 11, color: C.mut }}>{TT[g.away].name} at {TT[g.home].name}</div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 11, color: C.field }}>{g.slot}<div style={{ color: C.mut, marginTop: 2 }}>simulate ▸</div></div>
                </button>
              ))}
            </div>
            {/* Both cuts change every projection on the page, so they are shown rather than applied silently. */}
            {(data.inj?.fetched || (data.offRoster?.length ?? 0) > 0) && (
              <div style={{ marginTop: 18, ...box, padding: "12px 14px" }}>
                {(data.offRoster?.length ?? 0) > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: C.chalk, fontWeight: 700, marginBottom: 6 }}>
                      no longer on the roster · {data.offRoster!.length} dropped
                      <span style={{ color: C.mut, fontWeight: 400 }}> — traded, released, on IR or practice squad per ESPN's live roster</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 11, color: C.mut, fontFamily: "ui-monospace,monospace" }}>
                      {data.offRoster!.slice(0, 40).map((p, k) => (
                        <span key={k}><span style={{ color: C.mut }}>{p.team}</span> <span style={{ color: C.chalk }}>{p.name}</span> {p.pos}</span>
                      ))}
                      {data.offRoster!.length > 40 && <span>+{data.offRoster!.length - 40} more</span>}
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 11, color: C.mut, marginBottom: 10 }}>
                  rosters: <span style={{ color: C.field }}>{data.liveTeams?.length ?? 0}</span> team(s) on live season usage
                  {(data.liveTeams?.length ?? 0) > 0 && <> · about {Math.round(Object.entries(data.T).filter(([a]) => data.liveTeams!.includes(a)).reduce((n, [, t]) => n + t.players.length, 0) / Math.max(1, data.liveTeams!.length))} players per team</>}
                </div>
                {(data.staleTeams?.length ?? 0) > 0 && (
                  <div style={{ marginBottom: 10, fontSize: 11, color: C.gold }}>
                    ⚠ {data.staleTeams!.join(", ")} — roster match failed, these teams are still showing stale players.
                  </div>
                )}
                {data.inj?.fetched && (<>
                  <div style={{ fontSize: 12, color: C.chalk, fontWeight: 700, marginBottom: 6 }}>
                    injury cut · {data.inj.cut.length} player{data.inj.cut.length === 1 ? "" : "s"} removed
                    <span style={{ color: C.mut, fontWeight: 400 }}> — Out / IR / Doubtful / Questionable are not simulated</span>
                  </div>
                  {data.inj.cut.length === 0
                    ? <div style={{ fontSize: 11, color: C.mut }}>nobody left on this slate is ruled out.</div>
                    : <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 11, color: C.mut, fontFamily: "ui-monospace,monospace" }}>
                        {data.inj.cut.slice(0, 40).map((i, k) => (
                          <span key={k}>
                            <span style={{ color: C.red }}>{i.status.toLowerCase() === "questionable" ? "Q" : i.status.toLowerCase() === "doubtful" ? "D" : "O"}</span>
                            {" "}<span style={{ color: C.chalk }}>{i.name}</span> {i.pos}{i.detail ? " (" + i.detail + ")" : ""}
                          </span>
                        ))}
                        {data.inj.cut.length > 40 && <span>+{data.inj.cut.length - 40} more</span>}
                      </div>}
                </>)}
              </div>
            )}
            <p style={{ marginTop: 22, fontSize: 11, color: C.mut, lineHeight: 1.6 }}>
              Real Monte-Carlo model: each sim runs team pace → play volume → per-player usage → matchup-adjusted efficiency (offense vs the opponent's pass/run D) → WR1 vs the opponent's top CB → home-field → Gaussian yards / Poisson TDs / Binomial catches, scored PPR and averaged over your N sims. Every RUN reseeds, so results carry real sampling variation and converge as N grows — never a canned answer. {data.source === "espn" ? `This week's real ${league === "cfb" ? "NCAA" : "NFL"} slate is pulled live from ESPN; player usage is the real 2025-season baseline${league === "nfl" ? ". Add a proxy via ⚙ for live season-to-date usage." : " for all FBS teams."}` : data.source === "curated" ? "Live slate unavailable — showing no games; try again shortly." : `This week's slate + live per-player usage (${srcLabel.replace("live · ", "")}).`}
            </p>
          </>
        ) : (
          <>
            <button onClick={() => { setSel(null); setRes(null); }} style={{ background: "none", border: "none", color: C.mut, cursor: "pointer", fontSize: 13, margin: "14px 0", padding: 0 }}>‹ all games</button>
            <div style={{ ...box, padding: 16, marginBottom: 16, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, justifyContent: "space-between" }}>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{TT[games[sel].away].abbr} @ {TT[games[sel].home].abbr} <span style={{ color: C.mut, fontSize: 13, fontWeight: 400 }}>· {games[sel].slot}</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ fontSize: 12, color: C.mut }}># sims</label>
                <input type="number" value={sims} min={100} max={100000} onChange={(e) => setSims(Number(e.target.value))} style={{ width: 100, ...box, color: C.chalk, padding: "9px 10px", fontFamily: "ui-monospace,monospace" }} />
                {[1000, 10000, 50000].map((n) => <button key={n} onClick={() => setSims(n)} style={{ ...box, color: C.mut, cursor: "pointer", padding: "8px 8px", fontSize: 11 }}>{n >= 1000 ? n / 1000 + "k" : n}</button>)}
                <button onClick={run} disabled={busy} style={{ background: `linear-gradient(135deg,${C.field},#1e8f52)`, color: "#04140c", border: "none", borderRadius: 10, fontWeight: 900, padding: "10px 18px", cursor: "pointer" }}>{busy ? "SIMULATING…" : "RUN ▸"}</button>
              </div>
            </div>

            {busy && (
              <div style={{ padding: "34px 20px", textAlign: "center", color: C.mut }}>
                <div style={{ fontSize: 13, marginBottom: 12 }}>simulating {Math.round(progress * clamp(Math.round(sims) || 1, 100, 100000)).toLocaleString()} / {clamp(Math.round(sims) || 1, 100, 100000).toLocaleString()} games…</div>
                <div style={{ maxWidth: 420, margin: "0 auto", height: 8, borderRadius: 8, background: "#0e1c15", border: `1px solid ${C.line}`, overflow: "hidden" }}>
                  <div style={{ width: `${Math.round(progress * 100)}%`, height: "100%", background: `linear-gradient(90deg,${C.field},${C.gold})`, transition: "width .08s linear" }} />
                </div>
              </div>
            )}
            {res && !busy && (
              <>
                <div style={{ textAlign: "center", marginBottom: 12, fontSize: 13, color: C.mut }}>
                  averaged over <b style={{ color: C.chalk }}>{res.n.toLocaleString()}</b> sims · projected <b style={{ color: C.field }}>{TT[games[sel].away].abbr} {num(res.away.pts)}</b> — <b style={{ color: C.field }}>{num(res.home.pts)} {TT[games[sel].home].abbr}</b> · {(res.home.pts > res.away.pts ? TT[games[sel].home].abbr : TT[games[sel].away].abbr)} favored {num(Math.max(res.home.winPct, res.away.winPct) * 100)}%
                </div>
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
                  <Team t={res.away} /><Team t={res.home} />
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: C.mut, textAlign: "center" }}>each player: mean PPR, then <span style={{ color: C.red }}>floor</span> / <span style={{ color: C.chalk }}>median</span> / <span style={{ color: C.field }}>ceiling</span> (10th / 50th / 90th percentile across the sims). boom = 20+ pts, bust = under 10. The mean converges as N grows; the spread is what does not. Averaged stat line across all {res.n.toLocaleString()} sims.</div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Index;
