const state = {
  segments: [],
  filteredSegments: [],
  activeSegmentId: null,
  activeSegment: null,
  markersBySiteId: new Map(),
  sitesById: new Map(),
  focusedSiteId: null,
  selectedSpecies: new Set(),
  speciesIndex: [],
  hasFittedBounds: false,
  markerLayer: null,
  approximateArea: null,
  useClustering: true,
  isAudioPlaying: false,
  audioContext: null,
  analyser: null,
  spectrogram: {
    enabled: false,
    rafId: null,
  },
  spectrogramDockDrag: {
    active: false,
    offsetX: 0,
    offsetY: 0,
  },
  uiMode: "full",
  theme: "dark",
  signedInUser: null,
  authMode: "signin",
  likedSegmentsByUser: {},
  commentsBySegmentId: {},
  showTimelineComments: false,
  timelineActionSec: null,
  selectedTimelineComment: null,
};

const STORAGE_MODE_KEY = "soundscapeAtlas.uiMode";
const STORAGE_THEME_KEY = "soundscapeAtlas.theme";
const STORAGE_USER_KEY = "soundscapeAtlas.userName";
// Likes are stored in Cloudflare D1 via /api/likes
// Comments are now stored in Cloudflare D1 via /api/comments

let shareFeedbackTimer = null;

const dom = {
  datasetSummary: document.getElementById("datasetSummary"),
  brandLogo: document.getElementById("brandLogo"),
  brandLogoFallback: document.getElementById("brandLogoFallback"),
  authDialog: document.getElementById("authDialog"),
  authCloseBtn: document.getElementById("authCloseBtn"),
  authTitle: document.getElementById("authTitle"),
  authReason: document.getElementById("authReason"),
  authModeSignin: document.getElementById("authModeSignin"),
  authModeRegister: document.getElementById("authModeRegister"),
  authForm: document.getElementById("authForm"),
  authName: document.getElementById("authName"),
  authPassword: document.getElementById("authPassword"),
  authPasswordHint: document.getElementById("authPasswordHint"),
  authSubmitBtn: document.getElementById("authSubmitBtn"),
  authMessage: document.getElementById("authMessage"),
  signInBtn: document.getElementById("signInBtn"),
  librarySignInBtn: document.getElementById("librarySignInBtn"),
  userLibraryEmptyText: document.getElementById("userLibraryEmptyText"),
  signedInBadge: document.getElementById("signedInBadge"),
  settingsToggleBtn: document.getElementById("settingsToggleBtn"),
  settingsMenu: document.getElementById("settingsMenu"),
  modeSelect: document.getElementById("modeSelect"),
  themeSelect: document.getElementById("themeSelect"),
  settingsSignOutBtn: document.getElementById("settingsSignOutBtn"),
  clusterToggle: document.getElementById("clusterToggle"),
  dawnDuskOnlyToggle: document.getElementById("dawnDuskOnlyToggle"),
  seasonFilter: document.getElementById("seasonFilter"),
  speciesSearch: document.getElementById("speciesSearch"),
  speciesOptions: document.getElementById("speciesOptions"),
  speciesChips: document.getElementById("speciesChips"),
  speciesMore: document.getElementById("speciesMore"),
  hourRangeMin: document.getElementById("hourRangeMin"),
  hourRangeMax: document.getElementById("hourRangeMax"),
  hourRangeLabel: document.getElementById("hourRangeLabel"),
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),
  segmentList: document.getElementById("segmentList"),
  siteFocusBar: document.getElementById("siteFocusBar"),
  siteFocusLabel: document.getElementById("siteFocusLabel"),
  clearSiteFocusBtn: document.getElementById("clearSiteFocusBtn"),
  nowPlaying: document.getElementById("nowPlaying"),
  shareSegmentBtn: document.getElementById("shareSegmentBtn"),
  toggleSegmentLikeBtn: document.getElementById("toggleSegmentLikeBtn"),
  audioPlayer: document.getElementById("audioPlayer"),
  metadataGrid: document.getElementById("metadataGrid"),
  speciesList: document.getElementById("speciesList"),
  spectrogramMode: document.getElementById("spectrogramMode"),
  toggleSpectrogramBtn: document.getElementById("toggleSpectrogramBtn"),
  spectrogramDock: document.getElementById("spectrogramDock"),
  spectrogramDockHandle: document.getElementById("spectrogramDockHandle"),
  closeSpectrogramDockBtn: document.getElementById("closeSpectrogramDockBtn"),
  spectrogramCanvas: document.getElementById("spectrogramCanvas"),
  spectrogramImage: document.getElementById("spectrogramImage"),
  spectrogramHint: document.getElementById("spectrogramHint"),
  spectrogramAxis: document.getElementById("spectrogramAxis"),
  segmentImage: document.getElementById("segmentImage"),
  segmentImagePlaceholder: document.getElementById("segmentImagePlaceholder"),
  segmentImageCaption: document.getElementById("segmentImageCaption"),
  picturePanel: document.getElementById("picturePanel"),
  expandPictureBtn: document.getElementById("expandPictureBtn"),
  mapImageLightbox: document.getElementById("mapImageLightbox"),
  mapImagePreview: document.getElementById("mapImagePreview"),
  closeMapImageBtn: document.getElementById("closeMapImageBtn"),
  audioTimeline: document.getElementById("audioTimeline"),
  audioProgress: document.getElementById("audioProgress"),
  detectionMarkers: document.getElementById("detectionMarkers"),
  commentMarkers: document.getElementById("commentMarkers"),
  showCommentsToggle: document.getElementById("showCommentsToggle"),
  timelineActionMenu: document.getElementById("timelineActionMenu"),
  timelineActionText: document.getElementById("timelineActionText"),
  timelineActionApplyBtn: document.getElementById("timelineActionApplyBtn"),
  timelineActionCancelBtn: document.getElementById("timelineActionCancelBtn"),
  deleteTimelineCommentBtn: document.getElementById("deleteTimelineCommentBtn"),
  userLibraryList: document.getElementById("userLibraryList"),
  userLibraryEmpty: document.getElementById("userLibraryEmpty"),
  rightSidebar: document.getElementById("rightSidebar"),
  libraryToggleBtn: document.getElementById("libraryToggleBtn"),
  libraryCloseBtn: document.getElementById("libraryCloseBtn"),
  librarySidebarResizeHandle: document.getElementById("librarySidebarResizeHandle"),
  audioTimeLabel: document.getElementById("audioTimeLabel"),
  timelineHint: document.getElementById("timelineHint"),
  nowPlayingMeta: document.getElementById("nowPlayingMeta"),
  timelineLabels: document.getElementById("timelineLabels"),
  timelineLanes: document.getElementById("timelineLanes"),
  timelinePlayhead: document.getElementById("timelinePlayhead"),
  timelineEmpty: document.getElementById("timelineEmpty"),
  timelineAxis: document.getElementById("timelineAxis"),
  timelineTooltip: document.getElementById("timelineTooltip"),
  timelineActionLabel: document.getElementById("timelineActionLabel"),
  confidenceFilter: document.getElementById("confidenceFilter"),
  addCommentBtn: document.getElementById("addCommentBtn"),
  audioTimelinePanel: document.getElementById("audioTimelinePanel"),
  mobileFiltersBtn: document.getElementById("mobileFiltersBtn"),
  mobileClosePanelsBtn: document.getElementById("mobileClosePanelsBtn"),
  mobileMiniPlayer: document.getElementById("mobileMiniPlayer"),
  mobileMiniNowPlaying: document.getElementById("mobileMiniNowPlaying"),
  mobileMiniPlayPause: document.getElementById("mobileMiniPlayPause"),
  controlsPanel: document.getElementById("controlsPanel"),
  segmentPanel: document.getElementById("segmentPanel"),
  metadataPanel: document.getElementById("metadataPanel"),
  advancedFilters: document.getElementById("advancedFilters"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  iconPlay: document.getElementById("iconPlay"),
  iconPause: document.getElementById("iconPause"),
  skipBackBtn: document.getElementById("skipBackBtn"),
  skipFwdBtn: document.getElementById("skipFwdBtn"),
  seekBar: document.getElementById("seekBar"),
  seekCurrentTime: document.getElementById("seekCurrentTime"),
  seekDuration: document.getElementById("seekDuration"),
  volumeSlider: document.getElementById("volumeSlider"),
  timeBlockButtons: document.querySelectorAll("[data-time-block]"),
};

const map = L.map("map", {
  zoomControl: false,
  worldCopyJump: true,
}).setView([-30.458, 151.635], 10);

const imageryLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 20,
    maxNativeZoom: 19,
    attribution:
      "Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  }
).addTo(map);

const labelsLayer = L.tileLayer(
  "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 20,
    maxNativeZoom: 19,
    pane: "overlayPane",
    attribution: "Labels &copy; Esri",
  }
).addTo(map);

L.control
  .layers(
    {
      "High-res satellite": imageryLayer,
    },
    {
      "Place labels": labelsLayer,
    },
    { collapsed: true, position: "topleft" }
  )
  .addTo(map);

const LocateControl = L.Control.extend({
  options: {
    position: "topleft",
  },

  onAdd() {
    const container = L.DomUtil.create("div", "leaflet-control leaflet-control-locate");
    const button = L.DomUtil.create("button", "leaflet-control-locate-btn", container);
    button.type = "button";
    button.setAttribute("aria-label", "Find my location");
    button.title = "Find my location";
    button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>';

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.on(button, "click", (event) => {
      L.DomEvent.stop(event);
      findUserLocation();
    });

    return container;
  },
});

new LocateControl().addTo(map);

// Credits bottom-left keeps them clear of the phone "Panels" button.
map.attributionControl.setPosition("bottomleft");
map.attributionControl.setPrefix(false);

