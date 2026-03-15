const state = {
  segments: [],
  filteredSegments: [],
  activeSegmentId: null,
  activeSegment: null,
  markersBySegmentId: new Map(),
  markerLayer: null,
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
  landingOverlay: document.getElementById("landingOverlay"),
  landingSignInName: document.getElementById("landingSignInName"),
  landingSignInPassword: document.getElementById("landingSignInPassword"),
  landingSignInBtn: document.getElementById("landingSignInBtn"),
  landingSignInHint: document.getElementById("landingSignInHint"),
  guestEnterBtn: document.getElementById("guestEnterBtn"),
  signedInBadge: document.getElementById("signedInBadge"),
  settingsToggleBtn: document.getElementById("settingsToggleBtn"),
  settingsMenu: document.getElementById("settingsMenu"),
  modeSelect: document.getElementById("modeSelect"),
  themeSelect: document.getElementById("themeSelect"),
  settingsSignOutBtn: document.getElementById("settingsSignOutBtn"),
  authStatus: document.getElementById("authStatus"),
  clusterToggle: document.getElementById("clusterToggle"),
  dawnDuskOnlyToggle: document.getElementById("dawnDuskOnlyToggle"),
  seasonFilter: document.getElementById("seasonFilter"),
  speciesFilter: document.getElementById("speciesFilter"),
  hourRangeMin: document.getElementById("hourRangeMin"),
  hourRangeMax: document.getElementById("hourRangeMax"),
  hourRangeLabel: document.getElementById("hourRangeLabel"),
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),
  segmentList: document.getElementById("segmentList"),
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
  zoomControl: true,
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
    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-locate");
    const button = L.DomUtil.create("button", "leaflet-control-locate-btn", container);
    button.type = "button";
    button.setAttribute("aria-label", "Find my location");
    button.title = "Find my location";
    button.innerHTML = "<span aria-hidden=\"true\">⌖</span>";

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.on(button, "click", (event) => {
      L.DomEvent.stop(event);
      findUserLocation();
    });

    return container;
  },
});

new LocateControl().addTo(map);

