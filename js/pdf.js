// Rendering of page "display lists" to SVG and to a minimal vector PDF.
//
// A page is { width, height, items } in millimetres (origin top-left). Items:
//   { type: "cells",  x, y, module, grid }            grid[r][c] === 1 -> black
//   { type: "rect",   x, y, w, h, color, lineWidth, dash }
//   { type: "line",   x1, y1, x2, y2, color, lineWidth }
//   { type: "text",   x, y, text, size, align }       y = baseline, size in pt
(function () {
  "use strict";

  var PT_PER_MM = 72 / 25.4;
  var MM_PER_PT = 25.4 / 72;

  // Helvetica advance widths (1/1000 em) for ASCII 32..126.
  var HELVETICA = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
  ];

  function textWidthMm(text, sizePt) {
    var w = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      w += (c >= 32 && c <= 126) ? HELVETICA[c - 32] : 556;
    }
    return w / 1000 * sizePt * MM_PER_PT;
  }

  // Merge black cells into rectangles: horizontal runs, then stack identical
  // runs from consecutive rows. Returns [[col, row, w, h], ...] in modules.
  function gridRects(grid) {
    var rects = [];
    var open = {};
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      var next = {};
      var c = 0;
      while (c < row.length) {
        if (!row[c]) { c++; continue; }
        var start = c;
        while (c < row.length && row[c]) c++;
        var key = start + ":" + c;
        var rect = open[key];
        if (rect) {
          rect[3]++;
        } else {
          rect = [start, r, c - start, 1];
          rects.push(rect);
        }
        next[key] = rect;
      }
      open = next;
    }
    return rects;
  }

  function fmt(v) {
    return String(Math.round(v * 1000) / 1000);
  }

  function anchorX(item) {
    if (item.align === "center") return item.x - textWidthMm(item.text, item.size) / 2;
    if (item.align === "right") return item.x - textWidthMm(item.text, item.size);
    return item.x;
  }

  // ---------------------------------------------------------------- SVG

  function escapeXml(s) {
    return s.replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }

  function pageToSvg(page) {
    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + fmt(page.width) + 'mm" height="' +
      fmt(page.height) + 'mm" viewBox="0 0 ' + fmt(page.width) + " " + fmt(page.height) + '">');
    out.push('<rect width="100%" height="100%" fill="#fff"/>');
    page.items.forEach(function (item) {
      if (item.type === "cells") {
        var d = gridRects(item.grid).map(function (r) {
          return "M" + fmt(item.x + r[0] * item.module) + " " + fmt(item.y + r[1] * item.module) +
            "h" + fmt(r[2] * item.module) + "v" + fmt(r[3] * item.module) + "h" + fmt(-r[2] * item.module) + "z";
        }).join("");
        out.push('<path fill="#000" shape-rendering="crispEdges" d="' + d + '"/>');
      } else if (item.type === "rect") {
        out.push('<rect x="' + fmt(item.x) + '" y="' + fmt(item.y) + '" width="' + fmt(item.w) +
          '" height="' + fmt(item.h) + '" fill="none" stroke="' + item.color + '" stroke-width="' +
          fmt(item.lineWidth) + '"' + (item.dash ? ' stroke-dasharray="' + item.dash.join(" ") + '"' : "") + "/>");
      } else if (item.type === "line") {
        out.push('<line x1="' + fmt(item.x1) + '" y1="' + fmt(item.y1) + '" x2="' + fmt(item.x2) +
          '" y2="' + fmt(item.y2) + '" stroke="' + item.color + '" stroke-width="' + fmt(item.lineWidth) + '"/>');
      } else if (item.type === "text") {
        // Position with Helvetica metrics so SVG and PDF line up exactly.
        out.push('<text x="' + fmt(anchorX(item)) + '" y="' + fmt(item.y) + '" font-family="Helvetica, Arial, sans-serif" font-size="' +
          fmt(item.size * MM_PER_PT) + '" fill="' + (item.color || "#000") + '">' + escapeXml(item.text) + "</text>");
      }
    });
    out.push("</svg>");
    return out.join("\n");
  }

  // ---------------------------------------------------------------- PDF

  function rgb(hex) {
    var n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) { return fmt(v / 255); }).join(" ");
  }

  function pdfString(s) {
    return "(" + s.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&") + ")";
  }

  function pageContent(page) {
    var H = page.height;
    var ops = [];
    function X(v) { return fmt(v * PT_PER_MM); }
    function Y(v) { return fmt((H - v) * PT_PER_MM); }

    page.items.forEach(function (item) {
      if (item.type === "cells") {
        var m = item.module;
        // A single fill of all sub-rectangles avoids hairline seams between cells.
        ops.push("0 g");
        gridRects(item.grid).forEach(function (r) {
          ops.push(X(item.x + r[0] * m) + " " + Y(item.y + (r[1] + r[3]) * m) + " " +
            X(r[2] * m) + " " + X(r[3] * m) + " re");
        });
        ops.push("f");
      } else if (item.type === "rect" || item.type === "line") {
        ops.push(rgb(item.color) + " RG " + X(item.lineWidth) + " w " +
          (item.dash ? "[" + item.dash.map(X).join(" ") + "] 0 d" : "[] 0 d"));
        if (item.type === "rect") {
          ops.push(X(item.x) + " " + Y(item.y + item.h) + " " + X(item.w) + " " + X(item.h) + " re S");
        } else {
          ops.push(X(item.x1) + " " + Y(item.y1) + " m " + X(item.x2) + " " + Y(item.y2) + " l S");
        }
      } else if (item.type === "text") {
        ops.push(rgb(item.color || "#000000") + " rg BT /F1 " + fmt(item.size) + " Tf " +
          X(anchorX(item)) + " " + Y(item.y) + " Td " + pdfString(item.text) + " Tj ET");
      }
    });
    return ops.join("\n");
  }

  function asciiBytes(s) {
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
    return b;
  }

  function deflate(bytes) {
    if (typeof CompressionStream === "undefined") return Promise.resolve(null);
    var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); })
      .catch(function () { return null; });
  }

  // Returns a Promise<Blob> of the PDF document.
  function buildPdf(pages, title) {
    return Promise.all(pages.map(function (p) {
      var raw = asciiBytes(pageContent(p));
      return deflate(raw).then(function (z) { return z ? { data: z, flate: true } : { data: raw, flate: false }; });
    })).then(function (streams) {
      var chunks = [];
      var offsets = [];
      var length = 0;
      function push(part) {
        var bytes = typeof part === "string" ? asciiBytes(part) : part;
        chunks.push(bytes);
        length += bytes.length;
      }
      function obj(num, body) {
        offsets[num] = length;
        push(num + " 0 obj\n");
        if (typeof body === "string") push(body); else body();
        push("\nendobj\n");
      }

      // Objects: 1 catalog, 2 pages, 3 font, 4 info, then (page, content) pairs.
      var kids = pages.map(function (_, i) { return (5 + i * 2) + " 0 R"; });
      push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
      obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
      obj(2, "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + pages.length + " >>");
      obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
      obj(4, "<< /Title " + pdfString(title || "Markers") + " /Producer (ArUco Marker Generator) >>");
      pages.forEach(function (p, i) {
        var pageNum = 5 + i * 2;
        obj(pageNum, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + fmt(p.width * PT_PER_MM) + " " +
          fmt(p.height * PT_PER_MM) + "] /Resources << /Font << /F1 3 0 R >> >> /Contents " + (pageNum + 1) + " 0 R >>");
        obj(pageNum + 1, function () {
          var s = streams[i];
          push("<< /Length " + s.data.length + (s.flate ? " /Filter /FlateDecode" : "") + " >>\nstream\n");
          push(s.data);
          push("\nendstream");
        });
      });

      var count = 5 + pages.length * 2;
      var xref = length;
      var table = "xref\n0 " + count + "\n0000000000 65535 f \n";
      for (var n = 1; n < count; n++) table += String(offsets[n]).padStart(10, "0") + " 00000 n \n";
      push(table + "trailer\n<< /Size " + count + " /Root 1 0 R /Info 4 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
      return new Blob(chunks, { type: "application/pdf" });
    });
  }

  window.MarkerRender = {
    MM_PER_PT: MM_PER_PT,
    textWidthMm: textWidthMm,
    pageToSvg: pageToSvg,
    buildPdf: buildPdf
  };
})();
