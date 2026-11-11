<?php
/**
 * Plugin Name:       Integra Figures
 * Description:       Interactive technical figures for integra.dental. Each figure is one self-contained file served from this site; place one with [integra_figure id="arum-5x200-finishing"].
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Integra Dental
 * License:           GPL-2.0-or-later
 */

defined( 'ABSPATH' ) || exit;

const INTEGRA_FIGURES_VERSION = '1.0.0';

/**
 * The figures this plugin ships. `ratio` is the card's width over its height at full width, so the frame holds
 * its place before the figure has loaded and reported its real height.
 */
function integra_figures() {
	return array(
		'arum-5x200-finishing' => array(
			'file'  => 'figures/arum-5x200-finishing.html',
			'title' => 'Interactive figure: the ARUM 5X-200 changes its tool, then finishes a full-arch bridge in five axes',
			'ratio' => '760 / 900',
		),
	);
}

/**
 * [integra_figure id="arum-5x200-finishing"]
 *
 * Optional: theme="light|dark|auto", caption="short|full|none", frame="soft|card", bg="none|page",
 * fig="none|show", max_width="760" (px).
 */
function integra_figure_shortcode( $atts ) {
	static $count = 0;

	$atts = shortcode_atts(
		array(
			'id'        => '',
			'theme'     => 'light',
			'caption'   => 'short',
			'frame'     => 'soft',
			'bg'        => 'none',
			'fig'       => 'none',
			'max_width' => '760',
		),
		$atts,
		'integra_figure'
	);

	$figures = integra_figures();
	$id      = sanitize_key( $atts['id'] );
	if ( ! isset( $figures[ $id ] ) ) {
		return '';
	}
	$figure = $figures[ $id ];
	$path   = plugin_dir_path( __FILE__ ) . $figure['file'];
	if ( ! is_readable( $path ) ) {
		return '';
	}

	// Each option: the values it takes, the first being this shortcode's default. Anything else falls back to that
	// default, and only the values the figure's page acts on reach its address.
	$options = array(
		'theme'   => array( 'light', 'dark', 'auto' ),
		'caption' => array( 'short', 'full', 'none' ),
		'frame'   => array( 'soft', 'card' ),
		'bg'      => array( 'none', 'page' ),
		'fig'     => array( 'none', 'show' ),
	);
	$silent  = array( 'auto', 'full', 'card', 'page', 'show' );
	$query   = array();
	foreach ( $options as $key => $values ) {
		$value = sanitize_key( $atts[ $key ] );
		if ( ! in_array( $value, $values, true ) ) {
			$value = $values[0];
		}
		if ( ! in_array( $value, $silent, true ) ) {
			$query[ $key ] = $value;
		}
	}
	// A new upload of the figure gets a new address, so no visitor keeps a stale copy.
	$query['v'] = INTEGRA_FIGURES_VERSION . '-' . filemtime( $path );

	$src = add_query_arg( $query, plugins_url( $figure['file'], __FILE__ ) );
	$max = max( 320, min( 1200, (int) $atts['max_width'] ) );
	$count++;

	$html = sprintf(
		'<figure class="integra-figure" style="max-width:%1$dpx;width:100%%;margin:0 auto"><iframe class="integra-figure__frame" title="%2$s" src="%3$s" loading="lazy" scrolling="no" style="display:block;width:100%%;aspect-ratio:%4$s;border:0;background:transparent"></iframe></figure>',
		$max,
		esc_attr( $figure['title'] ),
		esc_url( $src ),
		esc_attr( $figure['ratio'] )
	);

	// Once per page: each figure reports its own height, and its frame takes it.
	if ( 1 === $count ) {
		$html .= '<script>addEventListener("message",function(e){var d=e.data;if(e.origin!==location.origin||!d||d.type!=="iso-figure:height"||!(d.height>100&&d.height<5000))return;var f=document.querySelectorAll("iframe.integra-figure__frame");for(var i=0;i<f.length;i++)if(f[i].contentWindow===e.source){f[i].style.aspectRatio="auto";f[i].style.height=Math.ceil(d.height)+"px"}});</script>';
	}

	return $html;
}
add_shortcode( 'integra_figure', 'integra_figure_shortcode' );
