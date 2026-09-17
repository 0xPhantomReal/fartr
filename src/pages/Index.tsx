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

type Game = { away: string; home: string; slot: string };
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
type DataSet = { T: Record<string, Team>; games: Game[]; source: string; week: number | null };
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
async function loadESPN(T: Record<string, Team>): Promise<DataSet> {
  const d = await fetchJSON("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard");
  const week: number | null = d?.week?.number ?? null;
  const games: Game[] = [];
  for (const e of (d.events || [])) {
    const comp = e.competitions && e.competitions[0]; if (!comp || !Array.isArray(comp.competitors)) continue;
    const away = canon(comp.competitors.find((x: any) => x.homeAway === "away")?.team?.abbreviation);
    const home = canon(comp.competitors.find((x: any) => x.homeAway === "home")?.team?.abbreviation);
    if (!T[away] || !T[home]) continue;
    const dt = new Date(e.date);
    const slot = isNaN(+dt) ? `Week ${week ?? ""}` : dt.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    games.push({ away, home, slot });
  }
  if (!games.length) throw new Error("no ESPN games matched the dataset");
  return { T, games, source: "espn", week };
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

type PRes = { name: string; pos: Pos; fp: number; sd: number; line: Line };
type TRes = { abbr: string; name: string; pts: number; ptsSd: number; winPct: number; players: PRes[] };

/* Incremental runner so a big N genuinely animates a progress bar and each RUN
   uses a fresh random seed (so results carry real Monte-Carlo variation run-to-run,
   converging as N grows — never a canned, identical answer). */
type Acc = { p: Player; sum: Line; fpSum: number; fp2: number };
type SimState = { home: Team; away: Team; H: Acc[]; A: Acc[]; r: () => number; pace: number; done: number; winH: number; winA: number; tie: number; ptsH: number; ptsA: number; ptsH2: number; ptsA2: number };

const mkAcc = (t: Team): Acc[] => t.players.map((p) => ({ p, sum: zero(), fpSum: 0, fp2: 0 }));
function simInit(home: Team, away: Team, seed: number): SimState {
  return { home, away, H: mkAcc(home), A: mkAcc(away), r: mul(seed), pace: (home.pace + away.pace) / 2, done: 0, winH: 0, winA: 0, tie: 0, ptsH: 0, ptsA: 0, ptsH2: 0, ptsA2: 0 };
}
function runTeam(st: SimState, roster: Acc[], oppDef: Team["def"], hm: number): number {
  let td = 0;
  for (const e of roster) { const { line, teamTD } = simPlayer(e.p, oppDef, hm, st.pace, st.r); td += teamTD; for (const k in line) (e.sum as any)[k] += (line as any)[k]; const fp = fpOf(line); e.fpSum += fp; e.fp2 += fp * fp; }
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
      players: roster.map((e) => { const line = zero() as any; for (const k in e.sum) line[k] = (e.sum as any)[k] / N; const mean = e.fpSum / N; return { name: e.p.name, pos: e.p.pos, fp: mean, sd: Math.sqrt(Math.max(0, e.fp2 / N - mean * mean)), line }; }).sort((a, b) => b.fp - a.fp),
    };
  };
  return { home: finish(st.home, st.H, st.ptsH, st.ptsH2, st.winH), away: finish(st.away, st.A, st.ptsA, st.ptsA2, st.winA) };
}

