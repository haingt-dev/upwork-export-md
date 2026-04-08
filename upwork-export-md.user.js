// ==UserScript==
// @name         Upwork Export MD
// @namespace    haingt-dev
// @version      1.1
// @description  Extract Upwork job details and export as structured Markdown for LLM scoring.
// @author       haingt-dev
// @match        https://www.upwork.com/nx/search/jobs*
// @match        https://www.upwork.com/nx/find-work/*
// @match        https://www.upwork.com/jobs/*
// @grant        GM.getValue
// @grant        GM.setValue
// @run-at       document-idle
// @license      MIT
// @homepageURL  https://github.com/haingt-dev/upwork-export-md
// ==/UserScript==

// Changelog:
// v1.1 — Stability: data-qa selectors for client fields, data-test="ConnectsDesktop" for connects,
//         data-test="ClientActivity" for proposals/activity. Persistence via GM storage.
//         New fields: screening questions, qualifications, client open jobs/hires/active.
// v1.0 — Initial: FAB + bottom bar, add/remove toggle, export .md, poll-based detection.

(function () {
  "use strict";

  const LOG = (...args) => console.log("[CFC]", ...args);
  LOG("v1.1 loaded");

  // --- Styles ---
  const style = document.createElement("style");
  style.textContent = `
    .cfc-fab {
      position: fixed;
      bottom: 56px;
      right: 24px;
      z-index: 99999;
      background: #d97706;
      color: #fff;
      border: none;
      border-radius: 50%;
      width: 48px;
      height: 48px;
      font-size: 22px;
      cursor: pointer;
      box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      transition: background 0.2s, transform 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .cfc-fab:hover { background: #b45309; transform: scale(1.1); }
    .cfc-fab.in-list { background: #dc2626; }
    .cfc-fab.in-list:hover { background: #b91c1c; }
    .cfc-fab-badge {
      position: fixed;
      bottom: 108px;
      right: 24px;
      z-index: 99999;
      background: #1e293b;
      color: #e2e8f0;
      border-radius: 12px;
      padding: 4px 10px;
      font-size: 11px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      pointer-events: none;
      transition: opacity 0.2s;
    }
    .cfc-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 99998;
      background: #1e293b;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 24px;
      font-size: 13px;
      box-shadow: 0 -2px 12px rgba(0,0,0,0.3);
      transform: translateY(100%);
      transition: transform 0.2s;
    }
    .cfc-bar.visible { transform: translateY(0); }
    .cfc-bar-actions { display: flex; gap: 8px; }
    .cfc-bar-export {
      background: #16a34a; color: #fff; border: none; border-radius: 6px;
      padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .cfc-bar-export:hover { background: #15803d; }
    .cfc-bar-clear {
      background: transparent; color: #94a3b8; border: 1px solid #475569;
      border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer;
    }
    .cfc-bar-clear:hover { background: #334155; }
  `;
  document.head.appendChild(style);

  // --- State (persisted via GM storage) ---
  const jobList = new Map();
  const STORAGE_KEY = "cfc_jobList";

  async function saveState() {
    try {
      const data = Object.fromEntries(jobList);
      await GM.setValue(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { LOG("Save failed:", e); }
  }

  async function loadState() {
    try {
      const raw = await GM.getValue(STORAGE_KEY, "{}");
      const data = JSON.parse(raw);
      for (const [id, entry] of Object.entries(data)) {
        jobList.set(id, entry);
      }
      if (jobList.size > 0) LOG("Restored", jobList.size, "jobs from storage");
    } catch (e) { LOG("Load failed:", e); }
  }

  // --- DOM Helpers ---
  // Collapse whitespace + trim — safe for titles and single-line fields
  function cleanText(el) {
    return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
  }

  // Clean text with tooltip removal — clone element, strip tooltips, then extract
  function cleanTextNoTooltip(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    // Remove tooltip content elements (Upwork uses these for hover info)
    clone.querySelectorAll('[data-test="UpCTooltip"], [data-test*="tooltip"], .air3-tooltip-body, .air3-popper-content, [role="tooltip"], [class*="tooltip"], .air3-popper, [data-popper-placement]').forEach(t => t.remove());
    // Also remove "Close the tooltip..." text patterns
    let text = clone.textContent.replace(/\s+/g, " ").trim();
    // Strip "Close the tooltip" and any trailing tooltip description (may or may not end with period)
    text = text.replace(/Close the tooltip\b[^.]*?\.\s*/g, "");  // with period
    text = text.replace(/Close the tooltip\s*/g, "");             // without period
    return text.trim();
  }

  function getDetailPanel() {
    // Known slider classes across page variants
    const slider = document.querySelector('[class*="air3-slider-job-details"]');
    if (slider) return slider;
    // Fallback: "Apply now" walk-up
    const applyBtn = [...document.querySelectorAll("button, a")].find(
      el => el.textContent.trim() === "Apply now"
    );
    if (applyBtn) {
      let el = applyBtn.parentElement;
      let depth = 0;
      while (el && el !== document.body && depth < 20) {
        if (el.querySelector("h1,h2,h3,h4,h5,h6")) {
          const r = el.getBoundingClientRect();
          if (r.width > 400 && r.height > 400) return el;
        }
        el = el.parentElement;
        depth++;
      }
    }
    // Single job page
    if (window.location.pathname.startsWith("/jobs/")) return document.querySelector("main");
    return null;
  }

  function getJobId(panel) {
    const link = panel.querySelector('a[href*="/jobs/~"]');
    if (link) {
      const m = link.getAttribute("href").match(/~(\d+)/);
      return m ? m[1] : null;
    }
    const um = window.location.href.match(/~(\d+)/);
    return um ? um[1] : null;
  }

  // --- Selector helpers ---
  // Try multiple selectors in order, return first match
  function q(panel, ...selectors) {
    for (const s of selectors) {
      const el = panel.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  // --- Extractors ---
  function extractFromPanel(panel) {
    const job = {};

    // Title — multi-fallback chain
    const titleEl = q(panel,
      '[data-test="job-tile-title-link"]',  // search tile (if panel is tile-based)
      "h4 span.flex-1",                     // detail slider
      "h1", "h2", "h3", "h4"               // single job page
    );
    job.title = cleanText(titleEl) || "Unknown Title";

    // Description — preserve newlines (multiline content)
    const descContainer = q(panel, '[data-test~="Description"]');
    const descP = descContainer ? q(descContainer, "p.multiline-text", "p") : null;
    job.description = (descP ? descP.textContent.trim() : descContainer ? descContainer.textContent.trim() : "") || "";

    // Posted — data-test="PostedOn" or fallback. Extract date text only, not "Worldwide" etc.
    const postedEl = q(panel, '[data-test="PostedOn"]', ".posted-on-line");
    if (postedEl) {
      // Prefer the inner span/div that contains just the date text
      const dateDiv = postedEl.querySelector('[data-v-cc9d29f2]') || postedEl.querySelector("div") || postedEl;
      let postedText = cleanTextNoTooltip(dateDiv);
      // Strip "Worldwide" or location text that may be in the same container
      postedText = postedText.replace(/\s*Worldwide\s*/g, " ").trim();
      job.posted = postedText.startsWith("Posted") ? postedText : postedText ? "Posted " + postedText : "";
    } else {
      job.posted = "";
    }

    // Skills — data-test="token" (richardadonnell) or class-based fallback
    let skillEls = panel.querySelectorAll('[data-test="token"] span');
    if (skillEls.length === 0) skillEls = panel.querySelectorAll(".skills-list .air3-badge.badge, .skills-list .badge");
    job.skills = [...new Set([...skillEls].map(cleanText).filter(s => s.length > 0 && s.length < 50))];

    // --- Client (data-qa selectors — stable in detail panel) ---
    // /nx/search and /nx/find-work use data-test~="about-client-container"
    // /jobs/~ direct page may use different structure — fallback to heading search
    let clientContainer = q(panel, '[data-test~="about-client-container"]');
    if (!clientContainer) {
      const headings = panel.querySelectorAll("h4, h5, h3, strong");
      for (const h of headings) {
        if (cleanText(h).includes("About the client")) {
          clientContainer = h.closest("section") || h.parentElement;
          break;
        }
      }
    }
    const clientParts = [];

    if (clientContainer) {
      // Payment verification — data-test or text fallback
      const paymentEl = clientContainer.querySelector('[data-test="payment-verified"]');
      if (paymentEl) {
        clientParts.push("Payment verified");
      } else {
        const ct = clientContainer.textContent;
        if (ct.includes("Payment method verified")) clientParts.push("Payment verified");
        else if (ct.includes("Payment method not verified")) clientParts.push("Payment NOT verified");
      }

      // Phone verification
      if (clientContainer.textContent.includes("Phone number verified")) clientParts.push("Phone verified");

      // Rating — multiple strategies for different page layouts
      let ratingFound = false;
      // Strategy 1: data-test="UpCRating" element
      const ratingEl = clientContainer.querySelector('[data-test="UpCRating"]');
      if (ratingEl) {
        const ratingText = cleanTextNoTooltip(ratingEl);
        const rm = ratingText.match(/([\d.]+)\s*of\s*(\d+)\s*reviews?/);
        if (rm && parseFloat(rm[1]) <= 5) { clientParts.push(`${rm[1]} of ${rm[2]} reviews`); ratingFound = true; }
      }
      // Strategy 2: data-test="feedback-rating" element
      if (!ratingFound) {
        const fbEl = clientContainer.querySelector('[data-test="feedback-rating"]');
        if (fbEl) {
          const fbText = cleanTextNoTooltip(fbEl);
          const rm = fbText.match(/([\d.]+)\s*of\s*(\d+)\s*reviews?/);
          if (rm && parseFloat(rm[1]) <= 5) { clientParts.push(`${rm[1]} of ${rm[2]} reviews`); ratingFound = true; }
        }
      }
      // Strategy 3: regex on full client container text (tooltip-stripped)
      if (!ratingFound) {
        const ctClean = cleanTextNoTooltip(clientContainer);
        const rm = ctClean.match(/([\d.]+)\s*of\s*(\d+)\s*reviews?/);
        if (rm && parseFloat(rm[1]) <= 5) { clientParts.push(`${rm[1]} of ${rm[2]} reviews`); ratingFound = true; }
      }
      // Strategy 4: look for rating span near client container (Nuxt pages render rating outside container)
      if (!ratingFound) {
        const ratingSpans = panel.querySelectorAll("span.nowrap");
        for (const sp of ratingSpans) {
          const rm = sp.textContent.match(/([\d.]+)\s*of\s*(\d+)\s*reviews?/);
          if (rm && parseFloat(rm[1]) <= 5) { clientParts.push(`${rm[1]} of ${rm[2]} reviews`); break; }
        }
      }

      // Location — data-qa="client-location" (MUCH more reliable than timestamp-anchored regex)
      const locEl = clientContainer.querySelector('[data-qa="client-location"]');
      if (locEl) {
        const country = locEl.querySelector("strong");
        const city = locEl.querySelector("span.nowrap:not([data-test])");
        const locParts = [];
        if (country && cleanText(country)) locParts.push(cleanText(country));
        if (city && cleanText(city)) locParts.push(cleanText(city));
        if (locParts.length > 0) clientParts.push(locParts.join(", "));
      }

      // Jobs posted + hire rate + open jobs — data-qa="client-job-posting-stats"
      const statsEl = clientContainer.querySelector('[data-qa="client-job-posting-stats"]');
      if (statsEl) {
        const strong = statsEl.querySelector("strong");
        if (strong) clientParts.push(cleanText(strong));  // "1 job posted"
        const div = statsEl.querySelector("div");
        if (div) {
          const statsText = cleanText(div);
          // "100% hire rate, 1 open job" — split and add each
          statsText.split(",").map(s => s.trim()).filter(Boolean).forEach(s => clientParts.push(s));
        }
      }

      // Hires — data-qa="client-hires"
      const hiresEl = clientContainer.querySelector('[data-qa="client-hires"]');
      if (hiresEl) clientParts.push(cleanText(hiresEl));  // "1 hire, 1 active"

      // Total spent — data-test="total-spent" or regex
      const spentEl = q(clientContainer, '[data-test="total-spent"] strong', '[data-test="total-spent"]');
      if (spentEl) {
        clientParts.push(cleanText(spentEl));
      } else {
        const sm = clientContainer.textContent.match(/\$([\d,.]+K?)\s*total spent/);
        if (sm) clientParts.push(`$${sm[1]} total spent`);
      }

      // Avg hourly rate + hours — often in client stats text
      const ctText = clientContainer.textContent;
      const avgRate = ctText.match(/\$([\d.]+)\s*\/hr\s*avg hourly rate/);
      if (avgRate) clientParts.push(`$${avgRate[1]}/hr avg hourly rate paid`);
      const totalHours = ctText.match(/([\d,]+)\s*hours/);
      if (totalHours) clientParts.push(`${totalHours[1]} hours`);

      // Company info — data-qa="client-company-profile"
      const companyEl = clientContainer.querySelector('[data-qa="client-company-profile"]');
      if (companyEl) {
        const companyText = cleanText(companyEl);
        if (companyText && companyText.length > 2) clientParts.push(companyText);
      }

      // Member since — data-qa="client-contract-date"
      const memberEl = clientContainer.querySelector('[data-qa="client-contract-date"]');
      if (memberEl) {
        const memberText = cleanText(memberEl);
        if (memberText) clientParts.push(memberText.startsWith("Member") ? memberText : "Member since " + memberText);
      }
    }
    job.client = clientParts.join(" | ");

    // --- Connects — data-test="ConnectsDesktop" (stable) ---
    const connEl = q(panel, '[data-test="ConnectsDesktop"]', '[data-test~="connects"]');
    if (connEl) {
      const cm = cleanTextNoTooltip(connEl).match(/Required Connects[^:]*:\s*(\d+)/);
      job.connects = cm ? cm[1] + " Connects" : "";
    } else {
      // Fallback: broader regex on panel
      const cm = cleanTextNoTooltip(panel).match(/(?:Send a proposal for:|Required Connects[^:]*:)\s*(\d+)/);
      job.connects = cm ? cm[1] + " Connects" : "";
    }

    // --- Features section (shared for type, budget, experience, duration, hours) ---
    // /nx/search/jobs uses data-test="Features"; /nx/find-work slider uses ul.features without data-test
    const featSection = q(panel, '[data-test~="Features"]') ||
      (panel.querySelector("ul.features") ? panel.querySelector("ul.features").closest("section") : null);
    const featText = featSection ? featSection.textContent : cleanTextNoTooltip(panel);

    // Type (Hourly / Fixed-price)
    job.type = "";
    if (featSection) {
      const descDivs = featSection.querySelectorAll(".description");
      for (const d of descDivs) {
        const t = cleanText(d);
        if (t === "Hourly" || t.includes("Fixed")) { job.type = t; break; }
      }
    }
    if (!job.type) {
      if (featText.includes("Hourly")) job.type = "Hourly";
      else if (featText.includes("Fixed")) job.type = "Fixed-price";
    }

    // Budget — regex on Features text first (catches both range and single), then data-test fallback
    job.budget = "";
    // Regex on Features/panel text — most reliable across all page types
    const rangeMatch = featText.match(/\$([\d,.]+)\s*[-–]\s*\$([\d,.]+)/);
    if (rangeMatch) {
      job.budget = `$${rangeMatch[1]}-$${rangeMatch[2]}`;
    }
    if (!job.budget) {
      const fixedMatch = featText.match(/\$([\d,.]+)[\s\S]{0,20}Fixed/);
      if (fixedMatch) job.budget = `$${fixedMatch[1]}`;
    }
    if (!job.budget) {
      const estMatch = featText.match(/(?:Est\.?\s*)?[Bb]udget[:\s]*\$([\d,.]+)/);
      if (estMatch) job.budget = `$${estMatch[1]}`;
    }
    // data-test fallback (search tiles)
    if (!job.budget) {
      const fixedBudgetEl = q(panel, '[data-test="is-fixed-price"] strong', '[data-test="BudgetAmount"] strong');
      const hourlyBudgetEl = q(panel, '[data-test="is-hourly"] strong');
      if (fixedBudgetEl) job.budget = cleanText(fixedBudgetEl);
      else if (hourlyBudgetEl) job.budget = cleanText(hourlyBudgetEl);
    }

    // Bids
    job.bids = "";
    const bidsEl = q(panel, '[data-test~="Bids"]');
    if (bidsEl) {
      const bt = bidsEl.textContent;
      const avg = bt.match(/Avg\s*\$([\d,.]+)/);
      const low = bt.match(/Low\s*\$([\d,.]+)/);
      const high = bt.match(/High\s*\$([\d,.]+)/);
      if (avg) {
        const p = [];
        if (low) p.push(`$${low[1]}`);
        p.push(`avg $${avg[1]}`);
        if (high) p.push(`$${high[1]}`);
        job.bids = p.join(" – ");
      }
    }

    // Contract-to-hire — from Features section
    job.contractToHire = false;
    if (featText.includes("Contract-to-hire")) job.contractToHire = true;

    // Experience — data-test, then strong tag in features, then regex
    const expEl = q(panel, '[data-test="experience-level"]', '[data-test="contractor-tier"]');
    if (expEl) {
      job.experience = cleanText(expEl);
    } else if (featSection) {
      // Check <strong> tags inside features for experience level text
      const strongs = featSection.querySelectorAll("strong");
      for (const s of strongs) {
        const t = cleanText(s);
        if (/^(Expert|Intermediate|Entry Level)$/i.test(t)) { job.experience = t; break; }
      }
    }
    if (!job.experience) {
      const exp = featText.match(/\b(Expert|Intermediate|Entry Level)\b/);
      job.experience = exp ? exp[0] : "";
    }

    // Duration
    const dur = featText.match(/(\d+\s*to\s*\d+\s*months|Less than (?:a|\d+) months?|More than \d+ months)/i);
    job.duration = dur ? dur[0] : "";

    // Hours
    const hrs = featText.match(/((?:Less|More) than \d+ hrs\/week|\d+\+?\s*hrs\/week|Hours to be determined)/i);
    job.hours = hrs ? hrs[0] : "";

    // Project type — data-test="Segmentations" or class fallback (find-work slider)
    job.projectType = "";
    const seg = q(panel, '[data-test~="Segmentations"]', "ul.segmentations");
    if (seg) {
      const sp = [...seg.querySelectorAll("span")].find(s => cleanText(s));
      job.projectType = sp ? cleanText(sp) : "";
    }

    // --- Proposals + Activity — data-test="ClientActivity" or heading-based fallback ---
    job.proposals = "";
    job.activity = [];
    let activityEl = q(panel, '[data-test="ClientActivity"]');
    // Fallback for /nx/find-work/ slider: find section by "Activity on this job" heading
    if (!activityEl) {
      const headings = panel.querySelectorAll("h5, h4");
      for (const h of headings) {
        if (cleanText(h).includes("Activity on this job")) {
          activityEl = h.closest("section") || h.parentElement;
          break;
        }
      }
    }
    if (activityEl) {
      const items = activityEl.querySelectorAll(".ca-item, li");
      for (const item of items) {
        const titleSpan = item.querySelector(".title");
        const label = titleSpan ? cleanText(titleSpan) : "";
        // Use tooltip-free text to avoid "Close the tooltip..." noise
        const fullText = cleanTextNoTooltip(item);
        const value = fullText.replace(label, "").trim();
        if (label.startsWith("Proposals")) {
          job.proposals = value;
        } else if (label && value) {
          job.activity.push(`${label} ${value}`);
        }
      }
    }
    // Fallback: data-test="proposals-tier" (search tile) or regex
    if (!job.proposals) {
      const propTier = q(panel, '[data-test="proposals-tier"] strong');
      if (propTier) {
        job.proposals = cleanText(propTier);
      } else {
        const propFallback = cleanTextNoTooltip(panel).match(/Proposals:\s*([\d+]+(?:\s*to\s*\d+)?|Less than \d+)/i);
        job.proposals = propFallback ? propFallback[1].trim() : "";
      }
    }

    // --- Screening questions ---
    job.questions = [];
    // Strategy 1: data-test="Questions" section (confirmed in Upwork DOM)
    const questionsSection = panel.querySelector('[data-test="Questions"]');
    if (questionsSection) {
      const items = questionsSection.querySelectorAll("ol > li, ul > li");
      for (const li of items) {
        const t = cleanText(li);
        if (t && t.length > 5) job.questions.push(t);
      }
    }
    // Strategy 2: data-test="question" elements (fallback)
    if (job.questions.length === 0) {
      const questionEls = panel.querySelectorAll('[data-test="question"]');
      for (const qEl of questionEls) job.questions.push(cleanText(qEl));
    }

    // --- Preferred Qualifications (English level, Location — NOT skills) ---
    job.qualifications = [];
    // Look for "Preferred qualifications" section by heading text
    const qualHeadings = panel.querySelectorAll("h5, h4, h3, strong");
    for (const h of qualHeadings) {
      if (cleanText(h).toLowerCase().includes("preferred qualification")) {
        const container = h.closest("section") || h.parentElement;
        // Strategy 1: structured list items with data-cy or strong:span pattern
        const items = container.querySelectorAll("ul.qualification-items li, li[data-cy]");
        if (items.length > 0) {
          for (const item of items) {
            const t = cleanTextNoTooltip(item);
            if (t && t.includes(":") && t.length < 100) job.qualifications.push(t);
          }
        }
        // Strategy 2: any li with colon pattern
        if (job.qualifications.length === 0) {
          const allItems = container.querySelectorAll("li, div > span");
          for (const item of allItems) {
            const t = cleanTextNoTooltip(item);
            if (t && t.includes(":") && t.length < 100) job.qualifications.push(t);
          }
        }
        // Strategy 3: regex on container text
        if (job.qualifications.length === 0) {
          const text = cleanTextNoTooltip(container);
          const matches = text.match(/((?:English level|Location|Talent Type|Job Success Score|Include Rising Talent):\s*[^,\n]+)/gi);
          if (matches) job.qualifications = matches.map(m => m.trim());
        }
        break;
      }
    }

    // --- URL ---
    const link = panel.querySelector('a[href*="/jobs/~"]');
    if (link) {
      const h = link.getAttribute("href");
      job.url = h.startsWith("http") ? h.split("?")[0] : "https://www.upwork.com" + h.split("?")[0];
    } else if (window.location.pathname.startsWith("/jobs/")) {
      // Direct job page — use current URL
      job.url = window.location.origin + window.location.pathname;
    } else {
      job.url = "";
    }

    return job;
  }

  // --- Post-processing: strip any remaining tooltip noise from all string fields ---
  function stripTooltipNoise(job) {
    const strip = s => typeof s === "string"
      ? s.replace(/Close the tooltip\b[^.]*?\.\s*/g, "").replace(/Close the tooltip\s*/g, "").trim()
      : s;
    for (const key of Object.keys(job)) {
      if (typeof job[key] === "string") job[key] = strip(job[key]);
      else if (Array.isArray(job[key])) job[key] = job[key].map(strip);
    }
    return job;
  }

  // --- Formatter ---
  function formatJob(job) {
    stripTooltipNoise(job);
    const lines = [];
    lines.push(`## ${job.title}`);
    if (job.url) lines.push(job.url);

    // Meta line: type | budget | bids | experience | posted | proposals | connects
    const meta = [
      job.type,
      job.budget,
      job.bids ? `Bids: ${job.bids}` : "",
      job.experience,
      job.contractToHire ? "Contract-to-hire" : "",
      job.hours,
      job.duration,
      job.posted,
      job.proposals ? `${job.proposals} proposals` : "",
      job.connects,
    ].filter(Boolean).join(" | ");
    if (meta) lines.push(meta);

    lines.push("");
    if (job.description) lines.push(job.description);
    if (job.projectType) { lines.push(""); lines.push(`Project Type: ${job.projectType}`); }
    if (job.skills.length > 0) { lines.push(""); lines.push(`Skills: ${job.skills.join(", ")}`); }
    if (job.questions.length > 0) {
      lines.push("");
      lines.push("Screening Questions:");
      job.questions.forEach(q => lines.push(`- ${q}`));
    }
    if (job.qualifications.length > 0) {
      lines.push("");
      lines.push(`Qualifications: ${job.qualifications.join(", ")}`);
    }
    if (job.activity.length > 0) {
      lines.push("");
      lines.push(`Activity: ${job.activity.join("; ")}`);
    }
    if (job.client) { lines.push(""); lines.push(`Client: ${job.client}`); }
    return lines.join("\n");
  }

  // --- Export ---
  function exportToMd() {
    if (jobList.size === 0) return;
    const date = new Date().toISOString().slice(0, 10);
    const parts = [`# Upwork Jobs — ${date}\n`, `${jobList.size} jobs collected\n`];
    let i = 0;
    for (const [, entry] of jobList) {
      if (i > 0) parts.push("\n---\n");
      parts.push(entry.formatted);
      i++;
    }
    const blob = new Blob([parts.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `upwork-jobs-${date}.md`;
    a.click();
    URL.revokeObjectURL(url);
    LOG("Exported", jobList.size, "jobs");
  }

  // --- UI ---
  function createUI() {
    const fab = document.createElement("button");
    fab.className = "cfc-fab";
    fab.id = "cfc-fab";
    fab.textContent = "+";
    fab.title = "Add current job to list";
    fab.addEventListener("click", handleFabClick);
    document.body.appendChild(fab);

    const badge = document.createElement("div");
    badge.className = "cfc-fab-badge";
    badge.id = "cfc-badge";
    badge.style.opacity = "0";
    document.body.appendChild(badge);

    const bar = document.createElement("div");
    bar.className = "cfc-bar";
    bar.id = "cfc-bar";
    bar.innerHTML = `
      <span id="cfc-bar-text">0 jobs</span>
      <div class="cfc-bar-actions">
        <button class="cfc-bar-export" id="cfc-export-btn">Export .md</button>
        <button class="cfc-bar-clear" id="cfc-clear-btn">Clear</button>
      </div>
    `;
    document.body.appendChild(bar);
    document.getElementById("cfc-export-btn").addEventListener("click", exportToMd);
    document.getElementById("cfc-clear-btn").addEventListener("click", () => {
      jobList.clear();
      saveState();
      updateUI();
    });
  }

  function handleFabClick() {
    const panel = getDetailPanel();
    if (!panel) { LOG("No detail panel open"); return; }
    const jobId = getJobId(panel);
    if (!jobId) { LOG("No job ID found"); return; }

    if (jobList.has(jobId)) {
      jobList.delete(jobId);
      LOG("Removed:", jobId);
    } else {
      const job = extractFromPanel(panel);
      const formatted = formatJob(job);
      jobList.set(jobId, { formatted, title: job.title });
      LOG("Added:", job.title.substring(0, 50));
    }
    saveState();
    updateUI();
  }

  function updateUI() {
    const fab = document.getElementById("cfc-fab");
    const badge = document.getElementById("cfc-badge");
    const bar = document.getElementById("cfc-bar");
    const barText = document.getElementById("cfc-bar-text");

    const panel = getDetailPanel();
    const jobId = panel ? getJobId(panel) : null;
    const inList = jobId && jobList.has(jobId);

    if (fab) {
      fab.textContent = inList ? "\u2715" : "+";
      fab.title = inList ? "Remove from list" : "Add to list";
      fab.classList.toggle("in-list", inList);
    }
    if (badge) {
      badge.textContent = jobList.size > 0 ? `${jobList.size} job(s)` : "";
      badge.style.opacity = jobList.size > 0 ? "1" : "0";
    }
    if (bar && barText) {
      bar.classList.toggle("visible", jobList.size > 0);
      barText.textContent = `${jobList.size} job(s) in list`;
    }
  }

  // --- Poll for job changes (lightweight: only checks jobId) ---
  let lastSeenJobId = null;
  setInterval(() => {
    const panel = getDetailPanel();
    const jobId = panel ? getJobId(panel) : null;
    if (jobId !== lastSeenJobId) {
      lastSeenJobId = jobId;
      updateUI();
    }
  }, 800);

  // --- Init ---
  async function init() {
    await loadState();
    createUI();
    updateUI();
    LOG("Init complete —", jobList.size, "jobs in list");
  }
  init();
})();