async function init() {
  try {
    setupBrandLogo();
    setupLibrarySidebarResize();

    const dataUrl = new URL("api/data.json", window.location.href);
    const response = await fetch(dataUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load metadata: ${response.status}`);
    }

    const payload = await response.json();
    state.segments = hydrateSegments(payload, response.url || dataUrl.href).filter((segment) => {
      const lat = Number(segment.latitude);
      const lng = Number(segment.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng);
    });

    dom.datasetSummary.textContent = describeDataset(payload);
    if (state.segments.length === 0) {
      const overlay = document.querySelector(".map-overlay p");
      if (overlay) {
        overlay.textContent = "No recordings are published yet. Check back soon.";
      }
    }

    // Read the shared link before anything selects a segment and rewrites the URL.
    const sharedSegmentId = getSharedSegmentIdFromUrl();

    buildFilterOptions(state.segments);
    wireEvents();
    restoreSession();
    state.commentsBySegmentId = {};
    renderUserLibrary();
    applyTheme(loadStoredTheme());
    applyUIMode(loadStoredUIMode());
    applyFilters({ autoSelect: false });

    // Collapse secondary panels on narrow screens for a cleaner initial view
    if (window.innerWidth <= 760) {
      if (dom.controlsPanel) dom.controlsPanel.open = false;
      if (dom.segmentPanel) dom.segmentPanel.open = false;
      if (dom.metadataPanel) dom.metadataPanel.open = false;
    }

    const sharedSegment = sharedSegmentId
      ? state.segments.find((segment) => segment.segment_id === sharedSegmentId)
      : null;
    if (sharedSegment) {
      // A shared link opens on its site, with that site's recordings listed.
      state.focusedSiteId = sharedSegment.site_id;
      selectSegment(sharedSegment.segment_id, { flyTo: true, autoplay: false });
    } else if (state.filteredSegments.length > 0) {
      // Otherwise keep the overview of all sites and just load a default segment.
      const initial = pickSiteSegment(state.filteredSegments[0].site_id);
      selectSegment(initial.segment_id, { flyTo: false, autoplay: false });
    } else {
      clearActiveSegmentState();
    }
  } catch (error) {
    dom.datasetSummary.textContent = "Could not load metadata. Run build script first.";
    dom.segmentList.innerHTML = `<li class="subtle">${escapeHtml(String(error.message || error))}</li>`;
  }
}

// data.json stores each site, session and species name once; put them back on
// every segment so the rest of the app can read segment.site_name, .site, etc.
// Detections are not in the index: they load per segment (see loadDetections).
function hydrateSegments(payload, dataUrl) {
  const sites = payload.sites || {};
  const sessions = payload.sessions || {};
  const speciesNames = Array.isArray(payload.species) ? payload.species : [];

  return (payload.segments || []).map((segment) => {
    const site = sites[segment.site_id] || {};
    const species = (segment.species_ids || [])
      .map((index) => speciesNames[index])
      .filter(Boolean);
    const detectionsUrl = segment.detections_url
      ? new URL(segment.detections_url, dataUrl).toString()
      : "";

    return {
      ...segment,
      site_name: site.site_name,
      latitude: site.latitude,
      longitude: site.longitude,
      site,
      session: sessions[segment.session_id] || {},
      species,
      speciesSet: new Set(species),
      detections_url: detectionsUrl,
      // undefined = not loaded yet; [] = nothing to load.
      detections: Number(segment.detection_count) > 0 && detectionsUrl ? undefined : [],
    };
  });
}

const detectionRequests = new Map();

function detectionsPending(segment) {
  return Boolean(segment) && !Array.isArray(segment.detections);
}

function loadDetections(segment) {
  if (!detectionsPending(segment)) {
    return Promise.resolve();
  }
  if (!detectionRequests.has(segment.segment_id)) {
    segment.detectionsError = false;
    const request = fetch(segment.detections_url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        segment.detections = Array.isArray(data.detections) ? data.detections : [];
      })
      .catch(() => {
        // Left unloaded so the next selection retries.
        segment.detectionsError = true;
      })
      .finally(() => {
        detectionRequests.delete(segment.segment_id);
      });
    detectionRequests.set(segment.segment_id, request);
  }
  return detectionRequests.get(segment.segment_id);
}

function setupBrandLogo() {
  if (!dom.brandLogo || !dom.brandLogoFallback) {
    return;
  }

  const configuredSrc = String(dom.brandLogo.dataset.logoSrc || "").trim();
  const candidateSources = Array.from(new Set([
    configuredSrc,
    "assets/logo.png",
    "assets/logo.svg",
  ].filter(Boolean)));

  if (candidateSources.length === 0) {
    dom.brandLogo.hidden = true;
    dom.brandLogoFallback.hidden = false;
    return;
  }

  const loadCandidate = (index) => {
    if (index >= candidateSources.length) {
      dom.brandLogo.hidden = true;
      dom.brandLogoFallback.hidden = false;
      return;
    }

    dom.brandLogo.onload = () => {
      dom.brandLogo.hidden = false;
      dom.brandLogoFallback.hidden = true;
    };

    dom.brandLogo.onerror = () => {
      loadCandidate(index + 1);
    };

    dom.brandLogo.src = candidateSources[index];
  };

  loadCandidate(0);
}

function wireEvents() {
  dom.authForm?.addEventListener("submit", submitAuthForm);
  dom.authModeSignin?.addEventListener("click", () => setAuthMode("signin"));
  dom.authModeRegister?.addEventListener("click", () => setAuthMode("register"));
  dom.authCloseBtn?.addEventListener("click", closeAuthDialog);
  dom.authDialog?.addEventListener("click", (event) => {
    if (event.target === dom.authDialog) {
      closeAuthDialog();
    }
  });
  dom.signInBtn?.addEventListener("click", () => openAuthDialog());
  dom.librarySignInBtn?.addEventListener("click", () => openAuthDialog());

  if (dom.settingsSignOutBtn) {
    dom.settingsSignOutBtn.addEventListener("click", () => {
      signOutUser();
      closeSettingsMenu();
    });
  }

  if (dom.settingsToggleBtn) {
    const handleSettingsToggle = (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleSettingsMenu();
    };

    dom.settingsToggleBtn.addEventListener("click", handleSettingsToggle);
    dom.settingsToggleBtn.addEventListener("touchstart", handleSettingsToggle, { passive: false });
  }

  if (dom.libraryToggleBtn) {
    dom.libraryToggleBtn.addEventListener("click", () => {
      toggleLibrarySidebar();
    });
  }

  if (dom.libraryCloseBtn) {
    dom.libraryCloseBtn.addEventListener("click", () => {
      closeLibrarySidebar();
    });
  }

  if (dom.modeSelect) {
    dom.modeSelect.addEventListener("change", () => {
      const mode = dom.modeSelect.value === "chill" ? "chill" : "full";
      applyUIMode(mode);
      storeUIMode(mode);
    });
  }

  if (dom.themeSelect) {
    dom.themeSelect.addEventListener("change", () => {
      const theme = dom.themeSelect.value === "light" ? "light" : "dark";
      applyTheme(theme);
      storeTheme(theme);
    });
  }

  if (dom.showCommentsToggle) {
    dom.showCommentsToggle.checked = state.showTimelineComments;
    dom.showCommentsToggle.addEventListener("change", () => {
      state.showTimelineComments = dom.showCommentsToggle.checked;
      state.selectedTimelineComment = null;
      updateDeleteTimelineCommentButton();
      renderDetectionTimeline(state.activeSegment);
    });
  }

  if (dom.audioTimeline) {
    dom.audioTimeline.addEventListener("click", seekFromTimelineClick);
    dom.audioTimeline.addEventListener("pointermove", handleTimelinePointer);
    dom.audioTimeline.addEventListener("pointerleave", hideTimelineTooltip);
    dom.audioTimeline.addEventListener("focusin", (event) => {
      if (event.target instanceof Element && event.target.dataset.tooltip) {
        showTimelineTooltip(event.target.dataset.tooltip, event.target.getBoundingClientRect());
      }
    });
    dom.audioTimeline.addEventListener("focusout", hideTimelineTooltip);
    dom.audioTimeline.addEventListener("keydown", (event) => {
      if (!state.activeSegment) {
        return;
      }
      const current = Number(dom.audioPlayer.currentTime) || 0;
      const moves = { ArrowLeft: current - 10, ArrowRight: current + 10, Home: 0, End: Infinity };
      if (event.key in moves) {
        event.preventDefault();
        event.stopPropagation();
        seekTo(moves[event.key], false);
      }
    });
  }

  dom.addCommentBtn?.addEventListener("click", openCommentMenu);

  // One listener for the whole segment list (rows are re-rendered often).
  dom.segmentList.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const like = event.target.closest("[data-segment-like-id]");
    if (like) {
      event.stopPropagation();
      toggleLikeForSegment(like.dataset.segmentLikeId || "");
      return;
    }
    const item = event.target.closest(".segment-item");
    if (item && item.dataset.segmentId) {
      selectSegment(item.dataset.segmentId, { flyTo: true, autoplay: isSmallPhoneViewport() });
      setMobilePanelsOpen(false);
    }
  });
  dom.segmentList.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target instanceof Element && event.target.classList.contains("segment-item")) {
      event.preventDefault();
      event.target.click();
    }
  });

  if (dom.confidenceFilter) {
    restoreMinConfidence();
    dom.confidenceFilter.addEventListener("change", () => {
      try {
        localStorage.setItem(STORAGE_CONFIDENCE_KEY, dom.confidenceFilter.value);
      } catch {
        // Ignore storage failures.
      }
      renderDetectionTimeline(state.activeSegment);
    });
  }

  // Keyboard: space plays/pauses, arrows skip 10 s (when not typing or on a control).
  document.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
      (dom.authDialog && !dom.authDialog.hidden) ||
      (target && target.closest("input, select, textarea, button, [contenteditable], .leaflet-container"))
    ) {
      return;
    }
    if (event.key === " " && dom.audioPlayer.getAttribute("src")) {
      event.preventDefault();
      dom.playPauseBtn?.click();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -10 : 10;
      seekTo((Number(dom.audioPlayer.currentTime) || 0) + delta, false);
    }
  });

  if (dom.timelineActionApplyBtn) {
    dom.timelineActionApplyBtn.addEventListener("click", () => {
      addTimelineAnnotationFromMenu();
    });
  }

  if (dom.timelineActionCancelBtn) {
    dom.timelineActionCancelBtn.addEventListener("click", () => {
      closeTimelineActionMenu();
    });
  }

  if (dom.timelineActionText) {
    dom.timelineActionText.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        addTimelineAnnotationFromMenu();
      }
    });
  }

  if (dom.deleteTimelineCommentBtn) {
    dom.deleteTimelineCommentBtn.addEventListener("click", () => {
      deleteSelectedTimelineComment();
    });
  }

  if (dom.userLibraryList) {
    dom.userLibraryList.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const dislikeBtn = event.target.closest(".library-dislike-btn");
      if (dislikeBtn) {
        const segmentId = dislikeBtn.getAttribute("data-segment-id") || "";
        removeLikeFromLibrary(segmentId);
        return;
      }

      const deleteBtn = event.target.closest(".library-delete-btn");
      if (deleteBtn) {
        const segmentId = deleteBtn.getAttribute("data-segment-id") || "";
        const commentId = deleteBtn.getAttribute("data-comment-id") || "";
        deleteCommentById(segmentId, commentId);
        return;
      }

      const button = event.target.closest(".library-recall-btn");
      if (!button) {
        return;
      }

      const segmentId = button.getAttribute("data-segment-id") || "";
      const commentId = button.getAttribute("data-comment-id") || "";
      const sec = Number(button.getAttribute("data-sec"));
      recallLibraryItem(segmentId, commentId, sec);
    });
  }

  if (dom.toggleSegmentLikeBtn) {
    dom.toggleSegmentLikeBtn.addEventListener("click", () => {
      if (!state.activeSegment) {
        return;
      }
      toggleLikeForSegment(state.activeSegment.segment_id);
    });
  }

  if (dom.shareSegmentBtn) {
    dom.shareSegmentBtn.addEventListener("click", () => {
      copyCurrentSegmentShareLink();
    });
  }

  if (dom.mobileFiltersBtn) {
    dom.mobileFiltersBtn.addEventListener("click", () => {
      if (isSmallPhoneViewport()) {
        toggleMobilePanels();
        return;
      }
      if (dom.controlsPanel) {
        dom.controlsPanel.open = true;
      }
      if (dom.advancedFilters) {
        dom.advancedFilters.open = true;
      }
      if (dom.controlsPanel) {
        dom.controlsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  if (dom.mobileClosePanelsBtn) {
    dom.mobileClosePanelsBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.body.classList.remove("mobile-panels-open");
      setMobilePanelsOpen(false);
    });
  }

  if (dom.mobileMiniPlayPause) {
    dom.mobileMiniPlayPause.addEventListener("click", () => {
      if (!dom.audioPlayer.src) {
        return;
      }
      if (dom.audioPlayer.paused) {
        dom.audioPlayer.play().catch(() => {});
      } else {
        dom.audioPlayer.pause();
      }
    });
  }

  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("orientationchange", handleViewportChange);

  // Custom transport
  if (dom.playPauseBtn) {
    dom.playPauseBtn.addEventListener("click", () => {
      if (dom.audioPlayer.paused) {
        dom.audioPlayer.play().catch(() => {});
      } else {
        dom.audioPlayer.pause();
      }
    });
  }

  if (dom.skipBackBtn) {
    dom.skipBackBtn.addEventListener("click", () => {
      dom.audioPlayer.currentTime = Math.max(0, dom.audioPlayer.currentTime - 10);
      if (!dom.audioPlayer.paused) return;
      if (dom.audioPlayer.src) dom.audioPlayer.play().catch(() => {});
    });
  }

  if (dom.skipFwdBtn) {
    dom.skipFwdBtn.addEventListener("click", () => {
      const dur = dom.audioPlayer.duration;
      dom.audioPlayer.currentTime = Number.isFinite(dur)
        ? Math.min(dur, dom.audioPlayer.currentTime + 10)
        : dom.audioPlayer.currentTime + 10;
    });
  }

  if (dom.seekBar) {
    dom.seekBar.addEventListener("input", () => {
      const duration = dom.audioPlayer.duration;
      if (Number.isFinite(duration) && duration > 0) {
        dom.audioPlayer.currentTime = Number(dom.seekBar.value) * duration;
      }
    });
  }

  if (dom.volumeSlider) {
    dom.volumeSlider.addEventListener("input", () => {
      dom.audioPlayer.volume = Number(dom.volumeSlider.value);
    });
  }

  if (dom.expandPictureBtn) {
    dom.expandPictureBtn.addEventListener("click", () => {
      if (dom.mapImageLightbox && !dom.mapImageLightbox.hidden) {
        closeMapImageLightbox();
      } else {
        openMapImageLightbox();
      }
    });
  }

  if (dom.closeMapImageBtn) {
    dom.closeMapImageBtn.addEventListener("click", () => {
      closeMapImageLightbox();
      setMobilePanelsOpen(false);
    });
  }

  if (dom.mapImageLightbox) {
    dom.mapImageLightbox.addEventListener("click", (event) => {
      if (event.target === dom.mapImageLightbox) {
        closeMapImageLightbox();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (dom.authDialog && !dom.authDialog.hidden) {
        closeAuthDialog();
        return;
      }
      closeMapImageLightbox();
      closeTimelineActionMenu();
      closeSettingsMenu();
      closeLibrarySidebar();
      setMobilePanelsOpen(false);
    }
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (dom.settingsMenu && !dom.settingsMenu.hidden) {
      const clickedInsideSettings = event.target.closest("#settingsMenu") || event.target.closest(".settings-wrap");
      if (!clickedInsideSettings) {
        closeSettingsMenu();
      }
    }

    if (dom.rightSidebar && !dom.rightSidebar.classList.contains("collapsed")) {
      const clickedInsideSidebar = event.target.closest("#rightSidebar") || event.target.closest("#libraryToggleBtn");
      if (!clickedInsideSidebar) {
        closeLibrarySidebar();
      }
    }

    if (document.body.classList.contains("mobile-panels-open") && isSmallPhoneViewport()) {
      const clickedInsidePanels = event.target.closest(".sidebar") || event.target.closest("#mobileFiltersBtn");
      if (!clickedInsidePanels) {
        setMobilePanelsOpen(false);
      }
    }

    if (!dom.timelineActionMenu || dom.timelineActionMenu.hidden) {
      return;
    }
    if (event.target.closest("#timelineActionMenu, #addCommentBtn")) {
      return;
    }
    closeTimelineActionMenu();
  });

  dom.clusterToggle.addEventListener("change", () => {
    state.useClustering = dom.clusterToggle.checked;
    renderMarkers(state.filteredSegments);
  });

  dom.dawnDuskOnlyToggle.addEventListener("change", applyFilters);
  dom.seasonFilter.addEventListener("change", applyFilters);
  dom.speciesSearch?.addEventListener("input", renderSpeciesFilter);
  dom.speciesOptions?.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === "checkbox") {
      setSpeciesSelected(event.target.value, event.target.checked);
    }
  });
  dom.speciesChips?.addEventListener("click", (event) => {
    const chip = event.target instanceof Element ? event.target.closest("[data-species]") : null;
    if (chip) {
      setSpeciesSelected(chip.dataset.species, false);
    }
  });

  dom.hourRangeMin.addEventListener("input", () => {
    if (Number(dom.hourRangeMin.value) > Number(dom.hourRangeMax.value)) {
      dom.hourRangeMax.value = dom.hourRangeMin.value;
    }
    updateHourRangeLabel();
    updateTimeBlockButtons();
    applyFilters();
  });

  dom.hourRangeMax.addEventListener("input", () => {
    if (Number(dom.hourRangeMax.value) < Number(dom.hourRangeMin.value)) {
      dom.hourRangeMin.value = dom.hourRangeMax.value;
    }
    updateHourRangeLabel();
    updateTimeBlockButtons();
    applyFilters();
  });

  for (const button of dom.timeBlockButtons) {
    button.addEventListener("click", () => {
      const block = button.dataset.timeBlock || "";
      const range = getTimeBlockRange(block);
      if (!range) {
        return;
      }

      dom.hourRangeMin.value = String(range.min);
      dom.hourRangeMax.value = String(range.max);
      updateHourRangeLabel();
      updateTimeBlockButtons();
      applyFilters();
    });
  }

  if (dom.clearSiteFocusBtn) {
    dom.clearSiteFocusBtn.addEventListener("click", () => {
      clearSiteFocus();
    });
  }

  dom.clearFiltersBtn.addEventListener("click", () => {
    state.focusedSiteId = null;
    dom.seasonFilter.value = "all";
    dom.clusterToggle.checked = true;
    dom.dawnDuskOnlyToggle.checked = false;
    dom.hourRangeMin.value = "0";
    dom.hourRangeMax.value = "23";
    state.selectedSpecies.clear();
    if (dom.speciesSearch) dom.speciesSearch.value = "";
    renderSpeciesFilter();
    state.useClustering = true;
    updateHourRangeLabel();
    updateTimeBlockButtons();
    applyFilters();
  });

  dom.spectrogramMode.addEventListener("change", () => {
    if (!state.spectrogram.enabled) {
      return;
    }
    stopSpectrogram();
    renderSpectrogramForCurrentSegment();
  });

  dom.toggleSpectrogramBtn.addEventListener("click", () => {
    state.spectrogram.enabled = !state.spectrogram.enabled;
    dom.toggleSpectrogramBtn.textContent = state.spectrogram.enabled
      ? "Hide spectrogram"
      : "Show spectrogram";

    if (state.spectrogram.enabled) {
      if (dom.spectrogramDock) {
        dom.spectrogramDock.hidden = false;
      }
      renderSpectrogramForCurrentSegment();
    } else {
      stopSpectrogram();
      dom.spectrogramCanvas.hidden = true;
      dom.spectrogramImage.hidden = true;
      dom.spectrogramHint.hidden = true;
      if (dom.spectrogramDock) {
        dom.spectrogramDock.hidden = true;
      }
    }
  });

  if (dom.closeSpectrogramDockBtn) {
    dom.closeSpectrogramDockBtn.addEventListener("mousedown", (event) => {
      // Prevent header drag logic from starting when pressing the hide button.
      event.stopPropagation();
    });

    dom.closeSpectrogramDockBtn.addEventListener("click", () => {
      state.spectrogram.enabled = false;
      dom.toggleSpectrogramBtn.textContent = "Show spectrogram";
      stopSpectrogram();
      dom.spectrogramCanvas.hidden = true;
      dom.spectrogramImage.hidden = true;
      dom.spectrogramHint.hidden = true;
      if (dom.spectrogramDock) {
        dom.spectrogramDock.hidden = true;
      }
    });
  }

  if (dom.spectrogramDockHandle && dom.spectrogramDock) {
    dom.spectrogramDockHandle.addEventListener("mousedown", (event) => {
      if (window.innerWidth <= 980) {
        return;
      }

      // If the click started on an interactive control, do not start dragging.
      if (event.target instanceof Element && event.target.closest("button, select, input, a")) {
        return;
      }

      state.spectrogramDockDrag.active = true;
      const rect = dom.spectrogramDock.getBoundingClientRect();
      const parentRect = dom.spectrogramDock.offsetParent instanceof Element
        ? dom.spectrogramDock.offsetParent.getBoundingClientRect()
        : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      state.spectrogramDockDrag.offsetX = event.clientX - rect.left;
      state.spectrogramDockDrag.offsetY = event.clientY - rect.top;
      dom.spectrogramDock.style.right = "auto";
      dom.spectrogramDock.style.bottom = "auto";
      dom.spectrogramDock.style.left = `${rect.left - parentRect.left}px`;
      dom.spectrogramDock.style.top = `${rect.top - parentRect.top}px`;
    });

    window.addEventListener("mousemove", (event) => {
      if (!state.spectrogramDockDrag.active) {
        return;
      }

      const dock = dom.spectrogramDock;
      const parentRect = dock.offsetParent instanceof Element
        ? dock.offsetParent.getBoundingClientRect()
        : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const width = dock.offsetWidth;
      const height = dock.offsetHeight;
      const nextLeft = Math.max(
        0,
        Math.min(parentRect.width - width, event.clientX - parentRect.left - state.spectrogramDockDrag.offsetX)
      );
      const nextTop = Math.max(
        0,
        Math.min(parentRect.height - height, event.clientY - parentRect.top - state.spectrogramDockDrag.offsetY)
      );
      dock.style.left = `${nextLeft}px`;
      dock.style.top = `${nextTop}px`;
    });

    window.addEventListener("mouseup", () => {
      state.spectrogramDockDrag.active = false;
    });
  }

  dom.audioPlayer.addEventListener("loadedmetadata", () => {
    if (dom.playPauseBtn) dom.playPauseBtn.disabled = false;
    const dur = dom.audioPlayer.duration;
    if (dom.seekDuration && Number.isFinite(dur)) {
      dom.seekDuration.textContent = formatTime(dur);
    }
    updateAudioTimelineProgress();
    renderDetectionTimeline(state.activeSegment);
    updateMobileMiniPlayer();
  });

  dom.audioPlayer.addEventListener("timeupdate", () => {
    updateAudioTimelineProgress();
  });

  dom.audioPlayer.addEventListener("play", () => {
    state.isAudioPlaying = true;
    refreshMarkerIcons();
    setPlayButtonState(true);
    updateMobileMiniPlayer();
    if (state.spectrogram.enabled && dom.spectrogramMode.value === "live") {
      ensureAudioGraph();
      startSpectrogram();
    }
  });

  dom.audioPlayer.addEventListener("pause", () => {
    state.isAudioPlaying = false;
    refreshMarkerIcons();
    setPlayButtonState(false);
    updateMobileMiniPlayer();
    if (state.spectrogram.enabled && dom.spectrogramMode.value === "live") {
      stopSpectrogram();
    }
  });

  dom.audioPlayer.addEventListener("ended", () => {
    state.isAudioPlaying = false;
    refreshMarkerIcons();
    setPlayButtonState(false);
    updateMobileMiniPlayer();
    if (state.spectrogram.enabled && dom.spectrogramMode.value === "live") {
      stopSpectrogram();
    }
  });

  dom.spectrogramImage.addEventListener("error", () => {
    dom.spectrogramImage.hidden = true;
    dom.spectrogramHint.hidden = false;
    dom.spectrogramHint.textContent = "No precomputed spectrogram image found for this segment.";
  });
}

// The icons are SVG elements, which have no `hidden` property, so the
// attribute must be set directly.
function setPlayButtonState(isPlaying) {
  if (dom.iconPlay) dom.iconPlay.toggleAttribute("hidden", isPlaying);
  if (dom.iconPause) dom.iconPause.toggleAttribute("hidden", !isPlaying);
  if (dom.playPauseBtn) dom.playPauseBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
}

function isSmallPhoneViewport() {
  return window.matchMedia("(max-width: 700px)").matches;
}

function setMobilePanelsOpen(open) {
  const shouldOpen = Boolean(open) && isSmallPhoneViewport();
  document.body.classList.toggle("mobile-panels-open", shouldOpen);
  if (dom.mobileFiltersBtn) {
    dom.mobileFiltersBtn.textContent = "Panels";
    dom.mobileFiltersBtn.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  }
}

function toggleMobilePanels() {
  const isOpen = document.body.classList.contains("mobile-panels-open");
  setMobilePanelsOpen(!isOpen);
}

function updateMobileMiniPlayer() {
  if (!dom.mobileMiniPlayer || !dom.mobileMiniNowPlaying || !dom.mobileMiniPlayPause) {
    return;
  }

  const hasSegment = Boolean(state.activeSegment);
  const shouldShow = isSmallPhoneViewport() && hasSegment;
  dom.mobileMiniPlayer.hidden = !shouldShow;
  if (!shouldShow) {
    return;
  }

  dom.mobileMiniNowPlaying.textContent = hasSegment
    ? `${state.activeSegment.site_name || state.activeSegment.site_id} - ${state.activeSegment.segment_id}`
    : "No segment selected.";
  dom.mobileMiniPlayPause.disabled = !Boolean(dom.audioPlayer.src);
  const isPaused = dom.audioPlayer.paused;
  dom.mobileMiniPlayPause.textContent = isPaused ? "Play" : "Pause";
  dom.mobileMiniPlayPause.setAttribute("aria-label", isPaused ? "Play" : "Pause");
}

function handleViewportChange() {
  if (!isSmallPhoneViewport()) {
    setMobilePanelsOpen(false);
  }
  updateMobileMiniPlayer();
  window.setTimeout(() => {
    map.invalidateSize();
  }, 120);
}

function findUserLocation() {
  if (!navigator.geolocation) {
    if (dom.timelineHint) {
      setStatus("Location is not available in this browser.");
    }
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const latitude = Number(position.coords.latitude);
      const longitude = Number(position.coords.longitude);
      const accuracy = Number(position.coords.accuracy);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return;
      }

      map.flyTo([latitude, longitude], Math.max(map.getZoom(), 13), { duration: 0.9 });

      if (dom.timelineHint) {
        const accuracyText = Number.isFinite(accuracy) ? ` Accuracy about ${Math.round(accuracy)} m.` : "";
        setStatus(`Centered on your location.${accuracyText}`);
      }
    },
    () => {
      if (dom.timelineHint) {
        setStatus("Could not access your location.");
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    }
  );
}

function loadStoredUIMode() {
  try {
    const mode = localStorage.getItem(STORAGE_MODE_KEY);
    return mode === "chill" ? "chill" : "full";
  } catch {
    return "full";
  }
}

function storeUIMode(mode) {
  try {
    localStorage.setItem(STORAGE_MODE_KEY, mode);
  } catch {
    // Ignore storage failures.
  }
}

function loadStoredTheme() {
  try {
    const theme = localStorage.getItem(STORAGE_THEME_KEY);
    if (theme === "light" || theme === "sandstone") {
      return "light";
    }
    return "dark";
  } catch {
    return "dark";
  }
}

function storeTheme(theme) {
  try {
    localStorage.setItem(STORAGE_THEME_KEY, theme);
  } catch {
    // Ignore storage failures.
  }
}

function applyTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  state.theme = nextTheme;
  document.body.setAttribute("data-theme", nextTheme);

  if (dom.themeSelect) {
    dom.themeSelect.value = nextTheme;
  }
}

function toggleSettingsMenu() {
  if (!dom.settingsMenu || !dom.settingsToggleBtn) {
    return;
  }
  // Prevent the menu from sitting under the mobile panels sheet.
  setMobilePanelsOpen(false);
  dom.settingsMenu.hidden = !dom.settingsMenu.hidden;
  dom.settingsToggleBtn.setAttribute("aria-expanded", dom.settingsMenu.hidden ? "false" : "true");
}

function closeSettingsMenu() {
  if (!dom.settingsMenu || !dom.settingsToggleBtn) {
    return;
  }
  dom.settingsMenu.hidden = true;
  dom.settingsToggleBtn.setAttribute("aria-expanded", "false");
}

function setupLibrarySidebarResize() {
  const handle = dom.librarySidebarResizeHandle;
  const sidebar = dom.rightSidebar;
  if (!handle || !sidebar) return;

  let startX = 0;
  let startWidth = 0;
  let dragging = false;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add("dragging");
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const delta = startX - e.clientX;
    const maxW = Math.floor(window.innerWidth * 0.75);
    const newWidth = Math.min(Math.max(220, startWidth + delta), maxW);
    sidebar.style.width = newWidth + "px";
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
}

function toggleLibrarySidebar() {
  if (!dom.rightSidebar) return;
  const isCollapsed = dom.rightSidebar.classList.toggle("collapsed");
  if (dom.libraryToggleBtn) {
    dom.libraryToggleBtn.setAttribute("aria-expanded", String(!isCollapsed));
  }
}

function closeLibrarySidebar() {
  if (!dom.rightSidebar) return;
  dom.rightSidebar.classList.add("collapsed");
  if (dom.libraryToggleBtn) {
    dom.libraryToggleBtn.setAttribute("aria-expanded", "false");
  }
}

function applyUIMode(mode) {
  const nextMode = mode === "chill" ? "chill" : "full";
  state.uiMode = nextMode;
  document.body.setAttribute("data-mode", nextMode);

  if (dom.modeSelect) {
    dom.modeSelect.value = nextMode;
  }

  if (nextMode === "chill") {
    closeLibrarySidebar();
    if (state.spectrogram.enabled) {
      state.spectrogram.enabled = false;
      stopSpectrogram();
      if (dom.toggleSpectrogramBtn) {
        dom.toggleSpectrogramBtn.textContent = "Show spectrogram";
      }
      if (dom.spectrogramCanvas) dom.spectrogramCanvas.hidden = true;
      if (dom.spectrogramImage) dom.spectrogramImage.hidden = true;
      if (dom.spectrogramHint) dom.spectrogramHint.hidden = true;
      if (dom.spectrogramDock) dom.spectrogramDock.hidden = true;
    }

    if (dom.controlsPanel) {
      dom.controlsPanel.open = true;
    }
    if (dom.picturePanel) {
      dom.picturePanel.open = false;
    }
  }

  handleViewportChange();
}

// ---------------------------------------------------------------------------
// Accounts. The server keeps the session in an HttpOnly cookie; the page only
// learns who is signed in from /api/auth/me. Browsing never requires an account.
// ---------------------------------------------------------------------------

const AUTH_DEFAULT_REASON = "Save segments to your library and leave comments on the timeline.";

function openAuthDialog(reason = "", mode = "signin") {
  if (!dom.authDialog) {
    return;
  }
  closeSettingsMenu();
  setAuthMode(mode);
  if (dom.authReason) {
    dom.authReason.textContent = reason || AUTH_DEFAULT_REASON;
  }
  setAuthMessage("");
  dom.authDialog.hidden = false;
  window.setTimeout(() => {
    (dom.authName && !dom.authName.value ? dom.authName : dom.authPassword)?.focus();
  }, 0);
}

function closeAuthDialog() {
  if (!dom.authDialog || dom.authDialog.hidden) {
    return;
  }
  dom.authDialog.hidden = true;
  if (dom.authPassword) {
    dom.authPassword.value = "";
  }
}

function setAuthMode(mode) {
  state.authMode = mode === "register" ? "register" : "signin";
  const registering = state.authMode === "register";
  dom.authModeSignin?.classList.toggle("active", !registering);
  dom.authModeSignin?.setAttribute("aria-selected", String(!registering));
  dom.authModeRegister?.classList.toggle("active", registering);
  dom.authModeRegister?.setAttribute("aria-selected", String(registering));
  if (dom.authTitle) dom.authTitle.textContent = registering ? "Create account" : "Sign in";
  if (dom.authSubmitBtn) dom.authSubmitBtn.textContent = registering ? "Create account" : "Sign in";
  if (dom.authPassword) dom.authPassword.autocomplete = registering ? "new-password" : "current-password";
  if (dom.authPasswordHint) dom.authPasswordHint.hidden = !registering;
  setAuthMessage("");
}

function setAuthMessage(text, isError = false) {
  if (!dom.authMessage) {
    return;
  }
  dom.authMessage.textContent = text;
  dom.authMessage.classList.toggle("error", isError);
}

async function submitAuthForm(event) {
  event?.preventDefault();
  const name = (dom.authName?.value || "").trim();
  const password = dom.authPassword?.value || "";
  const registering = state.authMode === "register";

  if (!name) {
    setAuthMessage("Enter a username.", true);
    dom.authName?.focus();
    return;
  }
  if (!password) {
    setAuthMessage("Enter a password.", true);
    dom.authPassword?.focus();
    return;
  }
  if (registering && password.length < 8) {
    setAuthMessage("Passwords need at least 8 characters.", true);
    dom.authPassword?.focus();
    return;
  }

  setAuthMessage(registering ? "Creating account…" : "Signing in…");
  if (dom.authSubmitBtn) dom.authSubmitBtn.disabled = true;

  try {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password, mode: state.authMode }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || !data || !data.name) {
      if (response.status === 404 && data && data.error) {
        setAuthMessage("No account with that username. Check the spelling, or create an account.", true);
      } else if (data && data.error) {
        setAuthMessage(data.error, true);
      } else {
        setAuthMessage("Accounts are not available right now.", true);
      }
      if (response.status === 401 && dom.authPassword) {
        dom.authPassword.value = "";
        dom.authPassword.focus();
      }
      return;
    }

    closeAuthDialog();
    await completeSignIn(data.name);
    if (dom.timelineHint) {
      setStatus(registering ? `Welcome, ${data.name}.` : `Signed in as ${data.name}.`);
    }
  } catch {
    setAuthMessage("Network error. Check your connection and try again.", true);
  } finally {
    if (dom.authSubmitBtn) dom.authSubmitBtn.disabled = false;
  }
}

async function completeSignIn(name) {
  state.signedInUser = name;
  updateAuthUI();
  await fetchMyLikes();
  renderUserLibrary();
  fetchMyComments();
}

function resetSignedInState() {
  if (state.signedInUser) {
    delete state.likedSegmentsByUser[state.signedInUser];
  }
  state.signedInUser = null;
  state.selectedTimelineComment = null;
  updateAuthUI();
  renderUserLibrary();
}

async function signOutUser() {
  closeSettingsMenu();
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // The cookie expires on its own; the page forgets the user either way.
  }
  resetSignedInState();
  if (dom.timelineHint) {
    setStatus("Signed out.");
  }
}

// Called when the server answers 401: the session expired or was revoked.
function handleSessionEnded() {
  resetSignedInState();
  openAuthDialog("Your session has ended. Sign in again to continue.");
}

function requireSignIn(reason) {
  if (state.signedInUser) {
    return true;
  }
  openAuthDialog(reason);
  return false;
}

async function restoreSession() {
  try {
    // Older versions kept the username in localStorage; it is no longer trusted.
    localStorage.removeItem(STORAGE_USER_KEY);
  } catch {
    // Ignore storage failures.
  }

  updateAuthUI();
  renderUserLibrary();
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (data && data.name) {
      await completeSignIn(data.name);
    }
  } catch {
    // No accounts backend (e.g. a static preview): browse as a guest.
  }
}

async function fetchMyLikes() {
  if (!state.signedInUser) {
    return;
  }
  try {
    const response = await fetch("/api/likes", { cache: "no-store" });
    if (response.status === 401) {
      handleSessionEnded();
      return;
    }
    if (!response.ok) {
      return;
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) {
      return;
    }
    const likes = {};
    for (const row of rows) {
      likes[row.segment_id] = row.created_at;
    }
    state.likedSegmentsByUser[state.signedInUser] = likes;
    updateActiveSegmentLikeButton();
    renderSegmentList(state.filteredSegments);
  } catch {
    // Likes show up again on the next load.
  }
}

function getSharedSegmentIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const segmentId = String(params.get("segment") || "").trim();
  return segmentId || "";
}

function buildSegmentShareUrl(segmentId) {
  const url = new URL(window.location.href);
  if (segmentId) {
    url.searchParams.set("segment", segmentId);
  } else {
    url.searchParams.delete("segment");
  }
  return url.toString();
}

function updateSegmentShareUrl(segmentId) {
  const url = new URL(window.location.href);
  if (segmentId) {
    url.searchParams.set("segment", segmentId);
  } else {
    url.searchParams.delete("segment");
  }
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function showShareButtonFeedback(copied) {
  if (!dom.shareSegmentBtn) {
    return;
  }

  if (shareFeedbackTimer) {
    clearTimeout(shareFeedbackTimer);
    shareFeedbackTimer = null;
  }

  if (copied) {
    dom.shareSegmentBtn.textContent = "Copied!";
    dom.shareSegmentBtn.title = "Link copied";
    shareFeedbackTimer = window.setTimeout(() => {
      if (!dom.shareSegmentBtn) {
        return;
      }
      dom.shareSegmentBtn.textContent = "Share";
      dom.shareSegmentBtn.title = "Copy share link";
      shareFeedbackTimer = null;
    }, 1800);
    return;
  }

  dom.shareSegmentBtn.textContent = "Share";
  dom.shareSegmentBtn.title = "Copy share link";
}

async function copyCurrentSegmentShareLink() {
  const segmentId = state.activeSegment?.segment_id;
  if (!segmentId) {
    if (dom.timelineHint) {
      setStatus("Select a segment before sharing.");
    }
    showShareButtonFeedback(false);
    return;
  }

  const shareUrl = buildSegmentShareUrl(segmentId);
  try {
    await navigator.clipboard.writeText(shareUrl);
    showShareButtonFeedback(true);
    if (dom.timelineHint) {
      setStatus("Share link copied.");
    }
  } catch {
    const fallback = document.createElement("input");
    fallback.value = shareUrl;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "absolute";
    fallback.style.left = "-9999px";
    document.body.append(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    if (copied) {
      showShareButtonFeedback(true);
      if (dom.timelineHint) {
        setStatus("Share link copied.");
      }
    } else {
      showShareButtonFeedback(false);
      if (dom.timelineHint) {
        setStatus("Could not copy link automatically.");
      }
    }
  }
}

function getSignedInUserLikesMap() {
  if (!state.signedInUser) {
    return {};
  }
  const entry = state.likedSegmentsByUser[state.signedInUser];
  if (!entry || typeof entry !== "object") {
    return {};
  }
  return entry;
}

function isSegmentLikedForSignedInUser(segmentId) {
  if (!state.signedInUser || !segmentId) {
    return false;
  }
  const likes = getSignedInUserLikesMap();
  return Boolean(likes[segmentId]);
}

async function toggleLikeForSegment(segmentId) {
  if (!segmentId || !requireSignIn("Sign in to save segments to your library.")) {
    return;
  }

  const user = state.signedInUser;
  const current = getSignedInUserLikesMap();
  const isLiked = Boolean(current[segmentId]);

  // Optimistic update so the UI responds instantly; reverted if the server says no.
  const next = { ...current };
  if (isLiked) {
    delete next[segmentId];
  } else {
    next[segmentId] = new Date().toISOString();
  }
  state.likedSegmentsByUser[user] = next;
  refreshLikeViews();

  let saved = false;
  try {
    const response = await fetch("/api/likes", {
      method: isLiked ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segment_id: segmentId }),
    });
    if (response.status === 401) {
      handleSessionEnded();
      return;
    }
    saved = response.ok;
  } catch {
    saved = false;
  }

  if (!saved) {
    if (state.signedInUser === user) {
      state.likedSegmentsByUser[user] = current;
      refreshLikeViews();
    }
    if (dom.timelineHint) {
      setStatus("Could not update your library. Try again.");
    }
    return;
  }

  if (dom.timelineHint) {
    setStatus(isLiked ? "Removed from your library." : "Saved to your library.");
  }
}

function refreshLikeViews() {
  updateActiveSegmentLikeButton();
  renderSegmentList(state.filteredSegments);
  renderUserLibrary();
}

function updateActiveSegmentLikeButton() {
  if (!dom.toggleSegmentLikeBtn) {
    return;
  }

  const segmentId = state.activeSegment?.segment_id;
  const liked = isSegmentLikedForSignedInUser(segmentId);
  // Guests can press it too: it opens the sign-in dialog.
  dom.toggleSegmentLikeBtn.disabled = !segmentId;
  dom.toggleSegmentLikeBtn.classList.toggle("active", liked);
  dom.toggleSegmentLikeBtn.innerHTML = liked
    ? '<span aria-hidden="true">♥</span>'
    : '<span aria-hidden="true">♡</span>';
  dom.toggleSegmentLikeBtn.setAttribute("aria-label", liked ? "Remove from library" : "Save to library");
  dom.toggleSegmentLikeBtn.title = liked ? "Saved to your library" : "Save to library";
}

async function fetchCommentsForSegment(segmentId) {
  try {
    const response = await fetch(`/api/comments?segment_id=${encodeURIComponent(segmentId)}`);
    if (!response.ok) {
      return;
    }
    const comments = await response.json();
    if (Array.isArray(comments)) {
      state.commentsBySegmentId[segmentId] = comments
        .map((c) => ({ ...c, type: "comment" }))
        .sort((a, b) => Number(a.sec) - Number(b.sec));
    }
  } catch {
    // Network errors silently ignored; fall back to in-memory state.
  }
}

async function fetchMyComments() {
  if (!state.signedInUser) {
    return;
  }
  try {
    const response = await fetch("/api/comments?mine=1", { cache: "no-store" });
    if (response.status === 401) {
      handleSessionEnded();
      return;
    }
    if (!response.ok) {
      return;
    }
    const comments = await response.json();
    if (!Array.isArray(comments)) {
      return;
    }
    for (const comment of comments) {
      const sid = comment.segment_id;
      if (!Array.isArray(state.commentsBySegmentId[sid])) {
        state.commentsBySegmentId[sid] = [];
      }
      if (!state.commentsBySegmentId[sid].some((c) => c.id === comment.id)) {
        state.commentsBySegmentId[sid].push({ ...comment, type: "comment" });
      }
    }
    for (const sid of Object.keys(state.commentsBySegmentId)) {
      state.commentsBySegmentId[sid].sort((a, b) => Number(a.sec) - Number(b.sec));
    }
    renderUserLibrary();
  } catch {
    // Silently ignored.
  }
}

async function addTimelineComment(annotation) {
  const segmentId = state.activeSegment?.segment_id;
  if (!segmentId) {
    if (dom.timelineHint) {
      setStatus("Select a segment before adding a comment.");
    }
    return;
  }

  if (!requireSignIn("Sign in to leave comments on the timeline.")) {
    return;
  }

  const text = String(annotation?.text || "").trim();
  if (!text) {
    if (dom.timelineHint) {
      setStatus("Enter comment text before adding.");
    }
    return;
  }

  const atSecRaw = Number(annotation?.sec);
  const atSec = Number.isFinite(atSecRaw)
    ? Math.max(0, atSecRaw)
    : Math.max(0, Number(dom.audioPlayer.currentTime) || 0);

  if (dom.timelineHint) {
    setStatus("Saving comment…");
  }

  try {
    const response = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segment_id: segmentId, text, sec: atSec }),
    });

    if (response.status === 401) {
      handleSessionEnded();
      return;
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (dom.timelineHint) {
        setStatus(`Could not save comment: ${err.error || response.status}`);
      }
      return;
    }

    const comment = await response.json();
    const list = Array.isArray(state.commentsBySegmentId[segmentId])
      ? state.commentsBySegmentId[segmentId]
      : [];

    list.push({ ...comment, type: "comment" });
    list.sort((a, b) => Number(a.sec) - Number(b.sec));
    state.commentsBySegmentId[segmentId] = list;
    renderUserLibrary();

    state.showTimelineComments = true;
    if (dom.showCommentsToggle) {
      dom.showCommentsToggle.checked = true;
    }

    state.selectedTimelineComment = null;
    updateDeleteTimelineCommentButton();
    renderDetectionTimeline(state.activeSegment);

    if (dom.timelineHint) {
      setStatus(`Comment added at ${formatTime(atSec)}.`);
    }
  } catch {
    if (dom.timelineHint) {
      setStatus("Network error. Could not save comment.");
    }
  }
}

function closeTimelineActionMenu() {
  if (!dom.timelineActionMenu) {
    return;
  }
  dom.timelineActionMenu.hidden = true;
  state.timelineActionSec = null;
}

function addTimelineAnnotationFromMenu() {
  const text = String(dom.timelineActionText?.value || "").trim();
  const sec = state.timelineActionSec ?? Number(dom.audioPlayer.currentTime);

  addTimelineComment({ text, sec });
  closeTimelineActionMenu();
}

function updateAuthUI() {
  const signedIn = Boolean(state.signedInUser);

  if (dom.signInBtn) {
    dom.signInBtn.hidden = signedIn;
  }
  if (dom.signedInBadge) {
    dom.signedInBadge.hidden = !signedIn;
    dom.signedInBadge.textContent = signedIn ? state.signedInUser : "";
    dom.signedInBadge.title = signedIn ? `Signed in as ${state.signedInUser}` : "";
  }
  if (dom.settingsSignOutBtn) {
    dom.settingsSignOutBtn.hidden = !signedIn;
  }

  renderSegmentList(state.filteredSegments);
  updateActiveSegmentLikeButton();
  updateDeleteTimelineCommentButton();
}

function getSignedInUserLibraryItems() {
  if (!state.signedInUser) {
    return [];
  }

  const items = [];

  const likes = getSignedInUserLikesMap();
  for (const [segmentId, createdAtRaw] of Object.entries(likes)) {
    const segment = state.segments.find((entry) => entry.segment_id === segmentId) || null;
    items.push({
      kind: "segment",
      segmentId,
      segment,
      commentId: "",
      text: "",
      sec: 0,
      createdAt: String(createdAtRaw || ""),
    });
  }

  for (const [segmentId, annotations] of Object.entries(state.commentsBySegmentId)) {
    if (!Array.isArray(annotations)) {
      continue;
    }

    const segment = state.segments.find((entry) => entry.segment_id === segmentId) || null;
    for (const annotation of annotations) {
      if (!annotation || annotation.user !== state.signedInUser) {
        continue;
      }

      items.push({
        kind: "comment",
        segmentId,
        segment,
        commentId: String(annotation.id || ""),
        text: String(annotation.text || ""),
        sec: Number(annotation.sec) || 0,
        createdAt: String(annotation.created_at || ""),
      });
    }
  }

  items.sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
  return items;
}

function renderUserLibrary() {
  if (!dom.userLibraryList || !dom.userLibraryEmpty) {
    return;
  }

  dom.userLibraryList.innerHTML = "";

  const showEmpty = (text, offerSignIn) => {
    dom.userLibraryEmpty.hidden = false;
    if (dom.userLibraryEmptyText) dom.userLibraryEmptyText.textContent = text;
    if (dom.librarySignInBtn) dom.librarySignInBtn.hidden = !offerSignIn;
  };

  if (!state.signedInUser) {
    showEmpty("Sign in to keep a library of saved segments and your comments.", true);
    return;
  }

  const items = getSignedInUserLibraryItems();
  if (items.length === 0) {
    showEmpty("Nothing saved yet. Press ♡ on a segment to keep it here; your timeline comments appear here too.", false);
    return;
  }

  dom.userLibraryEmpty.hidden = true;

  const likedItems = items.filter((item) => item.kind === "segment");
  const commentItems = items.filter((item) => item.kind === "comment");

  const renderSection = (title, sectionItems, isCommentSection) => {
    const wrapper = document.createElement("section");
    wrapper.className = "library-section";

    const heading = document.createElement("h3");
    heading.className = "library-section-title";
    heading.textContent = title;
    wrapper.append(heading);

    if (sectionItems.length === 0) {
      const empty = document.createElement("p");
      empty.className = "subtle";
      empty.textContent = isCommentSection ? "No comments yet." : "No liked segments yet.";
      wrapper.append(empty);
      dom.userLibraryList.append(wrapper);
      return;
    }

    const list = document.createElement("ul");
    list.className = "user-library-list";

    for (const item of sectionItems) {
      const li = document.createElement("li");
      li.className = "library-item";

      const locationLabel = item.segment
        ? `${item.segment.site_name || item.segment.site_id} · ${formatDayLabel(item.segment.local_date)}, ${formatClock(item.segment.segment_start_local)}`
        : item.segmentId;
      const noteText = isCommentSection ? item.text || "Comment" : "Saved segment";

      li.innerHTML = `
        <div class="library-item-head">
          <strong>${escapeHtml(locationLabel)}</strong>
          <span class="library-kind">${isCommentSection ? "Comment" : "Segment"}</span>
        </div>
        <p>${isCommentSection ? `${escapeHtml(formatTime(item.sec))} - ` : ""}${escapeHtml(noteText)}</p>
        <div class="library-actions">
          <button
            type="button"
            class="library-recall-btn"
            data-segment-id="${escapeHtml(item.segmentId)}"
            data-comment-id="${escapeHtml(item.commentId)}"
            data-sec="${escapeHtml(String(item.sec))}"
          >Open segment</button>
          ${isCommentSection
            ? `<button type="button" class="library-delete-btn" data-segment-id="${escapeHtml(item.segmentId)}" data-comment-id="${escapeHtml(item.commentId)}">Delete</button>`
            : `<button type="button" class="library-dislike-btn" data-segment-id="${escapeHtml(item.segmentId)}">Remove</button>`}
        </div>
      `;

      list.append(li);
    }

    wrapper.append(list);
    dom.userLibraryList.append(wrapper);
  };

  renderSection("Liked Segments", likedItems, false);
  renderSection("My Comments", commentItems, true);
}

function recallLibraryItem(segmentId, commentId, sec) {
  if (!segmentId) {
    return;
  }

  if (commentId) {
    state.showTimelineComments = true;
    if (dom.showCommentsToggle) {
      dom.showCommentsToggle.checked = true;
    }
  }

  selectSegment(segmentId, { flyTo: true, autoplay: isSmallPhoneViewport() });
  setMobilePanelsOpen(false);

  const seekTo = Number.isFinite(sec) ? Math.max(0, sec) : 0;
  const setTime = () => {
    dom.audioPlayer.currentTime = seekTo;
    updateAudioTimelineProgress();
  };

  if (Number.isFinite(dom.audioPlayer.duration) && dom.audioPlayer.duration > 0) {
    setTime();
  } else {
    dom.audioPlayer.addEventListener("loadedmetadata", setTime, { once: true });
  }

  if (commentId) {
    state.selectedTimelineComment = { segmentId, commentId };
  } else {
    state.selectedTimelineComment = null;
  }
  updateDeleteTimelineCommentButton();

  if (dom.timelineHint) {
    setStatus(`Recalled ${formatTime(seekTo)} from your library.`);
  }
}

function buildFilterOptions(segments) {
  const seasons = [...new Set(segments.map((segment) => segment.season).filter(Boolean))].sort();
  const speciesNames = new Set();

  for (const segment of segments) {
    for (const species of segment.species || []) {
      const name = String(species).trim();
      if (name) {
        speciesNames.add(name);
      }
    }
  }

  for (const season of seasons) {
    const option = document.createElement("option");
    option.value = season;
    option.textContent = season;
    dom.seasonFilter.append(option);
  }

  // Species index for the searchable filter: how many segments contain each.
  const segmentCounts = new Map();
  for (const segment of segments) {
    for (const name of segment.speciesSet || []) {
      segmentCounts.set(name, (segmentCounts.get(name) || 0) + 1);
    }
  }
  state.speciesIndex = [...speciesNames]
    .map((name) => ({ name, segments: segmentCounts.get(name) || 0 }))
    .sort((a, b) => b.segments - a.segments || a.name.localeCompare(b.name));
  renderSpeciesFilter();

  updateHourRangeLabel();
}

const SPECIES_OPTIONS_LIMIT = 40;

function renderSpeciesFilter() {
  if (!dom.speciesOptions) {
    return;
  }
  const query = (dom.speciesSearch?.value || "").trim().toLowerCase();
  const matches = state.speciesIndex.filter((entry) => !query || entry.name.toLowerCase().includes(query));

  dom.speciesOptions.innerHTML = "";
  for (const entry of matches.slice(0, SPECIES_OPTIONS_LIMIT)) {
    const item = document.createElement("li");
    const label = document.createElement("label");
    label.className = "species-option";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = entry.name;
    box.checked = state.selectedSpecies.has(entry.name);
    const name = document.createElement("span");
    name.className = "species-option-name";
    name.textContent = entry.name;
    const count = document.createElement("span");
    count.className = "species-option-count";
    count.textContent = String(entry.segments);
    count.title = `${entry.segments} segment${entry.segments === 1 ? "" : "s"}`;
    label.append(box, name, count);
    item.append(label);
    dom.speciesOptions.append(item);
  }
  if (matches.length === 0) {
    const empty = document.createElement("li");
    empty.className = "subtle";
    empty.textContent = state.speciesIndex.length ? "No species match." : "No detections published yet.";
    dom.speciesOptions.append(empty);
  }
  if (dom.speciesMore) {
    const hiddenCount = matches.length - SPECIES_OPTIONS_LIMIT;
    dom.speciesMore.hidden = hiddenCount <= 0;
    dom.speciesMore.textContent = hiddenCount > 0 ? `${hiddenCount} more — type to narrow the list.` : "";
  }

  if (dom.speciesChips) {
    dom.speciesChips.innerHTML = "";
    for (const name of state.selectedSpecies) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "species-chip";
      chip.dataset.species = name;
      chip.setAttribute("aria-label", `Remove ${name} from the filter`);
      chip.textContent = name;
      dom.speciesChips.append(chip);
    }
  }
}

function setSpeciesSelected(name, selected) {
  if (selected) {
    state.selectedSpecies.add(name);
  } else {
    state.selectedSpecies.delete(name);
  }
  renderSpeciesFilter();
  applyFilters();
}

function updateHourRangeLabel() {
  const startHour = Number(dom.hourRangeMin.value);
  const endHour = Number(dom.hourRangeMax.value);
  dom.hourRangeLabel.textContent = `${formatHour(startHour)} to ${formatHour(endHour)}`;
}

function getTimeBlockRange(block) {
  const ranges = {
    night: { min: 20, max: 4 },
    dawn: { min: 5, max: 7 },
    morning: { min: 8, max: 11 },
    afternoon: { min: 12, max: 16 },
    dusk: { min: 17, max: 19 },
  };

  return ranges[block] || null;
}

function updateTimeBlockButtons() {
  const startHour = Number(dom.hourRangeMin.value);
  const endHour = Number(dom.hourRangeMax.value);

  for (const button of dom.timeBlockButtons) {
    const range = getTimeBlockRange(button.dataset.timeBlock || "");
    if (!range) {
      continue;
    }

    const isActive = range.min === startHour && range.max === endHour;
    button.classList.toggle("active", isActive);
  }
}

function getSelectedSpecies() {
  return [...state.selectedSpecies];
}

function applyFilters(options = {}) {
  const season = dom.seasonFilter.value;
  const hourMin = Number(dom.hourRangeMin.value);
  const hourMax = Number(dom.hourRangeMax.value);
  const selectedSpecies = getSelectedSpecies();
  const selectedSpeciesSet = new Set(selectedSpecies);
  const dawnDuskOnly = dom.dawnDuskOnlyToggle.checked;

  state.filteredSegments = state.segments.filter((segment) => {
    const segmentHour = Number(segment.local_hour);
    const seasonMatch = season === "all" || segment.season === season;
    const inRange = hourMin <= hourMax
      ? segmentHour >= hourMin && segmentHour <= hourMax
      : segmentHour >= hourMin || segmentHour <= hourMax; // wraps past midnight
    const hourMatch = Number.isFinite(segmentHour) && inRange;
    const dawnDuskMatch = !dawnDuskOnly || isDawnDusk(segmentHour);

    let speciesMatch = true;
    if (selectedSpeciesSet.size > 0) {
      const names = segment.speciesSet || new Set();
      speciesMatch = [...selectedSpeciesSet].some((species) => names.has(species));
    }

    return seasonMatch && hourMatch && dawnDuskMatch && speciesMatch;
  });

  renderMarkers(state.filteredSegments);
  renderSegmentList(state.filteredSegments);

  // Called directly as an event listener, `options` is the Event: autoSelect stays on.
  if (options.autoSelect === false) {
    return;
  }

  if (!state.filteredSegments.find((segment) => segment.segment_id === state.activeSegmentId)) {
    // Filters change what is listed, not what is playing.
    if (state.activeSegment && !dom.audioPlayer.paused) {
      return;
    }
    const fallback =
      (state.focusedSiteId && pickSiteSegment(state.focusedSiteId)) || state.filteredSegments[0];
    if (fallback) {
      selectSegment(fallback.segment_id, { flyTo: true, autoplay: false });
    } else {
      clearActiveSegmentState();
    }
  }
}

function groupSegmentsBySite(segments) {
  const sites = new Map();
  for (const segment of segments) {
    let site = sites.get(segment.site_id);
    if (!site) {
      site = {
        siteId: segment.site_id,
        name: segment.site_name || segment.site_id,
        lat: Number(segment.latitude),
        lng: Number(segment.longitude),
        segments: [],
      };
      sites.set(segment.site_id, site);
    }
    site.segments.push(segment);
  }
  return sites;
}

function renderMarkers(segments) {
  if (state.markerLayer) {
    state.markerLayer.remove();
  }

  state.markerLayer = state.useClustering
    ? L.markerClusterGroup({
        chunkedLoading: true,
        showCoverageOnHover: false,
      })
    : L.layerGroup();

  state.markersBySiteId.clear();
  state.sitesById = groupSegmentsBySite(segments);
  const bounds = [];

  for (const site of state.sitesById.values()) {
    if (!Number.isFinite(site.lat) || !Number.isFinite(site.lng)) {
      continue;
    }

    const count = site.segments.length;
    const marker = L.marker([site.lat, site.lng], {
      icon: siteMarkerIcon(site),
      title: `${site.name}, ${count} segment${count === 1 ? "" : "s"}`,
      riseOnHover: true,
    });
    marker.bindTooltip(siteTooltipHtml(site), {
      direction: "top",
      offset: [0, -14],
      className: "site-tooltip",
    });
    marker.on("click", () => {
      focusSite(site.siteId, { autoplay: true });
    });

    state.markersBySiteId.set(site.siteId, marker);
    state.markerLayer.addLayer(marker);
    bounds.push([site.lat, site.lng]);
  }

  state.markerLayer.addTo(map);

  // Fit the view to the sites once. Later filter changes must not move the map.
  if (!state.hasFittedBounds && bounds.length > 0) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    state.hasFittedBounds = true;
  }
}

function siteMarkerIcon(site) {
  const isActive = Boolean(state.activeSegment) && state.activeSegment.site_id === site.siteId;
  const classes = ["marker-dot"];
  if (site.segments.some((segment) => segment.featured)) {
    classes.push("marker-featured");
  }
  if (isActive) {
    classes.push("marker-active");
    if (state.isAudioPlaying) {
      classes.push("marker-playing");
    }
  }

  const count = site.segments.length;
  const badge = count > 1
    ? `<span class="marker-count">${count > 999 ? "999+" : count}</span>`
    : "";

  return L.divIcon({
    className: "site-marker",
    html: `<span class="${classes.join(" ")}"><span class="wave"></span><span class="wave"></span><span class="wave"></span></span>${badge}`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function siteTooltipHtml(site) {
  const count = site.segments.length;
  const dates = site.segments.map((segment) => segment.local_date).filter(Boolean).sort();
  let range = "";
  if (dates.length > 0) {
    const first = dates[0];
    const last = dates[dates.length - 1];
    range = first === last ? first : `${first} – ${last}`;
  }
  const precision = site.segments[0]?.site?.public_location_precision;
  const approximate = { rounded: "<br><em>Approximate location (about 1 km)</em>", coarse: "<br><em>Approximate location (about 10 km)</em>" }[precision] || "";
  return `<strong>${escapeHtml(site.name)}</strong><br>${count} segment${count === 1 ? "" : "s"}${range ? ` · ${escapeHtml(range)}` : ""}${approximate}`;
}

// Published coordinates of rounded/coarse sites are deliberately imprecise;
// show the active site's uncertainty as a dashed circle instead of a pinpoint.
const APPROXIMATE_RADIUS_M = { rounded: 1000, coarse: 10000 };

function updateApproximateArea() {
  if (state.approximateArea) {
    state.approximateArea.remove();
    state.approximateArea = null;
  }
  const segment = state.activeSegment;
  const radius = segment ? APPROXIMATE_RADIUS_M[segment.site?.public_location_precision] : 0;
  const lat = Number(segment?.latitude);
  const lng = Number(segment?.longitude);
  if (!radius || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return;
  }
  const accent = getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#85d3ff";
  state.approximateArea = L.circle([lat, lng], {
    radius,
    color: accent,
    weight: 1.5,
    dashArray: "5 6",
    fillColor: accent,
    fillOpacity: 0.07,
    interactive: false,
  }).addTo(map);
}

function refreshMarkerIcons() {
  updateApproximateArea();
  for (const site of state.sitesById.values()) {
    const marker = state.markersBySiteId.get(site.siteId);
    if (marker) {
      marker.setIcon(siteMarkerIcon(site));
    }
  }
}

function segmentLengthSeconds(segment) {
  const start = Date.parse(segment.segment_start_local || "");
  const end = Date.parse(segment.segment_end_local || "");
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 1000 : 3600;
}

// The segment a site click plays: featured first, then full hours, then earliest.
function pickSiteSegment(siteId) {
  const candidates = state.filteredSegments.filter((segment) => segment.site_id === siteId);
  if (candidates.length === 0) {
    return null;
  }
  const isFullHour = (segment) => segmentLengthSeconds(segment) >= 3540;
  return [...candidates].sort(
    (a, b) =>
      Number(Boolean(b.featured)) - Number(Boolean(a.featured)) ||
      Number(isFullHour(b)) - Number(isFullHour(a)) ||
      String(a.segment_start_local || "").localeCompare(String(b.segment_start_local || ""))
  )[0];
}

function getSiteName(siteId) {
  const site = state.sitesById.get(siteId);
  if (site) {
    return site.name;
  }
  const segment = state.segments.find((entry) => entry.site_id === siteId);
  return (segment && segment.site_name) || siteId;
}

function focusSite(siteId, options = {}) {
  state.focusedSiteId = siteId;
  if (dom.segmentPanel) {
    dom.segmentPanel.open = true;
  }

  const active = state.activeSegment;
  const activeIsHere = Boolean(active) && active.site_id === siteId && state.filteredSegments.includes(active);
  if (activeIsHere) {
    // Already listening here: keep the current position instead of reloading.
    renderSegmentList(state.filteredSegments);
    if (options.autoplay && dom.audioPlayer.paused && dom.audioPlayer.getAttribute("src")) {
      dom.audioPlayer.play().catch(() => {});
    }
  } else {
    const pick = pickSiteSegment(siteId);
    if (pick) {
      selectSegment(pick.segment_id, { flyTo: false, autoplay: Boolean(options.autoplay) });
    } else {
      renderSegmentList(state.filteredSegments);
    }
  }

  scrollActiveSegmentIntoView();
  setMobilePanelsOpen(false);
}

function clearSiteFocus() {
  state.focusedSiteId = null;
  renderSegmentList(state.filteredSegments);
  scrollActiveSegmentIntoView();
}

function updateSiteFocusBar(visibleCount) {
  if (!dom.siteFocusBar) {
    return;
  }
  const focusedSiteId = state.focusedSiteId;
  dom.siteFocusBar.hidden = !focusedSiteId;
  if (focusedSiteId && dom.siteFocusLabel) {
    dom.siteFocusLabel.textContent = `${getSiteName(focusedSiteId)} · ${visibleCount} segment${visibleCount === 1 ? "" : "s"}`;
  }
}

function scrollActiveSegmentIntoView() {
  const item = dom.segmentList.querySelector(".segment-item.active");
  if (!item) {
    return;
  }
  const listRect = dom.segmentList.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
    dom.segmentList.scrollTop += itemRect.top - listRect.top;
  }
}

function renderSegmentList(segments) {
  const focusedSiteId = state.focusedSiteId;
  const visible = (focusedSiteId ? segments.filter((segment) => segment.site_id === focusedSiteId) : segments.slice())
    .sort(
      (a, b) =>
        String(a.segment_start_local || "").localeCompare(String(b.segment_start_local || "")) ||
        String(a.site_id || "").localeCompare(String(b.site_id || ""))
    );
  updateSiteFocusBar(visible.length);
  dom.segmentList.innerHTML = "";

  if (visible.length === 0) {
    let message = "No segments match the current filters.";
    if (state.segments.length === 0) {
      message = "No recordings are published yet.";
    } else if (focusedSiteId) {
      message = `No segments at ${getSiteName(focusedSiteId)} match the current filters.`;
    }
    dom.segmentList.innerHTML = `<li class="segment-empty">${escapeHtml(message)}</li>`;
    return;
  }

  const maxDetections = visible.reduce((max, segment) => Math.max(max, Number(segment.detection_count) || 0), 1);
  const fragment = document.createDocumentFragment();
  let currentDay = null;

  for (const segment of visible) {
    if (segment.local_date !== currentDay) {
      currentDay = segment.local_date;
      const heading = document.createElement("li");
      heading.className = "segment-day";
      heading.setAttribute("role", "presentation");
      heading.textContent = formatDayLabel(currentDay) || "Undated";
      fragment.append(heading);
    }

    const active = segment.segment_id === state.activeSegmentId;
    const liked = isSegmentLikedForSignedInUser(segment.segment_id);
    const count = Number(segment.detection_count) || 0;
    const start = formatClock(segment.segment_start_local) || formatHour(Number(segment.local_hour));
    const end = formatClock(segment.segment_end_local);
    const siteName = segment.site_name || segment.site_id;

    const item = document.createElement("li");
    item.className = `segment-item time-${getTimeBand(Number(segment.local_hour))}${active ? " active" : ""}`;
    item.tabIndex = 0;
    item.dataset.segmentId = segment.segment_id;
    item.title = segment.segment_id;
    if (active) {
      item.setAttribute("aria-current", "true");
    }
    item.innerHTML = `
      <span class="segment-time">${escapeHtml(start)}${end ? `<span class="segment-time-end">–${escapeHtml(end)}</span>` : ""}</span>
      <span class="segment-main">
        ${focusedSiteId ? "" : `<span class="segment-site">${escapeHtml(siteName)}</span>`}
        <span class="segment-activity" aria-hidden="true"><span style="width:${Math.max(count ? 4 : 0, Math.round((count / maxDetections) * 100))}%"></span></span>
      </span>
      <span class="segment-count" title="${count} detection${count === 1 ? "" : "s"}">${count}</span>
      <button
        type="button"
        class="segment-item-like-btn${liked ? " active" : ""}"
        data-segment-like-id="${escapeHtml(segment.segment_id)}"
        aria-label="${liked ? "Remove from library" : "Save to library"}"
        title="${liked ? "Saved to your library" : "Save to library"}"
      >${liked ? "♥" : "♡"}</button>
    `;
    fragment.append(item);
  }

  dom.segmentList.append(fragment);
}

function selectSegment(segmentId, options = {}) {
  const segment =
    state.filteredSegments.find((entry) => entry.segment_id === segmentId) ||
    state.segments.find((entry) => entry.segment_id === segmentId);
  if (!segment) {
    return;
  }

  // Keep a focused segment list in step with what is playing.
  if (state.focusedSiteId && state.focusedSiteId !== segment.site_id) {
    state.focusedSiteId = segment.site_id;
  }

  state.activeSegmentId = segment.segment_id;
  state.activeSegment = segment;
  updateSegmentShareUrl(segment.segment_id);

  renderSegmentList(state.filteredSegments);
  scrollActiveSegmentIntoView();
  renderMetadata(segment);
  renderSegmentImage(segment);
  updateActiveSegmentLikeButton();
  refreshMarkerIcons();
  state.selectedTimelineComment = null;
  updateDeleteTimelineCommentButton();
  fetchCommentsForSegment(segment.segment_id).then(() => {
    renderDetectionTimeline(state.activeSegment);
  });
  renderDetectionTimeline(segment);
  if (detectionsPending(segment)) {
    loadDetections(segment).then(() => {
      if (state.activeSegment === segment) {
        renderDetectionTimeline(segment);
      }
    });
  }

  const audioSrc = segment.public_url && segment.public_url.trim() !== ""
    ? segment.public_url
    : segment.listening_opus_path;

  dom.nowPlaying.textContent = segment.site_name || segment.site_id;
  dom.nowPlaying.title = segment.segment_id;
  if (dom.nowPlayingMeta) {
    dom.nowPlayingMeta.textContent = describeSegmentTime(segment);
  }

  if (audioSrc) {
    dom.audioPlayer.src = audioSrc;
    if (dom.playPauseBtn) dom.playPauseBtn.disabled = false;
    if (options.autoplay) {
      dom.audioPlayer.play().catch(() => {
        // Browser autoplay restrictions are expected until a user gesture.
      });
    }
  } else {
    dom.audioPlayer.removeAttribute("src");
    dom.audioPlayer.load();
    if (dom.nowPlayingMeta) dom.nowPlayingMeta.textContent = "Audio for this segment is not available yet.";
    if (dom.playPauseBtn) dom.playPauseBtn.disabled = true;
  }

  updateMobileMiniPlayer();
  updateAudioTimelineProgress();

  if (state.spectrogram.enabled) {
    stopSpectrogram();
    renderSpectrogramForCurrentSegment();
  }

  const marker = state.markersBySiteId.get(segment.site_id);
  if (marker) {
    if (options.flyTo) {
      map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 12), { duration: 0.9 });
    }
  }
}

function renderMetadata(segment) {
  const site = segment.site || {};
  const session = segment.session || {};
  const precisionNote = { rounded: " (approx. 1 km)", coarse: " (approx. 10 km)" }[site.public_location_precision] || "";
  const location = segment.latitude && segment.longitude
    ? `${segment.latitude}, ${segment.longitude}${precisionNote}`
    : "";
  const heard = [segment.water_present ? "Water" : "", segment.rain_present ? "Rain" : ""].filter(Boolean).join(", ");
  const place = [site.locality, site.region_code, site.country_code].filter(Boolean).join(", ");

  const metadataRows = [
    ["Recorded", describeSegmentTime(segment)],
    ["Season", humanize(segment.season)],
    ["Site", segment.site_name || segment.site_id],
    ["Place", place],
    ["Habitat", humanize(site.habitat)],
    ["Biome", humanize(site.biome)],
    ["Elevation", site.elevation_m ? `${site.elevation_m} m` : ""],
    ["Location", location],
    ["Time zone", session.timezone],
    ["Also audible", heard],
    ["Sound quality", segment.sound_quality],
    ["Wind", segment.wind_level],
    ["Human noise", segment.anthropogenic_noise],
    ["Recorder", session.recorder],
    ["Microphones", session.microphones],
    ["Weather", session.weather_notes],
    ["Notes", segment.notes],
    ["Recordist", session.operator],
    ["Licence", humanize(session.license)],
    ["Segment ID", segment.segment_id],
  ];

  dom.metadataGrid.innerHTML = "";
  for (const [key, value] of metadataRows) {
    const text = value === undefined || value === null ? "" : String(value).trim();
    if (!text) {
      continue; // Only show what is known.
    }
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = text;
    if (key === "Segment ID") {
      dd.className = "mono";
    }
    dom.metadataGrid.append(dt, dd);
  }

  dom.speciesList.innerHTML = "";
  const topSpecies = Array.isArray(segment.top_species) ? segment.top_species : [];
  if (topSpecies.length === 0) {
    const empty = document.createElement("li");
    empty.className = "subtle";
    empty.textContent = "No detections for this segment.";
    dom.speciesList.append(empty);
    return;
  }

  for (const species of topSpecies) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="species-pill"><span>${escapeHtml(species.name)}</span><span>${escapeHtml(String(species.count))}</span></span>`;
    dom.speciesList.append(li);
  }
}

// ---------------------------------------------------------------------------
// Timeline: one row per frequently detected species (the rest share an
// "Other species" row), an optional comments row on top, a time axis, and a
// playhead. Clicking the track seeks; clicking a detection jumps just before it.
// ---------------------------------------------------------------------------

const TIMELINE_MAX_LANES = 5;
const STORAGE_CONFIDENCE_KEY = "soundscapeAtlas.minConfidence";
let statusTimer = null;

function setStatus(text) {
  const toast = dom.timelineHint;
  if (!toast || !text) {
    return;
  }
  toast.textContent = text;
  // Sit just above the player dock, whatever its current height.
  const dockHeight = dom.audioTimelinePanel ? dom.audioTimelinePanel.getBoundingClientRect().height : 0;
  toast.style.bottom = `${Math.round(dockHeight + 16)}px`;
  toast.hidden = false;
  toast.classList.remove("toast-leaving");
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    toast.classList.add("toast-leaving");
    statusTimer = window.setTimeout(() => {
      toast.hidden = true;
      toast.classList.remove("toast-leaving");
    }, 250);
  }, 3200);
}