/* ---- UI ---- */
const C = { bg: "#0a1410", panel: "#10201a", panel2: "#16281f", line: "#1f3a30", chalk: "#eaf3ee", mut: "#7fa394", field: "#2fbd6f", gold: "#ffd23f", red: "#ff5a52" };
const box = { background: "#10201a", border: "1px solid #1f3a30", borderRadius: 12 };
const num = (n: number, d = 1) => n.toFixed(d);

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

  // resolve data: Worker (full live) → ESPN real slate + baked usage → offline demo
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      if (proxy) { try { const d = await loadLive(proxy); if (alive) { setData(d); setSel(null); setRes(null); setLoading(false); } return; } catch { /* fall back */ } }
      try { const d = await loadESPN(CURATED_T); if (alive) { setData(d); setSel(null); setRes(null); setLoading(false); } return; } catch { /* fall back */ }
      if (alive) { setData(CURATED); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [proxy]);

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
            <span style={{ width: 30, fontSize: 10, fontWeight: 800, color: p.pos === "QB" ? C.gold : p.pos === "RB" ? "#57c7ff" : p.pos === "WR" ? "#ff8ad1" : "#c6a0ff" }}>{p.pos}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: C.mut, fontFamily: "ui-monospace,monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{statLine(p)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "ui-monospace,monospace", fontSize: 17, fontWeight: 800, color: C.chalk }}>{num(p.fp)}</div>
              <div style={{ fontSize: 10, color: C.mut }}>±{num(p.sd)} FP</div>
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
            <span title={srcLabel} style={{ fontSize: 11, fontWeight: 700, padding: "5px 9px", borderRadius: 20, border: `1px solid ${C.line}`, color: loading ? C.gold : live ? C.field : C.mut, background: "#0e1c15", whiteSpace: "nowrap" }}>
              <span style={{ marginRight: 6 }}>●</span>{loading ? "loading…" : srcLabel}
            </span>
            <button onClick={() => { setDraft(proxy); setShowCfg((s) => !s); }} title="Data source" style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: 8, color: C.mut, cursor: "pointer", padding: "5px 8px", fontSize: 13 }}>⚙</button>
          </div>
        </div>

        {showCfg && (
          <div style={{ ...box, padding: 14, margin: "12px 0", fontSize: 12, color: C.mut }}>
            <div style={{ marginBottom: 8 }}>Live-data proxy URL (your Cloudflare Worker). Leave blank to use the offline curated slate.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://your-worker.workers.dev" style={{ flex: 1, minWidth: 220, ...box, color: C.chalk, padding: "9px 10px", fontFamily: "ui-monospace,monospace", fontSize: 12 }} />
              <button onClick={saveProxy} style={{ background: `linear-gradient(135deg,${C.field},#1e8f52)`, color: "#04140c", border: "none", borderRadius: 8, fontWeight: 800, padding: "9px 16px", cursor: "pointer" }}>Save</button>
            </div>
          </div>
        )}

        {sel == null ? (
          <>
            <div style={{ margin: "18px 0 10px", fontSize: 13, color: C.mut, textTransform: "uppercase", letterSpacing: 1 }}>{loading ? "Loading this week's games…" : data.week ? `Week ${data.week} Games` : "This Week's Games"} — tap to simulate</div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", opacity: loading ? 0.4 : 1 }}>
              {games.map((g, i) => (
                <button key={i} onClick={() => { setSel(i); setRes(null); }} style={{ ...box, cursor: "pointer", textAlign: "left", padding: "14px 16px", color: C.chalk, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 800 }}>{TT[g.away].abbr} <span style={{ color: C.mut, fontWeight: 400 }}>@</span> {TT[g.home].abbr}</div>
                    <div style={{ fontSize: 11, color: C.mut }}>{TT[g.away].name} at {TT[g.home].name}</div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 11, color: C.field }}>{g.slot}<div style={{ color: C.mut, marginTop: 2 }}>simulate ▸</div></div>
                </button>
              ))}
            </div>
            <p style={{ marginTop: 22, fontSize: 11, color: C.mut, lineHeight: 1.6 }}>
              Real Monte-Carlo model: each sim runs team pace → play volume → per-player usage → matchup-adjusted efficiency (offense vs the opponent's pass/run D) → WR1 vs the opponent's top CB → home-field → Gaussian yards / Poisson TDs / Binomial catches, scored PPR and averaged over your N sims. Every RUN reseeds, so results carry real sampling variation and converge as N grows — never a canned answer. {data.source === "espn" ? "This week's real slate is pulled live from ESPN; player usage is the 2025-season baseline. Add a proxy via ⚙ for live season-to-date usage." : data.source === "curated" ? "Live feeds unavailable — running the offline demo slate." : `This week's slate + live per-player usage (${srcLabel.replace("live · ", "")}).`}
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
                <div style={{ marginTop: 10, fontSize: 11, color: C.mut, textAlign: "center" }}>each player: avg fantasy points (PPR) ± std-dev, with the averaged stat line across all {res.n.toLocaleString()} sims.</div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Index;
