import json
from pathlib import Path

DATA_PATH = Path('scripts/output/synthetic_trading_data.json')
OUTPUT_PATH = Path('scripts/output/synthetic_chart.svg')

with DATA_PATH.open() as f:
    payload = json.load(f)

points = payload['points']
values = [p['totalValue'] for p in points]
labels = [p['label'] for p in points]

width, height = 900, 420
padding = 60
usable_width = width - 2 * padding
usable_height = height - 2 * padding

min_val = min(values)
max_val = max(values)
val_range = max_val - min_val or 1

coords = []
for idx, value in enumerate(values):
    x = padding + (usable_width * idx / (len(values) - 1)) if len(values) > 1 else padding + usable_width / 2
    y = padding + usable_height * (1 - (value - min_val) / val_range)
    coords.append((x, y))

# Build SVG path
path_d = 'M ' + ' L '.join(f"{x:.2f} {y:.2f}" for x, y in coords)

# Create SVG elements
svg_lines = [
    f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{height}' viewBox='0 0 {width} {height}'>",
    "  <rect width='100%' height='100%' fill='#0b1120' rx='16' />",
    "  <g stroke='#1f2937' stroke-width='1'>",
]
# Horizontal grid lines
for i in range(5):
    y = padding + usable_height * i / 4
    svg_lines.append(f"    <line x1='{padding}' y1='{y:.2f}' x2='{width - padding}' y2='{y:.2f}' stroke-opacity='0.4' />")
svg_lines.append('  </g>')
svg_lines.append("  <path d='{path_d}' fill='none' stroke='#38bdf8' stroke-width='3' stroke-linecap='round' stroke-linejoin='round' />".format(path_d=path_d))

for (x, y), label, value in zip(coords, labels, values):
    svg_lines.append(f"  <circle cx='{x:.2f}' cy='{y:.2f}' r='5' fill='#f97316' stroke='#fff' stroke-width='2' />")
    svg_lines.append(f"  <text x='{x:.2f}' y='{height - padding / 2:.2f}' fill='#e2e8f0' font-size='14' text-anchor='middle'>{label}</text>")
    svg_lines.append(f"  <text x='{x:.2f}' y='{y - 12:.2f}' fill='#38bdf8' font-size='12' text-anchor='middle'>${value:,.0f}</text>")

svg_lines.append('  <text x="{0}" y="{1}" fill="#e2e8f0" font-size="16" font-weight="bold">Synthetic trading performance (weekends skipped)</text>'.format(width/2, padding/2))
svg_lines.append('</svg>')

OUTPUT_PATH.write_text('\n'.join(svg_lines))
print(f'Saved chart to {OUTPUT_PATH.resolve()}')
