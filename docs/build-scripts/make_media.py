"""Generates original SVG artwork: four vehicle illustrations and the animated hero scene.
Run from /home/claude/build. Output goes into the project's public/assets/images."""
import math, pathlib
OUT = pathlib.Path('/home/claude/airport-transfer-system/public/assets/images')
INK, BLUE, SUN, SKY = '#0f2236', '#1f6fb5', '#f6c453', '#e3f0fa'

def wheel(cx, cy, r):
    return (f'<g class="wheel"><circle cx="{cx}" cy="{cy}" r="{r+5}" fill="{INK}" opacity=".18"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{INK}"/><circle cx="{cx}" cy="{cy}" r="{r*0.46:.1f}" fill="#c9d6e3"/>'
            f'<path d="M{cx} {cy-r*0.46:.1f}V{cy+r*0.46:.1f}M{cx-r*0.46:.1f} {cy}H{cx+r*0.46:.1f}" stroke="{INK}" stroke-width="2.5"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r*0.14:.1f}" fill="{INK}"/></g>')

def vehicle_inner(kind):
    """Side view, facing right. Ground line is y=152."""
    if kind == 'sedan':
        body, col = 'M24 122 L24 104 Q24 94 38 91 L98 80 Q122 50 166 46 L238 46 Q276 48 298 76 L352 86 Q376 90 376 108 L376 122 Z', BLUE
        glass = ['M112 80 Q130 58 168 56 L200 56 L200 80 Z', 'M210 56 L238 56 Q266 58 284 78 L210 80 Z']
        wh, extra = [(100, 126, 24), (300, 126, 24)], '<path d="M205 82 V120" stroke="#0f2236" stroke-opacity=".3" stroke-width="2"/>'
    elif kind == 'suv':
        body, col = 'M22 128 L22 102 Q22 92 36 89 L88 82 L112 54 Q118 46 132 46 L276 46 Q292 46 300 56 L322 82 L356 88 Q378 92 378 110 L378 128 Z', '#36506b'
        glass = ['M122 56 L194 56 L194 80 L104 80 Z', 'M204 56 L274 56 Q284 56 290 64 L306 80 L204 80 Z']
        wh, extra = [(100, 128, 26), (300, 128, 26)], '<path d="M130 41 H270" stroke="#0f2236" stroke-width="4" stroke-linecap="round"/><path d="M199 82 V124" stroke="#0f2236" stroke-opacity=".3" stroke-width="2"/>'
    elif kind == 'van':
        body, col = 'M20 130 L20 62 Q20 48 34 48 L286 48 Q304 48 316 64 L352 94 Q376 100 376 116 L376 130 Z', '#f4f7fa'
        glass = ['M44 60 L120 60 L120 90 L44 90 Z', 'M130 60 L206 60 L206 90 L130 90 Z', 'M254 58 L286 58 Q296 58 304 68 L326 92 L254 92 Z']
        wh, extra = [(96, 130, 26), (300, 130, 26)], f'<path d="M214 54 V126" stroke="{INK}" stroke-opacity=".3" stroke-width="2"/><path d="M20 112 H376" stroke="{BLUE}" stroke-width="5"/>'
    else:  # luxury
        body, col = 'M16 122 L16 108 Q16 98 30 95 L110 86 Q140 62 186 58 L246 58 Q282 60 306 82 L360 90 Q384 94 384 110 L384 122 Z', INK
        glass = ['M126 86 Q146 68 186 66 L216 66 L216 86 Z', 'M224 66 L246 66 Q272 68 290 86 L224 86 Z']
        wh, extra = [(96, 126, 24), (308, 126, 24)], f'<path d="M30 108 H372" stroke="{SUN}" stroke-width="3"/><path d="M220 88 V120" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>'
    stroke = f' stroke="{INK}" stroke-width="2.5"' if kind == 'van' else ''
    parts = [f'<path d="{body}" fill="{col}"{stroke}/>']
    parts += [f'<path d="{g}" fill="#bfe0f5" stroke="{INK}" stroke-opacity=".35" stroke-width="1.5"/>' for g in glass]
    parts.append(extra)
    tail_y = 98 if kind != 'van' else 104
    parts.append(f'<rect x="{body.split()[0][1:]}" y="{tail_y}" width="9" height="8" rx="2" fill="#e5484d"/>')
    parts.append(f'<rect x="{float(body.split(" L")[0].split()[0][1:]) and 0 or 0}" y="0" width="0" height="0"/>') if False else None
    front_x = {'sedan': 367, 'suv': 369, 'van': 367, 'luxury': 375}[kind]
    parts.append(f'<rect x="{front_x}" y="{tail_y}" width="9" height="8" rx="2" fill="{SUN}"/>')
    for cx, cy, r in wh:
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="{r+6}" fill="{INK}" opacity=".85"/>')
    for cx, cy, r in wh:
        parts.append(wheel(cx, cy, r))
    return '\n'.join(p for p in parts if p)

def vehicle_svg(kind):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 170" role="img" aria-label="{kind} illustration">'
            f'<ellipse cx="200" cy="154" rx="172" ry="7" fill="{INK}" opacity=".12"/>{vehicle_inner(kind)}</svg>')

