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
  PBM: { team: "Premini B",  fam: "MINI",     sex: "M" },
  PAM: { team: "Premini A",  fam: "MINI",     sex: "M" },
  MAM: { team: "Mini A",     fam: "MINI",     sex: "M" },
  MBM: { team: "Mini B",     fam: "MINI",     sex: "M" },
  CAM: { team: "Cadet A",    fam: "CADET",    sex: "M" },
  CBM: { team: "Cadet B",    fam: "CADET",    sex: "M" },
  JAM: { team: "Júnior A",   fam: "JÚNIOR",   sex: "M" },
  JBM: { team: "Júnior B",   fam: "JÚNIOR",   sex: "M" },
  SAM: { team: "Sènior A",   fam: "SÈNIOR",   sex: "M" },
  SBM: { team: "Sènior B",   fam: "SÈNIOR",   sex: "M" },
  // Femení
  IF:  { team: "Infantil",   fam: "INFANTIL", sex: "F" },
  MF:  { team: "Mini",       fam: "MINI",     sex: "F" },
  CF:  { team: "Cadet",      fam: "CADET",    sex: "F" },
  JAF: { team: "Júnior A",   fam: "JÚNIOR",   sex: "F" },
  JBF: { team: "Júnior B",   fam: "JÚNIOR",   sex: "F" },
  SAF: { team: "Sènior A",   fam: "SÈNIOR",   sex: "F" },
};

// Només mostrem partits a partir d'aquesta data (inici temporada 26-27).
const FROM = Date.UTC(2026, 7, 1); // 1 d'agost de 2026

// Correccions manuals de pavelló. El calendari de Google situa alguns partits
// locals a La Colina, però es juguen en una altra pista pròpia del club (p. ex.
// quan hi ha més de 3 partits locals alhora, els que sobren van a Montigalà).
// Clau: "dateISO|sigla" → { loc, home } (home força que compti com a local).
const VENUE_OVERRIDES = {
  "2026-09-13|IF":  { loc: "Pavelló de Montigalà", home: true }, // Infantil femení
  "2026-09-13|IBM": { loc: "Pavelló de Montigalà", home: true }, // Infantil B masculí
  "2026-09-13|IAM": { loc: "Pavelló de Montigalà", home: true }, // Infantil A masculí
};

// Ordre manual de les files dins d'una franja de la graella de casa. Per
// defecte els partits d'una mateixa hora s'ordenen per nom d'equip; aquí es
// pot forçar l'ordre desitjat (de dalt a baix). Clau: "dateISO|time".
const ROW_ORDER = {
  "2026-09-13|19:30": ["Infantil A", "Cadet B"], // Infantil A a dalt, Cadet B a sota
};

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
      // La 🤝 al títol marca un partit amistós.
      const friendly = /🤝/.test(e.sum);
      const s = e.sum.replace(/🏀|🤝|🍼/g, "").trim();
      const parts = s.split(/\s+Vs\s+/i).map((x) => x.trim());
      let ownSide = -1, sigla = "";
      parts.forEach((p, i) => { if (OWN[p]) { ownSide = i; sigla = p; } });
      if (ownSide < 0) return null; // partit sense equip propi identificable
      const rival = parts[ownSide === 0 ? 1 : 0] || "";
      let home = /LA COLINA|GRAN BRETANYA/i.test(e.loc); // casa = pavelló propi
      const M = madrid(e.start.d);
      const info = OWN[sigla];
      let loc = cleanLoc(e.loc);

      // Aplica correcció manual de pavelló si n'hi ha per aquest partit
      const ov = VENUE_OVERRIDES[M.date + "|" + sigla];
      if (ov) {
        if (ov.loc != null) loc = ov.loc;
        if (ov.home != null) home = ov.home;
      }

      return {
        date: M.date, dow: wdmap[M.wd], time: M.time,
        team: info.team, fam: info.fam, sex: info.sex,
        rival, home, loc,
        ...(friendly ? { friendly: true } : {}),
      };
    })
    .filter(Boolean)
    .filter((g) => g.dow === 6 || g.dow === 0); // només cap de setmana
}

