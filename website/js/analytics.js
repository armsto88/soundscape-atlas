const ATLAS = "soundscapeatlas.com";
const ENDPOINT = "https://tomarmstrong.goatcounter.com/count";
const DURATION_BANDS = [
  [10, "under-10s", "Under 10 seconds"],
  [30, "10-29s", "10–29 seconds"],
  [60, "30-59s", "30–59 seconds"],
  [300, "1-4m", "1–4 minutes"],
  [900, "5-14m", "5–14 minutes"],
  [1800, "15-29m", "15–29 minutes"],
  [3600, "30-59m", "30–59 minutes"],
  [Infinity, "60m-plus", "60 minutes or more"],
];

let send = null;
let lastPage = null;

export function startAnalytics() {
  if (![ATLAS, `www.${ATLAS}`].includes(location.hostname)) return;
  const queued = [];
  send = (hit) => queued.push(hit);
  const script = document.createElement("script");
  script.src = "https://gc.zgo.at/count.js";
  script.async = true;
  script.dataset.goatcounter = ENDPOINT;
  script.dataset.goatcounterSettings = JSON.stringify({ no_onload: true });
  script.addEventListener("load", () => {
    send = (hit) => {
      try {
        window.goatcounter.count(hit);
      } catch {
        // Browser privacy settings can block tracking during playback.
      }
    };
    queued.splice(0).forEach(send);
  });
  script.addEventListener("error", () => {
    send = null;
    queued.length = 0;
  });
  document.head.append(script);
}

export function trackPage(path, title) {
  if (path === lastPage) return;
  lastPage = path;
  send?.({ path: `/${ATLAS}${path}`, title });
}

function trackListening(session, action, label) {
  send?.({
    path: `${ATLAS}/listen/${encodeURIComponent(session.id)}/${action}`,
    title: `${session.site.site_name} (${session.id}) · ${label}`,
    event: true,
    no_session: true,
  });
}

// One listening run can span several hours of the same recording session.
export function createListeningTracker() {
  let session = null;
  let since = null;
  let elapsed = 0;

  function interrupt() {
    if (since === null) return;
    elapsed += (performance.now() - since) / 1000;
    since = null;
  }

  function resume() {
    if (session && since === null) since = performance.now();
  }

  function finish() {
    if (!session) return;
    interrupt();
    const [, band, label] = DURATION_BANDS.find(([upper]) => elapsed < upper);
    trackListening(session, `duration/${band}`, `Listening duration · ${label}`);
    session = null;
    elapsed = 0;
  }

  window.addEventListener("pagehide", finish);
  return {
    playing(next) {
      if (!send) return;
      if (session !== next) {
        finish();
        session = next;
        trackListening(session, "start", "Play start");
      }
      resume();
    },
    interrupt,
    resume,
    finish,
  };
}