function getMinConfidence() {
  const value = Number(dom.confidenceFilter?.value);
  return Number.isFinite(value) ? value : 0;
}

function restoreMinConfidence() {
  if (!dom.confidenceFilter) {
    return;
  }
  try {
    const saved = localStorage.getItem(STORAGE_CONFIDENCE_KEY);
    if (saved !== null && [...dom.confidenceFilter.options].some((option) => option.value === saved)) {
      dom.confidenceFilter.value = saved;
    }
  } catch {
    // Ignore storage failures.
  }
}

function setTimelineEmpty(text) {
  if (!dom.timelineEmpty) {
    return;
  }
  dom.timelineEmpty.textContent = text;
  dom.timelineEmpty.hidden = !text;
}

function setTimelineRows(count) {
  if (dom.audioTimeline) {
    dom.audioTimeline.style.setProperty("--rows", String(Math.max(1, count)));
  }
  if (dom.timelineLabels) {
    dom.timelineLabels.style.setProperty("--rows", String(Math.max(1, count)));
  }
}

function addTimelineRow(label, count, className) {
  if (dom.timelineLabels) {
    const item = document.createElement("div");
    item.className = `timeline-label ${className || ""}`;
    item.title = count ? `${label}: ${count}` : label;
    const name = document.createElement("span");
    name.className = "timeline-label-name";
    name.textContent = label;
    item.append(name);
    if (count) {
      const number = document.createElement("span");
      number.className = "timeline-label-count";
      number.textContent = count;
      item.append(number);
    }
    dom.timelineLabels.append(item);
  }
  if (dom.timelineLanes) {
    const lane = document.createElement("div");
    lane.className = `timeline-lane ${className || ""}`;
    dom.timelineLanes.append(lane);
  }
}