function buildData(calendars) {
  // calendars: [{ ics }] — s'uneixen tots els partits dels dos gèneres
  // Índex d'ordre manual per franja (ROW_ORDER): retorna la posició de l'equip
  // dins la llista forçada, o Infinity si no hi és (queda darrere).
  const rowRank = (g) => {
    const order = ROW_ORDER[g.date + "|" + g.time];
    if (!order) return null;
    const i = order.indexOf(g.team);
    return i < 0 ? Infinity : i;
  };

  const games = calendars
    .flatMap((c) => parseCalendar(c.ics))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.time !== b.time) return a.time < b.time ? -1 : 1;
      // Ordre manual de files dins la mateixa franja, si està definit.
      const ra = rowRank(a), rb = rowRank(b);
      if (ra !== null && rb !== null && ra !== rb) return ra - rb;
      if (a.sex !== b.sex) return a.sex < b.sex ? -1 : 1;
      if (a.team !== b.team) return a.team < b.team ? -1 : 1;
      if (a.rival !== b.rival) return a.rival < b.rival ? -1 : 1;
      return 0;
    });

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

function allGames(data) {
  return (data.weeks || []).flatMap((w) => w.games || []);
}

function gameKey(g) {
  return [g.date, g.time, g.team, g.sex, g.rival, g.loc || "", g.home ? "home" : "away", g.friendly ? "friendly" : ""].join("|");
}

function identityKey(g) {
  return [g.team, g.sex, g.rival].join("|");
}

function changedFields(oldGame, newGame) {
  const fields = [];
  if (oldGame.date !== newGame.date) fields.push({ label: "Data", from: oldGame.date, to: newGame.date });
  if (oldGame.time !== newGame.time) fields.push({ label: "Hora", from: oldGame.time, to: newGame.time });
  if ((oldGame.loc || "") !== (newGame.loc || "")) fields.push({ label: "Lloc", from: oldGame.loc || "sense lloc", to: newGame.loc || "sense lloc" });
  if (!!oldGame.home !== !!newGame.home) fields.push({ label: "Casa/fora", from: oldGame.home ? "casa" : "fora", to: newGame.home ? "casa" : "fora" });
  if (!!oldGame.friendly !== !!newGame.friendly) fields.push({ label: "Tipus", from: oldGame.friendly ? "amistós" : "oficial", to: newGame.friendly ? "amistós" : "oficial" });
  return fields;
}

function gameSnapshot(g) {
  return {
    date: g.date,
    time: g.time,
    team: g.team,
    sex: g.sex,
    rival: g.rival,
    home: !!g.home,
    loc: g.loc || "",
    friendly: !!g.friendly,
  };
}

function buildChangeList(oldData, newData) {
  const oldGames = allGames(oldData);
  const newGames = allGames(newData);
  const oldExact = new Set(oldGames.map(gameKey));
  const newExact = new Set(newGames.map(gameKey));
  const addedRaw = newGames.filter((g) => !oldExact.has(gameKey(g)));
  const removedRaw = oldGames.filter((g) => !newExact.has(gameKey(g)));

  const removedByIdentity = new Map();
  removedRaw.forEach((g) => {
    const k = identityKey(g);
    if (!removedByIdentity.has(k)) removedByIdentity.set(k, []);
    removedByIdentity.get(k).push(g);
  });

  const changes = [];
  const usedRemoved = new Set();

  addedRaw.forEach((g) => {
    const candidates = removedByIdentity.get(identityKey(g)) || [];
    const old = candidates.find((x) => !usedRemoved.has(x) && changedFields(x, g).length);
    if (old) {
      usedRemoved.add(old);
      changes.push({ type: "changed", game: gameSnapshot(g), fields: changedFields(old, g) });
    } else {
      changes.push({ type: "added", game: gameSnapshot(g) });
    }
  });

  removedRaw
    .filter((g) => !usedRemoved.has(g))
    .forEach((g) => changes.push({ type: "removed", game: gameSnapshot(g) }));

  return changes;
}

async function main() {
  const pagePath = path.join(__dirname, "..", "partits.html");
  const html = fs.readFileSync(pagePath, "utf8");
  const re = /(<script id="partitsData"[^>]*>)([\s\S]*?)(<\/script>)/;
  const current = html.match(re);
  if (!current) {
    throw new Error("No s'ha trobat el bloc partitsData a partits.html");
  }
  const oldData = JSON.parse(current[2]);

  const calendars = await Promise.all(
    CALENDARS.map(async (c) => ({ sex: c.sex, ics: await fetchText(c.url) }))
  );
  const data = buildData(calendars);
  const latestChanges = buildChangeList(oldData, data);
  if (latestChanges.length) {
    data.latestChanges = {
      importedAt: new Date().toISOString(),
      changes: latestChanges,
    };
  } else if (oldData.latestChanges) {
    data.latestChanges = oldData.latestChanges;
  }
  const json = JSON.stringify(data);

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