async function init() {
  try {
    setupBrandLogo();
    setupLibrarySidebarResize();

    const response = await fetch("api/data.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load metadata: ${response.status}`);
    }

    const payload = await response.json();
    state.segments = (payload.segments || []).filter((segment) => {
      const lat = Number(segment.latitude);
      const lng = Number(segment.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng);
    });

    dom.datasetSummary.textContent = `${payload.sites_count || 0} site(s)  |  ${payload.segments_count || 0} segment(s)  |  ${payload.detections_count || 0} detections`;

    buildFilterOptions(state.segments);
    wireEvents();
    restoreSignedInUser();
    state.commentsBySegmentId = {};
    renderUserLibrary();
    applyTheme(loadStoredTheme());
    applyUIMode(loadStoredUIMode());
    applyFilters();

    const sharedSegmentId = getSharedSegmentIdFromUrl();

    // Collapse secondary panels on narrow screens for a cleaner initial view
    if (window.innerWidth <= 760) {
      if (dom.controlsPanel) dom.controlsPanel.open = false;
      if (dom.segmentPanel) dom.segmentPanel.open = false;
      if (dom.metadataPanel) dom.metadataPanel.open = false;
    }

    if (sharedSegmentId) {
      selectSegment(sharedSegmentId, {
        flyTo: true,
        autoplay: false,
      });
    } else if (state.filteredSegments.length > 0) {
      selectSegment(state.filteredSegments[0].segment_id, {
        flyTo: true,
        autoplay: false,
      });
    }
  } catch (error) {
    dom.datasetSummary.textContent = "Could not load metadata. Run build script first.";
    dom.segmentList.innerHTML = `<li class="subtle">${escapeHtml(String(error.message || error))}</li>`;
  }
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
  if (dom.landingSignInBtn) {
    dom.landingSignInBtn.addEventListener("click", () => {
      signInFromInput();
    });
  }

  if (dom.guestEnterBtn) {
    dom.guestEnterBtn.addEventListener("click", () => {
      enterAsGuest();
    });
  }

  if (dom.landingSignInName) {
    dom.landingSignInName.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        signInFromInput();
      }
    });
  }

  if (dom.landingSignInPassword) {
    dom.landingSignInPassword.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        signInFromInput();
      }
    });
  }

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
    dom.audioTimeline.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      if (event.target.closest(".detection-dot, .comment-marker, #timelineActionMenu")) {
        return;
      }
      openTimelineActionMenuAtClick(event);
    });
  }

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
    if (event.target.closest("#timelineActionMenu") || event.target.closest("#audioTimeline")) {
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
  dom.speciesFilter.addEventListener("change", applyFilters);

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

  dom.clearFiltersBtn.addEventListener("click", () => {
    dom.seasonFilter.value = "all";
    dom.clusterToggle.checked = true;
    dom.dawnDuskOnlyToggle.checked = false;
    dom.hourRangeMin.value = "0";
    dom.hourRangeMax.value = "23";
    for (const option of dom.speciesFilter.options) {
      option.selected = false;
    }
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
    if (dom.iconPlay) dom.iconPlay.hidden = true;
    if (dom.iconPause) dom.iconPause.hidden = false;
    if (dom.playPauseBtn) dom.playPauseBtn.setAttribute("aria-label", "Pause");
    updateMobileMiniPlayer();
    if (state.spectrogram.enabled && dom.spectrogramMode.value === "live") {
      ensureAudioGraph();
      startSpectrogram();
    }
  });

  dom.audioPlayer.addEventListener("pause", () => {
    state.isAudioPlaying = false;
    refreshMarkerIcons();
    if (dom.iconPlay) dom.iconPlay.hidden = false;
    if (dom.iconPause) dom.iconPause.hidden = true;
    if (dom.playPauseBtn) dom.playPauseBtn.setAttribute("aria-label", "Play");
    updateMobileMiniPlayer();
    if (state.spectrogram.enabled && dom.spectrogramMode.value === "live") {
      stopSpectrogram();
    }
  });

  dom.audioPlayer.addEventListener("ended", () => {
    state.isAudioPlaying = false;
    refreshMarkerIcons();
    if (dom.iconPlay) dom.iconPlay.hidden = false;
    if (dom.iconPause) dom.iconPause.hidden = true;
    if (dom.playPauseBtn) dom.playPauseBtn.setAttribute("aria-label", "Play");
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
      dom.timelineHint.textContent = "Location is not available in this browser.";
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
        dom.timelineHint.textContent = `Centered on your location.${accuracyText}`;
      }
    },
    () => {
      if (dom.timelineHint) {
        dom.timelineHint.textContent = "Could not access your location.";
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

async function signInFromInput() {
  if (!dom.landingSignInName) {
    return;
  }

  const name = dom.landingSignInName.value.trim();
  const password = dom.landingSignInPassword ? dom.landingSignInPassword.value : "";

  if (!name) {
    if (dom.landingSignInHint) {
      dom.landingSignInHint.textContent = "Enter a username to continue.";
    }
    return;
  }

  if (!password || password.length < 6) {
    if (dom.landingSignInHint) {
      dom.landingSignInHint.textContent = "Password must be at least 6 characters.";
    }
    return;
  }

  if (dom.landingSignInHint) {
    dom.landingSignInHint.textContent = "Signing in\u2026";
  }
  if (dom.landingSignInBtn) {
    dom.landingSignInBtn.disabled = true;
  }

  try {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password }),
    });

    if (response.status === 401) {
      if (dom.landingSignInHint) {
        dom.landingSignInHint.textContent = "Incorrect password. Try again.";
      }
      if (dom.landingSignInPassword) {
        dom.landingSignInPassword.value = "";
        dom.landingSignInPassword.focus();
      }
      return;
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (response.status === 404 || response.status === 405 || response.status === 501) {
        enterAsGuest();
        return;
      }
      if (dom.landingSignInHint) {
        dom.landingSignInHint.textContent = err.error || "Sign-in failed. Try again.";
      }
      return;
    }

    const data = await response.json();
    state.signedInUser = data.name;
    try {
      localStorage.setItem(STORAGE_USER_KEY, data.name);
    } catch {
      // Ignore storage failures.
    }

    if (dom.landingSignInHint) {
      dom.landingSignInHint.textContent = data.is_new ? "Account created. Welcome!" : "Signed in.";
    }
    if (dom.landingSignInPassword) {
      dom.landingSignInPassword.value = "";
    }

    updateAuthUI();
    await fetchLikesForUser(data.name);
    renderUserLibrary();
    fetchAllCommentsForUser(data.name);
  } catch {
    if (dom.landingSignInHint) {
      dom.landingSignInHint.textContent = "Network error. Check your connection.";
    }
  } finally {
    if (dom.landingSignInBtn) {
      dom.landingSignInBtn.disabled = false;
    }
  }
}

function signOutUser() {
  state.signedInUser = null;
  try {
    localStorage.removeItem(STORAGE_USER_KEY);
  } catch {
    // Ignore storage failures.
  }

  closeSettingsMenu();
  if (dom.landingSignInName) {
    dom.landingSignInName.value = "";
  }
  if (dom.landingSignInPassword) {
    dom.landingSignInPassword.value = "";
  }

  updateAuthUI();
  renderUserLibrary();
}

