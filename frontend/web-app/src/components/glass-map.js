import glassMapTokens from '../styles/glass-map-tokens.css?raw';

// Rectangular displacement map from React Bits GlassSurface. See react-bits-LICENSE.md.
function roundedShape(width, height, corners, inset = 0) {
  if (corners.every(radius => radius === corners[0])) {
    return `<rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" rx="${corners[0]}"`;
  }
  const x = width - inset, y = height - inset;
  const limit = (Math.min(width, height) - inset * 2) / 2;
  const [a, b, c, d] = corners.map(radius => Math.min(radius, limit));
  const arc = (radius, position) => radius ? ` A ${radius} ${radius} 0 0 1 ${position}` : '';
  return `<path d="M ${inset + a} ${inset} H ${x - b}${arc(b, `${x} ${inset + b}`)}
    V ${y - c}${arc(c, `${x - c} ${y}`)} H ${inset + d}${arc(d, `${inset} ${y - d}`)}
    V ${inset + a}${arc(a, `${inset + a} ${inset}`)} Z"`;
}

export function glassDisplacementMap(width, height, radius, {
  borderWidth = 0.07,
  brightness = 50,
  opacity = 0.93,
  blur = 11,
  mixBlendMode = 'difference',
  reverseHorizontal = false,
} = {}) {
  const edge = Math.min(width, height) * borderWidth * 0.5;
  const corners = Array.isArray(radius) ? radius : Array(4).fill(radius);
  const outline = roundedShape(width, height, corners);
  const inner = roundedShape(width, height, corners, edge);
  // Keep the original displacement midpoint at 127 when the channel is halfway.
  const centerChannel = Math.ceil(brightness * 255 / 100 - 0.5);
  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"
    style="--glass-map-center-channel:${centerChannel};--glass-map-center-opacity:${opacity};--glass-map-blend:${mixBlendMode}">
    <style>${glassMapTokens}</style>
    <defs>
      <linearGradient id="red" x1="${reverseHorizontal ? '0%' : '100%'}" y1="0%" x2="${reverseHorizontal ? '100%' : '0%'}" y2="0%">
        <stop offset="0%" stop-color="var(--glass-map-transparent)"/><stop offset="100%" stop-color="var(--glass-map-horizontal-axis)"/>
      </linearGradient>
      <linearGradient id="blue" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="var(--glass-map-transparent)"/><stop offset="100%" stop-color="var(--glass-map-vertical-axis)"/>
      </linearGradient>
      <filter id="soft" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" color-interpolation-filters="sRGB">
        <feGaussianBlur stdDeviation="${blur}"/>
      </filter>
    </defs>
    <rect width="${width}" height="${height}" fill="var(--glass-map-zero)"/>
    ${outline} fill="url(#red)"/>
    ${outline} fill="url(#blue)" class="glass-map-vertical-layer"/>
    ${inner} class="glass-map-center" filter="url(#soft)"/>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
