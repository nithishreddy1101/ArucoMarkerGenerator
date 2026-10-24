# ArUco Marker Generator

A static website that generates printable **ArUco** and **AprilTag** marker sheets at exact physical sizes.
Everything runs in the browser — no server, no build step, no external libraries.

**Live site: https://nithishreddy1101.github.io/ArucoMarkerGenerator/**

## Features

- **All OpenCV predefined dictionaries**
  - `DICT_4X4_50/100/250/1000`, `DICT_5X5_*`, `DICT_6X6_*`, `DICT_7X7_*`
  - `DICT_ARUCO_ORIGINAL`
  - `DICT_APRILTAG_16h5`, `DICT_APRILTAG_25h9`, `DICT_APRILTAG_36h10`, `DICT_APRILTAG_36h11`
  - Configurable border width (`markerBorderBits`, 1–4)
- **Marker selection**: an ID range, a list such as `0-9, 15, 20-24`, or the whole dictionary, plus copies of each marker
- **Paper sizes**: ISO A0–A6, B3–B5, Letter, Legal, Tabloid, Executive, Half Letter, ANSI C, 4×6 / 5×7 / 3×5 cards, or a custom size; portrait or landscape
- **Units**: mm, cm or inches
- **Size modes**
  - *Exact size*: you set the marker size and the page fits as many as possible
  - *Per page*: you set columns × rows and get the largest marker that fits
  - *One / page*: the largest single marker per page
- Adjustable page margin, gap between markers and white quiet zone
- Optional labels (ID, dictionary, size), cut guides (corner marks, dashed or solid outline), and a scale-check ruler on each page
- Live multi-page preview; **vector PDF** export (exact mm, compressed) and per-page **SVG** export
- Settings are remembered in the browser

## Usage

Open `index.html` in a browser; it also works offline from `file://`.

To print, use **100% / Actual size** (turn off "Fit to page"), then check the scale bar on the sheet with a ruler.

The size you enter is the marker's outer black edge, which is the `markerLength` you pass to OpenCV pose estimation.

## Hosting

The site is plain static files, so any static host works:

- **GitHub Pages**: Settings → Pages → Deploy from branch → `main` / root
- Netlify, Cloudflare Pages, Vercel: publish the repository root with no build command

## Project structure

```
index.html                    UI
css/style.css                 Styles (light/dark)
js/app.js                     Settings, ID parsing, page layout, preview, downloads
js/pdf.js                     SVG renderer and a minimal vector PDF writer
js/dictionaries.js            Marker bit patterns (generated)
tools/extract_dictionaries.py Regenerates js/dictionaries.js from OpenCV
```

## Marker data

`js/dictionaries.js` is exported directly from OpenCV's predefined dictionaries, so the markers are bit-for-bit identical to `cv2.aruco`'s.
To regenerate it:

```
pip install opencv-contrib-python
python3 tools/extract_dictionaries.py
```

Generated sheets were verified by rasterizing the PDFs and detecting every marker with `cv2.aruco.detectMarkers`, at the expected ID and physical size.

## License

Free to use and modify for personal and educational purposes.