function enterAsGuest() {
  state.signedInUser = null;
  if (dom.landingOverlay) {
    dom.landingOverlay.hidden = true;
  }
  if (dom.authStatus) {
    dom.authStatus.hidden = false;
    dom.authStatus.textContent = "Browsing as guest — sign in for likes & comments.";
  }
  if (dom.signedInBadge) {
    dom.signedInBadge.textContent = "Guest";
  }
  renderUserLibrary();
}

function restoreSignedInUser() {
  try {
    const saved = localStorage.getItem(STORAGE_USER_KEY);
    state.signedInUser = saved && saved.trim() !== "" ? saved.trim() : null;
  } catch {
    state.signedInUser = null;
  }

  updateAuthUI();
  if (state.signedInUser) {
    fetchLikesForUser(state.signedInUser).then(() => renderUserLibrary());
    fetchAllCommentsForUser(state.signedInUser);
  } else {
    renderUserLibrary();
  }
}

async function fetchLikesForUser(userName) {
  try {
    const response = await fetch(`/api/likes?user=${encodeURIComponent(userName)}`);
    if (!response.ok) {
      return;
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) {
      return;
    }
    const map = {};
    for (const row of rows) {
      map[row.segment_id] = row.created_at;
    }
    state.likedSegmentsByUser[userName] = map;
    updateActiveSegmentLikeButton();
    renderSegmentList(state.filteredSegments);
  } catch {
    // Silently ignored — likes just won't show until next load.
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
      dom.timelineHint.textContent = "Select a segment before sharing.";
    }
    showShareButtonFeedback(false);
    return;
  }

  const shareUrl = buildSegmentShareUrl(segmentId);
  try {
    await navigator.clipboard.writeText(shareUrl);
    showShareButtonFeedback(true);
    if (dom.timelineHint) {
      dom.timelineHint.textContent = "Share link copied.";
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
        dom.timelineHint.textContent = "Share link copied.";
      }
    } else {
      showShareButtonFeedback(false);
      if (dom.timelineHint) {
        dom.timelineHint.textContent = "Could not copy link automatically.";
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
  if (!segmentId) {
    return;
  }

  if (!state.signedInUser) {
    if (dom.timelineHint) {
      dom.timelineHint.textContent = "Sign in to save segments to your library.";
    }
    return;
  }

  const current = getSignedInUserLikesMap();
  const isLiked = Boolean(current[segmentId]);

  // Optimistic update so the UI responds instantly.
  const next = { ...current };
  if (isLiked) {
    delete next[segmentId];
  } else {
    next[segmentId] = new Date().toISOString();
  }
  state.likedSegmentsByUser[state.signedInUser] = next;
  updateActiveSegmentLikeButton();
  renderSegmentList(state.filteredSegments);
  renderUserLibrary();

  try {
    if (isLiked) {
      await fetch("/api/likes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: state.signedInUser, segment_id: segmentId }),
      });
    } else {
      await fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: state.signedInUser, segment_id: segmentId }),
      });
    }
  } catch {
    // Revert optimistic update on network failure.
    state.likedSegmentsByUser[state.signedInUser] = current;
    updateActiveSegmentLikeButton();
    renderSegmentList(state.filteredSegments);
    renderUserLibrary();
  }

  if (dom.timelineHint) {
    dom.timelineHint.textContent = isLiked
      ? "Removed segment from your library."
      : "Saved segment to your library.";
  }
}

