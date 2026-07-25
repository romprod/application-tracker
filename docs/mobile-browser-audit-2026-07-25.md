# Authenticated mobile browser audit

Date: 2026-07-25

## Outcome

The authenticated workspace passes the mobile geometry, interaction, and visual
regression suite after shared touch-target fixes. The audit found no remaining
horizontal overflow or clipped primary controls.

## Coverage

The geometry test runs 280 cases: seven authenticated pages across 40 browser
profiles.

| Dimension                | Values                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Pages                    | Dashboard, Applications, Opportunities, Documents, Lists, MCP, Users               |
| Portrait widths          | 320, 360, 390, 412, and 430 CSS px                                                 |
| Compact portrait heights | 458px with toolbar expanded; 568px collapsed                                       |
| Tall portrait heights    | 822px with toolbar expanded; 932px collapsed                                       |
| Compact landscape widths | 568px                                                                              |
| Tall landscape widths    | 932px                                                                              |
| Landscape heights        | Each requested device width, minus 104px when the toolbar is expanded              |
| Geometry checks          | Root overflow, primary-control clipping, navigation bounds, and 44px touch targets |

The interaction test runs each requested width through:

- the application modal with a keyboard-sized viewport;
- the Stage filter sheet;
- the native mobile sort control;
- fixed bottom navigation; and
- 44px navigation targets.

It repeats modal, filter, and navigation checks at the 568px compact-landscape
and 932px tall-landscape widths.

The visual suite stores 28 baselines: all seven pages at the four boundary
profiles.

## Findings fixed

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
navigation at the 568×216 boundary.

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
- The Android keyboard reduced the visual viewport to about 472px. The focused
  search field remained visible.
- The application modal scrolled its Cancel and Save actions above the keyboard.
- The Stage filter kept its Done action visible above the keyboard and
  navigation.
- All seven authenticated pages loaded at 411px without horizontal overflow.
- Chrome logcat contained no fatal exception, uncaught error, application-not-
  responding event, or crash-buffer entry during the pass.

## Permanent regressions

The tests live in `e2e/smoke.spec.ts`. Baseline PNGs live in
`e2e/smoke.spec.ts-snapshots/`.

Run the complete browser suite:

```sh
npm run test:e2e
```

Review and intentionally replace visual baselines:

```sh
npm run test:e2e -- --update-snapshots
```
