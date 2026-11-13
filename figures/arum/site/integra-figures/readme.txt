=== Integra Figures ===
Contributors: integradental
Requires at least: 6.0
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPL-2.0-or-later

Interactive technical figures for integra.dental pages.

== Description ==

Each figure is one self-contained HTML file in this plugin's `figures/` folder: drawing, script and styles in one
file, with no outside requests. The plugin serves it from this site and places it on a page in a frame that loads
only when a visitor scrolls near it and that takes the figure's own height.

Place a figure anywhere shortcodes run, including inside a Custom HTML block:

`[integra_figure id="arum-5x200-finishing"]`

Options (all optional):

* `theme` - `light` (default), `dark`, or `auto` to follow the visitor's system setting.
* `caption` - `short` (default: three sentences and the credit line), `full` (the whole technical caption) or `none`
  (the credit line only).
* `frame` - `soft` (default: a white rounded card with no outline) or `card` (the figure's own hairline card).
* `bg` - `none` (default: the page shows through round the card) or `page` (the figure's own page colour).
* `fig` - `none` (default) or `show` to keep the figure's "Fig n" tag.
* `max_width` - the widest the figure gets, in px (default 760).

Figures:

* `arum-5x200-finishing` - the ARUM 5X-200 changes its tool, then finishes the occlusal side of an illustrative
  full-arch titanium bridge framework in three five-axis passes; a Jog mode hands the visitor all five axes. Product
  data from ARUM Dentistry, used with permission.

== Changelog ==

= 1.0.0 =
* First version, with the ARUM 5X-200 finishing figure.