function updateActiveSegmentLikeButton() {
  if (!dom.toggleSegmentLikeBtn) {
    return;
  }

  const segmentId = state.activeSegment?.segment_id;
  if (!segmentId || !state.signedInUser) {
    dom.toggleSegmentLikeBtn.disabled = true;
    dom.toggleSegmentLikeBtn.classList.remove("active");
    dom.toggleSegmentLikeBtn.innerHTML = '<span aria-hidden="true">♡</span>';
    return;
  }

  const liked = isSegmentLikedForSignedInUser(segmentId);
  dom.toggleSegmentLikeBtn.disabled = false;
  dom.toggleSegmentLikeBtn.classList.toggle("active", liked);
  dom.toggleSegmentLikeBtn.innerHTML = liked
    ? '<span aria-hidden="true">♥</span>'
    : '<span aria-hidden="true">♡</span>';
  dom.toggleSegmentLikeBtn.setAttribute("aria-label", liked ? "Remove segment from library" : "Save segment to library");
  dom.toggleSegmentLikeBtn.title = liked ? "Saved" : "Save segment";
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

async function fetchAllCommentsForUser(user) {
  try {
    const response = await fetch(`/api/comments?user=${encodeURIComponent(user)}`);
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
      dom.timelineHint.textContent = "Select a segment before adding a comment.";
    }
    return;
  }

  if (!state.signedInUser) {
    if (dom.timelineHint) {
      dom.timelineHint.textContent = "Sign in to add timeline comments.";
    }
    return;
  }

  const text = String(annotation?.text || "").trim();
  if (!text) {
    if (dom.timelineHint) {
      dom.timelineHint.textContent = "Enter comment text before adding.";
    }
    return;
  }

  const atSecRaw = Number(annotation?.sec);
  const atSec = Number.isFinite(atSecRaw)
    ? Math.max(0, atSecRaw)
    : Math.max(0, Number(dom.audioPlayer.currentTime) || 0);

  if (dom.timelineHint) {
    dom.timelineHint.textContent = "Saving comment\u2026";
  }

  try {
    const response = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        segment_id: segmentId,
        user: state.signedInUser,
        text,
        sec: atSec,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (dom.timelineHint) {
        dom.timelineHint.textContent = `Could not save comment: ${err.error || response.status}`;
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
      dom.timelineHint.textContent = `Comment added at ${formatTime(atSec)}.`;
    }
  } catch {
    if (dom.timelineHint) {
      dom.timelineHint.textContent = "Network error. Could not save comment.";
    }
  }
}

function openTimelineActionMenuAtClick(event) {
  if (!dom.audioTimeline || !dom.timelineActionMenu || !state.activeSegment) {
    return;
  }

  const duration = getDurationForTimeline(state.activeSegment);
  const rect = dom.audioTimeline.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  const ratio = rect.width > 0 ? x / rect.width : 0;
  state.timelineActionSec = Math.max(0, ratio * duration);

  dom.timelineActionMenu.hidden = false;
  if (dom.timelineActionText) {
    dom.timelineActionText.value = "";
    dom.timelineActionText.hidden = false;
    dom.timelineActionText.focus();
  }

  const menuRect = dom.timelineActionMenu.getBoundingClientRect();
  const menuWidth = menuRect.width || 220;
  const menuHeight = menuRect.height || 120;
  const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, event.clientX - menuWidth / 2));
  const top = Math.max(8, Math.min(window.innerHeight - menuHeight - 8, event.clientY - menuHeight - 10));

  dom.timelineActionMenu.style.left = `${left}px`;
  dom.timelineActionMenu.style.top = `${top}px`;
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
  const sec = Number(state.timelineActionSec);

  addTimelineComment({ text, sec });
  closeTimelineActionMenu();
}

