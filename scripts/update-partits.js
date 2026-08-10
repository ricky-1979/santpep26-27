#!/usr/bin/env node
// Baixa el calendari ICS de partits, el converteix a JSON i actualitza el
// bloc de dades incrustat a partits.html. Pensat per executar-se en un
// GitHub Action (o localment amb `node scripts/update-partits.js`).
//
// No regenera el HTML/CSS/JS de la pàgina: només substitueix el contingut
// del bloc <script id="partitsData" type="application/json">…</script>.

const fs = require("fs");
const path = require("path");
const https = require("https");

// Dos calendaris: masculí i femení.
const CALENDARS = [
  {
    sex: "M",
    url: "https://calendar.google.com/calendar/ical/e6e366d49523bee10af33b961767a8c3228b60cb30066e3fdc04704077f65a9f%40group.calendar.google.com/public/basic.ics",
  },
  {
    sex: "F",
    url: "https://calendar.google.com/calendar/ical/6vssihbaio24d4s1220h8km6v8%40group.calendar.google.com/public/basic.ics",
  },
];

// Categories pròpies per sigla: nom, família de filtre i gènere.
const OWN = {
  // Masculí
  IAM: { team: "Infantil A", fam: "INFANTIL", sex: "M" },
  IBM: { team: "Infantil B", fam: "INFANTIL", sex: "M" },
  CAM: { team: "Cadet A",    fam: "CADET",    sex: "M" },
  CBM: { team: "Cadet B",    fam: "CADET",    sex: "M" },
  JAM: { team: "Júnior A",   fam: "JÚNIOR",   sex: "M" },
  JBM: { team: "Júnior B",   fam: "JÚNIOR",   sex: "M" },
  SAM: { team: "Sènior A",   fam: "SÈNIOR",   sex: "M" },
  SBM: { team: "Sènior B",   fam: "SÈNIOR",   sex: "M" },
  // Femení
  IF:  { team: "Infantil",   fam: "INFANTIL", sex: "F" },
  CF:  { team: "Cadet",      fam: "CADET",    sex: "F" },
  JAF: { team: "Júnior A",   fam: "JÚNIOR",   sex: "F" },
  JBF: { team: "Júnior B",   fam: "JÚNIOR",   sex: "F" },
  SAF: { team: "Sènior A",   fam: "SÈNIOR",   sex: "F" },
};

// Només mostrem partits a partir d'aquesta data (inici temporada 26-27).
const FROM = Date.UTC(2026, 7, 1); // 1 d'agost de 2026

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "santpep26-27-bot" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(fetchText(res.headers.location));
        }
        if (res.statusCode !== 200) {
          return reject(new Error("HTTP " + res.statusCode + " en baixar l'ICS"));
        }
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function field(block, name) {
  const m = block.match(new RegExp(name + "[^:]*:(.*)"));
  return m ? m[1].trim() : "";
}

function parseDTStart(s) {
  const m = s.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, Y, Mo, D, h, mi, se, z] = m;
  if (h === undefined) return { allday: true };
  if (z === "Z") return { allday: false, d: new Date(Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +se)) };
  return { allday: false, d: new Date(+Y, +Mo - 1, +D, +h, +mi, +se) };
}

// Components de data/hora en horari de Madrid (gestiona canvi d'hora).
function madrid(d) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const p = {};
  f.formatToParts(d).forEach((x) => (p[x.type] = x.value));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, wd: p.weekday };
}

function cleanLoc(loc) {
  if (!loc) return "";
  return loc.replace(/\\,/g, ",").split(",")[0].trim();
}

function mondayISO(dateStr) {
  const [Y, M, D] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(Y, M - 1, D));
  const wd = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - wd);
  return dt.toISOString().slice(0, 10);
}

function parseCalendar(ics) {
  const raw = ics.replace(/\r?\n[ \t]/g, ""); // unfold RFC5545
  const events = [...raw.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)].map((m) => m[1]);
  const wdmap = { Sat: 6, Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };

  return events
    .map((b) => ({
      sum: field(b, "SUMMARY"),
      loc: field(b, "LOCATION"),
      start: parseDTStart(field(b, "DTSTART")),
    }))
    .filter((e) => e.start && !e.start.allday && e.start.d.getTime() >= FROM)
    .map((e) => {
      const s = e.sum.replace(/🏀|🤝|🍼/g, "").trim();
      const parts = s.split(/\s+Vs\s+/i).map((x) => x.trim());
      let ownSide = -1, sigla = "";
      parts.forEach((p, i) => { if (OWN[p]) { ownSide = i; sigla = p; } });
      if (ownSide < 0) return null; // partit sense equip propi identificable
      const rival = parts[ownSide === 0 ? 1 : 0] || "";
      const home = /LA COLINA|GRAN BRETANYA/i.test(e.loc); // casa = pavelló propi
      const M = madrid(e.start.d);
      const info = OWN[sigla];
      return {
        date: M.date, dow: wdmap[M.wd], time: M.time,
        team: info.team, fam: info.fam, sex: info.sex,
        rival, home, loc: cleanLoc(e.loc),
      };
    })
    .filter(Boolean)
    .filter((g) => g.dow === 6 || g.dow === 0); // només cap de setmana
}

function buildData(calendars) {
  // calendars: [{ ics }] — s'uneixen tots els partits dels dos gèneres
  const games = calendars
    .flatMap((c) => parseCalendar(c.ics))
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 :
      a.time < b.time ? -1 : a.time > b.time ? 1 :
      a.sex < b.sex ? -1 : a.sex > b.sex ? 1 :
      a.team < b.team ? -1 : a.team > b.team ? 1 :
      a.rival < b.rival ? -1 : a.rival > b.rival ? 1 : 0
    );

  const byWeek = {};
  games.forEach((g) => {
    const wk = mondayISO(g.date);
    (byWeek[wk] = byWeek[wk] || []).push(g);
  });
  const weeks = Object.keys(byWeek)
    .sort()
    .map((w) => ({ monday: w, games: byWeek[w] }));

  return { weeks };
}

async function main() {
  const pagePath = path.join(__dirname, "..", "partits.html");
  const html = fs.readFileSync(pagePath, "utf8");

  const calendars = await Promise.all(
    CALENDARS.map(async (c) => ({ sex: c.sex, ics: await fetchText(c.url) }))
  );
  const data = buildData(calendars);
  const json = JSON.stringify(data);

  const re = /(<script id="partitsData"[^>]*>)([\s\S]*?)(<\/script>)/;
  if (!re.test(html)) {
    throw new Error("No s'ha trobat el bloc partitsData a partits.html");
  }
  const out = html.replace(re, (_, open, _old, close) => open + json + close);

  if (out === html) {
    console.log("Sense canvis: les dades ja estaven al dia.");
    return;
  }
  fs.writeFileSync(pagePath, out);
  const total = data.weeks.reduce((a, w) => a + w.games.length, 0);
  console.log(`Actualitzat partits.html: ${data.weeks.length} caps de setmana, ${total} partits.`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
