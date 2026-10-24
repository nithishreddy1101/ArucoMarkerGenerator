(function () {
  "use strict";

  var FAMILIES = window.MARKER_FAMILIES;
  var R = window.MarkerRender;
  var STORAGE_KEY = "aruco-generator-settings-v1";
  var MAX_MARKERS = 10000;
  var UNIT_MM = { mm: 1, cm: 10, in: 25.4 };

  // Portrait sizes in mm.
  var PAPERS = [
    ["ISO A", [["A0", 841, 1189], ["A1", 594, 841], ["A2", 420, 594], ["A3", 297, 420],
      ["A4", 210, 297], ["A5", 148, 210], ["A6", 105, 148]]],
    ["ISO B", [["B3", 353, 500], ["B4", 250, 353], ["B5", 176, 250]]],
    ["North America", [["Letter", 215.9, 279.4], ["Legal", 215.9, 355.6], ["Tabloid / Ledger", 279.4, 431.8],
      ["Executive", 184.15, 266.7], ["Half Letter", 139.7, 215.9], ["ANSI C", 431.8, 558.8]]],
    ["Photo & cards", [["4 x 6 in", 101.6, 152.4], ["5 x 7 in", 127, 177.8], ["3 x 5 in index card", 76.2, 127]]]
  ];
  var PAPER_BY_NAME = {};
  PAPERS.forEach(function (g) { g[1].forEach(function (p) { PAPER_BY_NAME[p[0]] = p; }); });

  // Dictionary name (OpenCV naming) -> { family, limit }.
  var DICTS = [];
  ["4X4", "5X5", "6X6", "7X7"].forEach(function (f) {
    FAMILIES[f].sizes.forEach(function (n) {
      DICTS.push({ name: "DICT_" + f + "_" + n, family: f, limit: n, group: FAMILIES[f].label });
    });
  });
  ["ARUCO_ORIGINAL", "APRILTAG_16h5", "APRILTAG_25h9", "APRILTAG_36h10", "APRILTAG_36h11"].forEach(function (f) {
    DICTS.push({ name: "DICT_" + f, family: f, limit: FAMILIES[f].count,
      group: f.indexOf("APRIL") === 0 ? "AprilTag" : "ArUco original" });
  });
  var DICT_BY_NAME = {};
  DICTS.forEach(function (d) { DICT_BY_NAME[d.name] = d; });

  var $ = function (id) { return document.getElementById(id); };
  var form = $("controls");
  var currentUnit = "mm";
  var state = { pages: [], pageIndex: 0, layout: null };

  // ------------------------------------------------------------ setup

  function fillSelects() {
    var dictSel = $("dictionary");
    var groups = {};
    DICTS.forEach(function (d) {
      if (!groups[d.group]) {
        groups[d.group] = document.createElement("optgroup");
        groups[d.group].label = d.group;
        dictSel.appendChild(groups[d.group]);
      }
      groups[d.group].appendChild(new Option(d.name + "  (" + d.limit + " markers)", d.name));
    });
    dictSel.value = "DICT_4X4_50";

    var paperSel = $("paper");
    PAPERS.forEach(function (g) {
      var og = document.createElement("optgroup");
      og.label = g[0];
      g[1].forEach(function (p) { og.appendChild(new Option(p[0], p[0])); });
      paperSel.appendChild(og);
    });
    paperSel.appendChild(new Option("Custom size…", "custom"));
    paperSel.value = "A4";
  }

  function radio(name) {
    var el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  function updateVisibility() {
    form.querySelectorAll("[data-show]").forEach(function (el) {
      var parts = el.getAttribute("data-show").split("=");
      var input = $(parts[0]);
      var value = input ? input.value : radio(parts[0]);
      el.hidden = value !== parts[1];
    });
    var d = DICT_BY_NAME[$("dictionary").value];
    var fam = FAMILIES[d.family];
    $("dictInfo").textContent = fam.bits + "×" + fam.bits + " data bits, IDs 0 – " + (d.limit - 1) + ".";
  }

  function lengthInputs() {
    return Array.prototype.slice.call(form.querySelectorAll("input.len"));
  }

  function roundForUnit(v, unit) {
    var digits = unit === "mm" ? 2 : 3;
    return String(+v.toFixed(digits));
  }

  function changeUnits(next) {
    lengthInputs().forEach(function (inp) {
      if (inp.value === "") return;
      var mm = parseFloat(inp.value) * UNIT_MM[currentUnit];
      inp.value = roundForUnit(mm / UNIT_MM[next], next);
    });
    currentUnit = next;
  }

  function lenMm(id) {
    return parseFloat($(id).value) * UNIT_MM[currentUnit];
  }

  function intVal(id) {
    return parseInt($(id).value, 10);
  }

  function formatLen(mm) {
    return roundForUnit(mm / UNIT_MM[currentUnit], currentUnit) + " " + currentUnit;
  }

  // ------------------------------------------------------------ settings persistence

  function saveSettings() {
    var data = { units: currentUnit };
    form.querySelectorAll("input, select").forEach(function (el) {
      if (el.type === "radio") { if (el.checked) data[el.name] = el.value; }
      else if (el.type === "checkbox") data[el.id] = el.checked;
      else if (el.id) data[el.id] = el.value;
    });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* storage unavailable */ }
  }

  function loadSettings() {
    var data;
    try { data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (e) { data = null; }
    if (!data) return;
    form.querySelectorAll("input, select").forEach(function (el) {
      if (el.type === "radio") { if (data[el.name] !== undefined) el.checked = data[el.name] === el.value; }
      else if (el.type === "checkbox") { if (data[el.id] !== undefined) el.checked = !!data[el.id]; }
      else if (el.id && data[el.id] !== undefined) {
        el.value = data[el.id];
        if (el.tagName === "SELECT" && el.selectedIndex < 0) el.selectedIndex = 0;
      }
    });
    currentUnit = UNIT_MM[data.units] ? data.units : "mm";
    $("units").value = currentUnit;
  }

  // ------------------------------------------------------------ markers

  function markerGrid(family, id, borderBits) {
    var fam = FAMILIES[family];
    var n = fam.bits;
    var hexLen = Math.ceil(n * n / 4);
    var hex = fam.codes.substr(id * hexLen, hexLen);
    var size = n + 2 * borderBits;
    var grid = [];
    for (var r = 0; r < size; r++) {
      var row = [];
      for (var c = 0; c < size; c++) {
        var br = r - borderBits, bc = c - borderBits;
        if (br < 0 || bc < 0 || br >= n || bc >= n) { row.push(1); continue; }
        var bit = br * n + bc;
        var nibble = parseInt(hex[bit >> 2], 16);
        var white = (nibble >> (3 - (bit & 3))) & 1;
        row.push(white ? 0 : 1);
      }
      grid.push(row);
    }
    return grid;
  }

  function parseIds(errors) {
    var dict = DICT_BY_NAME[$("dictionary").value];
    var mode = radio("idMode");
    var ids = [];
    if (mode === "all") {
      for (var i = 0; i < dict.limit; i++) ids.push(i);
    } else if (mode === "range") {
      var start = intVal("idStart"), count = intVal("idCount");
      if (!(start >= 0)) errors.push("First ID must be 0 or more.");
      else if (!(count >= 1)) errors.push("Number of markers must be at least 1.");
      else for (var j = 0; j < count && ids.length <= MAX_MARKERS; j++) ids.push(start + j);
    } else {
      var seen = {};
      var tokens = $("idList").value.split(/[\s,;]+/).filter(Boolean);
      tokens.forEach(function (tok) {
        var m = /^(\d+)(?:\s*[-–:]\s*(\d+))?$/.exec(tok);
        if (!m) { errors.push("Can't read “" + tok + "” — use numbers or ranges like 3-8."); return; }
        var a = parseInt(m[1], 10), b = m[2] !== undefined ? parseInt(m[2], 10) : a;
        var step = a <= b ? 1 : -1;
        for (var k = a; ids.length <= MAX_MARKERS; k += step) {
          if (!seen[k]) { seen[k] = true; ids.push(k); }
          if (k === b) break;
        }
      });
      if (!tokens.length) errors.push("Enter at least one marker ID.");
    }
    var bad = ids.filter(function (id) { return id >= dict.limit; });
    if (bad.length) {
      errors.push(dict.name + " only has IDs 0 – " + (dict.limit - 1) + "; out of range: " +
        bad.slice(0, 8).join(", ") + (bad.length > 8 ? ", …" : "") + ".");
    }
    return ids;
  }

  // ------------------------------------------------------------ layout

  function paperSize(errors) {
    var w, h;
    if ($("paper").value === "custom") {
      w = lenMm("customW"); h = lenMm("customH");
      if (!(w > 0 && h > 0)) { errors.push("Enter a valid custom paper size."); return null; }
    } else {
      var p = PAPER_BY_NAME[$("paper").value];
      w = p[1]; h = p[2];
    }
    var landscape = radio("orientation") === "landscape";
    if ((landscape && w < h) || (!landscape && w > h)) { var t = w; w = h; h = t; }
    return { w: w, h: h };
  }

  function labelText(dictName, id, sizeMm) {
    var parts = [];
    if ($("labelId").checked) parts.push("ID " + id);
    if ($("labelDict").checked) parts.push(dictName);
    if ($("labelSize").checked) parts.push(formatLen(sizeMm));
    return parts.join("  |  ");
  }

  function scaleBarSpec(availW) {
    var metric = currentUnit !== "in";
    var options = metric ? [100, 50, 20, 10] : [4, 2, 1, 0.5];
    var unitMm = metric ? 1 : 25.4;
    for (var i = 0; i < options.length; i++) {
      if (options[i] * unitMm <= availW * 0.55) {
        return { length: options[i] * unitMm, ticks: metric ? options[i] / 10 : options[i] * 4,
          text: options[i] + (metric ? " mm" : " in") };
      }
    }
    return null;
  }

  function computeLayout() {
    var errors = [];
    var dict = DICT_BY_NAME[$("dictionary").value];
    var fam = FAMILIES[dict.family];
    var borderBits = intVal("borderBits");
    if (!(borderBits >= 1 && borderBits <= 4)) { errors.push("Border width must be 1 – 4 bits."); borderBits = 1; }
    var copies = intVal("copies");
    if (!(copies >= 1)) { errors.push("Copies must be at least 1."); copies = 1; }

    var ids = parseIds(errors);
    var sequence = [];
    ids.forEach(function (id) { for (var c = 0; c < copies; c++) sequence.push(id); });
    if (sequence.length > MAX_MARKERS) errors.push("That's more than " + MAX_MARKERS + " markers — please narrow the selection.");

    var paper = paperSize(errors);
    var margin = lenMm("margin"), gap = lenMm("gap"), quiet = lenMm("quiet");
    if (!(margin >= 0)) errors.push("Page margin must be 0 or more.");
    if (!(gap >= 0)) errors.push("Gap must be 0 or more.");
    if (!(quiet >= 0)) errors.push("Quiet zone must be 0 or more.");
    if (errors.length || !paper) return { errors: errors };

    var fontPt = Math.max(4, intVal("fontSize") || 9);
    var hasLabel = labelText(dict.name, 0, 0) !== "";
    var labelH = hasLabel ? fontPt * R.MM_PER_PT * 1.5 : 0;
    var bottomZone = Math.max(quiet, labelH);

    var availW = paper.w - 2 * margin;
    var scaleBar = $("scaleBar").checked ? scaleBarSpec(availW) : null;
    var footerH = scaleBar ? 8 : 0;
    var availH = paper.h - 2 * margin - footerH;
    if (availW <= 0 || availH <= 0) return { errors: ["Margins are larger than the paper."] };

    var mode = radio("sizeMode");
    var size, cols, rows;
    if (mode === "fixed") {
      size = lenMm("markerSize");
      if (!(size > 0)) return { errors: ["Enter a marker size greater than 0."] };
      cols = Math.floor((availW + gap) / (size + 2 * quiet + gap));
      rows = Math.floor((availH + gap) / (size + quiet + bottomZone + gap));
      if (cols < 1 || rows < 1) {
        var maxFit = Math.min(availW - 2 * quiet, availH - quiet - bottomZone);
        return { errors: ["A " + formatLen(size) + " marker doesn't fit on this paper with these margins. " +
          (maxFit > 0 ? "Largest that fits: " + formatLen(Math.floor(maxFit * 10) / 10) + "." : "")] };
      }
    } else {
      cols = mode === "grid" ? intVal("gridCols") : 1;
      rows = mode === "grid" ? intVal("gridRows") : 1;
      if (!(cols >= 1 && rows >= 1)) return { errors: ["Columns and rows must be at least 1."] };
      size = Math.min((availW - (cols - 1) * gap) / cols - 2 * quiet,
        (availH - (rows - 1) * gap) / rows - quiet - bottomZone);
      // Round down to a tidy value in the current unit so the printed size is easy to measure.
      var step = currentUnit === "in" ? (size >= 25.4 ? 0.05 : 0.01) * 25.4 : (size >= 20 ? 1 : 0.1);
      size = Math.floor(size / step + 1e-9) * step;
      if (!(size > 0)) return { errors: [cols + " × " + rows + " markers don't fit on this paper — reduce the grid, gap, margin or quiet zone."] };
    }

    var cellW = size + 2 * quiet, cellH = size + quiet + bottomZone;
    var perPage = cols * rows;
    var usedCols = Math.min(cols, Math.max(1, sequence.length));
    var usedRows = Math.min(rows, Math.max(1, Math.ceil(sequence.length / cols)));
    var gridW = usedCols * cellW + (usedCols - 1) * gap;
    var gridH = (mode === "fixed" ? usedRows : rows) * cellH + ((mode === "fixed" ? usedRows : rows) - 1) * gap;
    var originX = margin + (availW - gridW) / 2;
    var originY = margin + (mode === "fixed" ? 0 : (availH - gridH) / 2);

    var warnings = [];
    var moduleMm = size / (fam.bits + 2 * borderBits);
    if (quiet < moduleMm) {
      warnings.push("The white quiet zone (" + formatLen(quiet) + ") is narrower than one marker bit (" + formatLen(moduleMm) +
        "). Detectors work best with at least one bit of white around each marker.");
    }
    if ($("cutStyle").value === "solid" && quiet < 2 * moduleMm) {
      warnings.push("A solid outline this close to the marker can be mistaken for the marker border if the sheet is used uncut. " +
        "Prefer corner marks, or cut along the outline before use.");
    }

    return {
      errors: [], warnings: warnings, dict: dict, fam: fam, borderBits: borderBits, ids: ids, sequence: sequence,
      paper: paper, margin: margin, gap: gap, quiet: quiet, size: size, cols: cols, rows: rows,
      perPage: perPage, cellW: cellW, cellH: cellH, originX: originX, originY: originY,
      fontPt: fontPt, labelH: labelH, scaleBar: scaleBar, mode: mode,
      pageCount: Math.max(1, Math.ceil(sequence.length / perPage))
    };
  }

  function cutGuide(items, x, y, w, h) {
    var style = $("cutStyle").value;
    var color = "#9a9a9a", lw = 0.2;
    if (style === "solid" || style === "dashed") {
      items.push({ type: "rect", x: x, y: y, w: w, h: h, color: color, lineWidth: lw,
        dash: style === "dashed" ? [1.5, 1.5] : null });
    } else if (style === "corners") {
      var l = Math.min(4, w / 4, h / 4);
      [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(function (c) {
        items.push({ type: "line", x1: c[0], y1: c[1], x2: c[0] + c[2] * l, y2: c[1], color: color, lineWidth: lw });
        items.push({ type: "line", x1: c[0], y1: c[1], x2: c[0], y2: c[1] + c[3] * l, color: color, lineWidth: lw });
      });
    }
  }

  function buildPages(L) {
    var pages = [];
    var modules = L.fam.bits + 2 * L.borderBits;
    var module = L.size / modules;
    var gridCache = {};

    for (var p = 0; p < L.pageCount; p++) {
      var items = [];
      var slice = L.sequence.slice(p * L.perPage, (p + 1) * L.perPage);
      slice.forEach(function (id, i) {
        var col = i % L.cols, row = Math.floor(i / L.cols);
        var cx = L.originX + col * (L.cellW + L.gap);
        var cy = L.originY + row * (L.cellH + L.gap);
        cutGuide(items, cx, cy, L.cellW, L.cellH);
        var grid = gridCache[id] || (gridCache[id] = markerGrid(L.dict.family, id, L.borderBits));
        items.push({ type: "cells", x: cx + L.quiet, y: cy + L.quiet, module: module, grid: grid });

        var text = labelText(L.dict.name, id, L.size);
        if (text) {
          var pt = L.fontPt;
          while (pt > 4 && R.textWidthMm(text, pt) > L.cellW * 0.95) pt -= 0.5;
          var top = cy + L.quiet + L.size;
          var zone = L.cellH - L.quiet - L.size;
          items.push({ type: "text", x: cx + L.cellW / 2, y: top + zone / 2 + pt * R.MM_PER_PT * 0.35,
            text: text, size: pt, align: "center" });
        }
      });

      if (L.scaleBar) {
        var sb = L.scaleBar;
        var bx = L.margin, by = L.paper.h - L.margin - 2;
        var line = { color: "#000000", lineWidth: 0.25 };
        items.push(Object.assign({ type: "line", x1: bx, y1: by, x2: bx + sb.length, y2: by }, line));
        for (var t = 0; t <= sb.ticks; t++) {
          var tx = bx + sb.length * t / sb.ticks;
          var th = (t === 0 || t === sb.ticks) ? 3 : 1.5;
          items.push(Object.assign({ type: "line", x1: tx, y1: by, x2: tx, y2: by - th }, line));
        }
        items.push({ type: "text", x: bx + sb.length + 2, y: by, text: sb.text, size: 7, align: "left" });

        var footer = L.dict.name + "  |  " + formatLen(L.size) + " markers  |  page " + (p + 1) + " / " + L.pageCount;
        var fw = R.textWidthMm(footer, 7);
        var leftEnd = bx + sb.length + 4 + R.textWidthMm(sb.text, 7);
        if (L.paper.w - L.margin - fw > leftEnd + 4) {
          items.push({ type: "text", x: L.paper.w - L.margin, y: by, text: footer, size: 7, align: "right", color: "#555555" });
        }
      }
      pages.push({ width: L.paper.w, height: L.paper.h, items: items });
    }
    return pages;
  }

  // ------------------------------------------------------------ UI

  function renderSummary(L) {
    var paperName = $("paper").value === "custom" ? "Custom" : $("paper").value;
    var stats = [
      ["Dictionary", L.dict.name],
      ["Markers", L.sequence.length + (L.sequence.length !== L.ids.length ? " (" + L.ids.length + " IDs)" : "")],
      ["Marker size", formatLen(L.size)],
      ["Per page", L.cols + " × " + L.rows + " = " + L.perPage],
      ["Pages", L.pageCount],
      ["Paper", paperName + " " + formatLen(L.paper.w) + " × " + formatLen(L.paper.h)],
      ["Module (1 bit)", formatLen(L.size / (L.fam.bits + 2 * L.borderBits))]
    ];
    var box = $("summary");
    box.textContent = "";
    stats.forEach(function (s) {
      var span = document.createElement("span");
      span.appendChild(document.createTextNode(s[0] + ": "));
      var b = document.createElement("b");
      b.textContent = s[1];
      span.appendChild(b);
      box.appendChild(span);
    });
  }

  function renderPreview() {
    var preview = $("preview");
    var page = state.pages[state.pageIndex];
    preview.innerHTML = page ? R.pageToSvg(page) : "";
    var svg = preview.querySelector("svg");
    if (svg) {
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.style.aspectRatio = page.width + " / " + page.height;
      svg.style.setProperty("--ar", page.width / page.height);
    }
    var total = state.pages.length;
    $("pageLabel").textContent = "Page " + (total ? state.pageIndex + 1 : 0) + " / " + total;
    $("prevPage").disabled = state.pageIndex <= 0;
    $("nextPage").disabled = state.pageIndex >= total - 1;
  }

  function update() {
    updateVisibility();
    var L = computeLayout();
    var errBox = $("errors");
    var warnBox = $("warnings");
    var warnings = L.warnings || [];
    warnBox.hidden = !warnings.length;
    warnBox.innerHTML = "";
    if (warnings.length) {
      var wl = document.createElement("ul");
      warnings.forEach(function (w) { var li = document.createElement("li"); li.textContent = w; wl.appendChild(li); });
      warnBox.appendChild(wl);
    }
    var ok = !L.errors.length;
    errBox.hidden = ok;
    errBox.innerHTML = "";
    if (!ok) {
      var ul = document.createElement("ul");
      L.errors.forEach(function (e) { var li = document.createElement("li"); li.textContent = e; ul.appendChild(li); });
      errBox.appendChild(ul);
      state.pages = [];
      state.layout = null;
      $("summary").textContent = "Fix the settings below to see a preview.";
    } else {
      state.layout = L;
      state.pages = buildPages(L);
      state.pageIndex = Math.min(state.pageIndex, state.pages.length - 1);
      renderSummary(L);
    }
    ["btnPdf", "btnOpenPdf", "btnSvg"].forEach(function (id) { $(id).disabled = !ok; });
    renderPreview();
    saveSettings();
  }

  var timer = null;
  function scheduleUpdate() {
    clearTimeout(timer);
    timer = setTimeout(update, 120);
  }

  function baseName() {
    var L = state.layout;
    var ids = L.ids;
    var contiguous = ids.every(function (id, i) { return i === 0 || id === ids[i - 1] + 1; });
    var range = ids.length === 1 ? ids[0] : contiguous ? ids[0] + "-" + ids[ids.length - 1] : ids.length + "ids";
    return L.dict.name + "_" + (contiguous ? "ids" : "") + range + "_" + formatLen(L.size).replace(" ", "").replace(".", "p");
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function withBusy(button, label, work) {
    var original = button.textContent;
    button.disabled = true;
    button.textContent = label;
    return work().catch(function (e) { alert("Could not create the PDF: " + e.message); })
      .then(function () { button.disabled = false; button.textContent = original; });
  }

  function makePdf() {
    return R.buildPdf(state.pages, state.layout.dict.name + " markers");
  }

  function bindEvents() {
    form.addEventListener("input", function (e) {
      if (e.target.id === "units") return;
      scheduleUpdate();
    });
    form.addEventListener("change", function (e) {
      if (e.target.id === "units") changeUnits(e.target.value);
      if (e.target.name === "idMode" || e.target.id === "dictionary") state.pageIndex = 0;
      update();
    });

    $("prevPage").addEventListener("click", function () { state.pageIndex--; renderPreview(); });
    $("nextPage").addEventListener("click", function () { state.pageIndex++; renderPreview(); });
    document.addEventListener("keydown", function (e) {
      if (e.target.closest && e.target.closest("input, select, textarea")) return;
      if (e.key === "ArrowLeft" && state.pageIndex > 0) { state.pageIndex--; renderPreview(); }
      if (e.key === "ArrowRight" && state.pageIndex < state.pages.length - 1) { state.pageIndex++; renderPreview(); }
    });

    $("btnPdf").addEventListener("click", function () {
      withBusy($("btnPdf"), "Building PDF…", function () {
        return makePdf().then(function (blob) { download(blob, baseName() + ".pdf"); });
      });
    });

    $("btnOpenPdf").addEventListener("click", function () {
      var win = window.open("", "_blank");
      withBusy($("btnOpenPdf"), "Building PDF…", function () {
        return makePdf().then(function (blob) {
          var url = URL.createObjectURL(blob);
          if (win) win.location.href = url; else download(blob, baseName() + ".pdf");
        });
      });
    });

    $("btnSvg").addEventListener("click", function () {
      var page = state.pages[state.pageIndex];
      var svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + R.pageToSvg(page);
      download(new Blob([svg], { type: "image/svg+xml" }), baseName() + "_page" + (state.pageIndex + 1) + ".svg");
    });

    $("btnReset").addEventListener("click", function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      location.reload();
    });
  }

  fillSelects();
  loadSettings();
  bindEvents();
  update();
})();
