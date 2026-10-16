#!/usr/bin/env node
// Builds llm-johor.json: the Johor highway cameras published by Lembaga
// Lebuhraya Malaysia (LLM) on https://www.llm.gov.my/awam/cctv1.
//
// LLM's camera list can't be read from the browser (no CORS), and its image
// links are signed and expire after 7 days. So the Pages workflow runs this
// daily and ships the result as a static file next to the app.
//
// Usage: node scripts/fetch-llm.mjs [out.json]

import { writeFileSync } from 'node:fs';

const LIST_URL = 'https://www.llm.gov.my/awam/cctv1';
const HIGHWAYS = ['LINK2', 'SPL', 'SDE'];

// LLM gives names and KM markers but no coordinates. Positions are placed by
// hand from OpenStreetMap: exact for named landmarks, estimated along the
// highway from the KM marker otherwise (approx: true, may be ~2 km off).
const CAMS = {
  'LNK_CAM_S5_SECOND_LINK_8_KM-1.3_NB.web.jpg': {
    id: 'LINK2-8', name: 'Second Link Bridge', code: 'E3 · KM −1.3 NB', lat: 1.3550, lng: 103.6274, approx: true,
  },
  'LNK_CAM_S5_SECOND_LINK_7_KM17.1_NB.web.jpg': {
    id: 'LINK2-7', name: 'Linkedua KM 17.1', code: 'E3 · KM 17.1 NB', lat: 1.4950, lng: 103.6120, approx: true,
  },
  'LNK_CAM_S5_SECOND_LINK_9_KM33.30_SB.web.jpg': {
    id: 'LINK2-9', name: 'Linkedua KM 33.3', code: 'E3 · KM 33.3 SB', lat: 1.6200, lng: 103.6550, approx: true,
  },
  'PLS_CAM_S4_SKUDAI_KM13.5_MD.web.jpg': {
    id: 'PLS-SKD', name: 'PLUS Skudai', code: 'E2 · KM 13.5', lat: 1.5764, lng: 103.6598, approx: true,
  },
  'PLS_CAM_S4_SIMPANG_RENGGAM_KM60.1_NB.web.jpg': {
    id: 'PLS-SPG', name: 'PLUS Simpang Renggam', code: 'E2 · KM 60.1 NB', lat: 1.8420, lng: 103.3220, approx: true,
  },
  'PLS_CAM_S3_PAGOH_RSA_SB_MAINLINE.web.jpg': {
    id: 'PLS-PGH', name: 'PLUS Pagoh R&R', code: 'E2 · Pagoh SB', lat: 2.1218, lng: 102.7935, approx: false,
  },
  'SDE_CAM_17_KM49.4_WB_SG_JHR_BRDG.web.jpg': {
    id: 'SDE-17', name: 'Sungai Johor Bridge', code: 'E22 · KM 49.4 WB', lat: 1.5322, lng: 104.0221, approx: false,
  },
  'SDE_CAM_18_PN_TP.web.jpg': {
    id: 'SDE-18', name: 'Penawar Toll Plaza', code: 'E22 · Penawar', lat: 1.5778, lng: 104.1912, approx: false,
  },
  'SDE_CAM_19_KM69.41_EB.web.jpg': {
    id: 'SDE-19', name: 'SDE KM 69.4', code: 'E22 · KM 69.4 EB', lat: 1.5806, lng: 104.2003, approx: true,
  },
};

async function list(highway) {
  const res = await fetch(`${LIST_URL}?highway=${highway}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'TrafficWatch (+https://github.com/alden000/TrafficWatch)' },
    signal: AbortSignal.timeout(30e3),
  });
  if (!res.ok) throw new Error(`${highway}: HTTP ${res.status}`);
  const json = JSON.parse((await res.text()).replace(/^﻿/, ''));
  if (json.status !== 'success' || !Array.isArray(json.data)) throw new Error(`${highway}: unexpected response`);
  return json.data;
}

const cameras = [];
let expires = Infinity;
for (const highway of HIGHWAYS) {
  try {
    for (const item of await list(highway)) {
      const meta = CAMS[item.file_name];
      const url = item.url || item.image_url;
      if (!meta || !url) continue;
      const exp = Number(new URL(url).searchParams.get('expires')) * 1000;
      if (exp) expires = Math.min(expires, exp);
      cameras.push({ ...meta, highway, url });
    }
  } catch (err) {
    console.error(String(err));
  }
}

if (!cameras.length) {
  console.error('No LLM cameras found');
  process.exit(1);
}

const out = process.argv[2] || 'llm-johor.json';
writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), expires, cameras }, null, 1));
console.log(`Wrote ${cameras.length} cameras to ${out}, links valid until ${new Date(expires).toISOString()}`);
