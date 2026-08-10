# Vendored Dependencies

## three.js (r160)

**Package:** three  
**Version:** 0.160.0 (r160)  
**Source URL:** https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js  
**File:** three.min.js  
**Size:** 669,884 bytes  
**SHA-256:** 170c6789f43217c96b3170f4b42fafe135de7f7cd48497a4218f9757ee1d49fa  

**Note:** three.js r160 is the last release to ship the UMD build (`build/three.min.js`). Later versions dropped the UMD format in favour of ES modules only. The explainer kit pins r160 specifically because it depends on a plain `<script>` tag setting `window.THREE` globally, with no bundler and no import map. This is a deliberate architectural choice for the kit's publishing model (autonomous builder copies the module into multi-chapter projects).
