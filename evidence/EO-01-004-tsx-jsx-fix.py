# EVA-STORY: EO-01-004
# Date: 2026-02-24
# Fix: .tsx and .jsx added to classify() and isTextLike regex in src/lib/scan-repo.js
# Root cause: React TSX component files were classified as "other" and content
#   was never loaded, so EVA-STORY tags in .tsx/.jsx headers were silently dropped.
# Discovered: during 46-accelerator audit where MTI=0 despite correct tags.
# Verified: re-audit of 46-accelerator after fix shows .tsx tags read correctly.
