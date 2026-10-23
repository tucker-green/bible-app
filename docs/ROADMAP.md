# Rootword roadmap

## v1 (in progress)
Reader with Greek/Hebrew word cards (KJV default; BSB, WEB, ASV, YLT; NIV via the reader's own
API.Bible key), interlinear mode, search, cross references, people & places cards, lineage
explorer, word-study pages, compare view, red letter, highlights/notes/bookmarks, offline PWA,
and the mobile/accessibility experience in docs/EXPERIENCE.md. Place cards in v1 show the
description, region and references, without a map.

## v1.1 — "Then and now" place maps (owner request, after v1 is live)
Hovering or tapping a place name shows a map with:
- **then**: the ancient site, from OpenBible.info's Bible Geocoding Data (CC BY), including
  competing identifications with their confidence when scholars disagree;
- **now**: the modern place and its current name (e.g. Capernaum → Tell Hum; Nineveh → near
  Mosul, Iraq), pinned separately when it differs from the ancient site;
- modern map tiles (OSM / CARTO, light and dark), touch-friendly, with an offline fallback.

Data: https://github.com/openbibleinfo/Bible-Geocoding-Data — data/ancient.jsonl (1,342 ancient
places; identifications → resolutions with lon/lat and a `modern_basis_id`) and data/modern.jsonl
(1,596 modern places with modern names). Join to STEPBible TIPNR places, which are already mapped
to word occurrences in public/data/names/.

## Known data caveats to revisit (from the study-data verification, Oct 2026)
- Lineage: TIPNR leaves gaps such as nine "Unnamed" links between Matthan and Jacob on the
  Adam → Jesus path (Matt 1:15 names Matthan as Jacob's father); family.json covers people only,
  so peoples/groups in genealogies (e.g. the sons of Javan, Mizraim) are not in the tree; place
  entities carry founders in `parents`.
- A few names stay ambiguous where nothing in the data separates them (Num 22:5 Amaw, 1 Ki 7:6
  Hall of Pillars, "holy garments" in Exod 35/39); hover spellings follow the majority of
  ESV/NIV/KJV and can differ from the BSB (Neco → "Necho").