function updateAuthUI() {
  const signedIn = Boolean(state.signedInUser);

  if (dom.landingOverlay) {
    dom.landingOverlay.hidden = signedIn;
  }

  if (dom.authStatus) {
    dom.authStatus.textContent = signedIn
      ? `Signed in as ${state.signedInUser}.`
      : "Not signed in.";
  }

  if (dom.signedInBadge) {
    dom.signedInBadge.textContent = signedIn ? state.signedInUser : "Guest";
  }

  if (dom.settingsSignOutBtn) {
    dom.settingsSignOutBtn.disabled = !signedIn;
  }

  if (dom.settingsToggleBtn) {
    dom.settingsToggleBtn.disabled = false;
  }

  if (!signedIn) {
    closeSettingsMenu();
    if (dom.landingSignInName) {
      dom.landingSignInName.focus();
    }
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

  if (!state.signedInUser) {
    dom.userLibraryEmpty.hidden = false;
    dom.userLibraryEmpty.textContent = "Sign in to view your saved segments and comments.";
    return;
  }

  const items = getSignedInUserLibraryItems();
  if (items.length === 0) {
    dom.userLibraryEmpty.hidden = false;
    dom.userLibraryEmpty.textContent = "No saved items yet.";
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
        ? `${item.segment.site_name || item.segment.site_id} - ${item.segmentId}`
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
          >${isCommentSection ? "Recall file" : "Open segment"}</button>
          ${isCommentSection ? `<button type="button" class="library-delete-btn" data-segment-id="${escapeHtml(item.segmentId)}" data-comment-id="${escapeHtml(item.commentId)}">Delete</button>` : ""}
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
    dom.timelineHint.textContent = `Recalled ${formatTime(seekTo)} from your library.`;
  }
}

function buildFilterOptions(segments) {
  const seasons = [...new Set(segments.map((segment) => segment.season).filter(Boolean))].sort();
  const speciesNames = new Set();

  for (const segment of segments) {
    for (const detection of segment.detections || []) {
      const species = (detection.common_name || "").trim();
      if (species) {
        speciesNames.add(species);
      }
    }
  }

  for (const season of seasons) {
    const option = document.createElement("option");
    option.value = season;
    option.textContent = season;
    dom.seasonFilter.append(option);
  }

  for (const species of [...speciesNames].sort((a, b) => a.localeCompare(b))) {
    const option = document.createElement("option");
    option.value = species;
    option.textContent = species;
    dom.speciesFilter.append(option);
  }

  updateHourRangeLabel();
}

function updateHourRangeLabel() {
  const startHour = Number(dom.hourRangeMin.value);
  const endHour = Number(dom.hourRangeMax.value);
  dom.hourRangeLabel.textContent = `${formatHour(startHour)} to ${formatHour(endHour)}`;
}

function getTimeBlockRange(block) {
  const ranges = {
    night: { min: 0, max: 4 },
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
  const selected = [];
  for (const option of dom.speciesFilter.options) {
    if (option.selected) {
      selected.push(option.value);
    }
  }
  return selected;
}

function applyFilters() {
  const season = dom.seasonFilter.value;
  const hourMin = Number(dom.hourRangeMin.value);
  const hourMax = Number(dom.hourRangeMax.value);
  const selectedSpecies = getSelectedSpecies();
  const selectedSpeciesSet = new Set(selectedSpecies);
  const dawnDuskOnly = dom.dawnDuskOnlyToggle.checked;

  state.filteredSegments = state.segments.filter((segment) => {
    const segmentHour = Number(segment.local_hour);
    const seasonMatch = season === "all" || segment.season === season;
    const hourMatch = Number.isFinite(segmentHour) && segmentHour >= hourMin && segmentHour <= hourMax;
    const dawnDuskMatch = !dawnDuskOnly || isDawnDusk(segmentHour);

    let speciesMatch = true;
    if (selectedSpeciesSet.size > 0) {
      const names = new Set((segment.detections || []).map((detection) => detection.common_name));
      speciesMatch = [...selectedSpeciesSet].some((species) => names.has(species));
    }

    return seasonMatch && hourMatch && dawnDuskMatch && speciesMatch;
  });

  renderMarkers(state.filteredSegments);
  renderSegmentList(state.filteredSegments);

  if (!state.filteredSegments.find((segment) => segment.segment_id === state.activeSegmentId)) {
    if (state.filteredSegments.length > 0) {
      selectSegment(state.filteredSegments[0].segment_id, { flyTo: true, autoplay: false });
    } else {
      clearActiveSegmentState();
    }
  }
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

  state.markersBySegmentId.clear();
  const bounds = [];

  for (const segment of segments) {
    const lat = Number(segment.latitude);
    const lng = Number(segment.longitude);

    const marker = L.marker([lat, lng], {
      icon: markerIcon(segment, segment.segment_id === state.activeSegmentId),
      title: `${segment.site_name || segment.site_id} - ${segment.segment_id}`,
    });

    marker.on("click", () => {
      selectSegment(segment.segment_id, { flyTo: false, autoplay: true });
      setMobilePanelsOpen(false);
    });

    state.markersBySegmentId.set(segment.segment_id, marker);
    state.markerLayer.addLayer(marker);
    bounds.push([lat, lng]);
  }

  state.markerLayer.addTo(map);
  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }
}

function markerIcon(segment, isActive) {
  const classes = ["marker-dot"];
  if (segment.featured) {
    classes.push("marker-featured");
  }
  if (isDawnDusk(Number(segment.local_hour))) {
    classes.push("marker-dawn-dusk");
  }
  if (isActive) {
    classes.push("marker-active");
    if (state.isAudioPlaying) {
      classes.push("marker-playing");
    }
  }

  return L.divIcon({
    className: "",
    html: `<span class="${classes.join(" ")}"><span class="wave"></span><span class="wave"></span><span class="wave"></span></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10],
  });
}

function refreshMarkerIcons() {
  for (const segment of state.filteredSegments) {
    const marker = state.markersBySegmentId.get(segment.segment_id);
    if (!marker) {
      continue;
    }
    marker.setIcon(markerIcon(segment, segment.segment_id === state.activeSegmentId));
  }
}

function renderSegmentList(segments) {
  dom.segmentList.innerHTML = "";

  if (segments.length === 0) {
    dom.segmentList.innerHTML = '<li class="subtle">No segments match the current filters.</li>';
    return;
  }

  for (const segment of segments) {
    const item = document.createElement("li");
    item.className = "segment-item";
    const segmentHour = Number(segment.local_hour);
    const timeBand = getTimeBand(segmentHour);
    const activity = getActivityBand(segment.detection_count);
    item.classList.add(`time-${timeBand}`);
    item.classList.add(`activity-${activity.level}`);
    if (segment.segment_id === state.activeSegmentId) {
      item.classList.add("active");
    }
    if (isDawnDusk(segmentHour)) {
      item.classList.add("dawn-dusk");
    }

    const liked = isSegmentLikedForSignedInUser(segment.segment_id);

    item.innerHTML = `
      <div class="segment-head-row">
        <strong>${escapeHtml(segment.site_name || segment.site_id)}</strong>
        <div class="segment-card-actions">
          ${activity.level === "high" ? `<span class="activity-badge">High activity</span>` : ""}
          <button
            type="button"
            class="segment-item-like-btn ${liked ? "active" : ""}"
            data-segment-like-id="${escapeHtml(segment.segment_id)}"
            aria-label="${liked ? "Remove segment from library" : "Save segment to library"}"
            title="${liked ? "Saved" : "Save segment"}"
          >${liked ? "♥" : "♡"}</button>
        </div>
      </div>
      <p>${escapeHtml(segment.local_date || "")} ${formatHour(Number(segment.local_hour))}</p>
      <p>${escapeHtml(segment.segment_id)}</p>
    `;

    const likeButton = item.querySelector("[data-segment-like-id]");
    if (likeButton) {
      likeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const targetId = likeButton.getAttribute("data-segment-like-id") || "";
        toggleLikeForSegment(targetId);
      });
    }

    item.addEventListener("click", () => {
      selectSegment(segment.segment_id, { flyTo: true, autoplay: isSmallPhoneViewport() });
      setMobilePanelsOpen(false);
    });

    dom.segmentList.append(item);
  }
}

function selectSegment(segmentId, options = {}) {
  const segment =
    state.filteredSegments.find((entry) => entry.segment_id === segmentId) ||
    state.segments.find((entry) => entry.segment_id === segmentId);
  if (!segment) {
    return;
  }

  state.activeSegmentId = segment.segment_id;
  state.activeSegment = segment;
  updateSegmentShareUrl(segment.segment_id);

  renderSegmentList(state.filteredSegments);
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

  const audioSrc = segment.public_url && segment.public_url.trim() !== ""
    ? segment.public_url
    : segment.listening_opus_path;

  if (audioSrc) {
    dom.audioPlayer.src = audioSrc;
    dom.nowPlaying.textContent = `${segment.site_name || segment.site_id} - ${segment.segment_id}`;
    if (dom.playPauseBtn) dom.playPauseBtn.disabled = false;
    if (dom.seekBar) dom.seekBar.value = "0";
    if (dom.seekCurrentTime) dom.seekCurrentTime.textContent = "0:00";
    if (dom.seekDuration) dom.seekDuration.textContent = "0:00";
    if (options.autoplay) {
      dom.audioPlayer.play().catch(() => {
        // Browser autoplay restrictions are expected until a user gesture.
      });
    }
  } else {
    dom.audioPlayer.removeAttribute("src");
    dom.audioPlayer.load();
    dom.nowPlaying.textContent = "No audio URL available for this segment.";
    if (dom.playPauseBtn) dom.playPauseBtn.disabled = true;
  }

  updateMobileMiniPlayer();
  updateAudioTimelineProgress();

  if (state.spectrogram.enabled) {
    stopSpectrogram();
    renderSpectrogramForCurrentSegment();
  }

  const marker = state.markersBySegmentId.get(segment.segment_id);
  if (marker) {
    if (options.flyTo) {
      map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 12), { duration: 0.9 });
    }
  }
}

function renderMetadata(segment) {
  const metadataRows = [
    ["Segment", segment.segment_id],
    ["Site", segment.site_name || segment.site_id],
    ["Date", segment.local_date],
    ["Hour", formatHour(Number(segment.local_hour))],
    ["Season", segment.season],
    ["Dawn/Dusk", isDawnDusk(Number(segment.local_hour)) ? "yes" : "no"],
    ["Timezone", segment.session?.timezone],
    ["Habitat", segment.site?.habitat],
    ["Biome", segment.site?.biome],
    ["Latitude", segment.latitude],
    ["Longitude", segment.longitude],
    ["Sound quality", segment.sound_quality],
    ["Wind level", segment.wind_level],
    ["Rain present", segment.rain_present ? "yes" : "no"],
    ["Water present", segment.water_present ? "yes" : "no"],
    ["Noise score", segment.anthropogenic_noise],
    ["Detections", String(segment.detection_count ?? 0)],
    ["Recorder", segment.session?.recorder],
    ["Microphones", segment.session?.microphones],
    ["Notes", segment.notes],
  ];

  dom.metadataGrid.innerHTML = "";
  for (const [key, value] of metadataRows) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value === undefined || value === null || String(value).trim() === "" ? "-" : String(value);
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

function renderDetectionTimeline(segment) {
  dom.detectionMarkers.innerHTML = "";
  if (dom.commentMarkers) {
    dom.commentMarkers.innerHTML = "";
  }
  closeTimelineActionMenu();

  if (!segment) {
    dom.timelineHint.textContent = "Select a segment to view detections on the timeline.";
    return;
  }

  const detections = (segment.detections || []).filter((detection) => Number.isFinite(Number(detection.start_sec)));
  if (detections.length === 0) {
    dom.timelineHint.textContent = "No detections available for this segment.";
    return;
  }

  const defaultHint = "Hover to preview detection details. Click to jump 5 seconds before detection. Click track to add a comment.";
  dom.timelineHint.textContent = defaultHint;
  state.selectedTimelineComment = null;
  updateDeleteTimelineCommentButton();

  const duration = getDurationForTimeline(segment);
  for (const detection of detections) {
    const startSec = Number(detection.start_sec);
    const ratio = Math.max(0, Math.min(1, startSec / duration));
    const confidence = getDetectionConfidence(detection);
    const confidenceRatio = Math.max(0, Math.min(1, confidence));
    const yPercent = 84 - confidenceRatio * 66;

    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "detection-dot";
    dot.style.left = `${ratio * 100}%`;
    dot.style.top = `${yPercent}%`;
    dot.setAttribute(
      "aria-label",
      `${detection.common_name || "Unknown"}, ${formatTime(startSec)}, confidence ${Math.round(confidenceRatio * 100)} percent`
    );

    dot.addEventListener("mouseenter", () => {
      const species = detection.common_name || "Unknown";
      const confidenceLabel = `${Math.round(confidenceRatio * 100)}%`;
      dom.timelineHint.textContent = `${species} at ${formatTime(startSec)} (confidence ${confidenceLabel})`;
    });

    dot.addEventListener("mouseleave", () => {
      dom.timelineHint.textContent = defaultHint;
    });

    dot.addEventListener("focus", () => {
      const species = detection.common_name || "Unknown";
      const confidenceLabel = `${Math.round(confidenceRatio * 100)}%`;
      dom.timelineHint.textContent = `${species} at ${formatTime(startSec)} (confidence ${confidenceLabel})`;
    });

    dot.addEventListener("blur", () => {
      dom.timelineHint.textContent = defaultHint;
    });

    dot.addEventListener("click", () => {
      const species = detection.common_name || "Unknown";
      const confidenceLabel = `${Math.round(confidenceRatio * 100)}%`;
      dom.timelineHint.textContent = `${species} at ${formatTime(startSec)} (confidence ${confidenceLabel}). Jumped to 5s before detection.`;
      const seekTarget = Math.max(0, startSec - 5);
      dom.audioPlayer.currentTime = seekTarget;
      dom.audioPlayer.play().catch(() => {});
      updateAudioTimelineProgress();
    });

    dom.detectionMarkers.append(dot);
  }

  renderTimelineComments(segment, duration, defaultHint);
}

function renderTimelineComments(segment, duration, defaultHint) {
  if (!dom.commentMarkers || !segment) {
    return;
  }

  if (!state.showTimelineComments) {
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

    const ratio = Math.max(0, Math.min(1, sec / duration));
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "comment-marker";
    marker.style.left = `${ratio * 100}%`;
    marker.setAttribute(
      "aria-label",
      `Comment by ${comment.user || "Unknown"} at ${formatTime(sec)}: ${comment.text || ""}`
    );

    marker.addEventListener("mouseenter", () => {
      const label = `${comment.user || "Unknown"} at ${formatTime(sec)}: ${comment.text || ""}`;
      dom.timelineHint.textContent = label;
    });

    marker.addEventListener("mouseleave", () => {
      dom.timelineHint.textContent = defaultHint;
    });

    marker.addEventListener("focus", () => {
      const label = `${comment.user || "Unknown"} at ${formatTime(sec)}: ${comment.text || ""}`;
      dom.timelineHint.textContent = label;
    });

    marker.addEventListener("blur", () => {
      dom.timelineHint.textContent = defaultHint;
    });

    marker.addEventListener("click", () => {
      dom.audioPlayer.currentTime = Math.max(0, sec);
      updateAudioTimelineProgress();
      state.selectedTimelineComment = { segmentId: segment.segment_id, commentId: comment.id };
      updateDeleteTimelineCommentButton();
      const label = `${comment.user || "Unknown"} at ${formatTime(sec)}: ${comment.text || ""}`;
      dom.timelineHint.textContent = label;
    });

    dom.commentMarkers.append(marker);
  }
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
      dom.timelineHint.textContent = "You can only delete your own comments while signed in.";
    }
    return;
  }

  try {
    const response = await fetch(`/api/comments/${encodeURIComponent(commentId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: state.signedInUser }),
    });

    if (!response.ok) {
      if (dom.timelineHint) {
        dom.timelineHint.textContent = "Could not delete comment.";
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
      dom.timelineHint.textContent = "Comment deleted.";
    }
  } catch {
    if (dom.timelineHint) {
      dom.timelineHint.textContent = "Network error. Could not delete comment.";
    }
  }
}

function updateAudioTimelineProgress() {
  const duration = Number(dom.audioPlayer.duration);
  const current = Number(dom.audioPlayer.currentTime);

  if (Number.isFinite(duration) && duration > 0) {
    const percent = Math.max(0, Math.min(100, (current / duration) * 100));
    dom.audioProgress.style.width = `${percent}%`;
    dom.audioTimeLabel.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    if (dom.seekBar && !dom.seekBar.matches(":active")) {
      dom.seekBar.value = String(current / duration);
    }
    if (dom.seekCurrentTime) dom.seekCurrentTime.textContent = formatTime(current);
    if (dom.seekDuration) dom.seekDuration.textContent = formatTime(duration);
    return;
  }

  dom.audioProgress.style.width = "0%";
  dom.audioTimeLabel.textContent = "00:00 / 00:00";
  if (dom.seekBar) dom.seekBar.value = "0";
  if (dom.seekCurrentTime) dom.seekCurrentTime.textContent = "0:00";
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
  dom.nowPlaying.textContent = "No segment selected.";
  dom.metadataGrid.innerHTML = "";
  dom.speciesList.innerHTML = "";
  clearSegmentImage();
  dom.audioPlayer.removeAttribute("src");
  dom.audioPlayer.load();
  dom.detectionMarkers.innerHTML = "";
  if (dom.commentMarkers) {
    dom.commentMarkers.innerHTML = "";
  }
  closeTimelineActionMenu();
  state.selectedTimelineComment = null;
  updateDeleteTimelineCommentButton();
  dom.timelineHint.textContent = "Select a segment to view detections on the timeline.";
  if (dom.playPauseBtn) {
    dom.playPauseBtn.disabled = true;
    if (dom.iconPlay) dom.iconPlay.hidden = false;
    if (dom.iconPause) dom.iconPause.hidden = true;
    dom.playPauseBtn.setAttribute("aria-label", "Play");
  }
  if (dom.seekBar) dom.seekBar.value = "0";
  if (dom.seekCurrentTime) dom.seekCurrentTime.textContent = "0:00";
  if (dom.seekDuration) dom.seekDuration.textContent = "0:00";
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
  state.analyser.fftSize = 1024;
  state.analyser.smoothingTimeConstant = 0.1;

  source.connect(state.analyser);
  state.analyser.connect(state.audioContext.destination);
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
      dom.spectrogramHint.textContent = "Image fallback mode. Provide precomputed PNG files beside Opus segments.";
    } else {
      dom.spectrogramImage.hidden = true;
      dom.spectrogramHint.textContent = "No spectrogram image URL for this segment. Add PNGs to enable fallback mode.";
    }
    return;
  }

  dom.spectrogramCanvas.hidden = false;
  dom.spectrogramImage.hidden = true;
  dom.spectrogramHint.textContent = "Live spectrogram view derived from audio playback.";

  ensureAudioGraph();
  const ctx = dom.spectrogramCanvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#03050a";
    ctx.fillRect(0, 0, dom.spectrogramCanvas.width, dom.spectrogramCanvas.height);
  }

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

  const bins = state.analyser.frequencyBinCount;
  const data = new Uint8Array(bins);

  const draw = () => {
    state.spectrogram.rafId = requestAnimationFrame(draw);
    state.analyser.getByteFrequencyData(data);
    ctx.drawImage(canvas, -1, 0);

    for (let y = 0; y < canvas.height; y += 1) {
      const bin = Math.floor((1 - y / canvas.height) * (bins - 1));
      const magnitude = data[bin] / 255;
      const hue = 220 - magnitude * 220;
      const light = 8 + magnitude * 58;
      ctx.fillStyle = `hsl(${hue}, 95%, ${light}%)`;
      ctx.fillRect(canvas.width - 1, y, 1, 1);
    }
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
