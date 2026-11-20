import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import './preview-login-scene.css';

const duration = 480;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));
const day = ['#257799', '#605fa0', '#237e80'];
const night = ['#77ddf4', '#a5a6fa', '#61e1d1'];
const particleOptions = {
  particleCount: 112, particleSpread: 9, cameraDistance: 33, speed: .2,
  particleBaseSize: 110, sizeRandomness: .8, glow: .42, twinkle: .2, depthOfField: .26,
  hoverEffect: 'parallax', particleHoverFactor: 2.6, clickBurst: false,
  intro: false, alphaParticles: true, opacity: .43, pixelRatio: 1.35,
};

const nodeCount = 432;
const points = Array.from({ length: nodeCount }, (_, index) => {
  const y = 1 - 2 * (index + .5) / nodeCount;
  const ring = Math.sqrt(1 - y * y);
  return [Math.cos(index * goldenAngle) * ring, y, Math.sin(index * goldenAngle) * ring];
});
const driftField = points.map(([, y], index) => {
  const phase = index * goldenAngle;
  const cos = Math.cos(phase), sin = Math.sin(phase);
  return {
    phase,
    east: [-sin, 0, cos],
    north: [-y * cos, Math.sqrt(1 - y * y), -y * sin],
    reach: .062 + (index % 11) * .0035,
    lifespan: index % 5 < 2 ? 5.5 + (index % 13) * .26 : 0,
    ageOffset: (index * 137 % nodeCount) / nodeCount,
  };
});
// Local candidates cover the drift range. A link exists only while both points are close.
const neighbors = [];
for (let index = 0; index < points.length; index++) {
  const [x, y, z] = points[index];
  for (let next = index + 1; next < points.length; next++) {
    const [nx, ny, nz] = points[next];
    if (x * nx + y * ny + z * nz > .913) neighbors.push([index, next]);
  }
}
const neighborhoods = [26, 92, 164, 231, 300, 369, 409].map(index => points[index]);
const localTides = points.map(([x, y, z]) => neighborhoods.flatMap(([nx, ny, nz], index) => {
  const influence = ((x * nx + y * ny + z * nz) - .68) / .32;
  return influence > 0 ? [{ index, offset: [nx - x, ny - y, nz - z], weight: influence ** 2 }] : [];
}));

