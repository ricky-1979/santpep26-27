"use strict";

const { onValueCreated } = require("firebase-functions/v2/database");
const { defineSecret, defineString } = require("firebase-functions/params");
const sendgrid = require("@sendgrid/mail");

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const PHYSIO_EMAIL_FROM = defineString("PHYSIO_EMAIL_FROM");
const PHYSIO_EMAIL_TO = defineString("PHYSIO_EMAIL_TO");

function splitRecipients(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ca-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid"
  }).format(date);
}

function escapeHtml(value) {
  return String(value || "—").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function requestText(request) {
  return [
    "Nova petició de fisioteràpia",
    "",
    `Data sol·licitud: ${formatDateTime(request.createdAt)}`,
    `Jugador/a: ${request.player || "—"}`,
    `Equip: ${request.team || "—"} ${request.gender || ""}`.trim(),
    `Data lesió: ${request.injuryDate || "—"}`,
    `Pare/mare: ${request.guardianName || "—"}`,
    `Email: ${request.email || "—"}`,
    `Telèfon: ${request.phone || "—"}`,
    "",
    "Descripció:",
    request.fullDescription || request.description || "—",
    "",
    "Peticions:",
    "https://ricky-1979.github.io/santpep26-27/fisio-peticions.html"
  ].join("\n");
}

function requestHtml(request) {
  const rows = [
    ["Data sol·licitud", formatDateTime(request.createdAt)],
    ["Jugador/a", request.player],
    ["Equip", `${request.team || "—"} ${request.gender || ""}`.trim()],
    ["Data lesió", request.injuryDate],
    ["Pare/mare", request.guardianName],
    ["Email", request.email],
    ["Telèfon", request.phone],
    ["Descripció", request.fullDescription || request.description]
  ];
  return `
    <div style="font-family:Arial,sans-serif;color:#2a2233;line-height:1.4">
      <h2 style="color:#5a2f7d;margin:0 0 12px">Nova petició de fisioteràpia</h2>
      <table style="border-collapse:collapse;width:100%;max-width:720px">
        ${rows.map(([label, value]) => `
          <tr>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #e6e0ee;color:#5a2f7d;white-space:nowrap">${escapeHtml(label)}</th>
            <td style="padding:8px;border-bottom:1px solid #e6e0ee">${escapeHtml(value)}</td>
          </tr>
        `).join("")}
      </table>
      <p style="margin-top:16px">
        <a href="https://ricky-1979.github.io/santpep26-27/fisio-peticions.html"
           style="display:inline-block;background:#713f97;color:#fff;text-decoration:none;border-radius:999px;padding:10px 14px;font-weight:bold">
          Obrir peticions
        </a>
      </p>
    </div>
  `;
}

exports.notifyPhysioRequestCreated = onValueCreated({
  region: "europe-west1",
  instance: "coord-fa09e-default-rtdb",
  ref: "/physioRequestsPrivate/season-26-27/{requestId}",
  secrets: [SENDGRID_API_KEY]
}, async (event) => {
  const request = event.data.val() || {};
  const recipients = splitRecipients(PHYSIO_EMAIL_TO.value());
  const from = String(PHYSIO_EMAIL_FROM.value() || "").trim();

  if (!from || recipients.length === 0) {
    console.warn("Physio email notification skipped: missing PHYSIO_EMAIL_FROM or PHYSIO_EMAIL_TO");
    return;
  }

  sendgrid.setApiKey(SENDGRID_API_KEY.value());

  await sendgrid.send({
    to: recipients,
    from,
    subject: `Nova petició de fisio · ${request.player || "Jugador/a"}`,
    text: requestText(request),
    html: requestHtml(request)
  });
});