function renderTimelineAxis(duration) {
  if (!dom.timelineAxis) {
    return;
  }
  dom.timelineAxis.innerHTML = "";
  const step = duration > 2400 ? 600 : duration > 900 ? 300 : duration > 240 ? 60 : 30;
  const ticks = [];
  for (let t = 0; t < duration - step * 0.35; t += step) {
    ticks.push(t);
  }
  ticks.push(duration);
  for (const t of ticks) {
    const tick = document.createElement("span");
    tick.className = "timeline-tick";
    tick.style.left = `${(t / duration) * 100}%`;
    tick.textContent = formatTime(t);
    dom.timelineAxis.append(tick);
  }
}

function renderDetectionTimeline(segment) {
  dom.detectionMarkers.innerHTML = "";
  if (dom.commentMarkers) dom.commentMarkers.innerHTML = "";
  if (dom.timelineLabels) dom.timelineLabels.innerHTML = "";
  if (dom.timelineLanes) dom.timelineLanes.innerHTML = "";
  hideTimelineTooltip();
  closeTimelineActionMenu();

  if (!segment) {
    if (dom.timelineAxis) dom.timelineAxis.innerHTML = "";
    setTimelineRows(1);
    setTimelineEmpty("Choose a site on the map to start listening.");
    return;
  }

  const duration = getDurationForTimeline(segment);
  renderTimelineAxis(duration);

  const minConfidence = getMinConfidence();
  const all = (segment.detections || []).filter((detection) => Number.isFinite(Number(detection.start_sec)));
  const detections = all.filter((detection) => getDetectionConfidence(detection) >= minConfidence);

  const counts = new Map();
  for (const detection of detections) {
    const name = detection.common_name || "Unknown";
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const namedCount = ranked.length > TIMELINE_MAX_LANES ? TIMELINE_MAX_LANES - 1 : ranked.length;
  const named = ranked.slice(0, namedCount);
  const laneOf = new Map(named.map(([name], index) => [name, index]));
  const otherSpecies = ranked.length - named.length;
  const otherCount = detections.length - named.reduce((sum, [, count]) => sum + count, 0);

  const showComments = state.showTimelineComments;
  const offset = showComments ? 1 : 0;
  const laneCount = named.length + (otherCount > 0 ? 1 : 0);
  setTimelineRows(laneCount + offset);

  if (showComments) {
    addTimelineRow("Comments", "", "comments-row");
  }
  for (const [name, count] of named) {
    addTimelineRow(name, String(count), "");
  }
  if (otherCount > 0) {
    addTimelineRow(`${otherSpecies} other species`, String(otherCount), "other-row");
  }

  if (detectionsPending(segment)) {
    setTimelineEmpty(segment.detectionsError ? "Could not load detections for this segment." : "Loading detections…");
  } else if (all.length === 0) {
    setTimelineEmpty(showComments ? "" : "No detections for this segment.");
  } else if (detections.length === 0) {
    setTimelineEmpty(
      `No detections at ${Math.round(minConfidence * 100)}% confidence or more (${all.length} below). Lower the confidence filter to see them.`
    );
  } else {
    setTimelineEmpty("");
  }

  for (const detection of detections) {
    const start = Number(detection.start_sec);
    const end = Number(detection.end_sec);
    const name = detection.common_name || "Unknown";
    const lane = laneOf.has(name) ? laneOf.get(name) : named.length;
    const confidence = getDetectionConfidence(detection);
    const percent = Math.round(confidence * 100);

    const mark = document.createElement("button");
    mark.type = "button";
    mark.className = "detection-mark";
    mark.style.left = `${Math.max(0, Math.min(1, start / duration)) * 100}%`;
    const width = Number.isFinite(end) && end > start ? ((end - start) / duration) * 100 : 0;
    mark.style.width = `max(3px, ${width}%)`;
    mark.style.setProperty("--row", String(lane + offset));
    mark.style.opacity = String(0.35 + 0.65 * confidence);
    mark.dataset.tooltip = `${name} · ${formatTime(start)} · ${percent}%`;
    mark.setAttribute("aria-label", `${name} at ${formatTime(start)}, ${percent} percent confidence`);
    mark.tabIndex = -1;
    mark.addEventListener("click", (event) => {
      event.stopPropagation();
      seekTo(Math.max(0, start - 3), true);
    });
    dom.detectionMarkers.append(mark);
  }

  if (showComments) {
    renderTimelineComments(segment, duration);
  }
}

function renderTimelineComments(segment, duration) {
  if (!dom.commentMarkers || !segment) {
    return;
  }
  const comments = Array.isArray(state.commentsBySegmentId[segment.segment_id])
    ? state.commentsBySegmentId[segment.segment_id]
    : [];

  for (const comment of comments) {
    const sec = Number(comment.sec);
    if (!Number.isFinite(sec) || sec < 0) {
      continue;
    }
    const selected =
      state.selectedTimelineComment &&
      state.selectedTimelineComment.segmentId === segment.segment_id &&
      state.selectedTimelineComment.commentId === comment.id;

    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = `comment-marker${selected ? " selected" : ""}`;
    marker.style.left = `${Math.max(0, Math.min(1, sec / duration)) * 100}%`;
    marker.dataset.tooltip = `${comment.user || "Someone"} · ${formatTime(sec)}: ${comment.text || ""}`;
    marker.setAttribute("aria-label", `Comment by ${comment.user || "someone"} at ${formatTime(sec)}: ${comment.text || ""}`);
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      seekTo(sec, false);
      state.selectedTimelineComment = { segmentId: segment.segment_id, commentId: comment.id };
      updateDeleteTimelineCommentButton();
      renderDetectionTimeline(state.activeSegment);
    });
    dom.commentMarkers.append(marker);
  }
}