function smoothRange(start, end, value) {
  const t = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function rotation(yaw, pitch) {
  const [sinYaw, cosYaw] = [Math.sin(yaw), Math.cos(yaw)];
  const [sinPitch, cosPitch] = [Math.sin(pitch), Math.cos(pitch)];
  return ([x, y, z]) => {
    const depth = z * cosYaw - x * sinYaw;
    return [x * cosYaw + z * sinYaw, y * cosPitch - depth * sinPitch, y * sinPitch + depth * cosPitch];
  };
}

function drawShell(context, width, height, time, camera, progress, dark) {
  const advance = progress ** 2 * (3 - 2 * progress);
  const focal = Math.min(width, height) * .71;
  const rotate = rotation(.28 + time * .077 + camera.x * .46, .13 * Math.cos(time * .34) - camera.y * .33);
  const pulses = neighborhoods.map((_, index) => Math.sin(time * .88 + index * goldenAngle) * .40);
  const project = ([x, y, z], travel) => {
    // Move the camera along its local forward axis, inside the unit sphere.
    const ahead = z + .28 - travel * .99;
    if (ahead < .075) return null;
    const slope = Math.min(3, (x * x + y * y) / (ahead * ahead));
    const stretch = focal * (1 + travel * .13) * (1 + slope * (.05 + travel * .07)) / ahead;
    return { x: width / 2 + x * stretch, y: height / 2 + y * stretch, z, stretch };
  };
  const nodes = points.map(([x, y, z], index) => {
    const { phase, east, north, reach, lifespan, ageOffset } = driftField[index];
    const elapsed = lifespan ? time / lifespan + ageOffset : 0;
    const cycle = Math.floor(elapsed);
    const age = elapsed - cycle;
    const presence = lifespan ? smoothRange(.08, .23, age) * (1 - smoothRange(.67, .89, age)) : 1;
    // Changing the path after a full fade makes each new point emerge at a nearby location.
    const tangentX = reach * Math.sin(time * .56 + phase + cycle * goldenAngle);
    const tangentY = reach * Math.cos(time * .43 - phase + cycle * goldenAngle);
    x += east[0] * tangentX + north[0] * tangentY;
    y += north[1] * tangentY;
    z += east[2] * tangentX + north[2] * tangentY;
    for (const { index: tide, offset, weight } of localTides[index]) {
      const motion = pulses[tide] * weight;
      x += offset[0] * motion;
      y += offset[1] * motion;
      z += offset[2] * motion;
    }
    const radius = Math.hypot(x, y, z);
    return { position: rotate([x / radius, y / radius, z / radius]), presence };
  });
  const screen = nodes.map(({ position, presence }) => presence > .012 ? project(position, advance) : null);
  const fade = 1 - .92 * Math.max(0, (progress - .67) / .33);
  const detail = dark ? '#75cde4' : '#376f8a';
  const highlight = dark ? '#bdeaff' : '#426e9b';
  context.lineCap = 'round';
  context.strokeStyle = detail;
  for (const [start, end] of neighbors) {
    const a = screen[start], b = screen[end];
    if (!a || !b || Math.max(a.x, b.x) < 0 || Math.min(a.x, b.x) > width ||
      Math.max(a.y, b.y) < 0 || Math.min(a.y, b.y) > height) continue;
    const [ax, ay, az] = nodes[start].position;
    const [bx, by, bz] = nodes[end].position;
    const proximity = smoothRange(.947, .986, ax * bx + ay * by + az * bz);
    const strength = proximity * Math.min(nodes[start].presence, nodes[end].presence);
    if (strength < .014) continue;
    const curve = 1 - (a.z + b.z) / 2;
    context.lineWidth = (.85 + curve * .83 + progress * .25) * (.7 + .3 * proximity);
    context.globalAlpha = (dark ? .41 : .45) * (1 + curve * .4) * fade * strength;
    const length = Math.hypot(ax + bx, ay + by, az + bz);
    const midpoint = project([(ax + bx) / length, (ay + by) / length, (az + bz) / length], advance);
    context.beginPath();
    context.moveTo(a.x, a.y);
    if (midpoint) context.quadraticCurveTo(2 * midpoint.x - (a.x + b.x) / 2, 2 * midpoint.y - (a.y + b.y) / 2, b.x, b.y);
    else context.lineTo(b.x, b.y);
    context.stroke();
  }

  screen.forEach((point, index) => {
    if (!point || point.x < -5 || point.x > width + 5 || point.y < -5 || point.y > height + 5) return;
    const { position, presence } = nodes[index];
    if (index % 4 === 0 && progress > .09 && progress < .94) {
      const tail = project(position, Math.max(0, advance - .18));
      if (tail && Math.hypot(point.x - tail.x, point.y - tail.y) > 4) {
        const shimmer = context.createLinearGradient(tail.x, tail.y, point.x, point.y);
        shimmer.addColorStop(0, 'transparent');
        shimmer.addColorStop(1, highlight);
        context.strokeStyle = shimmer;
        context.lineWidth = 1.35;
        context.globalAlpha = Math.sin(Math.PI * progress) * .82 * presence;
        context.beginPath();
        context.moveTo(tail.x, tail.y);
        context.lineTo(point.x, point.y);
        context.stroke();
      }
    }
    context.fillStyle = index % 5 === 0 ? highlight : detail;
    context.globalAlpha = (index % 5 === 0 ? .86 : .63) * fade * presence;
    context.beginPath();
    const radius = Math.min(3.2, 1.2 + point.stretch / focal * .84);
    context.arc(point.x, point.y, radius * (.5 + .5 * presence), 0, Math.PI * 2);
    context.fill();
  });
  context.globalAlpha = 1;
}

export function mountLoginScene(host, motionPreference) {
  const canvas = host.querySelector('.login-scene');
  const card = host.querySelector('.login-card');
  const context = canvas.getContext('2d');
  const particleLayer = document.createElement('div');
  particleLayer.className = 'login-particle-layer';
  particleLayer.setAttribute('aria-hidden', 'true');
  host.prepend(particleLayer);

  let frame = 0;
  let timeout = 0;
  let startedAt = 0;
  let onFinish;
  let width = 0;
  let height = 0;
  let lastTick = 0;
  let lastPaint = 0;
  let clock = 0;
  let loadParticles;
  let Particles;
  let particleRoot;
  let particleAppearance;
  const camera = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  const reduced = () => motionPreference.matches || document.documentElement.dataset.reducedMotion === 'true';
  const dark = () => document.documentElement.dataset.theme === 'dark';

  function paint(progress = 0) {
    if (!context || !width || !height || host.hidden) return;
    const isDark = dark();
    context.clearRect(0, 0, width, height);
    drawShell(context, width, height, clock, camera, progress, isDark);
  }

  function stopFrame() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTick = 0;
  }

  function cancel() {
    if (!onFinish) return;
    onFinish = undefined;
    clearTimeout(timeout);
    card.inert = false;
    host.removeAttribute('aria-busy');
    delete host.dataset.loginMotion;
    paint();
  }

  function finish(animated = true) {
    const navigate = onFinish;
    cancel();
    navigate?.(animated);
  }

  function scheduleFrame() {
    if (!frame && !host.hidden && !document.hidden && !reduced()) frame = requestAnimationFrame(animate);
  }

  function animate(now) {
    frame = 0;
    const elapsed = lastTick ? Math.min(50, now - lastTick) : 16;
    lastTick = now;
    if (!onFinish) clock += elapsed / 1000;
    const follow = 1 - Math.exp(-elapsed / 145);
    camera.x += (target.x - camera.x) * follow;
    camera.y += (target.y - camera.y) * follow;
    const progress = onFinish ? Math.min(1, (now - startedAt) / duration) : 0;
    if (onFinish || now - lastPaint >= 30) {
      lastPaint = now;
      paint(progress);
    }
    if (progress >= 1) finish();
    else scheduleFrame();
  }

  function clearParticles() {
    if (particleAppearance === undefined) return;
    particleRoot.render(null);
    particleAppearance = undefined;
  }

  function syncParticles(paused) {
    if (!Particles) {
      loadParticles ??= import('./react-bits/Particles.jsx').then(module => {
        Particles = module.default;
        refresh();
      }).catch(() => {}); // The projected graph also runs when WebGL is unavailable.
      return;
    }
    const isDark = dark();
    const appearance = `${isDark}:${paused}`;
    if (particleAppearance === appearance) return;
    particleAppearance = appearance;
    particleRoot ??= createRoot(particleLayer);
    particleRoot.render(createElement(Particles, { ...particleOptions,
      particleColors: isDark ? night : day, lightMode: !isDark, paused,
      moveParticlesOnHover: !paused,
    }));
  }

  function refresh() {
    if (host.hidden || document.hidden) {
      stopFrame();
      if (host.hidden) clearParticles();
      return;
    }
    const paused = reduced();
    if (paused) {
      stopFrame();
      clock = camera.x = camera.y = target.x = target.y = 0;
      if (onFinish) finish(false);
      if (host.hidden) return;
    }
    syncParticles(paused);
    if (!context) return;
    ({ width, height } = host.getBoundingClientRect());
    if (!width || !height) return;
    const scale = Math.min(window.devicePixelRatio || 1, 1.6, 2300 / Math.max(width, height));
    const pixelWidth = Math.round(width * scale);
    const pixelHeight = Math.round(height * scale);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      context.setTransform(scale, 0, 0, scale, 0, 0);
    }
    paint(onFinish ? Math.min(1, Math.max(0, (performance.now() - startedAt) / duration)) : 0);
    scheduleFrame();
  }

  const observer = new ResizeObserver(refresh);
  observer.observe(host);
  const visibility = new MutationObserver(refresh);
  visibility.observe(host, { attributes: true, attributeFilter: ['hidden'] });
  host.addEventListener('pointermove', event => {
    if (reduced() || !width || !height || event.pointerType === 'touch') return;
    const { left, top } = host.getBoundingClientRect();
    target.x = 2 * (event.clientX - left) / width - 1;
    target.y = 2 * (event.clientY - top) / height - 1;
  }, { passive: true });
  host.addEventListener('pointerleave', () => { target.x = target.y = 0; });
  document.addEventListener('aml:appearance', refresh);
  document.addEventListener('visibilitychange', refresh);
  motionPreference.addEventListener('change', refresh);
  window.addEventListener('pagehide', () => {
    cancel();
    stopFrame();
    clearParticles();
  });
  window.addEventListener('pageshow', refresh);

  return {
    get transitioning() { return Boolean(onFinish); },
    cancel,
    enter(navigate) {
      if (onFinish) return;
      if (!context || reduced() || host.hidden) {
        navigate(false);
        return;
      }
      onFinish = navigate;
      host.dataset.loginMotion = 'entering';
      host.setAttribute('aria-busy', 'true');
      card.inert = true;
      startedAt = performance.now();
      scheduleFrame();
      timeout = setTimeout(finish, duration + 60);
    },
  };
}
