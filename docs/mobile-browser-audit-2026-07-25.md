# Authenticated mobile browser audit

Date: 2026-07-25

## Outcome

The original audit should not have been accepted. It missed two visible defects:
the Settings tab did not match the other four tabs, and the whole navigation bar
moved when Android Chrome changed its toolbar state during a page scroll.

The re-review replaced the mobile navigation with Ionic's maintained
`IonTabBar` and `IonTabButton` components. It also changed the mobile workspace
to a fixed app shell with an internal content scroller. The navigation now sits
outside the scroller, all five tabs share one implementation, and Android Chrome
no longer transfers the bar between visual viewports while application content
scrolls.

## Coverage

The geometry test runs 280 cases: seven authenticated pages across 40 browser
profiles.

| Dimension                | Values                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| Pages                    | Dashboard, Applications, Opportunities, Documents, Lists, MCP, Users                                  |
| Portrait widths          | 320, 360, 390, 412, and 430 CSS px                                                                    |
| Compact portrait heights | 458px with toolbar expanded; 568px collapsed                                                          |
| Tall portrait heights    | 822px with toolbar expanded; 932px collapsed                                                          |
| Compact landscape widths | 568px                                                                                                 |
| Tall landscape widths    | 932px                                                                                                 |
| Landscape heights        | Each requested device width, minus 104px when the toolbar is expanded                                 |
| Geometry checks          | Root overflow, clipping, navigation bounds, equal tab geometry and typography, and 44px touch targets |

The interaction test runs each requested width through:

- the application modal with a keyboard-sized viewport;
- the Stage filter sheet;
- the native mobile sort control;
- fixed Ionic bottom navigation; and
- 44px navigation targets.

It repeats modal, filter, and navigation checks at the 568px compact-landscape
and 932px tall-landscape widths.

The visual suite stores 28 baselines: all seven pages at the four boundary
profiles.

## Why the original audit missed the defects

The first visual baselines recorded the broken Settings tab as the expected
image. Screenshot comparison then protected that image from later changes; it
did not establish that the image was correct. The old test also allowed a
0.25% whole-screen pixel difference and had no assertion that the five labels
used the same font, size, weight, line height, offset, width, or height.

The old navigation stability check only proved that the bar remained inside the
viewport after a synthetic resize. It did not record the bar while Android
Chrome expanded or collapsed its browser controls during a real scroll.

## Root cause

The old bar derived its bottom position from
`max(0px, calc(100vh - 100dvh))`. Android Chrome reported a 784px content
viewport with its toolbar expanded and 840px with it collapsed. That made the
bar's offset change by as much as 56 CSS px, approximately 147 physical pixels
on the emulator.

Removing that calculation fixed the large jump, but a fixed, composited bar
still moved by up to six physical pixels while Chrome handed the bar between
the two browser-control viewports. This showed that another positioning tweak
would treat the symptom rather than the viewport handoff.

The Settings mismatch had a separate, simpler cause: Settings used the desktop
label path while the other four items used shortened mobile labels. The shared
screenshots did not enforce a common tab structure.

## Fix

The corrected implementation uses the established Ionic tab pattern:

- `IonTabBar` owns the mobile navigation container;
- five `IonTabButton` components provide equal flex sizing and tab semantics;
- every label uses the same mobile-label and typography rules;
- the bar uses `bottom: 0`, safe-area padding, and one composited layer;
- portrait navigation stays at the bottom and landscape navigation becomes a
  left rail; and
- the document root remains fixed while `.workspace-main` scrolls internally.

Keeping page scroll inside the app shell is the decisive stability change.
Android Chrome keeps its toolbar expanded during application scrolling, so the
browser never reassigns the navigation bar between changing visual viewports.

## Other findings fixed

The first matrix run found undersized targets in shared UI rules. The fixes set a
44px minimum for:

- the skip link and sign-out action;
- standard and text-style tracker buttons;
- reference-list chips;
- MCP text fields, selects, permission controls, and submit action;
- modal and drawer close controls; and
- filter search, option rows, Clear, and Done controls.

At 300px-tall landscape viewports and below, the filter sheet now reserves fixed
rows for its header and footer, lets its option list shrink and scroll, and hides
the optional search field. This keeps the 44px Done action above the bottom
navigation at the 568x216 boundary.

The audit also found a test-harness race while switching between the 300px
landscape breakpoint and adjacent profiles. The regression now waits for two
animation frames after each resize before measuring geometry.

## Android Chrome verification

The live pass used the `quantasync-api36-play` Android emulator, Chrome, ADB UI
trees, device screenshots, Chrome DevTools Protocol metrics, and logcat.

- Chrome reported the exact portrait widths 320, 360, 390, 412, and 430 CSS px.
  Every width had zero root overflow.
- The matching landscape samples produced 212, 252, 282, 304, and 322px content
  heights. Every sample had zero root overflow.
- At 411px portrait width, the expanded toolbar left a 784px content viewport;
  the collapsed toolbar left 840px.
- The final 22-frame source-built scroll recording kept the Chrome toolbar
  expanded. The navigation indicator appeared at physical row 2190 in 17
  frames, 2191 in three frames, and 2192 in two frames: a two-pixel encoded
  range instead of the old 147-pixel jump.
- The Android UI tree reported the WebView as non-scrollable while the
  application content pane continued to scroll.
- The Android keyboard reduced the visual viewport to about 472px. The focused
  company field remained visible.
- The application modal scrolled its Cancel and Save actions above the keyboard.
- The Stage filter kept its Done action visible above the keyboard and
  navigation.
- Landscape navigation remained a stable left rail with five accessible
  targets.
- All seven authenticated pages loaded at 411px without horizontal overflow.
- Chrome logcat contained no fatal exception, uncaught error, application-not-
  responding event, or crash-buffer entry during the pass.

## Permanent regressions

The tests live in `e2e/smoke.spec.ts`. Baseline PNGs live in
`e2e/smoke.spec.ts-snapshots/`.

Visual comparison allows at most 320 changed pixels per image. This is narrowly
above the measured 295-pixel Linux antialiasing variance around placeholder
text and remains independent of screenshot size. Exact structural assertions
protect tab consistency.

The permanent checks now fail if:

- the five tabs differ in width, height, number offset, label offset, or
  typography;
- a tab omits its shared mobile label or exposes its desktop label;
- any tab or primary control is smaller than 44px;
- navigation uses a viewport-unit-derived bottom offset;
- the root document becomes scrollable;
- the fixed app shell or internal content scroller is removed;
- window scroll changes while authenticated content scrolls;
- a mobile tab click reloads the document or discards in-memory client state;
- navigation loses fixed positioning or compositor promotion; or
- any authenticated page differs from its baseline by more than 320 pixels.

Run the complete browser suite:

```sh
npm run test:e2e
```

Review and intentionally replace visual baselines:

```sh
npm run test:e2e -- --update-snapshots
```