def bridge():
    x0, x1, base, top = 300, 730, 296, 168
    mid = (x0 + x1) / 2
    def arc_y(x):  # quadratic bezier through (x0,base) ctrl(mid, 2*top-base) (x1,base)
        t = (x - x0) / (x1 - x0); cy = 2 * top - base
        return (1 - t) ** 2 * base + 2 * (1 - t) * t * cy + t ** 2 * base
    hangers = ''.join(f'<path d="M{x} {arc_y(x):.1f}V{base}"/>' for x in range(x0 + 24, x1, 22))
    return (f'<g fill="none" stroke="{INK}" stroke-opacity=".55" stroke-width="3" stroke-linecap="round">'
            f'<path d="M{x0} {base}Q{mid} {2*top-base} {x1} {base}" stroke-width="6"/><path d="M{x0-20} {base}H{x1+20}" stroke-width="5"/>'
            f'<g stroke-width="1.6">{hangers}</g><path d="M{x0} {base}V{base+14}M{x1} {base}V{base+14}" stroke-width="8"/></g>')

def opera():
    shells = ['M70 300 Q74 236 126 212 Q134 262 128 300Z', 'M112 300 Q120 222 190 196 Q204 256 190 300Z',
              'M168 300 Q184 236 236 222 Q238 266 232 300Z', 'M206 300 Q222 262 262 256 Q258 282 252 300Z']
    return ''.join(f'<path d="{s}" fill="#fff" stroke="{INK}" stroke-opacity=".35" stroke-width="2.5" stroke-linejoin="round"/>' for s in shells) + \
           f'<path d="M50 300H290" stroke="{INK}" stroke-opacity=".5" stroke-width="5" stroke-linecap="round"/>'

def scene(plane=22, car=14, clouds=(50, 70, 60), wheel_s=0.9, dash=2, h=360):
    cloud = lambda cx, cy, s: (f'<g transform="translate({cx} {cy}) scale({s})" fill="#fff"><ellipse cx="0" cy="0" rx="46" ry="16"/>'
                               f'<ellipse cx="-22" cy="-10" rx="24" ry="16"/><ellipse cx="14" cy="-16" rx="28" ry="20"/></g>')
    css = f'''
.c1{{animation:drift {clouds[0]}s linear infinite}} .c2{{animation:drift {clouds[1]}s linear infinite;animation-delay:-{clouds[1]*0.4:.1f}s}}
.c3{{animation:drift {clouds[2]}s linear infinite;animation-delay:-{clouds[2]*0.75:.1f}s}}
@keyframes drift{{from{{transform:translateX(-260px)}}to{{transform:translateX(820px)}}}}
.plane{{offset-path:path('M-40 250 C 160 60, 420 40, 760 140');offset-rotate:auto;animation:fly {plane}s linear infinite}}
@keyframes fly{{from{{offset-distance:0%}}to{{offset-distance:100%}}}}
.trail{{stroke-dasharray:3 10;animation:dash {dash}s linear infinite}}
@keyframes dash{{to{{stroke-dashoffset:-26}}}}
.car{{animation:drive {car}s linear infinite}}
@keyframes drive{{from{{transform:translateX(-170px)}}to{{transform:translateX(780px)}}}}
.wheel{{transform-box:fill-box;transform-origin:center;animation:spin {wheel_s}s linear infinite}}
@keyframes spin{{to{{transform:rotate(360deg)}}}}
.sun{{transform-box:fill-box;transform-origin:center;animation:pulse 6s ease-in-out infinite}}
@keyframes pulse{{50%{{transform:scale(1.06)}}}}'''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 {h}" role="img" aria-label="A plane flying over Sydney while a car drives to the airport">
<style>{css}</style>
<g transform="translate(0 {h-360})">
<circle class="sun" cx="560" cy="96" r="72" fill="{SUN}" opacity=".7"/>
<g class="c1">{cloud(0,70,1)}</g><g class="c2">{cloud(0,120,0.8)}</g><g class="c3">{cloud(0,40,0.6)}</g>
<path class="trail" d="M-40 250 C 160 60, 420 40, 760 140" fill="none" stroke="{BLUE}" stroke-opacity=".5" stroke-width="2.5" stroke-linecap="round"/>
<g class="plane"><g transform="scale(1.4)" stroke="{INK}" stroke-width="1.4" stroke-linejoin="round" fill="#fff">
<path d="M-8 -3 L-18 -14 L-11 -14 L4 -3Z" fill="#dbe8f3"/><path d="M-22 0 Q-22 -5 -14 -5 L18 -5 Q26 -3 28 0 Q26 4 18 5 L-14 5 Q-22 5 -22 0Z"/>
<path d="M-20 -4 L-27 -16 L-19 -16 L-9 -4Z"/><path d="M-4 3 L-16 17 L-7 17 L11 3Z"/></g></g>
<g opacity=".95">{opera()}</g>{bridge()}
<rect x="0" y="312" width="720" height="48" fill="#fff"/><path d="M0 312H720" stroke="{INK}" stroke-opacity=".15"/>
<path d="M0 340H720" stroke="{BLUE}" stroke-opacity=".35" stroke-width="3" stroke-dasharray="26 22"/>
<g class="car"><g transform="translate(0 292) scale(.3)">{vehicle_inner('sedan')}</g></g>
</g></svg>'''

if __name__ == '__main__':
    for k in ('sedan', 'suv', 'van', 'luxury'):
        (OUT / 'vehicles' / f'{k}.svg').write_text(vehicle_svg(k))
    (OUT / 'hero-scene.svg').write_text(scene())
    # Video variant: every animation period divides 8 seconds so the recording loops seamlessly
    (pathlib.Path('/home/claude/build') / 'scene-video.svg').write_text(scene(plane=8, car=8, clouds=(8, 8, 4), wheel_s=0.8, dash=2, h=405))
    print('ok')