function showTimelineTooltip(text, anchorRect, x) {
  const tip = dom.timelineTooltip;
  if (!tip) {
    return;
  }
  tip.textContent = text;
  tip.hidden = false;
  const width = tip.offsetWidth;
  const centre = Number.isFinite(x) ? x : anchorRect.left + anchorRect.width / 2;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, centre - width / 2));
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(8, anchorRect.top - tip.offsetHeight - 8)}px`;
}

function hideTimelineTooltip() {
  if (dom.timelineTooltip) {
    dom.timelineTooltip.hidden = true;
  }
}

function handleTimelinePointer(event) {
  if (!state.activeSegment || !dom.audioTimeline) {
    return;
  }
  const target = event.target instanceof Element ? event.target.closest("[data-tooltip]") : null;
  if (target) {
    showTimelineTooltip(target.dataset.tooltip, target.getBoundingClientRect());
    return;
  }
  const rect = dom.audioTimeline.getBoundingClientRect();
  const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0;
  showTimelineTooltip(formatTime(ratio * getDurationForTimeline(state.activeSegment)), rect, event.clientX);
}

function seekTo(seconds, play) {
  if (!state.activeSegment || !dom.audioPlayer.getAttribute("src")) {
    return;
  }
  const duration = getDurationForTimeline(state.activeSegment);
  dom.audioPlayer.currentTime = Math.max(0, Math.min(duration, seconds));
  if (play && dom.audioPlayer.paused) {
    dom.audioPlayer.play().catch(() => {});
  }
  updateAudioTimelineProgress();
}

function seekFromTimelineClick(event) {
  if (!state.activeSegment || !(event.target instanceof Element)) {
    return;
  }
  if (event.target.closest(".detection-mark, .comment-marker")) {
    return;
  }
  const rect = dom.audioTimeline.getBoundingClientRect();
  const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0;
  seekTo(ratio * getDurationForTimeline(state.activeSegment), false);
}

function openCommentMenu() {
  if (!state.activeSegment || !dom.timelineActionMenu) {
    return;
  }
  if (!requireSignIn("Sign in to leave comments on the timeline.")) {
    return;
  }
  state.timelineActionSec = Math.max(0, Number(dom.audioPlayer.currentTime) || 0);
  if (dom.timelineActionLabel) {
    dom.timelineActionLabel.textContent = `Comment at ${formatTime(state.timelineActionSec)}`;
  }
  dom.timelineActionMenu.hidden = false;
  if (dom.timelineActionText) {
    dom.timelineActionText.value = "";
    dom.timelineActionText.focus();
  }
  const anchor = (dom.addCommentBtn || dom.audioTimeline).getBoundingClientRect();
  const menu = dom.timelineActionMenu.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - menu.width - 8, anchor.left));
  const top = Math.max(8, anchor.top - menu.height - 8);
  dom.timelineActionMenu.style.left = `${left}px`;
  dom.timelineActionMenu.style.top = `${top}px`;
}

function updateDeleteTimelineCommentButton() {
  if (!dom.deleteTimelineCommentBtn) {
    return;
  }

  const selected = state.selectedTimelineComment;
  if (!selected || !state.signedInUser) {
    dom.deleteTimelineCommentBtn.hidden = true;
    dom.deleteTimelineCommentBtn.textContent = "Delete comment";
    return;
  }

  const list = Array.isArray(state.commentsBySegmentId[selected.segmentId])
    ? state.commentsBySegmentId[selected.segmentId]
    : [];
  const comment = list.find((item) => item.id === selected.commentId);
  const canDelete = Boolean(comment && comment.user === state.signedInUser);
  dom.deleteTimelineCommentBtn.hidden = !canDelete;
  dom.deleteTimelineCommentBtn.textContent = "Delete comment";
}

async function deleteSelectedTimelineComment() {
  const selected = state.selectedTimelineComment;
  if (!selected) {
    return;
  }

  await deleteCommentById(selected.segmentId, selected.commentId);
}

async function removeLikeFromLibrary(segmentId) {
  if (!segmentId) {
    return;
  }
  if (!isSegmentLikedForSignedInUser(segmentId)) {
    return;
  }
  await toggleLikeForSegment(segmentId);
}

async function deleteCommentById(segmentId, commentId) {
  if (!segmentId || !commentId) {
    return;
  }

  const list = Array.isArray(state.commentsBySegmentId[segmentId])
    ? state.commentsBySegmentId[segmentId]
    : [];
  const index = list.findIndex((item) => item.id === commentId);
  if (index < 0) {
    return;
  }

  const comment = list[index];
  if (!state.signedInUser || comment.user !== state.signedInUser) {
    if (dom.timelineHint) {
      setStatus("You can only delete your own comments while signed in.");
    }
    return;
  }

  try {
    const response = await fetch(`/api/comments/${encodeURIComponent(commentId)}`, {
      method: "DELETE",
    });

    if (response.status === 401) {
      handleSessionEnded();
      return;
    }
    if (!response.ok) {
      if (dom.timelineHint) {
        setStatus("Could not delete comment.");
      }
      return;
    }

    list.splice(index, 1);
  state.commentsBySegmentId[segmentId] = list;
    renderUserLibrary();

    state.selectedTimelineComment = null;
    updateDeleteTimelineCommentButton();
    renderDetectionTimeline(state.activeSegment);

    if (dom.timelineHint) {
      setStatus("Comment deleted.");
    }
  } catch {
    if (dom.timelineHint) {
      setStatus("Network error. Could not delete comment.");
    }
  }
}

function updateAudioTimelineProgress() {
  const segment = state.activeSegment;
  const current = Math.max(0, Number(dom.audioPlayer.currentTime) || 0);
  // Before the audio loads, the segment's own length stands in for the duration.
  const duration = segment ? getDurationForTimeline(segment) : 0;
  const percent = duration > 0 ? Math.max(0, Math.min(100, (current / duration) * 100)) : 0;

  dom.audioProgress.style.width = `${percent}%`;
  if (dom.timelinePlayhead) {
    dom.timelinePlayhead.style.left = `${percent}%`;
    dom.timelinePlayhead.hidden = !segment;
  }
  dom.audioTimeline?.setAttribute("aria-valuenow", String(Math.round(percent)));
  dom.audioTimeline?.setAttribute("aria-valuetext", `${formatTime(current)} of ${formatTime(duration)}`);
  dom.audioTimeLabel.textContent = segment ? `${formatTime(current)} / ${formatTime(duration)}` : "";
  if (dom.addCommentBtn) {
    dom.addCommentBtn.disabled = !segment;
    dom.addCommentBtn.textContent = segment ? `+ Comment at ${formatTime(current)}` : "+ Comment";
  }
}

function getDurationForTimeline(segment) {
  const audioDuration = Number(dom.audioPlayer.duration);
  if (Number.isFinite(audioDuration) && audioDuration > 0) {
    return audioDuration;
  }

  const start = Date.parse(segment.segment_start_local || "");
  const end = Date.parse(segment.segment_end_local || "");
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return (end - start) / 1000;
  }

  return 3600;
}

function clearActiveSegmentState() {
  state.activeSegmentId = null;
  state.activeSegment = null;
  setMobilePanelsOpen(false);
  dom.nowPlaying.textContent = state.segments.length > 0 ? "No segments match the filters" : "Choose a site on the map";
  if (dom.nowPlayingMeta) dom.nowPlayingMeta.textContent = "";
  dom.metadataGrid.innerHTML = "";
  dom.speciesList.innerHTML = "";
  clearSegmentImage();
  dom.audioPlayer.removeAttribute("src");
  dom.audioPlayer.load();
  state.selectedTimelineComment = null;
  updateDeleteTimelineCommentButton();
  renderDetectionTimeline(null);
  if (dom.playPauseBtn) {
    dom.playPauseBtn.disabled = true;
  }
  setPlayButtonState(false);
  state.isAudioPlaying = false;
  updateActiveSegmentLikeButton();
  updateAudioTimelineProgress();
  updateMobileMiniPlayer();
  refreshMarkerIcons();
}

function getDetectionConfidence(detection) {
  const raw = Number(detection.confidence);
  if (!Number.isFinite(raw)) {
    return 0.5;
  }
  if (raw > 1) {
    return Math.max(0, Math.min(1, raw / 100));
  }
  return Math.max(0, Math.min(1, raw));
}

function getSegmentImageInfo(segment) {
  const candidates = [
    segment?.photo_url,
    segment?.image_url,
    segment?.site?.image_url,
    segment?.session?.image_url,
    segment?.spectrogram_image_url,
  ];

  for (const candidate of candidates) {
    const url = String(candidate || "").trim();
    if (!url) {
      continue;
    }

    const isSpectrogram = url === String(segment?.spectrogram_image_url || "").trim();
    return {
      url,
      caption: isSpectrogram
        ? "Spectrogram preview image for this segment."
        : "Segment image preview.",
    };
  }

  return null;
}

function renderSegmentImage(segment) {
  if (!dom.segmentImage || !dom.segmentImagePlaceholder || !dom.segmentImageCaption) {
    return;
  }

  const imageInfo = getSegmentImageInfo(segment);
  if (!imageInfo) {
    clearSegmentImage();
    dom.segmentImageCaption.textContent = "No image is linked to this segment.";
    return;
  }

  dom.segmentImage.hidden = false;
  dom.segmentImagePlaceholder.hidden = true;
  if (dom.picturePanel) {
    dom.picturePanel.hidden = false;
  }
  dom.segmentImage.src = imageInfo.url;
  dom.segmentImage.alt = `${segment.site_name || segment.site_id} ${segment.segment_id} image`;
  dom.segmentImageCaption.textContent = imageInfo.caption;
  if (dom.expandPictureBtn) {
    dom.expandPictureBtn.disabled = false;
    dom.expandPictureBtn.textContent = "Expand";
  }

  dom.segmentImage.onerror = () => {
    clearSegmentImage();
    if (dom.segmentImageCaption) {
      dom.segmentImageCaption.textContent = "Image could not be loaded for this segment.";
    }
  };
}

function clearSegmentImage() {
  if (!dom.segmentImage || !dom.segmentImagePlaceholder || !dom.segmentImageCaption) {
    return;
  }

  dom.segmentImage.hidden = true;
  dom.segmentImage.removeAttribute("src");
  dom.segmentImagePlaceholder.hidden = false;
  dom.segmentImageCaption.textContent = "Select a segment to preview an image.";
  if (dom.expandPictureBtn) {
    dom.expandPictureBtn.disabled = true;
    dom.expandPictureBtn.textContent = "Expand";
  }
  if (dom.picturePanel) dom.picturePanel.hidden = true;
  closeMapImageLightbox();
}

function openMapImageLightbox() {
  if (!dom.mapImageLightbox || !dom.mapImagePreview || !dom.segmentImage) {
    return;
  }

  const src = dom.segmentImage.getAttribute("src");
  if (!src) {
    return;
  }

  dom.mapImagePreview.src = src;
  dom.mapImagePreview.alt = dom.segmentImage.alt || "Expanded segment visual";
  dom.mapImageLightbox.hidden = false;
  if (dom.expandPictureBtn) {
    dom.expandPictureBtn.textContent = "Retract";
  }
}

function closeMapImageLightbox() {
  if (!dom.mapImageLightbox || !dom.mapImagePreview) {
    return;
  }

  dom.mapImageLightbox.hidden = true;
  dom.mapImagePreview.removeAttribute("src");
  if (dom.expandPictureBtn && !dom.expandPictureBtn.disabled) {
    dom.expandPictureBtn.textContent = "Expand";
  }
}

// Live spectrogram: 0-12 kHz (where most birdsong is), a perceptual
// dark-to-bright palette, kHz labels, and a canvas sized for the screen's
// pixel density. Each frame scrolls left by one pixel and writes one column.
const SPECTROGRAM_MAX_HZ = 12000;

const SPECTROGRAM_PALETTE = (() => {
  // Approximates the "inferno" colour map.
  const stops = [
    [0, [0, 0, 4]],
    [0.2, [40, 11, 84]],
    [0.4, [101, 21, 110]],
    [0.6, [188, 55, 84]],
    [0.8, [249, 142, 9]],
    [1, [252, 255, 164]],
  ];
  const palette = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) {
      k += 1;
    }
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    const f = (t - t0) / (t1 - t0);
    for (let j = 0; j < 3; j += 1) {
      palette[i * 3 + j] = Math.round(c0[j] + (c1[j] - c0[j]) * f);
    }
  }
  return palette;
})();

function ensureAudioGraph() {
  if (state.audioContext && state.analyser) {
    return;
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    dom.spectrogramHint.textContent = "Spectrogram not supported in this browser.";
    return;
  }

  state.audioContext = new AudioCtx();
  const source = state.audioContext.createMediaElementSource(dom.audioPlayer);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 2048;
  state.analyser.smoothingTimeConstant = 0;
  state.analyser.minDecibels = -110;
  state.analyser.maxDecibels = -35;

  source.connect(state.analyser);
  state.analyser.connect(state.audioContext.destination);
}

function sizeSpectrogramCanvas() {
  const canvas = dom.spectrogramCanvas;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return;
  }
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#000004";
      ctx.fillRect(0, 0, width, height);
    }
  }
}

function renderSpectrogramAxis() {
  if (!dom.spectrogramAxis) {
    return;
  }
  dom.spectrogramAxis.innerHTML = "";
  for (let khz = 2; khz < SPECTROGRAM_MAX_HZ / 1000; khz += 2) {
    const label = document.createElement("span");
    label.style.bottom = `${((khz * 1000) / SPECTROGRAM_MAX_HZ) * 100}%`;
    label.textContent = `${khz} kHz`;
    dom.spectrogramAxis.append(label);
  }
}

function renderSpectrogramForCurrentSegment() {
  if (!state.spectrogram.enabled) {
    return;
  }

  const mode = dom.spectrogramMode.value;
  dom.spectrogramHint.hidden = false;

  if (mode === "image") {
    dom.spectrogramCanvas.hidden = true;
    dom.spectrogramImage.hidden = false;
    const imageUrl = state.activeSegment?.spectrogram_image_url || "";
    if (imageUrl) {
      dom.spectrogramImage.src = imageUrl;
      dom.spectrogramHint.textContent = "Pre-rendered spectrogram for the whole segment.";
    } else {
      dom.spectrogramImage.hidden = true;
      dom.spectrogramHint.textContent = "No pre-rendered spectrogram for this segment.";
    }
    return;
  }

  dom.spectrogramCanvas.hidden = false;
  dom.spectrogramImage.hidden = true;
  dom.spectrogramHint.textContent = dom.audioPlayer.paused
    ? "Press play to draw the live spectrogram (0–12 kHz)."
    : "Live spectrogram, 0–12 kHz.";

  ensureAudioGraph();
  sizeSpectrogramCanvas();
  renderSpectrogramAxis();

  if (!dom.audioPlayer.paused) {
    startSpectrogram();
  }
}

function startSpectrogram() {
  if (!state.spectrogram.enabled || dom.spectrogramMode.value !== "live" || !state.analyser) {
    return;
  }

  if (state.audioContext && state.audioContext.state === "suspended") {
    state.audioContext.resume().catch(() => {});
  }

  const canvas = dom.spectrogramCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  sizeSpectrogramCanvas();
  dom.spectrogramHint.textContent = "Live spectrogram, 0–12 kHz.";

  const bins = state.analyser.frequencyBinCount;
  const data = new Uint8Array(bins);
  const nyquist = state.audioContext.sampleRate / 2;
  const topBin = Math.min(bins - 1, Math.round((SPECTROGRAM_MAX_HZ / nyquist) * bins));
  let column = null;

  const draw = () => {
    state.spectrogram.rafId = requestAnimationFrame(draw);
    const { width, height } = canvas;
    if (!column || column.height !== height) {
      column = ctx.createImageData(1, height);
    }
    state.analyser.getByteFrequencyData(data);
    ctx.drawImage(canvas, -1, 0);
    for (let y = 0; y < height; y += 1) {
      const bin = Math.round((1 - y / Math.max(1, height - 1)) * topBin);
      const value = data[bin];
      const offset = y * 4;
      column.data[offset] = SPECTROGRAM_PALETTE[value * 3];
      column.data[offset + 1] = SPECTROGRAM_PALETTE[value * 3 + 1];
      column.data[offset + 2] = SPECTROGRAM_PALETTE[value * 3 + 2];
      column.data[offset + 3] = 255;
    }
    ctx.putImageData(column, width - 1, 0);
  };

  if (!state.spectrogram.rafId) {
    draw();
  }
}

function stopSpectrogram() {
  if (state.spectrogram.rafId) {
    cancelAnimationFrame(state.spectrogram.rafId);
    state.spectrogram.rafId = null;
  }
}

function isDawnDusk(hour) {
  if (!Number.isFinite(hour)) {
    return false;
  }
  return (hour >= 5 && hour <= 7) || (hour >= 17 && hour <= 19);
}

function getTimeBand(hour) {
  if (!Number.isFinite(hour)) {
    return "unknown";
  }
  if (hour >= 0 && hour <= 4) {
    return "night";
  }
  if (hour >= 5 && hour <= 7) {
    return "dawn";
  }
  if (hour >= 8 && hour <= 11) {
    return "morning";
  }
  if (hour >= 12 && hour <= 16) {
    return "afternoon";
  }
  if (hour >= 17 && hour <= 19) {
    return "dusk";
  }
  return "night";
}

function getActivityBand(detectionCount) {
  const count = Number(detectionCount);
  if (!Number.isFinite(count) || count <= 0) {
    return { level: "low", count: 0 };
  }
  if (count >= 20) {
    return { level: "high", count };
  }
  if (count >= 8) {
    return { level: "medium", count };
  }
  return { level: "low", count };
}

// "3 sites · 1,440 segments · 115,160 detections"
function describeDataset(payload) {
  const count = (value, singular, plural) => {
    const n = Number(value) || 0;
    return `${n.toLocaleString("en-GB")} ${n === 1 ? singular : plural}`;
  };
  if (!Number(payload.segments_count)) {
    return "No recordings published yet";
  }
  return [
    count(payload.sites_count, "site", "sites"),
    count(payload.segments_count, "segment", "segments"),
    count(payload.detections_count, "detection", "detections"),
  ].join(" · ");
}

// "riparian_forest" -> "Riparian forest"
function humanize(value) {
  const text = String(value ?? "").trim().replace(/_/g, " ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

// "Sat 13 Apr 2024". Dates are local to the recording, so format them as-is (UTC).
function formatDayLabel(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (!isoDate || Number.isNaN(date.getTime())) {
    return isoDate || "";
  }
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// "17:15" from "2024-04-13T17:15:28".
function formatClock(isoDateTime) {
  const match = /T(\d{2}):(\d{2})/.exec(isoDateTime || "");
  return match ? `${match[1]}:${match[2]}` : "";
}

// "Sat 13 Apr 2024 · 17:15–18:00 · 42 detections"
function describeSegmentTime(segment) {
  const parts = [formatDayLabel(segment.local_date)];
  const start = formatClock(segment.segment_start_local);
  const end = formatClock(segment.segment_end_local);
  if (start) {
    parts.push(end ? `${start}–${end}` : start);
  }
  const count = Number(segment.detection_count) || 0;
  parts.push(count === 1 ? "1 detection" : `${count} detections`);
  return parts.filter(Boolean).join(" · ");
}

function formatHour(hour) {
  if (!Number.isFinite(hour)) {
    return "--:00";
  }
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatTime(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

init();
