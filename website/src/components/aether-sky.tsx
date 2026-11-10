import { useEffect, useRef } from 'react';

/**
 * The sky behind the whole page: a WebGL fragment shader of aether currents, stars and rising
 * motes, in the app's warm scheme (umber, gold, honey, ember). Scrolling travels from a golden
 * dawn at the top, through an ember dusk, to deep umber night at the bottom. Abstract light only; nothing here imitates game
 * artwork. Falls back to a CSS gradient without WebGL, and holds a still frame under reduced
 * motion.
 */

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_scroll;
uniform vec2 u_mouse;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.02 + 3.1; a *= 0.5; }
  return v;
}

vec3 stars(vec2 uv, float scale, float t) {
  vec2 g = uv * scale;
  vec2 id = floor(g), f = fract(g) - 0.5;
  float h = hash(id);
  if (h < 0.9) return vec3(0.0);
  vec2 o = vec2(hash(id + 1.3), hash(id + 7.1)) - 0.5;
  float d = length(f - o * 0.7);
  float tw = 0.55 + 0.45 * sin(t * (1.0 + h * 3.0) + h * 40.0);
  float s = smoothstep(0.06, 0.0, d) * tw;
  vec3 tint = mix(vec3(1.0, 0.93, 0.8), vec3(1.0, 0.8, 0.55), hash(id + 3.7));
  return tint * s * (h - 0.9) * 10.0;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res.y;
  vec2 st = gl_FragCoord.xy / u_res;
  float t = u_time;
  float s = u_scroll;

  // Journey palette: golden dawn -> ember dusk -> deep umber night.
  vec3 dawnTop = vec3(0.05, 0.035, 0.022), dawnLow = vec3(0.22, 0.12, 0.05);
  vec3 abyssTop = vec3(0.045, 0.03, 0.02), abyssLow = vec3(0.17, 0.075, 0.035);
  vec3 nightTop = vec3(0.03, 0.022, 0.015), nightLow = vec3(0.08, 0.05, 0.028);
  float a = smoothstep(0.0, 0.45, s), b = smoothstep(0.5, 1.0, s);
  vec3 top = mix(mix(dawnTop, abyssTop, a), nightTop, b);
  vec3 low = mix(mix(dawnLow, abyssLow, a), nightLow, b);
  vec3 col = mix(low, top, smoothstep(0.0, 0.9, st.y));

  // Aether currents: domain-warped noise flowing like water.
  vec2 p = uv * 1.6 + vec2(0.0, s * 3.0) + u_mouse * 0.05;
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.03)), fbm(p + vec2(5.2, 1.3) - t * 0.025));
  vec2 r = vec2(fbm(p + 3.5 * q + vec2(1.7, 9.2) + t * 0.02), fbm(p + 3.5 * q + vec2(8.3, 2.8)));
  float f = fbm(p + 3.0 * r);
  vec3 gold = vec3(0.93, 0.72, 0.36), honey = vec3(0.98, 0.88, 0.64), ember = vec3(0.85, 0.42, 0.18);
  vec3 current = mix(mix(gold, ember, a), honey, b * 0.5 + a * 0.2);
  current = mix(current, honey, clamp(length(q) * 0.6, 0.0, 1.0) * 0.5);
  float veil = smoothstep(0.42, 1.0, f) * (0.3 + 0.08 * sin(t * 0.2));
  vec3 deep = mix(vec3(0.42, 0.24, 0.1), vec3(0.6, 0.3, 0.12), q.x);
  col += deep * smoothstep(0.3, 0.8, length(r) * 0.7) * 0.18;
  col += current * veil * 0.38;
  col += current * pow(f, 5.0) * 0.6;

  // Stars, in two depths with scroll parallax.
  vec2 su = uv + vec2(0.0, s * 0.6);
  col += stars(su, 90.0, t) * 0.9;
  col += stars(su * 1.7 + 4.0, 140.0, t * 1.3) * 0.6;

  // Rising motes: slow sparks drifting upward, like feathers of light.
  vec2 m = uv * 9.0;
  m.y -= t * 0.18 + s * 4.0;
  vec2 mid = floor(m), mf = fract(m) - 0.5;
  float mh = hash(mid);
  if (mh > 0.9) {
    vec2 mo = vec2(sin(t * 0.5 + mh * 20.0) * 0.25, hash(mid + 2.0) - 0.5);
    float md = length(mf - mo);
    float glow = smoothstep(0.05, 0.0, md) + smoothstep(0.22, 0.0, md) * 0.18;
    col += mix(gold, honey, hash(mid + 9.0)) * glow * (0.5 + 0.5 * sin(t * 1.3 + mh * 30.0));
  }

  // Horizon glow at the bottom of the first screen (dawn breaking over Atreia).
  float horizon = exp(-pow((st.y - 0.0) * 2.4, 2.0)) * (1.0 - a);
  col += vec3(0.95, 0.68, 0.35) * horizon * 0.22;

  // Vignette
  vec2 v = st - 0.5;
  col *= 1.0 - dot(v, v) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function AetherSky() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const gl = el?.getContext('webgl', { antialias: false, premultipliedAlpha: false });
    if (!el || !gl) return;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'u_res');
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uScroll = gl.getUniformLocation(program, 'u_scroll');
    const uMouse = gl.getUniformLocation(program, 'u_mouse');

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Render below device resolution: the sky is soft, and this keeps it cheap.
    const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.6;
    let mouse = [0, 0];
    let target = [0, 0];
    let frame = 0;
    let visible = true;
    const start = performance.now();

    const resize = () => {
      el.width = Math.round(window.innerWidth * scale);
      el.height = Math.round(window.innerHeight * scale);
      gl.viewport(0, 0, el.width, el.height);
    };
    const scrollProgress = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    };
    const draw = (now: number) => {
      mouse = [
        mouse[0]! + (target[0]! - mouse[0]!) * 0.04,
        mouse[1]! + (target[1]! - mouse[1]!) * 0.04,
      ];
      gl.uniform2f(uRes, el.width, el.height);
      gl.uniform1f(uTime, still ? 12 : (now - start) / 1000);
      gl.uniform1f(uScroll, scrollProgress());
      gl.uniform2f(uMouse, mouse[0]!, mouse[1]!);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    let last = 0;
    const loop = (now: number) => {
      // About 30 fps: the sky moves slowly, and this leaves the GPU for the page.
      if (visible && now - last >= 32) {
        last = now;
        draw(now);
      }
      frame = requestAnimationFrame(loop);
    };
    const onScroll = () => draw(performance.now());
    const onMove = (e: PointerEvent) => {
      target = [e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5];
    };
    const onVisibility = () => {
      visible = !document.hidden;
    };

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    if (still) {
      draw(start);
      window.addEventListener('scroll', onScroll, { passive: true });
    } else {
      window.addEventListener('pointermove', onMove, { passive: true });
      frame = requestAnimationFrame(loop);
    }
    el.dataset.ready = 'true';

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 bg-void">
      {/* CSS sky shown until (or instead of) the shader. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_110%,oklch(0.4_0.09_70/0.5),transparent_60%),radial-gradient(80%_60%_at_80%_10%,oklch(0.28_0.06_50/0.4),transparent_70%)]" />
      <canvas
        ref={canvas}
        className="absolute inset-0 size-full opacity-0 transition-opacity duration-1000 data-[ready=true]:opacity-100"
      />
    </div>
  );
}
